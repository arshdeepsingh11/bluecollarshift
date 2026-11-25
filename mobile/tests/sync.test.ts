/**
 * Offline synchronisation tests (owner requirement: "Test offline functionality extensively").
 * Covers: offline clock-in/out, app restart with pending events, reconnection, duplicate
 * synchronisation attempts, failed sync + retry/back-off, rejected events kept, server review flags,
 * ordering, auth expiry, and "never silently delete pending events".
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SyncBatchResponse } from '@bluecollar/shared';
import { AuthError, MemoryStore, NetworkError, RejectedError, SyncEngine, type Transport } from '../src/lib/sync/engine';

const C = 'company-1';
const loc = { lat: 51.19, lng: -114.47, accuracyM: 8 };

/** Fake server that behaves like the real API: idempotent by id, pairs in order. */
class FakeServer implements Transport {
  constructor(private readonly now: () => number) {}
  online = true;
  failNext: Error | null = null;
  received = new Map<string, { type: string; offline: boolean; deviceTime: string }>();
  calls: string[][] = [];
  async sendBatch(_companyId: string, events: { id: string; type: string; offline: boolean; deviceTime: string }[]): Promise<SyncBatchResponse> {
    if (!this.online) throw new NetworkError('offline');
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.calls.push(events.map((e) => e.id));
    const results = events.map((e) => {
      const at = new Date().toISOString();
      if (this.received.has(e.id)) return { id: e.id, result: 'duplicate' as const, sessionId: 's1', flags: [], serverReceivedAt: at };
      if (Date.parse(e.deviceTime) > this.now() + 120_000) return { id: e.id, result: 'rejected' as const, reason: 'Offline event is in the future' };
      this.received.set(e.id, e);
      const flags = e.offline ? ['offline_device_time'] : [];
      return { id: e.id, result: 'accepted' as const, sessionId: 's1', flags, serverReceivedAt: at };
    });
    return { results, serverTime: new Date().toISOString() };
  }
}

let store: MemoryStore;
let server: FakeServer;
let clock: number;
let engine: SyncEngine;

beforeEach(() => {
  store = new MemoryStore();
  clock = Date.parse('2027-01-04T15:00:00Z');
  server = new FakeServer(() => clock);
  engine = new SyncEngine(store, server, { now: () => clock, random: () => 0.5, uuid: randomUUID });
});

describe('offline attendance', () => {
  it('saves locally BEFORE any network call and survives no signal', async () => {
    server.online = false;
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    expect(store.rows.get(e.id)?.state).toBe('pending');
    expect(server.received.size).toBe(0);
    const s = await engine.sync();
    expect(s.networkError).toBe(true);
    expect(store.rows.get(e.id)?.state).toBe('pending'); // still safe on the device
    expect(store.rows.get(e.id)?.attempts).toBe(1);
  });

  it('pending events survive an app restart (new engine, same store) and sync on reconnect', async () => {
    server.online = false;
    const a = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    clock += 8 * 3600_000;
    const b = await engine.record({ companyId: C, type: 'clock_out', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    // "Restart": a brand-new engine instance using the persisted store.
    const engine2 = new SyncEngine(store, server, { now: () => clock, random: () => 0.5, uuid: randomUUID });
    server.online = true;
    const s = await engine2.retryNow();
    expect(s.synced).toBe(2);
    expect(store.rows.get(a.id)?.state).toBe('synced');
    expect(store.rows.get(b.id)?.state).toBe('synced');
    // Sent in device-time order: clock-in before clock-out.
    expect(server.calls[0]).toEqual([a.id, b.id]);
    // Offline semantics preserved: device time kept and flagged.
    expect(server.received.get(a.id)?.offline).toBe(true);
    expect(store.rows.get(a.id)?.flags).toContain('offline_device_time');
  });

  it('duplicate synchronisation attempts never create duplicate records', async () => {
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: true });
    await engine.sync();
    // Simulate a lost response: the app thinks it is still pending and sends again.
    await store.update(e.id, { state: 'pending', nextAttemptAt: clock });
    await engine.sync();
    expect(server.received.size).toBe(1);
    expect(store.rows.get(e.id)?.state).toBe('synced');
  });

  it('retries with exponential back-off and does not hammer the server', async () => {
    server.online = false;
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    await engine.sync();
    const first = store.rows.get(e.id)!.nextAttemptAt - clock;
    expect(first).toBe(5000);
    await engine.sync(); // not due yet → nothing sent, attempts unchanged
    expect(store.rows.get(e.id)?.attempts).toBe(1);
    clock += 5000;
    await engine.sync();
    expect(store.rows.get(e.id)!.nextAttemptAt - clock).toBe(15000);
  });

  it('future-dated events rejected by the server stay visible as rejected', async () => {
    server.online = false;
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    clock -= 3 * 3600_000; // phone clock was ahead; server clock is now earlier
    server.online = true;
    await store.update(e.id, { nextAttemptAt: clock });
    await engine.sync();
    expect(store.rows.get(e.id)?.state).toBe('rejected');
    expect(store.rows.get(e.id)?.lastError).toContain('future');
  });

  it('rejected events are kept with the reason (never deleted)', async () => {
    server.failNext = new RejectedError('Validation failed', 400);
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: null, deviceId: 'dev-1', online: true });
    await engine.sync();
    expect(store.rows.get(e.id)?.state).toBe('rejected');
    expect(store.rows.get(e.id)?.lastError).toContain('Validation');
    expect(store.rows.size).toBe(1);
  });

  it('server 5xx / rate limit are retried, not rejected', async () => {
    server.failNext = new RejectedError('busy', 429);
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: true });
    await engine.sync();
    expect(store.rows.get(e.id)?.state).toBe('pending');
  });

  it('expired login pauses sync without losing events', async () => {
    server.failNext = new AuthError('expired');
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: true });
    const s = await engine.sync();
    expect(s.authError).toBe(true);
    expect(store.rows.get(e.id)?.state).toBe('pending');
    engine.authBlocked = false; // user signed in again
    await engine.sync();
    expect(store.rows.get(e.id)?.state).toBe('synced');
  });

  it('enforces the clock state machine locally (no double clock-in)', async () => {
    await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    await expect(engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false })).rejects.toThrow();
    expect(await engine.allowedNext(C)).toEqual(['break_start', 'clock_out']);
  });

  it('an event delivered late is sent with offline semantics even if recorded "online"', async () => {
    server.online = false;
    const e = await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: true });
    await engine.sync(); // fails, phone lost signal right after tapping
    clock += 10 * 60_000;
    server.online = true;
    await engine.retryNow();
    expect(server.received.get(e.id)?.offline).toBe(true);
  });

  it('concurrent sync calls share one run (no double sending)', async () => {
    await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    expect(server.calls.length).toBe(1);
  });

  it('reports counts for the sync status banner', async () => {
    server.online = false;
    await engine.record({ companyId: C, type: 'clock_in', shiftId: null, location: loc, deviceId: 'dev-1', online: false });
    expect(await engine.counts(C)).toEqual({ pending: 1, needsReview: 0, rejected: 0 });
  });
});
