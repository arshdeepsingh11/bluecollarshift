/**
 * Offline synchronisation contract between the mobile app and the server.
 *
 * Local states (device):   saved -> pending -> synced | rejected | needs_review
 * The device NEVER deletes an event until the server has returned a final result for it.
 */
import type { TimeEventType } from './schemas';

export const LOCAL_SYNC_STATES = ['saved', 'pending', 'synced', 'needs_review', 'rejected'] as const;
export type LocalSyncState = (typeof LOCAL_SYNC_STATES)[number];

export type ServerEventResult =
  | { id: string; result: 'accepted'; sessionId: string | null; flags: string[]; serverReceivedAt: string }
  | { id: string; result: 'needs_review'; sessionId: string | null; flags: string[]; serverReceivedAt: string }
  | { id: string; result: 'duplicate'; sessionId: string | null; flags: string[]; serverReceivedAt: string }
  | { id: string; result: 'rejected'; reason: string };

export interface SyncBatchResponse {
  results: ServerEventResult[];
  serverTime: string;
}

export function localStateFor(r: ServerEventResult): LocalSyncState {
  switch (r.result) {
    case 'accepted':
      return 'synced';
    case 'duplicate':
      return r.flags.length ? 'needs_review' : 'synced';
    case 'needs_review':
      return 'needs_review';
    case 'rejected':
      return 'rejected';
  }
}

/** Retry back-off for failed network syncs: 5s, 15s, 45s … capped at 15 min, with jitter. */
export function nextRetryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(5_000 * 3 ** Math.max(0, attempt), 15 * 60_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Which event types are allowed next, given the last accepted local event. */
export function allowedNextEvents(last: TimeEventType | null): TimeEventType[] {
  switch (last) {
    case null:
    case 'clock_out':
      return ['clock_in'];
    case 'clock_in':
    case 'break_end':
      return ['break_start', 'clock_out'];
    case 'break_start':
      return ['break_end'];
  }
}

export const TIME_EVENT_FLAGS = {
  OFFLINE_DEVICE_TIME: 'offline_device_time',
  DEVICE_CLOCK_SKEW: 'device_clock_skew',
  OUTSIDE_GEOFENCE: 'outside_geofence',
  NO_LOCATION: 'no_location',
  LOW_ACCURACY: 'low_location_accuracy',
  DUPLICATE_CLOCK_IN: 'duplicate_clock_in',
  NO_OPEN_SESSION: 'no_open_session',
  OUT_OF_ORDER: 'out_of_order',
  SESSION_ALREADY_APPROVED: 'session_already_approved',
  NOT_ASSIGNED_TO_SHIFT: 'not_assigned_to_shift',
  BREAK_NOT_STARTED: 'break_not_started',
} as const;
