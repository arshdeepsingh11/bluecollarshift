import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adjustmentSchema,
  approveSessionsSchema,
  disputeSchema,
  resolveDisputeSchema,
  timesheetQuerySchema,
  type WorkSession,
  type WorkSessionDetail,
} from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requireCompany } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx } from '../lib/http';
import { notify, staffUserIds } from '../services/notify';
import type { Tx } from '../db';

const SESSION_SELECT = `
  select e.id, e.membership_id, p.full_name, e.shift_id, js.name as site_name, e.original_start, e.original_end, e.original_break_minutes,
         e.effective_start, e.effective_end, e.effective_break_minutes, e.status, e.approval_status, e.version, e.flags, e.adjusted,
         (select count(*) from app.disputes d where d.session_id = e.id and d.status = 'open')::int as open_disputes,
         (select paid_breaks from app.payroll_settings where company_id = e.company_id) as paid_breaks
    from app.work_sessions_effective e
    join app.memberships m on m.id = e.membership_id join app.profiles p on p.user_id = m.user_id
    left join app.job_sites js on js.id = e.site_id`;

function mapSession(r: Record<string, unknown>): WorkSession {
  const end = r.effective_end as Date | null;
  const start = r.effective_start as Date;
  const gross = end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
  return {
    id: r.id as string, membershipId: r.membership_id as string, employeeName: r.full_name as string, shiftId: (r.shift_id as string) ?? null,
    siteName: (r.site_name as string) ?? null, originalStart: (r.original_start as Date).toISOString(),
    originalEnd: r.original_end ? (r.original_end as Date).toISOString() : null, originalBreakMinutes: r.original_break_minutes as number,
    effectiveStart: start.toISOString(), effectiveEnd: end ? end.toISOString() : null, effectiveBreakMinutes: r.effective_break_minutes as number,
    paidMinutes: gross === null ? null : Math.max(0, gross - (r.paid_breaks ? 0 : (r.effective_break_minutes as number))),
    status: r.status as WorkSession['status'], approvalStatus: r.approval_status as WorkSession['approvalStatus'], version: r.version as number,
    flags: r.flags as string[], adjusted: r.adjusted as boolean, openDisputes: r.open_disputes as number,
  };
}

async function loadDetail(tx: Tx, sessionId: string, companyId: string): Promise<WorkSessionDetail | null> {
  const s = (await tx.query(`${SESSION_SELECT} where e.id = $1 and e.company_id = $2`, [sessionId, companyId])).rows[0];
  if (!s) return null;
  const events = (await tx.query(
    `select id, type, occurred_at, device_time, server_received_at, source, lat, lng, accuracy_m, distance_from_site_m, flags, review_status
       from app.time_events where session_id = $1 order by occurred_at`, [sessionId])).rows;
  const adjustments = (await tx.query(
    `select a.id, a.adjusted_start, a.adjusted_end, a.adjusted_break_minutes, a.reason, a.created_at, a.created_by, p.full_name,
            (ws.current_adjustment_id = a.id) as active
       from app.adjustments a join app.work_sessions ws on ws.id = a.session_id left join app.profiles p on p.user_id = a.created_by
      where a.session_id = $1 order by a.created_at`, [sessionId])).rows;
  const disputes = (await tx.query(
    `select d.*, rp.full_name as raised_name, xp.full_name as resolver_name
       from app.disputes d join app.memberships rm on rm.id = d.raised_by_membership_id join app.profiles rp on rp.user_id = rm.user_id
       left join app.profiles xp on xp.user_id = d.resolved_by where d.session_id = $1 order by d.created_at`, [sessionId])).rows;
  return {
    ...mapSession(s),
    events: events.map((e) => ({
      id: e.id, type: e.type, occurredAt: e.occurred_at.toISOString(), deviceTime: e.device_time.toISOString(), serverReceivedAt: e.server_received_at.toISOString(),
      source: e.source, lat: e.lat, lng: e.lng, accuracyM: e.accuracy_m, distanceFromSiteM: e.distance_from_site_m, flags: e.flags, reviewStatus: e.review_status,
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id, adjustedStart: a.adjusted_start.toISOString(), adjustedEnd: a.adjusted_end.toISOString(), adjustedBreakMinutes: a.adjusted_break_minutes,
      reason: a.reason, createdBy: { userId: a.created_by, fullName: a.full_name ?? 'Unknown' }, createdAt: a.created_at.toISOString(), active: a.active,
    })),
    disputes: disputes.map((d) => ({
      id: d.id, sessionId: d.session_id, adjustmentId: d.adjustment_id, explanation: d.explanation, status: d.status, resolutionNote: d.resolution_note,
      raisedBy: { membershipId: d.raised_by_membership_id, fullName: d.raised_name }, resolvedBy: d.resolved_by ? { userId: d.resolved_by, fullName: d.resolver_name } : null,
      createdAt: d.created_at.toISOString(), resolvedAt: d.resolved_at ? d.resolved_at.toISOString() : null,
    })),
  };
}

export default async function timesheetRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;

  app.get('/companies/:companyId/timesheets', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const q = parse(timesheetQuerySchema, req.query);
    const staff = m.permissions.has('attendance.view');
    const membershipId = staff ? (q.membershipId ?? null) : m.membershipId; // employees: own records only
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `${SESSION_SELECT}
          where e.company_id = $1
            and (e.effective_start at time zone (select timezone from app.companies where id = $1))::date between $2 and $3
            and ($4::uuid is null or e.membership_id = $4) and ($5::uuid is null or e.site_id = $5)
            and ($6::text is null or e.status = $6) and ($7::text is null or e.approval_status = $7)
          order by e.effective_start desc limit 1000`,
        [companyId, q.from, q.to, membershipId, q.siteId ?? null, q.status ?? null, q.approval ?? null],
      )).rows,
    );
    return { items: rows.map(mapSession) };
  });

  app.get('/companies/:companyId/timesheets/:sessionId', async (req) => {
    const a = actorOf(req);
    const { companyId, sessionId } = parse(companyIdParams('sessionId'), req.params);
    requireCompany(a, companyId);
    const d = await db.asUser(a.userId, (tx) => loadDetail(tx, sessionId, companyId));
    if (!d) throw notFound();
    return d;
  });

  /** Employer adjustment: original record is preserved; reason required; employee notified. */
  app.post('/companies/:companyId/timesheets/:sessionId/adjustments', async (req, reply) => {
    const a = actorOf(req);
    const { companyId, sessionId } = parse(companyIdParams('sessionId'), req.params);
    const m = requireCompany(a, companyId, 'timesheets.adjust');
    const b = parse(adjustmentSchema, req.body);
    const detail = await db.asUser(a.userId, async (tx) => {
      const s = (await tx.query(`select ws.*, m.user_id from app.work_sessions ws join app.memberships m on m.id = ws.membership_id where ws.id = $1 and ws.company_id = $2 for update of ws`, [sessionId, companyId])).rows[0];
      if (!s) throw notFound();
      if (s.membership_id === m.membershipId) throw forbidden('You cannot adjust your own hours.');
      if (s.status === 'open') throw badRequest('The employee is still clocked in. Adjust after they clock out.');
      if (s.version !== b.expectedVersion) throw conflict('This timesheet changed since you opened it (for example a synced offline event). Review the latest version.', { currentVersion: s.version });
      if (Date.parse(b.adjustedEnd) - Date.parse(b.adjustedStart) > 24 * 3600_000) throw badRequest('A work session cannot exceed 24 hours.');
      const adj = (await tx.query(
        `insert into app.adjustments (company_id, session_id, adjusted_start, adjusted_end, adjusted_break_minutes, reason, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, after_payment`,
        [companyId, sessionId, b.adjustedStart, b.adjustedEnd, b.adjustedBreakMinutes, b.reason, a.userId],
      )).rows[0];
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'timesheet.adjusted', targetType: 'work_session', targetId: sessionId,
        metadata: { adjustmentId: adj.id, original: { start: s.original_start, end: s.original_end, breakMinutes: s.original_break_minutes }, adjusted: b, afterPayment: adj.after_payment }, ...ctx(req) });
      await tx.query('set local role app_system');
      await notify(tx, {
        userIds: [s.user_id], companyId, type: 'timesheet.adjusted', title: 'Your hours were adjusted',
        body: `${a.fullName ?? 'Your manager'} changed a timesheet. Reason: ${b.reason.slice(0, 140)}`,
        data: { sessionId, adjustmentId: adj.id, companyId }, dedupeKey: `timesheet.adjusted:${adj.id}`, email: true,
      }, emit);
      await tx.query('set local role app_user');
      return loadDetail(tx, sessionId, companyId);
    });
    emit(`company:${companyId}:staff`, 'timesheet:changed', { sessionId });
    return reply.status(201).send(detail);
  });

  app.post('/companies/:companyId/timesheets/approve', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'timesheets.approve');
    const b = parse(approveSessionsSchema, req.body);
    const updated = await db.asUser(a.userId, async (tx) => {
      const { rows } = await tx.query(
        `update app.work_sessions set approval_status = $3, approved_by = $4, approved_at = now(), approval_note = $5, version = version + 1
          where company_id = $1 and id = any($2) and status <> 'open' and membership_id <> $6
          returning id, membership_id`,
        [companyId, b.sessionIds, b.decision, a.userId, b.note ?? null, m.membershipId],
      );
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `timesheet.${b.decision}`, targetType: 'work_session', targetId: null, metadata: { sessionIds: rows.map((r) => r.id), note: b.note }, ...ctx(req) });
      if (b.decision === 'rejected' && rows.length) {
        const users = (await tx.query(`select distinct user_id from app.memberships where id = any($1)`, [rows.map((r) => r.membership_id)])).rows.map((r) => r.user_id);
        await tx.query('set local role app_system');
        await notify(tx, { userIds: users, companyId, type: 'timesheet.rejected', title: 'Timesheet needs correction', body: b.note ?? 'A timesheet was sent back for correction.', data: { companyId }, dedupeKey: `timesheet.rejected:${rows.map((r) => r.id).join(',').slice(0, 200)}` }, emit);
        await tx.query('set local role app_user');
      }
      return rows.map((r) => r.id as string);
    });
    // Sessions not updated were open, your own, or outside your scope (RLS) — report them.
    return { updated, skipped: b.sessionIds.filter((id) => !updated.includes(id)) };
  });

  app.get('/companies/:companyId/disputes', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const { status } = parse(z.object({ status: z.enum(['open', 'resolved', 'rejected', 'all']).default('open') }), req.query);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select d.id, d.session_id, d.adjustment_id, d.explanation, d.status, d.resolution_note, d.created_at, d.resolved_at, p.full_name, d.raised_by_membership_id
           from app.disputes d join app.memberships rm on rm.id = d.raised_by_membership_id join app.profiles p on p.user_id = rm.user_id
          where d.company_id = $1 and ($2 = 'all' or d.status = $2) and ($3::uuid is null or d.raised_by_membership_id = $3)
          order by d.created_at desc limit 500`,
        [companyId, status, m.permissions.has('disputes.resolve') ? null : m.membershipId],
      )).rows,
    );
    return { items: rows.map((d) => ({ id: d.id, sessionId: d.session_id, adjustmentId: d.adjustment_id, explanation: d.explanation, status: d.status, resolutionNote: d.resolution_note, raisedBy: { membershipId: d.raised_by_membership_id, fullName: d.full_name }, createdAt: d.created_at, resolvedAt: d.resolved_at })) };
  });

  /** Employee disputes their own timesheet / an adjustment. */
  app.post('/companies/:companyId/timesheets/:sessionId/disputes', async (req, reply) => {
    const a = actorOf(req);
    const { companyId, sessionId } = parse(companyIdParams('sessionId'), req.params);
    const m = requireCompany(a, companyId);
    const b = parse(disputeSchema, req.body);
    const id = await db.asUser(a.userId, async (tx) => {
      const s = (await tx.query(`select id, membership_id, site_id from app.work_sessions where id = $1 and company_id = $2`, [sessionId, companyId])).rows[0];
      if (!s || s.membership_id !== m.membershipId) throw notFound();
      if (b.adjustmentId) {
        const ok = (await tx.query(`select 1 from app.adjustments where id = $1 and session_id = $2`, [b.adjustmentId, sessionId])).rowCount;
        if (!ok) throw badRequest('That adjustment does not belong to this timesheet.');
      }
      const open = (await tx.query(`select 1 from app.disputes where session_id = $1 and status = 'open'`, [sessionId])).rowCount;
      if (open) throw conflict('There is already an open dispute for this timesheet.');
      const d = (await tx.query(
        `insert into app.disputes (company_id, session_id, adjustment_id, raised_by_membership_id, explanation) values ($1,$2,$3,$4,$5) returning id`,
        [companyId, sessionId, b.adjustmentId ?? null, m.membershipId, b.explanation],
      )).rows[0];
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'dispute.opened', targetType: 'work_session', targetId: sessionId, metadata: { disputeId: d.id }, ...ctx(req) });
      await tx.query('set local role app_system');
      const staff = await staffUserIds(tx, companyId, ['owner', 'admin', 'manager'], s.site_id);
      await notify(tx, { userIds: staff, companyId, type: 'dispute.opened', title: 'Timesheet disputed', body: `${a.fullName ?? 'An employee'} disputed a timesheet.`, data: { sessionId, disputeId: d.id, companyId }, dedupeKey: `dispute.opened:${d.id}`, email: true }, emit);
      await tx.query('set local role app_user');
      return d.id as string;
    });
    return reply.status(201).send({ id });
  });

  app.post('/companies/:companyId/disputes/:disputeId/resolve', async (req) => {
    const a = actorOf(req);
    const { companyId, disputeId } = parse(companyIdParams('disputeId'), req.params);
    const m = requireCompany(a, companyId, 'disputes.resolve');
    const b = parse(resolveDisputeSchema, req.body);
    await db.asUser(a.userId, async (tx) => {
      const d = (await tx.query(
        `select d.*, mm.user_id from app.disputes d join app.memberships mm on mm.id = d.raised_by_membership_id where d.id = $1 and d.company_id = $2 for update of d`,
        [disputeId, companyId],
      )).rows[0];
      if (!d) throw notFound();
      if (d.raised_by_membership_id === m.membershipId) throw forbidden('You cannot resolve your own dispute.');
      if (d.status !== 'open') throw conflict('This dispute is already closed.');
      await tx.query(`update app.disputes set status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now() where id = $1`, [disputeId, b.status, b.resolutionNote, a.userId]);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: `dispute.${b.status}`, targetType: 'dispute', targetId: disputeId, metadata: { note: b.resolutionNote }, ...ctx(req) });
      await tx.query('set local role app_system');
      await notify(tx, { userIds: [d.user_id], companyId, type: 'dispute.closed', title: b.status === 'resolved' ? 'Dispute resolved' : 'Dispute declined', body: b.resolutionNote.slice(0, 200), data: { sessionId: d.session_id, disputeId, companyId }, dedupeKey: `dispute.closed:${disputeId}`, email: true }, emit);
      await tx.query('set local role app_user');
    });
    return { ok: true };
  });
}
