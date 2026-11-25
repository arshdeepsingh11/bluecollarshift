/**
 * Offline-first attendance synchronisation engine (pure TypeScript — no React Native imports,
 * so it is unit-tested in Node: tests/sync.test.ts).
 *
 * Guarantees:
 *  1. An event is written to durable local storage BEFORE any network call.
 *  2. Every event has a device-generated UUID — the server treats it as an idempotency key, so
 *     retries can never create duplicates.
 *  3. Events are never deleted locally. They move saved → pending → synced | needs_review | rejected.
 *  4. Network failures retry with exponential back-off; validation failures are kept as rejected
 *     (visible to the employee and manager), never silently dropped.
 *  5. Events are sent in device-time order so the server pairs clock-in/clock-out correctly.
 */
import {
  allowedNextEvents,
  localStateFor,
  nextRetryDelayMs,
  type LocalSyncState,
  type SyncBatchResponse,
  type TimeEventType,
} from '@bluecollar/shared';

export interface QueuedEvent {
  id: string;
  companyId: string;
  type: TimeEventType;
  deviceTime: string;
  shiftId: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  deviceId: string;
  recordedOffline: boolean;
  state: LocalSyncState;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  flags: string[];
  sessionId: string | null;
  serverReceivedAt: string | null;
  createdAt: number;
}

export interface EventStore {
  insert(e: QueuedEvent): Promise<void>;
  update(id: string, patch: Partial<QueuedEvent>): Promise<void>;
  /** All events, newest first (for the UI and for deriving clock state). */
  all(companyId?: string): Promise<QueuedEvent[]>;
  /** Events waiting to be sent whose retry time has come. */
  due(now: number): Promise<QueuedEvent[]>;
}

export class NetworkError extends Error {}
export class AuthError extends Error {}
export class RejectedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface Transport {
  sendBatch(companyId: string, events: Array<Omit<QueuedEvent, 'state' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'flags' | 'sessionId' | 'serverReceivedAt' | 'createdAt' | 'companyId' | 'recordedOffline'> & { offline: boolean }>): Promise<SyncBatchResponse>;
}

export interface EngineOptions {
  now?: () => number;
  random?: () => number;
  uuid: () => string;
  batchSize?: number;
  /** An event sent later than this after it happened is treated as offline (device time kept). */
  lateThresholdMs?: number;
}

export interface RecordInput {
  companyId: string;
  type: TimeEventType;
  shiftId: string | null;
  location: { lat: number; lng: number; accuracyM: number | null } | null;
  deviceId: string;
  online: boolean;
}

type Listener = () => void;

export class SyncEngine {
  private running: Promise<SyncSummary> | null = null;
  private listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly batchSize: number;
  private readonly lateThresholdMs: number;
  /** Set when the server returns 401; cleared after the user signs in again. */
  authBlocked = false;

  constructor(
    private readonly store: EventStore,
    private readonly transport: Transport,
    private readonly opts: EngineOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.batchSize = opts.batchSize ?? 50;
    this.lateThresholdMs = opts.lateThresholdMs ?? 60_000;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** The next allowed actions, derived from the latest local (synced or pending) event. */
  async allowedNext(companyId: string): Promise<TimeEventType[]> {
    const last = (await this.store.all(companyId)).find((e) => e.state !== 'rejected');
    return allowedNextEvents(last?.type ?? null);
  }

  /** Save the event durably FIRST, then try to send it. Returns the saved event. */
  async record(input: RecordInput): Promise<QueuedEvent> {
    const allowed = await this.allowedNext(input.companyId);
    if (!allowed.includes(input.type)) throw new Error(`Cannot ${input.type.replace('_', ' ')} now.`);
    const e: QueuedEvent = {
      id: this.opts.uuid(),
      companyId: input.companyId,
      type: input.type,
      deviceTime: new Date(this.now()).toISOString(),
      shiftId: input.shiftId,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      accuracyM: input.location?.accuracyM ?? null,
      deviceId: input.deviceId,
      recordedOffline: !input.online,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      lastError: null,
      flags: [],
      sessionId: null,
      serverReceivedAt: null,
      createdAt: this.now(),
    };
    await this.store.insert(e);
    this.emit();
    if (input.online) void this.sync();
    return e;
  }

  /** Send all due events. Safe to call often (concurrent calls share one run). */
  sync(): Promise<SyncSummary> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<SyncSummary> {
    const summary: SyncSummary = { sent: 0, synced: 0, needsReview: 0, rejected: 0, retrying: 0, networkError: false, authError: false };
    if (this.authBlocked) {
      summary.authError = true;
      return summary;
    }
    const due = (await this.store.due(this.now())).sort((a, b) => Date.parse(a.deviceTime) - Date.parse(b.deviceTime));
    const byCompany = new Map<string, QueuedEvent[]>();
    for (const e of due) byCompany.set(e.companyId, [...(byCompany.get(e.companyId) ?? []), e]);

    for (const [companyId, events] of byCompany) {
      for (let i = 0; i < events.length; i += this.batchSize) {
        const batch = events.slice(i, i + this.batchSize);
        const sendTime = this.now();
        try {
          const res = await this.transport.sendBatch(
            companyId,
            batch.map((e) => ({
              id: e.id, type: e.type, deviceTime: e.deviceTime, shiftId: e.shiftId, lat: e.lat, lng: e.lng, accuracyM: e.accuracyM, deviceId: e.deviceId,
              // Late delivery = offline semantics: the server keeps the device time and flags it for review.
              offline: e.recordedOffline || sendTime - Date.parse(e.deviceTime) > this.lateThresholdMs,
            })),
          );
          summary.sent += batch.length;
          for (const r of res.results) {
            const state = localStateFor(r);
            if (r.result === 'rejected') {
              summary.rejected++;
              await this.store.update(r.id, { state, lastError: r.reason });
            } else {
              if (state === 'needs_review') summary.needsReview++;
              else summary.synced++;
              await this.store.update(r.id, { state, flags: r.flags, sessionId: r.sessionId, serverReceivedAt: r.serverReceivedAt, lastError: null });
            }
          }
          // Any event the server did not mention stays pending and is retried.
          const answered = new Set(res.results.map((r) => r.id));
          for (const e of batch) if (!answered.has(e.id)) await this.retryLater(e, 'No response for this event', summary);
        } catch (err) {
          if (err instanceof AuthError) {
            this.authBlocked = true;
            summary.authError = true;
            this.emit();
            return summary;
          }
          if (err instanceof RejectedError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
            // The whole batch was refused (e.g. validation). Keep the events, mark rejected with the reason.
            for (const e of batch) await this.store.update(e.id, { state: 'rejected', lastError: err.message });
            summary.rejected += batch.length;
            continue;
          }
          summary.networkError = true;
          for (const e of batch) await this.retryLater(e, err instanceof Error ? err.message : 'Network error', summary);
          break; // stop this company; try again on reconnect / back-off
        }
      }
    }
    this.emit();
    return summary;
  }

  private async retryLater(e: QueuedEvent, reason: string, summary: SyncSummary) {
    summary.retrying++;
    await this.store.update(e.id, {
      state: 'pending',
      attempts: e.attempts + 1,
      nextAttemptAt: this.now() + nextRetryDelayMs(e.attempts, this.random),
      lastError: reason,
    });
  }

  /** Force an immediate retry (e.g. connectivity restored). */
  async retryNow() {
    const all = await this.store.all();
    for (const e of all) if (e.state === 'pending' && e.nextAttemptAt > this.now()) await this.store.update(e.id, { nextAttemptAt: this.now() });
    return this.sync();
  }

  async counts(companyId?: string) {
    const all = await this.store.all(companyId);
    return {
      pending: all.filter((e) => e.state === 'pending' || e.state === 'saved').length,
      needsReview: all.filter((e) => e.state === 'needs_review').length,
      rejected: all.filter((e) => e.state === 'rejected').length,
    };
  }
}

export interface SyncSummary {
  sent: number;
  synced: number;
  needsReview: number;
  rejected: number;
  retrying: number;
  networkError: boolean;
  authError: boolean;
}

/** In-memory store (tests). The app uses the SQLite store in sqliteStore.ts. */
export class MemoryStore implements EventStore {
  rows = new Map<string, QueuedEvent>();
  async insert(e: QueuedEvent) {
    if (this.rows.has(e.id)) throw new Error('duplicate id');
    this.rows.set(e.id, { ...e });
  }
  async update(id: string, patch: Partial<QueuedEvent>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
  async all(companyId?: string) {
    return [...this.rows.values()].filter((e) => !companyId || e.companyId === companyId).sort((a, b) => Date.parse(b.deviceTime) - Date.parse(a.deviceTime) || b.createdAt - a.createdAt);
  }
  async due(now: number) {
    return [...this.rows.values()].filter((e) => (e.state === 'pending' || e.state === 'saved') && e.nextAttemptAt <= now);
  }
}
