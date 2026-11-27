import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  availabilitySchema,
  decideRequestSchema,
  peerResponseSchema,
  shiftRequestSchema,
  timeOffSchema,
  type AvailabilityDay,
  type ShiftRequest,
  type TimeOffRequest,
} from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { canAccessSite, requireCompany, type ActorMembership } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx } from '../lib/http';
import { notify, staffUserIds, type RealtimeEmit } from '../services/notify';
import type { Tx } from '../db';

const REQ_SELECT = `
  select r.id, r.kind, r.status, r.note, r.decision_note, r.decided_at, r.created_at,
         s.id as shift_id, s.site_id, s.starts_at, s.ends_at, js.name as site_name,
         r.requester_membership_id, rp.full_name as requester_name,
         r.target_membership_id, tp.full_name as target_name
    from app.shift_requests r
    join app.shifts s on s.id = r.shift_id
    join app.job_sites js on js.id = s.site_id
    join app.memberships rm on rm.id = r.requester_membership_id join app.profiles rp on rp.user_id = rm.user_id
    left join app.memberships tm on tm.id = r.target_membership_id left join app.profiles tp on tp.user_id = tm.user_id`;

const mapReq = (r: Record<string, any>): ShiftRequest => ({
  id: r.id, kind: r.kind, status: r.status, note: r.note ?? null, decisionNote: r.decision_note ?? null,
  decidedAt: r.decided_at ?? null, createdAt: r.created_at,
  shift: { id: r.shift_id, siteName: r.site_name, startsAt: r.starts_at, endsAt: r.ends_at },
  requester: { membershipId: r.requester_membership_id, fullName: r.requester_name },
  target: r.target_membership_id ? { membershipId: r.target_membership_id, fullName: r.target_name } : null,
});

const TOFF_SELECT = `
  select t.id, t.membership_id, p.full_name, t.kind, t.starts_on, t.ends_on, t.note, t.status, t.decision_note, t.decided_at, t.created_at
    from app.time_off_requests t join app.memberships m on m.id = t.membership_id join app.profiles p on p.user_id = m.user_id`;
const mapToff = (r: Record<string, any>): TimeOffRequest => ({
  id: r.id, membershipId: r.membership_id, fullName: r.full_name, kind: r.kind, startsOn: r.starts_on, endsOn: r.ends_on,
  note: r.note ?? null, status: r.status, decisionNote: r.decision_note ?? null, decidedAt: r.decided_at ?? null, createdAt: r.created_at,
});

/** Sites an employee may pick up open shifts at: linked sites or sites they worked; all sites if none. */
async function pickupSites(tx: Tx, membershipId: string): Promise<string[] | null> {
  const { rows } = await tx.query(
    `select site_id from app.membership_sites where membership_id = $1
     union select s.site_id from app.shift_assignments sa join app.shifts s on s.id = sa.shift_id
      where sa.membership_id = $1 and s.starts_at > now() - interval '120 days'`,
    [membershipId],
  );
  return rows.length ? rows.map((r) => r.site_id as string) : null;
}

/** Overlapping shifts, approved time off and unavailability for these people (warnings, never blocking). */
export async function scheduleWarnings(tx: Tx, membershipIds: string[], startsAt: string, endsAt: string, timezone: string, excludeShift?: string) {
  if (!membershipIds.length) return [];
  const { rows } = await tx.query(
    `with people as (select unnest($1::uuid[]) as id),
          local as (select ($2::timestamptz at time zone $4) as s, ($3::timestamptz at time zone $4) as e)
     select p.id as membership_id, 'overlap' as kind, s.id::text as ref
       from people p join app.shift_assignments sa on sa.membership_id = p.id join app.shifts s on s.id = sa.shift_id
      where s.status = 'scheduled' and s.starts_at < $3 and s.ends_at > $2 and ($5::uuid is null or s.id <> $5)
     union all
     select p.id, 'time_off', t.id::text from people p join app.time_off_requests t on t.membership_id = p.id
      where t.status = 'approved' and t.starts_on <= (select e::date from local) and t.ends_on >= (select s::date from local)
     union all
     select p.id, 'unavailable', a.dow::text from people p join app.availability a on a.membership_id = p.id
      where a.dow = extract(dow from (select s from local))::int and (
        not a.available
        or (a.start_minute is not null and (
             extract(hour from (select s from local)) * 60 + extract(minute from (select s from local)) < a.start_minute
          or extract(hour from (select e from local)) * 60 + extract(minute from (select e from local)) > a.end_minute
          or (select e::date from local) > (select s::date from local))))`,
    [membershipIds, startsAt, endsAt, timezone, excludeShift ?? null],
  );
  return rows as { membership_id: string; kind: 'overlap' | 'time_off' | 'unavailable'; ref: string }[];
}

async function notifySystem(tx: Tx, emit: RealtimeEmit, n: Parameters<typeof notify>[1]) {
  await tx.query('set local role app_system');
  await notify(tx, n, emit);
  await tx.query('set local role app_user');
}

function userOf(tx: Tx, membershipId: string) {
  return tx.query(`select user_id from app.memberships where id = $1`, [membershipId]).then((r) => r.rows[0]?.user_id as string | undefined);
}

export default async function requestRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;

  // ---------- Open shifts ----------
  app.get('/companies/:companyId/open-shifts', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const staff = m.permissions.has('shifts.view');
    const rows = await db.asSystem(async (tx) => {
      const sites = staff ? m.siteScope : await pickupSites(tx, m.membershipId);
      return (await tx.query(
        `select s.id, s.site_id, js.name as site_name, s.starts_at, s.ends_at, s.break_minutes, s.instructions, s.open_slots,
                (select r.status from app.shift_requests r where r.shift_id = s.id and r.requester_membership_id = $2 and r.kind = 'pickup'
                  order by r.created_at desc limit 1) as my_request
           from app.shifts s join app.job_sites js on js.id = s.site_id
          where s.company_id = $1 and s.status = 'scheduled' and s.open_slots > 0 and s.starts_at > now() and s.starts_at < now() + interval '45 days'
            and ($3::uuid[] is null or s.site_id = any($3))
            and not exists (select 1 from app.shift_assignments sa where sa.shift_id = s.id and sa.membership_id = $2)
          order by s.starts_at limit 200`,
        [companyId, m.membershipId, sites],
      )).rows;
    });
    return {
      items: rows.map((r) => ({
        id: r.id, siteId: r.site_id, siteName: r.site_name, startsAt: r.starts_at, endsAt: r.ends_at, breakMinutes: r.break_minutes,
        instructions: r.instructions, openSlots: r.open_slots, myRequest: r.my_request ?? null,
      })),
    };
  });

  /** Coworkers an employee can offer a shift to: active employees at the same sites (names only). */
  app.get('/companies/:companyId/coworkers', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const rows = await db.asSystem(async (tx) => {
      const sites = await pickupSites(tx, m.membershipId);
      return (await tx.query(
        `select m.id, p.full_name from app.memberships m join app.profiles p on p.user_id = m.user_id
          where m.company_id = $1 and m.status = 'active' and m.role = 'employee' and m.id <> $2
            and ($3::uuid[] is null
                 or exists (select 1 from app.membership_sites ms where ms.membership_id = m.id and ms.site_id = any($3))
                 or exists (select 1 from app.shift_assignments sa join app.shifts s on s.id = sa.shift_id
                            where sa.membership_id = m.id and s.site_id = any($3) and s.starts_at > now() - interval '120 days'))
          order by p.full_name limit 500`,
        [companyId, m.membershipId, sites],
      )).rows;
    });
    return { items: rows.map((r) => ({ membershipId: r.id, fullName: r.full_name })) };
  });

  // ---------- Shift requests ----------
  app.post('/companies/:companyId/shift-requests', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(shiftRequestSchema, req.body);
    const created = await db.asUser(a.userId, async (tx) => {
      await tx.query('set local role app_system');
      const shift = (await tx.query(`select id, site_id, starts_at, ends_at, status, open_slots from app.shifts where id = $1 and company_id = $2`, [b.shiftId, companyId])).rows[0];
      if (!shift) throw notFound('Shift not found.');
      if (shift.status !== 'scheduled' || Date.parse(shift.starts_at) <= Date.now()) throw badRequest('This shift has already started or was cancelled.');
      const assigned = (await tx.query(`select 1 from app.shift_assignments where shift_id = $1 and membership_id = $2`, [b.shiftId, m.membershipId])).rowCount;
      if (b.kind === 'pickup') {
        if (assigned) throw badRequest('You are already on this shift.');
        if (shift.open_slots < 1) throw conflict('This shift has no open spots left.');
        const sites = await pickupSites(tx, m.membershipId);
        if (sites && !sites.includes(shift.site_id)) throw notFound('Shift not found.');
      } else if (!assigned) {
        throw badRequest('You are not on this shift.');
      }
      if (b.kind === 'swap') {
        const t = (await tx.query(`select id, role, status from app.memberships where id = $1 and company_id = $2`, [b.targetMembershipId, companyId])).rows[0];
        if (!t || t.status !== 'active') throw badRequest('That coworker is not an active member.');
        const tAssigned = (await tx.query(`select 1 from app.shift_assignments where shift_id = $1 and membership_id = $2`, [b.shiftId, b.targetMembershipId])).rowCount;
        if (tAssigned) throw badRequest('That coworker is already on this shift.');
      }
      await tx.query('set local role app_user');
      const row = (await tx.query(
        `insert into app.shift_requests (company_id, shift_id, kind, requester_membership_id, target_membership_id, status, note)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [companyId, b.shiftId, b.kind, m.membershipId, b.targetMembershipId ?? null, b.kind === 'swap' ? 'pending_peer' : 'pending', b.note ?? null],
      ).catch((e: { code?: string }) => {
        if (e.code === '23505') throw conflict('You already have an open request for this shift.');
        throw e;
      })).rows[0];
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `shift_request.${b.kind}`, targetType: 'shift_request', targetId: row.id, metadata: b, ...ctx(req) });
      await tx.query('set local role app_system');
      if (b.kind === 'swap') {
        const uid = await userOf(tx, b.targetMembershipId!);
        if (uid) await notify(tx, { userIds: [uid], companyId, type: 'shift_request.swap', msg: { key: 'req.swap', vars: { name: a.fullName ?? '' } }, data: { requestId: row.id, companyId }, dedupeKey: `swap:${row.id}` }, emit);
      } else {
        const staff = await staffUserIds(tx, companyId, ['owner', 'admin', 'manager', 'supervisor'], shift.site_id);
        await notify(tx, { userIds: staff.filter((u) => u !== a.userId), companyId, type: `shift_request.${b.kind}`, msg: { key: b.kind === 'pickup' ? 'req.pickup' : 'req.drop', vars: { name: a.fullName ?? '' } }, data: { requestId: row.id, companyId }, dedupeKey: `shiftreq:${row.id}` }, emit);
      }
      // The requester may not see an unassigned open shift through RLS; read the result as the system (already authorised).
      return (await tx.query(`${REQ_SELECT} where r.id = $1`, [row.id])).rows[0];
    });
    emit(`company:${companyId}:staff`, 'requests:changed', {});
    return reply.status(201).send(mapReq(created));
  });

  app.get('/companies/:companyId/shift-requests', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const q = parse(z.object({ scope: z.enum(['mine', 'team']).default('mine'), status: z.enum(['open', 'all']).default('open') }), req.query);
    if (q.scope === 'team' && !m.permissions.has('requests.manage')) throw forbidden();
    // Explicit scoping (employees may not see unassigned open shifts through RLS): own requests, or the team within site scope.
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `${REQ_SELECT} where r.company_id = $1
         and (($2 = 'team' and ($5::uuid[] is null or s.site_id = any($5))) or r.requester_membership_id = $3 or r.target_membership_id = $3)
         and ($4 = 'all' or r.status in ('pending_peer', 'pending'))
       order by r.created_at desc limit 200`,
      [companyId, q.scope, m.membershipId, q.status, q.scope === 'team' ? m.siteScope : null],
    )).rows);
    return { items: rows.map(mapReq) };
  });

  app.post('/companies/:companyId/shift-requests/:requestId/respond', async (req) => {
    const a = actorOf(req);
    const { companyId, requestId } = parse(companyIdParams('requestId'), req.params);
    const m = requireCompany(a, companyId);
    const { accept } = parse(peerResponseSchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const r = (await tx.query(`select * from app.shift_requests where id = $1 and company_id = $2 for update`, [requestId, companyId])).rows[0];
      if (!r || r.target_membership_id !== m.membershipId) throw notFound();
      if (r.status !== 'pending_peer') throw conflict('This request was already answered.');
      await tx.query(`update app.shift_requests set status = $2, decided_at = case when $2 = 'rejected' then now() else null end,
                        decision_note = case when $2 = 'rejected' then 'Declined by coworker' else null end where id = $1`,
        [requestId, accept ? 'pending' : 'rejected']);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: accept ? 'shift_request.peer_accepted' : 'shift_request.peer_declined', targetType: 'shift_request', targetId: requestId, ...ctx(req) });
      await tx.query('set local role app_system');
      const shift = (await tx.query(`select site_id from app.shifts where id = $1`, [r.shift_id])).rows[0];
      const requester = await userOf(tx, r.requester_membership_id);
      if (requester) await notify(tx, { userIds: [requester], companyId, type: 'shift_request.peer', msg: { key: accept ? 'req.swap_accepted' : 'req.swap_declined', vars: { name: a.fullName ?? '' } }, data: { requestId, companyId }, dedupeKey: `swap-peer:${requestId}` }, emit);
      if (accept) {
        const staff = await staffUserIds(tx, companyId, ['owner', 'admin', 'manager', 'supervisor'], shift?.site_id);
        await notify(tx, { userIds: staff, companyId, type: 'shift_request.swap', msg: { key: 'req.swap_approve' }, data: { requestId, companyId }, dedupeKey: `swap-approve:${requestId}` }, emit);
      }
      return (await tx.query(`${REQ_SELECT} where r.id = $1`, [requestId])).rows[0];
    });
    emit(`company:${companyId}:staff`, 'requests:changed', {});
    return mapReq(row);
  });

  app.post('/companies/:companyId/shift-requests/:requestId/decide', async (req) => {
    const a = actorOf(req);
    const { companyId, requestId } = parse(companyIdParams('requestId'), req.params);
    const m = requireCompany(a, companyId, 'requests.manage');
    const b = parse(decideRequestSchema, req.body);
    const out = await db.asUser(a.userId, async (tx) => {
      const r = (await tx.query(`select * from app.shift_requests where id = $1 and company_id = $2 for update`, [requestId, companyId])).rows[0];
      if (!r) throw notFound();
      if (r.requester_membership_id === m.membershipId) throw forbidden('You cannot approve your own request.');
      const shift = (await tx.query(`select s.*, c.timezone from app.shifts s join app.companies c on c.id = s.company_id where s.id = $1 for update of s`, [r.shift_id])).rows[0];
      if (!shift || !canAccessSite(m, shift.site_id)) throw notFound();
      if (r.status !== 'pending') throw conflict(r.status === 'pending_peer' ? 'The coworker has not accepted yet.' : 'This request was already decided.');
      let warnings: unknown[] = [];
      if (b.decision === 'approved') {
        if (shift.status !== 'scheduled') throw conflict('This shift was cancelled.');
        const newPerson = r.kind === 'swap' ? r.target_membership_id : r.kind === 'pickup' ? r.requester_membership_id : null;
        if (r.kind === 'pickup') {
          if (shift.open_slots < 1) throw conflict('No open spots are left on this shift.');
          await tx.query(`insert into app.shift_assignments (shift_id, membership_id, company_id) values ($1, $2, $3) on conflict do nothing`, [shift.id, r.requester_membership_id, companyId]);
          await tx.query(`update app.shifts set open_slots = open_slots - 1, updated_by = $2 where id = $1`, [shift.id, a.userId]);
        } else if (r.kind === 'drop') {
          const del = await tx.query(`delete from app.shift_assignments where shift_id = $1 and membership_id = $2`, [shift.id, r.requester_membership_id]);
          if (del.rowCount) await tx.query(`update app.shifts set open_slots = least(open_slots + 1, 50), updated_by = $2 where id = $1`, [shift.id, a.userId]);
        } else {
          await tx.query(`delete from app.shift_assignments where shift_id = $1 and membership_id = $2`, [shift.id, r.requester_membership_id]);
          await tx.query(`insert into app.shift_assignments (shift_id, membership_id, company_id) values ($1, $2, $3) on conflict do nothing`, [shift.id, r.target_membership_id, companyId]);
        }
        if (newPerson) warnings = await scheduleWarnings(tx, [newPerson], shift.starts_at.toISOString(), shift.ends_at.toISOString(), shift.timezone, shift.id);
        // Other open requests for this shift may no longer make sense; leave them for the manager to decide.
      }
      await tx.query(`update app.shift_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`,
        [requestId, b.decision, a.userId, b.note ?? null]);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `shift_request.${b.decision}`, targetType: 'shift_request', targetId: requestId, metadata: { kind: r.kind, shiftId: shift.id }, ...ctx(req) });
      await tx.query('set local role app_system');
      const users = (await tx.query(`select user_id from app.memberships where id = any($1)`, [[r.requester_membership_id, r.target_membership_id].filter(Boolean)])).rows.map((x) => x.user_id as string);
      await notify(tx, { userIds: users, companyId, type: 'shift_request.decided', msg: { key: b.decision === 'approved' ? 'req.approved' : 'req.rejected', text: b.note }, data: { requestId, shiftId: shift.id, companyId }, dedupeKey: `shiftreq-decided:${requestId}` }, emit);
      await tx.query('set local role app_user');
      return { row: (await tx.query(`${REQ_SELECT} where r.id = $1`, [requestId])).rows[0], warnings };
    });
    emit(`company:${companyId}:staff`, 'shift:changed', { shiftId: out.row.shift_id });
    return { ...mapReq(out.row), warnings: out.warnings };
  });

  app.post('/companies/:companyId/shift-requests/:requestId/cancel', async (req) => {
    const a = actorOf(req);
    const { companyId, requestId } = parse(companyIdParams('requestId'), req.params);
    const m = requireCompany(a, companyId);
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(
        `update app.shift_requests set status = 'cancelled', decided_at = now() where id = $1 and company_id = $2 and requester_membership_id = $3
           and status in ('pending_peer', 'pending') returning id`, [requestId, companyId, m.membershipId]);
      if (!r.rowCount) throw notFound();
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'shift_request.cancelled', targetType: 'shift_request', targetId: requestId, ...ctx(req) });
    });
    return { ok: true };
  });

  // ---------- Time off ----------
  app.post('/companies/:companyId/time-off', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(timeOffSchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const overlap = (await tx.query(`select 1 from app.time_off_requests where membership_id = $1 and status in ('pending', 'approved')
                                        and starts_on <= $3 and ends_on >= $2`, [m.membershipId, b.startsOn, b.endsOn])).rowCount;
      if (overlap) throw conflict('You already have a request for some of these days.');
      const r = (await tx.query(
        `insert into app.time_off_requests (company_id, membership_id, kind, starts_on, ends_on, note) values ($1,$2,$3,$4,$5,$6) returning id`,
        [companyId, m.membershipId, b.kind, b.startsOn, b.endsOn, b.note ?? null],
      )).rows[0];
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'time_off.requested', targetType: 'time_off', targetId: r.id, metadata: b, ...ctx(req) });
      await tx.query('set local role app_system');
      const staff = await staffUserIds(tx, companyId, ['owner', 'admin', 'manager', 'supervisor']);
      await notify(tx, { userIds: staff.filter((u) => u !== a.userId), companyId, type: 'time_off.requested', msg: { key: 'toff.requested', vars: { name: a.fullName ?? '', from: b.startsOn, to: b.endsOn } }, data: { timeOffId: r.id, companyId }, dedupeKey: `toff:${r.id}` }, emit);
      await tx.query('set local role app_user');
      return (await tx.query(`${TOFF_SELECT} where t.id = $1`, [r.id])).rows[0];
    });
    emit(`company:${companyId}:staff`, 'requests:changed', {});
    return reply.status(201).send(mapToff(row));
  });

  app.get('/companies/:companyId/time-off', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const q = parse(z.object({
      scope: z.enum(['mine', 'team']).default('mine'),
      status: z.enum(['pending', 'approved', 'all']).default('all'),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), req.query);
    if (q.scope === 'team' && !m.permissions.has('requests.manage') && !m.permissions.has('shifts.view')) throw forbidden();
    const rows = await db.asUser(a.userId, async (tx) => (await tx.query(
      `${TOFF_SELECT} where t.company_id = $1 and ($2 = 'team' or t.membership_id = $3)
         and ($4 = 'all' or t.status = $4) and ($5::date is null or t.ends_on >= $5) and ($6::date is null or t.starts_on <= $6)
       order by t.starts_on desc limit 300`,
      [companyId, q.scope, m.membershipId, q.status, q.from ?? null, q.to ?? null],
    )).rows);
    return { items: rows.map(mapToff) };
  });

  app.post('/companies/:companyId/time-off/:requestId/decide', async (req) => {
    const a = actorOf(req);
    const { companyId, requestId } = parse(companyIdParams('requestId'), req.params);
    const m = requireCompany(a, companyId, 'requests.manage');
    const b = parse(decideRequestSchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const t = (await tx.query(`select * from app.time_off_requests where id = $1 and company_id = $2 for update`, [requestId, companyId])).rows[0];
      if (!t) throw notFound();
      if (t.membership_id === m.membershipId) throw forbidden('You cannot approve your own request.');
      if (t.status !== 'pending') throw conflict('This request was already decided.');
      const upd = await tx.query(`update app.time_off_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`,
        [requestId, b.decision, a.userId, b.note ?? null]);
      if (!upd.rowCount) throw notFound();
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `time_off.${b.decision}`, targetType: 'time_off', targetId: requestId, ...ctx(req) });
      await tx.query('set local role app_system');
      const uid = await userOf(tx, t.membership_id);
      if (uid) await notify(tx, { userIds: [uid], companyId, type: 'time_off.decided', msg: { key: b.decision === 'approved' ? 'toff.approved' : 'toff.rejected', vars: { from: t.starts_on, to: t.ends_on }, text: b.note ? `${t.starts_on} → ${t.ends_on} — ${b.note}` : null }, data: { timeOffId: requestId, companyId }, dedupeKey: `toff-decided:${requestId}` }, emit);
      await tx.query('set local role app_user');
      return (await tx.query(`${TOFF_SELECT} where t.id = $1`, [requestId])).rows[0];
    });
    emit(`company:${companyId}:staff`, 'requests:changed', {});
    return mapToff(row);
  });

  app.post('/companies/:companyId/time-off/:requestId/cancel', async (req) => {
    const a = actorOf(req);
    const { companyId, requestId } = parse(companyIdParams('requestId'), req.params);
    const m = requireCompany(a, companyId);
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(
        `update app.time_off_requests set status = 'cancelled' where id = $1 and company_id = $2 and membership_id = $3
           and (status = 'pending' or (status = 'approved' and starts_on > current_date)) returning id`, [requestId, companyId, m.membershipId]);
      if (!r.rowCount) throw notFound();
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'time_off.cancelled', targetType: 'time_off', targetId: requestId, ...ctx(req) });
    });
    emit(`company:${companyId}:staff`, 'requests:changed', {});
    return { ok: true };
  });

  // ---------- Availability ----------
  const loadAvailability = async (tx: Tx, membershipId: string): Promise<AvailabilityDay[]> => {
    const rows = (await tx.query(`select dow, available, start_minute, end_minute from app.availability where membership_id = $1 order by dow`, [membershipId])).rows;
    return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const r = rows.find((x) => x.dow === dow);
      return r ? { dow, available: r.available, startMinute: r.start_minute, endMinute: r.end_minute } : { dow, available: true, startMinute: null, endMinute: null };
    });
  };

  app.get('/companies/:companyId/availability/me', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    return { days: await db.asUser(a.userId, (tx) => loadAvailability(tx, m.membershipId)) };
  });

  app.put('/companies/:companyId/availability/me', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(availabilitySchema, req.body);
    const days = await db.asUser(a.userId, async (tx) => {
      for (const d of b.days) {
        const allDay = d.available && d.startMinute == null;
        if (allDay) {
          await tx.query(`delete from app.availability where membership_id = $1 and dow = $2`, [m.membershipId, d.dow]);
        } else {
          await tx.query(
            `insert into app.availability (membership_id, company_id, dow, available, start_minute, end_minute) values ($1,$2,$3,$4,$5,$6)
             on conflict (membership_id, dow) do update set available = excluded.available, start_minute = excluded.start_minute, end_minute = excluded.end_minute, updated_at = now()`,
            [m.membershipId, companyId, d.dow, d.available, d.available ? d.startMinute : null, d.available ? d.endMinute : null],
          );
        }
      }
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'availability.updated', targetType: 'membership', targetId: m.membershipId, ...ctx(req) });
      return loadAvailability(tx, m.membershipId);
    });
    return { days };
  });

  app.get('/companies/:companyId/members/:membershipId/availability', async (req) => {
    const a = actorOf(req);
    const { companyId, membershipId } = parse(companyIdParams('membershipId'), req.params);
    requireCompany(a, companyId, 'shifts.view');
    const days = await db.asUser(a.userId, async (tx) => {
      const visible = (await tx.query(`select 1 from app.memberships where id = $1 and company_id = $2`, [membershipId, companyId])).rowCount;
      if (!visible) throw notFound();
      return loadAvailability(tx, membershipId);
    });
    return { days };
  });
}

export type { ActorMembership };
