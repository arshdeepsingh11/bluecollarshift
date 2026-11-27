import type { FastifyInstance } from 'fastify';
import { syncBatchSchema, timeEventSchema, type ServerEventResult, type SyncBatchResponse, type TimeEventInput } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requireCompany, type ActorMembership } from '../lib/actor';
import { forbidden } from '../lib/errors';
import { companyParams } from '../lib/http';
import { notify, staffUserIds } from '../services/notify';
import type { Tx } from '../db';
import type { RealtimeEmit } from '../services/notify';

/**
 * Apply attendance events idempotently. Each event runs in its own savepoint so one bad event
 * never blocks the rest of an offline batch. The database trigger pairs events into work sessions.
 */
export async function applyEvents(
  tx: Tx,
  userId: string,
  m: Pick<ActorMembership, 'membershipId' | 'companyId'>,
  events: TimeEventInput[],
  emit?: RealtimeEmit,
  /** Set when a crew lead records the event for this crew member (requires the system role). */
  recordedBy?: string,
): Promise<ServerEventResult[]> {
  const results: ServerEventResult[] = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.deviceTime) - Date.parse(b.deviceTime));
  const reviewSessions = new Set<string>();
  for (const ev of sorted) {
    await tx.query('savepoint ev');
    try {
      const existing = (await tx.query(
        `select membership_id, session_id, flags, server_received_at, review_status from app.time_events where id = $1`,
        [ev.id],
      )).rows[0];
      if (existing) {
        await tx.query('release savepoint ev');
        if (existing.membership_id !== m.membershipId) {
          results.push({ id: ev.id, result: 'rejected', reason: 'Event id already used.' });
        } else {
          results.push({ id: ev.id, result: 'duplicate', sessionId: existing.session_id, flags: existing.flags, serverReceivedAt: existing.server_received_at.toISOString() });
        }
        continue;
      }
      const { rows } = await tx.query(
        `insert into app.time_events (id, company_id, membership_id, shift_id, type, occurred_at, device_time, source, lat, lng, accuracy_m, device_id, created_by,
                                      entry_method, recorded_by_membership_id)
         values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         returning session_id, flags, review_status, server_received_at`,
        [ev.id, m.companyId, m.membershipId, ev.shiftId ?? null, ev.type, ev.deviceTime, ev.offline ? 'offline' : 'online',
          ev.lat ?? null, ev.lng ?? null, ev.accuracyM ?? null, ev.deviceId, userId, recordedBy ? 'crew' : 'self', recordedBy ?? null],
      );
      await tx.query('release savepoint ev');
      const r = rows[0];
      if (r.review_status === 'needs_review' && r.session_id) reviewSessions.add(r.session_id);
      results.push({
        id: ev.id,
        result: r.review_status === 'needs_review' ? 'needs_review' : 'accepted',
        sessionId: r.session_id,
        flags: r.flags,
        serverReceivedAt: r.server_received_at.toISOString(),
      });
    } catch (e) {
      await tx.query('rollback to savepoint ev');
      const err = e as { code?: string; message?: string };
      if (err.code && ['P0002', 'P0003', '23503', '23514', '23505'].includes(err.code)) {
        const reason = err.code === '23503' ? 'Unknown shift.' : err.code === '23505' ? 'Event id already used.' : (err.message ?? 'Rejected');
        results.push({ id: ev.id, result: 'rejected', reason });
      } else {
        throw e;
      }
    }
  }

  if (results.some((r) => r.result !== 'rejected' && r.result !== 'duplicate')) {
    emit?.(`company:${m.companyId}:staff`, 'attendance:update', { membershipId: m.membershipId });
  }
  if (reviewSessions.size) {
    if (!recordedBy) await tx.query('set local role app_system');
    const staff = await staffUserIds(tx, m.companyId, ['owner', 'admin', 'manager', 'supervisor']);
    for (const sid of reviewSessions) {
      await notify(tx, {
        userIds: staff, companyId: m.companyId, type: 'attendance.review', msg: { key: 'att.review' }, data: { sessionId: sid, companyId: m.companyId },
        dedupeKey: `attendance.review:${sid}`,
      }, emit);
    }
    if (!recordedBy) await tx.query('set local role app_user');
  }
  return results;
}

export default async function attendanceRoutes(app: FastifyInstance) {
  const { db, emit, metrics } = app.services;

  function employeeOnly(m: ActorMembership) {
    // Permission matrix: only employees clock in/out, and only for themselves.
    if (m.role !== 'employee') throw forbidden('Only employees record attendance.');
  }

  app.post('/companies/:companyId/attendance/events', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    employeeOnly(m);
    const ev = parse(timeEventSchema, req.body);
    const [result] = await db.asUser(a.userId, (tx) => applyEvents(tx, a.userId, m, [ev], emit));
    metrics.inc(`attendance.${result!.result}`);
    return result;
  });

  /** Offline synchronisation: up to 200 events per batch, idempotent by event id. */
  app.post('/companies/:companyId/sync/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    employeeOnly(m);
    const { events } = parse(syncBatchSchema, req.body);
    const results = await db.asUser(a.userId, (tx) => applyEvents(tx, a.userId, m, events, emit));
    for (const r of results) metrics.inc(`sync.${r.result}`);
    const response: SyncBatchResponse = { results, serverTime: new Date().toISOString() };
    return response;
  });

  /** The employee's current state: open session, today's and next shifts. */
  app.get('/companies/:companyId/attendance/me', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    return db.asUser(a.userId, async (tx) => {
      const open = (await tx.query(
        `select id, original_start, original_break_minutes, break_started_at, shift_id, flags from app.work_sessions where membership_id = $1 and status = 'open'`,
        [m.membershipId],
      )).rows[0];
      const last = (await tx.query(`select type, occurred_at from app.time_events where membership_id = $1 order by occurred_at desc limit 1`, [m.membershipId])).rows[0];
      const shifts = (await tx.query(
        `select s.id, s.starts_at, s.ends_at, s.break_minutes, s.instructions, js.id as site_id, js.name as site_name, js.address, js.lat, js.lng, js.geofence_radius_m
           from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.job_sites js on js.id = s.site_id
          where sa.membership_id = $1 and s.status = 'scheduled' and s.ends_at > now() - interval '12 hours'
          order by s.starts_at limit 5`,
        [m.membershipId],
      )).rows;
      const totals = (await tx.query(
        `with tz as (select timezone from app.companies where id = $2)
         select
           coalesce(sum(extract(epoch from (coalesce(effective_end, now()) - effective_start)) / 60 - effective_break_minutes)
             filter (where (effective_start at time zone (select timezone from tz))::date = (now() at time zone (select timezone from tz))::date), 0)::int as today,
           coalesce(sum(extract(epoch from (coalesce(effective_end, now()) - effective_start)) / 60 - effective_break_minutes)
             filter (where effective_start > now() - interval '7 days'), 0)::int as week
         from app.work_sessions_effective where membership_id = $1 and effective_start > now() - interval '8 days'`,
        [m.membershipId, companyId],
      )).rows[0];
      return {
        openSession: open
          ? { id: open.id, startedAt: open.original_start, breakMinutes: open.original_break_minutes, onBreakSince: open.break_started_at, shiftId: open.shift_id, flags: open.flags }
          : null,
        lastEvent: last ? { type: last.type, at: last.occurred_at } : null,
        shifts: shifts.map((s) => ({
          id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, breakMinutes: s.break_minutes, instructions: s.instructions,
          site: { id: s.site_id, name: s.site_name, address: s.address, lat: s.lat, lng: s.lng, geofenceRadiusM: s.geofence_radius_m },
        })),
        minutesToday: Math.max(0, totals.today),
        minutesLast7Days: Math.max(0, totals.week),
        serverTime: new Date().toISOString(),
      };
    });
  });

  /** Live board for staff: who is working, on break, late. */
  app.get('/companies/:companyId/attendance/live', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'attendance.view');
    const grace = app.services.config.LATE_GRACE_MINUTES;
    return db.asUser(a.userId, async (tx) => {
      const working = (await tx.query(
        `select ws.id, ws.membership_id, p.full_name, ws.original_start, ws.break_started_at, js.name as site_name, ws.flags,
                (select json_build_object('lat', te.lat, 'lng', te.lng, 'accuracyM', te.accuracy_m, 'distanceM', te.distance_from_site_m)
                   from app.time_events te where te.session_id = ws.id and te.type = 'clock_in' limit 1) as clock_in_location
           from app.work_sessions ws join app.memberships m on m.id = ws.membership_id join app.profiles p on p.user_id = m.user_id
           left join app.job_sites js on js.id = ws.site_id
          where ws.company_id = $1 and ws.status = 'open' order by ws.original_start`,
        [companyId],
      )).rows;
      const late = (await tx.query(
        `select s.id as shift_id, sa.membership_id, p.full_name, s.starts_at, js.name as site_name
           from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.memberships m on m.id = sa.membership_id
           join app.profiles p on p.user_id = m.user_id join app.job_sites js on js.id = s.site_id
          where s.company_id = $1 and s.status = 'scheduled' and s.starts_at < now() - make_interval(mins => $2) and s.ends_at > now()
            and not exists (select 1 from app.time_events te where te.membership_id = sa.membership_id and te.type = 'clock_in'
                            and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at)
          order by s.starts_at`,
        [companyId, grace],
      )).rows;
      return {
        working: working.map((w) => ({ sessionId: w.id, membershipId: w.membership_id, fullName: w.full_name, since: w.original_start, onBreak: !!w.break_started_at, siteName: w.site_name, flags: w.flags, clockInLocation: w.clock_in_location })),
        late: late.map((l) => ({ shiftId: l.shift_id, membershipId: l.membership_id, fullName: l.full_name, startsAt: l.starts_at, siteName: l.site_name })),
      };
    });
  });
}
