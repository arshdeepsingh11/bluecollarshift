import type { CrewMember } from '@bluecollar/shared';
import { api, ApiError } from './api';
import { db } from './db';
import { currentLocation, deviceId } from './device';
import * as Crypto from 'expo-crypto';

/**
 * Crew clock-in from one phone. Each person gets their own event id, created on the phone,
 * so retries never record anyone twice. With no signal the request is kept in SQLite and
 * sent automatically later (the server keeps the original phone time and flags it as offline).
 */
type EventType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
interface CrewBody {
  type: EventType;
  deviceTime: string;
  offline: boolean;
  deviceId: string;
  lat?: number;
  lng?: number;
  accuracyM?: number | null;
  entries: { id: string; membershipId: string }[];
}
export interface CrewResult { membershipId: string; result: string; reason?: string }

async function table() {
  const d = await db();
  await d.execAsync(`CREATE TABLE IF NOT EXISTS crew_queue (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`);
  return d;
}

export function loadCrew(companyId: string) {
  return api<{ items: CrewMember[] }>(`/companies/${companyId}/crew`);
}

export async function sendCrew(companyId: string, type: EventType, membershipIds: string[]): Promise<{ queued: boolean; results: CrewResult[] }> {
  const loc = await currentLocation().catch(() => null);
  const body: CrewBody = {
    type, deviceTime: new Date().toISOString(), offline: false, deviceId: await deviceId(),
    ...(loc ? { lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracyM } : {}),
    entries: membershipIds.map((membershipId) => ({ id: Crypto.randomUUID(), membershipId })),
  };
  try {
    const r = await api<{ results: CrewResult[] }>(`/companies/${companyId}/crew/events`, { method: 'POST', body });
    return { queued: false, results: r.results };
  } catch (e) {
    if (e instanceof ApiError && e.status > 0 && e.status < 500) throw e;
    const d = await table();
    await d.runAsync(`INSERT INTO crew_queue (id, company_id, body, created_at) VALUES (?,?,?,?)`,
      [Crypto.randomUUID(), companyId, JSON.stringify({ ...body, offline: true }), Date.now()]);
    return { queued: true, results: [] };
  }
}

/** Send any crew events saved while offline. Safe to call often. */
export async function flushCrewQueue() {
  const d = await table();
  const rows = await d.getAllAsync<{ id: string; company_id: string; body: string }>(`SELECT id, company_id, body FROM crew_queue WHERE attempts < 99 ORDER BY created_at LIMIT 20`);
  for (const r of rows) {
    try {
      await api(`/companies/${r.company_id}/crew/events`, { method: 'POST', body: JSON.parse(r.body) });
      await d.runAsync(`DELETE FROM crew_queue WHERE id = ?`, [r.id]);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && e.status !== 429) {
        // Refused by the server (e.g. no longer a crew lead): keep it with the reason, stop retrying.
        await d.runAsync(`UPDATE crew_queue SET attempts = 99, last_error = ? WHERE id = ?`, [e.message, r.id]);
      } else {
        await d.runAsync(`UPDATE crew_queue SET attempts = attempts + 1 WHERE id = ?`, [r.id]);
        break;
      }
    }
  }
}

/** Crew entries waiting to send, and ones the server refused (shown on the crew screen). */
export async function crewQueueStatus() {
  const d = await table();
  const r = await d.getFirstAsync<{ waiting: number; refused: number }>(
    `SELECT SUM(CASE WHEN attempts < 99 THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN attempts >= 99 THEN 1 ELSE 0 END) AS refused FROM crew_queue`);
  return { waiting: r?.waiting ?? 0, refused: r?.refused ?? 0 };
}
