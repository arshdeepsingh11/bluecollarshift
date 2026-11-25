import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { actorOf, parse } from '../app';
import { requireCompany } from '../lib/actor';
import { companyParams, minutesToHours, toCsv } from '../lib/http';

const range = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    format: z.enum(['json', 'csv']).default('json'),
    siteId: z.string().uuid().optional(),
    membershipId: z.string().uuid().optional(),
  })
  .refine((v) => v.to >= v.from, 'to must be on or after from')
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400_000 <= 370, 'Range cannot exceed one year');

function send(reply: FastifyReply, format: 'json' | 'csv', name: string, header: string[], rows: unknown[][], items: unknown[]) {
  if (format === 'csv') {
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`).send(toCsv(header, rows));
  }
  return { items };
}

export default async function reportRoutes(app: FastifyInstance) {
  const { db } = app.services;

  /** Hours by employee (and site) from effective (adjusted) values. Scoped by RLS for supervisors. */
  app.get('/companies/:companyId/reports/hours', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'reports.view');
    const q = parse(range, req.query);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select p.full_name, coalesce(js.name, '—') as site_name, count(*)::int as sessions,
                sum(greatest(0, extract(epoch from (e.effective_end - e.effective_start)) / 60
                    - case when ps.paid_breaks then 0 else e.effective_break_minutes end))::int as minutes,
                count(*) filter (where e.approval_status = 'approved')::int as approved,
                count(*) filter (where e.adjusted)::int as adjusted
           from app.work_sessions_effective e join app.memberships m on m.id = e.membership_id join app.profiles p on p.user_id = m.user_id
           left join app.job_sites js on js.id = e.site_id join app.payroll_settings ps on ps.company_id = e.company_id
           join app.companies c on c.id = e.company_id
          where e.company_id = $1 and e.effective_end is not null
            and (e.effective_start at time zone c.timezone)::date between $2 and $3
            and ($4::uuid is null or e.site_id = $4) and ($5::uuid is null or e.membership_id = $5)
          group by p.full_name, js.name order by p.full_name, js.name`,
        [companyId, q.from, q.to, q.siteId ?? null, q.membershipId ?? null],
      )).rows,
    );
    const items = rows.map((r) => ({ employee: r.full_name, site: r.site_name, sessions: r.sessions, hours: minutesToHours(r.minutes), approved: r.approved, adjusted: r.adjusted }));
    return send(reply, q.format, `hours-${q.from}-${q.to}`, ['Employee', 'Site', 'Sessions', 'Hours', 'Approved', 'Adjusted'], items.map((i) => Object.values(i)), items);
  });

  /** Late arrivals and missing clock-outs. */
  app.get('/companies/:companyId/reports/attendance', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'reports.view');
    const q = parse(range, req.query);
    const grace = app.services.config.LATE_GRACE_MINUTES;
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `with c as (select timezone from app.companies where id = $1)
         select p.full_name, js.name as site_name, s.starts_at, s.ends_at,
                (select min(te.occurred_at) from app.time_events te where te.membership_id = sa.membership_id and te.type = 'clock_in'
                   and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at) as clock_in,
                (select max(te.occurred_at) from app.time_events te where te.membership_id = sa.membership_id and te.type = 'clock_out'
                   and te.occurred_at between s.starts_at and s.ends_at + interval '12 hours') as clock_out
           from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.memberships m on m.id = sa.membership_id
           join app.profiles p on p.user_id = m.user_id join app.job_sites js on js.id = s.site_id
          where s.company_id = $1 and s.status = 'scheduled' and s.ends_at < now()
            and (s.starts_at at time zone (select timezone from c))::date between $2 and $3
            and ($4::uuid is null or s.site_id = $4) and ($5::uuid is null or sa.membership_id = $5)
          order by s.starts_at`,
        [companyId, q.from, q.to, q.siteId ?? null, q.membershipId ?? null],
      )).rows,
    );
    const items = rows
      .map((r) => {
        const lateBy = r.clock_in ? Math.round((r.clock_in.getTime() - r.starts_at.getTime()) / 60000) : null;
        const issue = !r.clock_in ? 'no_show' : lateBy! > grace ? 'late' : !r.clock_out ? 'missing_clock_out' : null;
        return { employee: r.full_name, site: r.site_name, shiftStart: r.starts_at, clockIn: r.clock_in, clockOut: r.clock_out, minutesLate: lateBy && lateBy > 0 ? lateBy : 0, issue };
      })
      .filter((i) => i.issue);
    return send(reply, q.format, `attendance-${q.from}-${q.to}`, ['Employee', 'Site', 'Shift start', 'Clock in', 'Clock out', 'Minutes late', 'Issue'], items.map((i) => Object.values(i)), items);
  });

  app.get('/companies/:companyId/reports/adjustments', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'reports.view');
    const q = parse(range, req.query);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select ep.full_name as employee, ap.full_name as adjusted_by, a.created_at, ws.original_start, ws.original_end, a.adjusted_start, a.adjusted_end,
                ws.original_break_minutes, a.adjusted_break_minutes, a.reason, a.after_payment,
                (select status from app.disputes d where d.session_id = ws.id order by d.created_at desc limit 1) as dispute
           from app.adjustments a join app.work_sessions ws on ws.id = a.session_id join app.memberships m on m.id = ws.membership_id
           join app.profiles ep on ep.user_id = m.user_id left join app.profiles ap on ap.user_id = a.created_by
          where a.company_id = $1 and a.created_at::date between $2 and $3 and ($5::uuid is null or ws.membership_id = $5)
          order by a.created_at desc`,
        [companyId, q.from, q.to, q.siteId ?? null, q.membershipId ?? null],
      )).rows,
    );
    const items = rows.map((r) => ({ employee: r.employee, adjustedBy: r.adjusted_by, adjustedAt: r.created_at, originalStart: r.original_start, originalEnd: r.original_end, adjustedStart: r.adjusted_start, adjustedEnd: r.adjusted_end, originalBreak: r.original_break_minutes, adjustedBreak: r.adjusted_break_minutes, reason: r.reason, afterPayment: r.after_payment, dispute: r.dispute ?? '' }));
    return send(reply, q.format, `adjustments-${q.from}-${q.to}`, ['Employee', 'Adjusted by', 'Adjusted at', 'Original start', 'Original end', 'Adjusted start', 'Adjusted end', 'Original break', 'Adjusted break', 'Reason', 'After payment', 'Dispute'], items.map((i) => Object.values(i)), items);
  });

  /** Company audit trail (owners/admins). */
  app.get('/companies/:companyId/audit', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'audit.view');
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), before: z.coerce.number().int().optional() }), req.query);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select al.id, al.action, al.target_type, al.target_id, al.metadata, al.success, al.created_at, p.full_name
           from app.audit_logs al left join app.profiles p on p.user_id = al.actor_user_id
          where al.company_id = $1 and ($2::bigint is null or al.id < $2) order by al.id desc limit $3`,
        [companyId, q.before ?? null, q.limit],
      )).rows,
    );
    return { items: rows.map((r) => ({ id: r.id, action: r.action, targetType: r.target_type, targetId: r.target_id, metadata: r.metadata, success: r.success, createdAt: r.created_at, actorName: r.full_name ?? 'System' })), nextBefore: rows.length ? rows[rows.length - 1].id : null };
  });
}
