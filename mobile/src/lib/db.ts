import * as SQLite from 'expo-sqlite';
import type { EventStore, QueuedEvent } from './sync/engine';

/**
 * Local SQLite database (on the device only). Holds:
 *  - attendance_queue: every clock event until the server confirms it (never auto-deleted)
 *  - message_outbox: messages written offline
 *  - cache: last downloaded schedule/status/conversations for offline viewing
 * Contains work data only — no passwords or tokens (those are in the secure keystore).
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('bluecollar.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS attendance_queue (
          id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, type TEXT NOT NULL, device_time TEXT NOT NULL,
          shift_id TEXT, lat REAL, lng REAL, accuracy_m REAL, device_id TEXT NOT NULL, recorded_offline INTEGER NOT NULL,
          state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, last_error TEXT,
          flags TEXT NOT NULL DEFAULT '[]', session_id TEXT, server_received_at TEXT, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS attendance_queue_state ON attendance_queue (state, next_attempt_at);
        CREATE TABLE IF NOT EXISTS message_outbox (
          id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, conversation_id TEXT NOT NULL, body TEXT NOT NULL,
          created_at TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      `);
      return d;
    })();
  }
  return dbPromise;
}

type Row = Record<string, string | number | null>;
const toEvent = (r: Row): QueuedEvent => ({
  id: r.id as string, companyId: r.company_id as string, type: r.type as QueuedEvent['type'], deviceTime: r.device_time as string,
  shiftId: (r.shift_id as string) ?? null, lat: (r.lat as number) ?? null, lng: (r.lng as number) ?? null, accuracyM: (r.accuracy_m as number) ?? null,
  deviceId: r.device_id as string, recordedOffline: r.recorded_offline === 1, state: r.state as QueuedEvent['state'], attempts: r.attempts as number,
  nextAttemptAt: r.next_attempt_at as number, lastError: (r.last_error as string) ?? null, flags: JSON.parse((r.flags as string) ?? '[]'),
  sessionId: (r.session_id as string) ?? null, serverReceivedAt: (r.server_received_at as string) ?? null, createdAt: r.created_at as number,
});

const COLS: Record<keyof QueuedEvent, string> = {
  id: 'id', companyId: 'company_id', type: 'type', deviceTime: 'device_time', shiftId: 'shift_id', lat: 'lat', lng: 'lng', accuracyM: 'accuracy_m',
  deviceId: 'device_id', recordedOffline: 'recorded_offline', state: 'state', attempts: 'attempts', nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error', flags: 'flags', sessionId: 'session_id', serverReceivedAt: 'server_received_at', createdAt: 'created_at',
};
const val = (k: keyof QueuedEvent, v: unknown) => (k === 'flags' ? JSON.stringify(v) : k === 'recordedOffline' ? (v ? 1 : 0) : (v as string | number | null));

export const sqliteEventStore: EventStore = {
  async insert(e) {
    const d = await db();
    const keys = Object.keys(COLS) as (keyof QueuedEvent)[];
    await d.runAsync(
      `INSERT INTO attendance_queue (${keys.map((k) => COLS[k]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((k) => val(k, e[k])),
    );
  },
  async update(id, patch) {
    const keys = Object.keys(patch) as (keyof QueuedEvent)[];
    if (!keys.length) return;
    const d = await db();
    await d.runAsync(`UPDATE attendance_queue SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => val(k, patch[k])), id]);
  },
  async all(companyId) {
    const d = await db();
    const rows = companyId
      ? await d.getAllAsync<Row>(`SELECT * FROM attendance_queue WHERE company_id = ? ORDER BY device_time DESC, created_at DESC LIMIT 500`, [companyId])
      : await d.getAllAsync<Row>(`SELECT * FROM attendance_queue ORDER BY device_time DESC, created_at DESC LIMIT 500`);
    return rows.map(toEvent);
  },
  async due(now) {
    const d = await db();
    const rows = await d.getAllAsync<Row>(`SELECT * FROM attendance_queue WHERE state IN ('saved','pending') AND next_attempt_at <= ? ORDER BY device_time`, [now]);
    return rows.map(toEvent);
  },
};

export async function cacheGet<T>(key: string): Promise<{ value: T; updatedAt: number } | null> {
  const d = await db();
  const r = await d.getFirstAsync<{ value: string; updated_at: number }>(`SELECT value, updated_at FROM cache WHERE key = ?`, [key]);
  return r ? { value: JSON.parse(r.value) as T, updatedAt: r.updated_at } : null;
}

export async function cacheSet(key: string, value: unknown) {
  const d = await db();
  await d.runAsync(`INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, JSON.stringify(value), Date.now()]);
}

/** On sign-out: clear cached work data. Unsynced attendance is KEPT and synced at the next sign-in. */
export async function clearCache() {
  const d = await db();
  await d.runAsync(`DELETE FROM cache`);
}
