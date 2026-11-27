import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { shiftSchema, updateShiftSchema, type Shift } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { canAccessSite, requireCompany } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx } from '../lib/http';
import { notify } from '../services/notify';
import type { Tx } from '../db';
import { scheduleWarnings } from './requests';

const SELECT = `
  select s.id, s.site_id, js.name as site_name, s.starts_at, s.ends_at, s.break_minutes, s.instructions, s.status, s.version, s.updated_at, s.open_slots,
         coalesce((select json_agg(json_build_object('membershipId', m.id, 'fullName', p.full_name) order by p.full_name)
                   from app.shift_assignments sa join app.memberships m on m.id = sa.membership_id
                   join app.profiles p on p.user_id = m.user_id where sa.shift_id = s.id), '[]') as assignees
    from app.shifts s join app.job_sites js on js.id = s.site_id`;

const map = (r: Record<string, unknown>): Shift => ({
  id: r.id as string, siteId: r.site_id as string, siteName: r.site_name as string, startsAt: r.starts_at as string,
  endsAt: r.ends_at as string, breakMinutes: r.break_minutes as number, instructions: (r.instructions as string) ?? null,
  status: r.status as Shift['status'], version: r.version as number, assignees: r.assignees as Shift['assignees'],
  openSlots: Number(r.open_slots ?? 0), updatedAt: r.updated_at as string,
});

async function validateAssignees(tx: Tx, companyId: string, ids: string[]) {
  if (!ids.length) return [];
  const { rows } = await tx.query(`select id, user_id from app.memberships where company_id = $1 and status = 'active' and id = any($2)`, [companyId, ids]);
  if (rows.length !== new Set(ids).size) throw badRequest('One or more employees are not active members of this company.');
  return rows as { id: string; user_id: string }[];
}

async function conflictsFor(tx: Tx, ids: string[], startsAt: string, endsAt: string, excludeShift?: string) {
  const { rows } = await tx.query(
    `select sa.membership_id, s.id as shift_id, s.starts_at, s.ends_at from app.shift_assignments sa join app.shifts s on s.id = sa.shift_id
      where sa.membership_id = any($1) and s.status = 'scheduled' and s.starts_at < $3 and s.ends_at > $2 and ($4::uuid is null or s.id <> $4)`,
    [ids, startsAt, endsAt, excludeShift ?? null],
  );
  return rows;
}

export default async function shiftRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;

  app.get('/companies/:companyId/shifts', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const q = parse(
      z.object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        siteId: z.string().uuid().optional(),
        membershipId: z.string().uuid().optional(),
        mine: z.enum(['true', 'false']).optional(),
      }).refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 93 * 86400_000, 'Range cannot exceed 93 days'),
      req.query,
    );
    const onlyMine = q.mine === 'true' || !m.permissions.has('shifts.view');
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `${SELECT} where s.company_id = $1 and s.starts_at < $3 and s.ends_at > $2
           and ($4::uuid is null or s.site_id = $4)
           and ($5::uuid is null or exists (select 1 from app.shift_assignments x where x.shift_id = s.id and x.membership_id = $5))
         order by s.starts_at limit 2000`,
        [companyId, q.from, q.to, q.siteId ?? null, onlyMine ? m.membershipId : (q.membershipId ?? null)],
      )).rows,
    );
    return { items: rows.map(map) };
  });

  app.post('/companies/:companyId/shifts', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'shifts.manage');
    const b = parse(shiftSchema, req.body);
    if (!canAccessSite(m, b.siteId)) throw notFound('Job site not found.');
    const created = await db.asUser(a.userId, async (tx) => {
      const site = (await tx.query(`select js.id, js.name, js.status, c.timezone from app.job_sites js join app.companies c on c.id = js.company_id where js.id = $1 and js.company_id = $2`, [b.siteId, companyId])).rows[0];
      if (!site) throw notFound('Job site not found.');
      if (site.status !== 'active') throw badRequest('This job site is archived.');
      const members = await validateAssignees(tx, companyId, b.membershipIds);
      const seriesId = b.repeatWeeks > 0 ? crypto.randomUUID() : null;
      const ids: string[] = [];
      const warnings: unknown[] = [];
      for (let w = 0; w <= b.repeatWeeks; w++) {
        const start = new Date(Date.parse(b.startsAt) + w * 7 * 86400_000).toISOString();
        const end = new Date(Date.parse(b.endsAt) + w * 7 * 86400_000).toISOString();
        const overlaps = await conflictsFor(tx, b.membershipIds, start, end);
        if (overlaps.length) warnings.push({ week: w, conflicts: overlaps });
        const other = (await scheduleWarnings(tx, b.membershipIds, start, end, site.timezone)).filter((x) => x.kind !== 'overlap');
        if (other.length) warnings.push({ week: w, availability: other });
        const s = (await tx.query(
          `insert into app.shifts (company_id, site_id, starts_at, ends_at, break_minutes, instructions, series_id, created_by, updated_by, open_slots)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id`,
          [companyId, b.siteId, start, end, b.breakMinutes, b.instructions ?? null, seriesId, a.userId, b.openSlots],
        )).rows[0];
        await tx.query(`insert into app.shift_assignments (shift_id, membership_id, company_id) select $1, unnest($2::uuid[]), $3`, [s.id, b.membershipIds, companyId]);
        ids.push(s.id);
      }
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'shift.created', targetType: 'shift', targetId: ids[0], metadata: { count: ids.length, assignees: b.membershipIds }, ...ctx(req) });
      // Notifications are addressed to other users: system role.
      await tx.query('set local role app_system');
      await notify(tx, {
        userIds: members.map((x) => x.user_id).filter((u) => u !== a.userId), companyId, type: 'shift.assigned',
        msg: ids.length > 1 ? { key: 'shift.new_many', vars: { site: site.name, count: ids.length } } : { key: 'shift.new', vars: { site: site.name, when: { date: b.startsAt } } },
        data: { shiftId: ids[0], companyId }, dedupeKey: `shift.assigned:${ids[0]}`, email: true,
      }, emit);
      if (b.openSlots > 0) {
        // Tell employees who work at this site that spots are open (they request; a manager approves).
        const eligible = (await tx.query(
          `select distinct m.user_id from app.memberships m
             where m.company_id = $1 and m.status = 'active' and m.role = 'employee' and not (m.id = any($3::uuid[]))
               and (exists (select 1 from app.membership_sites ms where ms.membership_id = m.id and ms.site_id = $2)
                    or exists (select 1 from app.shift_assignments sa join app.shifts x on x.id = sa.shift_id
                               where sa.membership_id = m.id and x.site_id = $2 and x.starts_at > now() - interval '120 days'))`,
          [companyId, b.siteId, b.membershipIds],
        )).rows.map((r) => r.user_id as string);
        await notify(tx, {
          userIds: eligible, companyId, type: 'shift.open',
          msg: { key: 'shift.open', vars: { site: site.name, when: { date: b.startsAt }, count: b.openSlots } }, data: { shiftId: ids[0], companyId }, dedupeKey: `shift.open:${ids[0]}`,
        }, emit);
      }
      await tx.query('set local role app_user');
      const rows = (await tx.query(`${SELECT} where s.id = any($1) order by s.starts_at`, [ids])).rows;
      return { items: rows.map(map), warnings };
    });
    for (const s of created.items) emit(`company:${companyId}:staff`, 'shift:changed', { shiftId: s.id });
    return reply.status(201).send(created);
  });

  app.patch('/companies/:companyId/shifts/:shiftId', async (req) => {
    const a = actorOf(req);
    const { companyId, shiftId } = parse(companyIdParams('shiftId'), req.params);
    const m = requireCompany(a, companyId, 'shifts.manage');
    const b = parse(updateShiftSchema, req.body);
    if (b.siteId && !canAccessSite(m, b.siteId)) throw notFound('Job site not found.');
    const result = await db.asUser(a.userId, async (tx) => {
      const cur = (await tx.query(`select * from app.shifts where id = $1 and company_id = $2 for update`, [shiftId, companyId])).rows[0];
      if (!cur || !canAccessSite(m, cur.site_id)) throw notFound();
      // Optimistic concurrency: refuse to overwrite someone else's newer change.
      if (cur.version !== b.version) throw conflict('This shift was changed by someone else. Reload and try again.', { currentVersion: cur.version });
      const startsAt = b.startsAt ?? cur.starts_at.toISOString();
      const endsAt = b.endsAt ?? cur.ends_at.toISOString();
      if (Date.parse(endsAt) <= Date.parse(startsAt)) throw badRequest('Shift must end after it starts.');
      const before = (await tx.query(`select membership_id from app.shift_assignments where shift_id = $1`, [shiftId])).rows.map((r) => r.membership_id as string);
      await tx.query(
        `update app.shifts set site_id = coalesce($3, site_id), starts_at = $4, ends_at = $5, break_minutes = coalesce($6, break_minutes),
                instructions = case when $7 then $8 else instructions end, status = coalesce($9, status), updated_by = $10,
                open_slots = coalesce($11, open_slots)
          where id = $1 and company_id = $2`,
        [shiftId, companyId, b.siteId ?? null, startsAt, endsAt, b.breakMinutes ?? null, b.instructions !== undefined, b.instructions ?? null, b.status ?? null, a.userId, b.openSlots ?? null],
      );
      let assignees = before;
      if (b.membershipIds) {
        await validateAssignees(tx, companyId, b.membershipIds);
        await tx.query(`delete from app.shift_assignments where shift_id = $1 and not (membership_id = any($2))`, [shiftId, b.membershipIds]);
        await tx.query(`insert into app.shift_assignments (shift_id, membership_id, company_id) select $1, unnest($2::uuid[]), $3 on conflict do nothing`, [shiftId, b.membershipIds, companyId]);
        assignees = b.membershipIds;
      }
      await auditTx(tx, { companyId, actorUserId: a.userId, action: b.status === 'cancelled' ? 'shift.cancelled' : 'shift.updated', targetType: 'shift', targetId: shiftId,
        metadata: { before: { siteId: cur.site_id, startsAt: cur.starts_at, endsAt: cur.ends_at, status: cur.status, assignees: before }, changes: b }, ...ctx(req) });
      const affected = [...new Set([...before, ...assignees])];
      const users = (await tx.query(`select user_id from app.memberships where id = any($1)`, [affected])).rows.map((r) => r.user_id as string);
      const row = (await tx.query(`${SELECT} where s.id = $1`, [shiftId])).rows[0];
      await tx.query('set local role app_system');
      await notify(tx, {
        userIds: users.filter((u) => u !== a.userId), companyId, type: b.status === 'cancelled' ? 'shift.cancelled' : 'shift.changed',
        msg: { key: b.status === 'cancelled' ? 'shift.cancelled' : 'shift.changed', vars: { site: row.site_name, when: { date: new Date(row.starts_at).toISOString() } } },
        data: { shiftId, companyId }, dedupeKey: `shift.changed:${shiftId}:${row.version}`, email: true,
      }, emit);
      await tx.query('set local role app_user');
      return map(row);
    });
    emit(`company:${companyId}:staff`, 'shift:changed', { shiftId });
    return result;
  });
}
