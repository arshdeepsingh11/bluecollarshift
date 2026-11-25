import type { FastifyInstance } from 'fastify';
import {
  blocksEndingInPeriod,
  calculateEmployeePay,
  payPeriodSchema,
  type PayPeriod,
  type PayrollRecord,
} from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { requireCompany } from '../lib/actor';
import { auditTx } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx, minutesToHours, toCsv } from '../lib/http';
import { notify } from '../services/notify';
import { settingsFromRow } from './companies';

function mapRecord(r: Record<string, unknown>): PayrollRecord {
  return {
    id: r.id as string, payPeriodId: r.pay_period_id as string, membershipId: r.membership_id as string, employeeName: r.full_name as string,
    regularMinutes: r.regular_minutes as number, overtimeMinutes: r.overtime_minutes as number, hourlyRateCents: r.hourly_rate_cents as number,
    overtimeMultiplier: Number(r.overtime_multiplier), grossRegularCents: r.gross_regular_cents as number, grossOvertimeCents: r.gross_overtime_cents as number,
    grossTotalCents: r.gross_total_cents as number, status: r.status as PayrollRecord['status'], paidAt: (r.paid_at as string) ?? null,
    trace: r.trace, pendingSessions: r.pending_sessions as number,
  };
}

export default async function payrollRoutes(app: FastifyInstance) {
  const { db, emit } = app.services;

  app.get('/companies/:companyId/pay-periods', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId);
    // RLS: payroll roles see all; employees only periods that include their own records.
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select pp.id, pp.starts_on, pp.ends_on, pp.pay_date, pp.status,
                count(pr.id)::int as employees, coalesce(sum(pr.regular_minutes), 0)::int as regular, coalesce(sum(pr.overtime_minutes), 0)::int as overtime,
                coalesce(sum(pr.gross_total_cents), 0)::bigint as gross
           from app.pay_periods pp left join app.payroll_records pr on pr.pay_period_id = pp.id
          where pp.company_id = $1 group by pp.id order by pp.starts_on desc limit 100`,
        [companyId],
      )).rows,
    );
    const items: PayPeriod[] = rows.map((r) => ({
      id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, payDate: r.pay_date, status: r.status,
      totals: { employees: r.employees, regularMinutes: r.regular, overtimeMinutes: r.overtime, grossCents: Number(r.gross) },
    }));
    return { items };
  });

  app.post('/companies/:companyId/pay-periods', async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'payroll.manage');
    const b = parse(payPeriodSchema, req.body);
    if (b.endsOn < b.startsOn) throw badRequest('The period must end after it starts.');
    if (b.payDate < b.endsOn) throw badRequest('Pay date must be on or after the period end.');
    const row = await db.asUser(a.userId, async (tx) => {
      const overlap = (await tx.query(`select 1 from app.pay_periods where company_id = $1 and starts_on <= $3 and ends_on >= $2`, [companyId, b.startsOn, b.endsOn])).rowCount;
      if (overlap) throw conflict('This period overlaps an existing pay period.');
      const r = (await tx.query(
        `insert into app.pay_periods (company_id, starts_on, ends_on, pay_date, created_by) values ($1,$2,$3,$4,$5) returning id, starts_on, ends_on, pay_date, status`,
        [companyId, b.startsOn, b.endsOn, b.payDate, a.userId],
      )).rows[0];
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payperiod.created', targetType: 'pay_period', targetId: r.id, metadata: b, ...ctx(req) });
      return r;
    });
    return reply.status(201).send({ id: row.id, startsOn: row.starts_on, endsOn: row.ends_on, payDate: row.pay_date, status: row.status, totals: { employees: 0, regularMinutes: 0, overtimeMinutes: 0, grossCents: 0 } });
  });

  /**
   * Calculate (or recalculate) a pay period from APPROVED effective hours.
   * Overtime blocks (weeks / averaging periods) are attributed to the period in which they end.
   */
  app.post('/companies/:companyId/pay-periods/:periodId/calculate', async (req) => {
    const a = actorOf(req);
    const { companyId, periodId } = parse(companyIdParams('periodId'), req.params);
    requireCompany(a, companyId, 'payroll.manage');
    const result = await db.asUser(a.userId, async (tx) => {
      const period = (await tx.query(`select * from app.pay_periods where id = $1 and company_id = $2 for update`, [periodId, companyId])).rows[0];
      if (!period) throw notFound();
      if (!['open', 'calculated'].includes(period.status)) throw conflict('This pay period is already approved or paid.');
      const sRow = (await tx.query(`select ps.*, c.timezone from app.payroll_settings ps join app.companies c on c.id = ps.company_id where ps.company_id = $1`, [companyId])).rows[0];
      const settings = settingsFromRow(sRow, sRow.timezone);
      const blocks = blocksEndingInPeriod(period.starts_on, period.ends_on, settings);
      if (!blocks.length) throw badRequest('No complete work weeks end inside this period. Check the period dates and work-week start day.');
      const from = blocks[0]!.start;
      const to = blocks[blocks.length - 1]!.end;

      const sessions = (await tx.query(
        `select e.id, e.membership_id, e.effective_start, e.effective_end, e.effective_break_minutes, e.approval_status, e.status,
                (e.effective_start at time zone $4)::date as local_date
           from app.work_sessions_effective e
          where e.company_id = $1 and (e.effective_start at time zone $4)::date between $2 and $3`,
        [companyId, from, to, settings.timezone],
      )).rows;
      const members = (await tx.query(
        `select m.id, m.overtime_exempt, p.full_name,
                (select pr.hourly_rate_cents from app.pay_rates pr where pr.membership_id = m.id and pr.effective_from <= $2
                  order by pr.effective_from desc limit 1) as rate
           from app.memberships m join app.profiles p on p.user_id = m.user_id
          where m.company_id = $1 and m.id = any($3)`,
        [companyId, period.ends_on, [...new Set(sessions.map((s) => s.membership_id))]],
      )).rows;

      await tx.query(`delete from app.payroll_records where pay_period_id = $1 and status = 'draft'`, [periodId]);
      const warnings: { membershipId: string; fullName: string; message: string }[] = [];
      let count = 0;
      for (const mem of members) {
        const mine = sessions.filter((s) => s.membership_id === mem.id);
        const approved = mine.filter((s) => s.approval_status === 'approved' && s.effective_end);
        const pending = mine.filter((s) => s.approval_status !== 'approved').length;
        if (!mem.rate) {
          warnings.push({ membershipId: mem.id, fullName: mem.full_name, message: 'No pay rate set — record skipped.' });
          continue;
        }
        const r = calculateEmployeePay(
          {
            membershipId: mem.id, hourlyRateCents: mem.rate, overtimeExempt: mem.overtime_exempt,
            sessions: approved.map((s) => ({ id: s.id, start: s.effective_start.toISOString(), end: s.effective_end.toISOString(), breakMinutes: s.effective_break_minutes })),
          },
          settings,
        );
        if (pending) warnings.push({ membershipId: mem.id, fullName: mem.full_name, message: `${pending} timesheet(s) not approved and excluded.` });
        await tx.query(
          `insert into app.payroll_records (company_id, pay_period_id, membership_id, regular_minutes, overtime_minutes, hourly_rate_cents,
             overtime_multiplier, gross_regular_cents, gross_overtime_cents, gross_total_cents, trace, engine_version, pending_sessions)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [companyId, periodId, mem.id, r.regularMinutes, r.overtimeMinutes, r.hourlyRateCents, r.overtimeMultiplier, r.grossRegularCents,
            r.grossOvertimeCents, r.grossTotalCents, JSON.stringify({ days: r.days, blocks: r.blocks, warnings: r.warnings, ruleProfile: r.ruleProfile, range: { from, to } }), r.engineVersion, pending],
        );
        count++;
      }
      await tx.query(`update app.pay_periods set status = 'calculated', calculated_at = now() where id = $1`, [periodId]);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payroll.calculated', targetType: 'pay_period', targetId: periodId, metadata: { records: count, range: { from, to } }, ...ctx(req) });
      return { records: count, range: { from, to }, warnings };
    });
    return result;
  });

  app.post('/companies/:companyId/pay-periods/:periodId/approve', async (req) => {
    const a = actorOf(req);
    const { companyId, periodId } = parse(companyIdParams('periodId'), req.params);
    requireCompany(a, companyId, 'payroll.manage');
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(`update app.pay_periods set status = 'approved', approved_by = $3, approved_at = now() where id = $1 and company_id = $2 and status = 'calculated'`, [periodId, companyId, a.userId]);
      if (!r.rowCount) throw conflict('Only a calculated pay period can be approved.');
      await tx.query(`update app.payroll_records set status = 'approved' where pay_period_id = $1`, [periodId]);
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payroll.approved', targetType: 'pay_period', targetId: periodId, ...ctx(req) });
    });
    return { ok: true };
  });

  app.post('/companies/:companyId/pay-periods/:periodId/mark-paid', async (req) => {
    const a = actorOf(req);
    const { companyId, periodId } = parse(companyIdParams('periodId'), req.params);
    requireCompany(a, companyId, 'payroll.manage');
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(`update app.pay_periods set status = 'paid', paid_at = now() where id = $1 and company_id = $2 and status = 'approved'`, [periodId, companyId]);
      if (!r.rowCount) throw conflict('Only an approved pay period can be marked as paid.');
      const recs = (await tx.query(`update app.payroll_records pr set status = 'paid', paid_at = now() from app.memberships m where pr.pay_period_id = $1 and m.id = pr.membership_id returning m.user_id`, [periodId])).rows;
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payroll.paid', targetType: 'pay_period', targetId: periodId, metadata: { records: recs.length }, ...ctx(req) });
      await tx.query('set local role app_system');
      await notify(tx, { userIds: recs.map((r) => r.user_id), companyId, type: 'payroll.paid', title: 'Pay summary available', body: 'Your pay summary for the latest period is ready.', data: { periodId, companyId }, dedupeKey: `payroll.paid:${periodId}` }, emit);
      await tx.query('set local role app_user');
    });
    return { ok: true };
  });

  app.get('/companies/:companyId/pay-periods/:periodId/records', async (req) => {
    const a = actorOf(req);
    const { companyId, periodId } = parse(companyIdParams('periodId'), req.params);
    const m = requireCompany(a, companyId);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select pr.*, p.full_name from app.payroll_records pr join app.memberships m on m.id = pr.membership_id join app.profiles p on p.user_id = m.user_id
          where pr.pay_period_id = $1 and pr.company_id = $2 and ($3::uuid is null or pr.membership_id = $3) order by p.full_name`,
        [periodId, companyId, m.permissions.has('payroll.view') ? null : m.membershipId],
      )).rows,
    );
    return { items: rows.map(mapRecord) };
  });

  app.get('/companies/:companyId/pay-periods/:periodId/export.csv', async (req, reply) => {
    const a = actorOf(req);
    const { companyId, periodId } = parse(companyIdParams('periodId'), req.params);
    requireCompany(a, companyId, 'payroll.view');
    const { period, rows } = await db.asUser(a.userId, async (tx) => {
      const period = (await tx.query(`select starts_on, ends_on, pay_date from app.pay_periods where id = $1 and company_id = $2`, [periodId, companyId])).rows[0];
      if (!period) throw notFound();
      const rows = (await tx.query(
        `select pr.*, p.full_name, p.email from app.payroll_records pr join app.memberships m on m.id = pr.membership_id join app.profiles p on p.user_id = m.user_id
          where pr.pay_period_id = $1 order by p.full_name`, [periodId])).rows;
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payroll.exported', targetType: 'pay_period', targetId: periodId, ...ctx(req) });
      return { period, rows };
    });
    const csv = toCsv(
      ['Employee', 'Email', 'Period start', 'Period end', 'Pay date', 'Regular hours', 'Overtime hours', 'Hourly rate', 'OT multiplier', 'Gross regular', 'Gross overtime', 'Gross total', 'Status', 'Unapproved timesheets'],
      rows.map((r) => [r.full_name, r.email, period.starts_on, period.ends_on, period.pay_date, minutesToHours(r.regular_minutes), minutesToHours(r.overtime_minutes),
        (r.hourly_rate_cents / 100).toFixed(2), Number(r.overtime_multiplier).toFixed(2), (r.gross_regular_cents / 100).toFixed(2), (r.gross_overtime_cents / 100).toFixed(2),
        (r.gross_total_cents / 100).toFixed(2), r.status, r.pending_sessions]),
    );
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="payroll-${period.starts_on}-${period.ends_on}.csv"`)
      .send(`# Gross pay estimate only. Blue Collar does not calculate statutory deductions (CPP, EI, income tax).\r\n${csv}`);
  });

  /** Employee's own pay history. */
  app.get('/companies/:companyId/my-pay', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(
        `select pr.*, p.full_name, pp.starts_on, pp.ends_on, pp.pay_date from app.payroll_records pr join app.pay_periods pp on pp.id = pr.pay_period_id
           join app.memberships m on m.id = pr.membership_id join app.profiles p on p.user_id = m.user_id
          where pr.membership_id = $1 and pr.status in ('approved', 'paid') order by pp.starts_on desc limit 60`,
        [m.membershipId],
      )).rows,
    );
    return { items: rows.map((r) => ({ ...mapRecord(r), startsOn: r.starts_on, endsOn: r.ends_on, payDate: r.pay_date })) };
  });
}
