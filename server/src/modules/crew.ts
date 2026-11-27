import type { FastifyInstance } from 'fastify';
import { crewEventSchema, type CrewMember, type ServerEventResult } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requireCompany, type ActorMembership } from '../lib/actor';
import { auditSystemTx } from '../lib/audit';
import { forbidden } from '../lib/errors';
import { companyParams, ctx } from '../lib/http';
import { applyEvents } from './attendance';
import type { Db } from '../db';

/**
 * Crew clock-in: a foreman records clock-in/out/breaks for crew members from ONE phone.
 *
 * Who may do it (checked on every request, Rules.md Rule 1):
 *  - staff with "attendance.crew" (owner, admin, manager, supervisor) for employees they can access;
 *  - an employee marked as crew lead, only for people on the SAME shift as them (±16 h window).
 * Every event records who entered it (entry_method = 'crew', recorded_by_membership_id).
 */
async function allowedCrew(db: Db, userId: string, m: ActorMembership): Promise<Map<string, { fullName: string; shiftId: string | null }>> {
  if (m.permissions.has('attendance.crew')) {
    // can_access_member applies site scopes for supervisors / scoped managers.
    const rows = await db.asUser(userId, async (tx) => (await tx.query(
      `select m.id, p.full_name,
              (select s.id from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id
                where sa.membership_id = m.id and s.status = 'scheduled' and s.starts_at < now() + interval '12 hours' and s.ends_at > now() - interval '4 hours'
                order by abs(extract(epoch from (s.starts_at - now()))) limit 1) as shift_id
         from app.memberships m join app.profiles p on p.user_id = m.user_id
        where m.company_id = $1 and m.status = 'active' and m.role = 'employee' and m.id <> $2 and app.can_access_member($1, m.id)
        order by p.full_name limit 500`,
      [m.companyId, m.membershipId],
    )).rows);
    return new Map(rows.map((r) => [r.id as string, { fullName: r.full_name as string, shiftId: (r.shift_id as string) ?? null }]));
  }
  if (m.role !== 'employee') return new Map();
  return db.asSystem(async (tx) => {
    const lead = (await tx.query(`select crew_lead from app.memberships where id = $1 and status = 'active'`, [m.membershipId])).rows[0];
    if (!lead?.crew_lead) return new Map();
    const rows = (await tx.query(
      `select distinct on (other.membership_id) other.membership_id as id, p.full_name, s.id as shift_id
         from app.shift_assignments mine
         join app.shifts s on s.id = mine.shift_id and s.status = 'scheduled'
         join app.shift_assignments other on other.shift_id = s.id and other.membership_id <> mine.membership_id
         join app.memberships om on om.id = other.membership_id and om.status = 'active'
         join app.profiles p on p.user_id = om.user_id
        where mine.membership_id = $1 and s.starts_at < now() + interval '12 hours' and s.ends_at > now() - interval '16 hours'
        order by other.membership_id, s.starts_at`,
      [m.membershipId],
    )).rows;
    return new Map(rows.map((r) => [r.id as string, { fullName: r.full_name as string, shiftId: (r.shift_id as string) ?? null }]));
  });
}

export default async function crewRoutes(app: FastifyInstance) {
  const { db, emit, metrics } = app.services;

  /** The people this caller may clock in, with their current state. */
  app.get('/companies/:companyId/crew', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const crew = await allowedCrew(db, a.userId, m);
    if (!crew.size) {
      if (!m.permissions.has('attendance.crew') && m.role === 'employee') {
        const isLead = await db.asSystem(async (tx) => (await tx.query(`select crew_lead from app.memberships where id = $1`, [m.membershipId])).rows[0]?.crew_lead);
        if (!isLead) throw forbidden('Only crew leads and supervisors can clock in a crew.');
      }
      return { items: [] };
    }
    const states = await db.asSystem(async (tx) => (await tx.query(
      `select membership_id, original_start, break_started_at from app.work_sessions where membership_id = any($1) and status = 'open'`,
      [[...crew.keys()]],
    )).rows);
    const byId = new Map(states.map((s) => [s.membership_id as string, s]));
    const items: CrewMember[] = [...crew.entries()].map(([id, c]) => {
      const s = byId.get(id);
      return {
        membershipId: id, fullName: c.fullName, shiftId: c.shiftId,
        state: s ? (s.break_started_at ? 'on_break' : 'working') : 'off',
        since: s ? (s.break_started_at ?? s.original_start).toISOString() : null,
      };
    });
    return { items };
  });

  /** Record one event type for several crew members. Each entry has its own id (safe to retry offline). */
  app.post('/companies/:companyId/crew/events', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const b = parse(crewEventSchema, req.body);
    const crew = await allowedCrew(db, a.userId, m);
    const results: (ServerEventResult & { membershipId: string })[] = [];
    await db.asSystem(async (tx) => {
      for (const e of b.entries) {
        const member = crew.get(e.membershipId);
        if (!member) {
          results.push({ id: e.id, membershipId: e.membershipId, result: 'rejected', reason: 'You cannot clock in this person.' });
          continue;
        }
        const [r] = await applyEvents(
          tx, a.userId, { membershipId: e.membershipId, companyId },
          [{ id: e.id, type: b.type, shiftId: member.shiftId ?? b.shiftId ?? null, deviceTime: b.deviceTime, offline: b.offline, lat: b.lat, lng: b.lng, accuracyM: b.accuracyM, deviceId: b.deviceId }],
          emit, m.membershipId,
        );
        results.push({ ...r!, membershipId: e.membershipId });
      }
      await auditSystemTx(tx, {
        companyId, actorUserId: a.userId, action: `attendance.crew_${b.type}`, targetType: 'membership', targetId: m.membershipId,
        metadata: { count: b.entries.length, members: b.entries.map((x) => x.membershipId) }, ...ctx(req),
      });
    });
    for (const r of results) metrics.inc(`crew.${r.result}`);
    return { results, serverTime: new Date().toISOString() };
  });
}
