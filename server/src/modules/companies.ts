import type { FastifyInstance } from 'fastify';
import {
  payrollSettingsSchema,
  registerCompanySchema,
  updateCompanySchema,
  validatePayrollSettings,
  type RuleProfileId,
} from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { invalidateActor, requireCompany } from '../lib/actor';
import { auditSystemTx, auditTx } from '../lib/audit';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { companyParams, ctx } from '../lib/http';

export function settingsFromRow(r: Record<string, unknown>, timezone: string) {
  return {
    ruleProfile: r.rule_profile as RuleProfileId,
    timezone,
    workWeekStartDow: Number(r.work_week_start_dow),
    dailyOvertimeEnabled: r.daily_overtime_enabled !== false,
    dailyThresholdMinutes: Number(r.daily_threshold_minutes),
    weeklyOvertimeEnabled: r.weekly_overtime_enabled !== false,
    weeklyThresholdMinutes: Number(r.weekly_threshold_minutes),
    overtimeMultiplier: Number(r.overtime_multiplier),
    paidBreaks: Boolean(r.paid_breaks),
    averaging: r.averaging_enabled
      ? { enabled: true, periodWeeks: Number(r.averaging_weeks), anchorDate: String(r.averaging_anchor) }
      : null,
    overtimeAgreementBanking: Boolean(r.overtime_banking),
    payFrequency: r.pay_frequency as 'weekly' | 'biweekly' | 'semimonthly' | 'monthly',
    payPeriodAnchor: String(r.pay_period_anchor),
    adpCompanyCode: (r.adp_company_code as string | null) ?? null,
  };
}

const COMPANY_COLS = 'id, name, phone, address, timezone, currency, country, status, created_at';
function mapCompany(r: Record<string, unknown>) {
  return {
    id: r.id, name: r.name, phone: r.phone, address: r.address, timezone: r.timezone,
    currency: r.currency, country: r.country, status: r.status, createdAt: r.created_at,
  };
}

export default async function companyRoutes(app: FastifyInstance) {
  const { db } = app.services;

  /** Company registration: the signed-in (email-verified) user becomes the owner. */
  app.post('/companies', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const a = actorOf(req);
    const body = parse(registerCompanySchema, req.body);
    if (!a.email) throw badRequest('Your account has no email address.');
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: body.timezone });
    } catch {
      throw badRequest('Unknown time zone.');
    }
    if (a.memberships.filter((m) => m.role === 'owner').length >= 3) throw conflict('You already own the maximum number of companies.');

    const company = await db.asSystem(async (tx) => {
      await tx.query(
        `insert into app.profiles (user_id, email, full_name) values ($1, $2, $3)
         on conflict (user_id) do update set full_name = coalesce(nullif(app.profiles.full_name, ''), excluded.full_name)`,
        [a.userId, a.email, body.fullName],
      );
      const { rows } = await tx.query(
        `insert into app.companies (name, phone, timezone, currency, country, created_by) values ($1, $2, $3, $4, $5, $6)
         returning ${COMPANY_COLS}`,
        [body.companyName, body.phone ?? null, body.timezone, body.currency, body.country, a.userId],
      );
      const c = rows[0]!;
      await tx.query(`insert into app.memberships (company_id, user_id, role) values ($1, $2, 'owner')`, [c.id, a.userId]);
      await tx.query(`insert into app.payroll_settings (company_id, updated_by) values ($1, $2)`, [c.id, a.userId]);
      await auditSystemTx(tx, { companyId: c.id, actorUserId: a.userId, action: 'company.registered', targetType: 'company', targetId: c.id, ...ctx(req) });
      return c;
    });
    invalidateActor(a.userId);
    return reply.status(201).send(mapCompany(company));
  });

  app.get('/companies/:companyId', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId);
    const row = await db.asUser(a.userId, async (tx) =>
      (await tx.query(`select ${COMPANY_COLS} from app.companies where id = $1`, [companyId])).rows[0],
    );
    return mapCompany(row);
  });

  app.patch('/companies/:companyId', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'company.settings.manage');
    const body = parse(updateCompanySchema, req.body);
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: body.timezone });
      } catch {
        throw badRequest('Unknown time zone.');
      }
    }
    const row = await db.asUser(a.userId, async (tx) => {
      const before = (await tx.query(`select name, phone, address, timezone, currency, country from app.companies where id = $1`, [companyId])).rows[0];
      const { rows } = await tx.query(
        `update app.companies set name = coalesce($2, name), phone = case when $3::boolean then $4 else phone end,
                address = case when $5::boolean then $6 else address end, timezone = coalesce($7, timezone),
                currency = coalesce($8, currency), country = coalesce($9, country)
          where id = $1 returning ${COMPANY_COLS}`,
        [companyId, body.name ?? null, body.phone !== undefined, body.phone ?? null, body.address !== undefined, body.address ?? null, body.timezone ?? null,
          body.currency ?? null, body.country ?? null],
      );
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'company.updated', targetType: 'company', targetId: companyId, metadata: { before, after: body }, ...ctx(req) });
      return rows[0];
    });
    invalidateActor();
    return mapCompany(row);
  });

  app.get('/companies/:companyId/payroll-settings', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId);
    if (!m.permissions.has('payroll.view') && !m.permissions.has('company.settings.manage')) throw forbidden();
    const r = await db.asUser(a.userId, async (tx) =>
      (
        await tx.query(
          `select ps.*, c.timezone from app.payroll_settings ps join app.companies c on c.id = ps.company_id where ps.company_id = $1`,
          [companyId],
        )
      ).rows[0],
    );
    return settingsFromRow(r, r.timezone);
  });

  app.put('/companies/:companyId/payroll-settings', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const mem = requireCompany(a, companyId, 'payroll.manage');
    const s = parse(payrollSettingsSchema, req.body);
    const violations = validatePayrollSettings(s);
    if (violations.length) throw badRequest('Some pay settings are not valid.', violations);
    await db.asUser(a.userId, async (tx) => {
      const before = (await tx.query(`select * from app.payroll_settings where company_id = $1`, [companyId])).rows[0];
      await tx.query(
        `update app.payroll_settings set rule_profile = $2, work_week_start_dow = $3, daily_threshold_minutes = $4,
           weekly_threshold_minutes = $5, overtime_multiplier = $6, paid_breaks = $7, averaging_enabled = $8,
           averaging_weeks = $9, averaging_anchor = $10, overtime_banking = $11, pay_frequency = $12, pay_period_anchor = $13,
           updated_by = $14, updated_at = now(), daily_overtime_enabled = $15, weekly_overtime_enabled = $16,
           adp_company_code = case when $17::boolean then $18 else adp_company_code end
         where company_id = $1`,
        [companyId, s.ruleProfile, s.workWeekStartDow, s.dailyThresholdMinutes, s.weeklyThresholdMinutes, s.overtimeMultiplier,
          s.paidBreaks, s.averaging?.enabled ?? false, s.averaging?.enabled ? s.averaging.periodWeeks : null,
          s.averaging?.enabled ? s.averaging.anchorDate : null, s.overtimeAgreementBanking, s.payFrequency, s.payPeriodAnchor, a.userId,
          s.dailyOvertimeEnabled, s.weeklyOvertimeEnabled, s.adpCompanyCode !== undefined, s.adpCompanyCode?.toUpperCase() ?? null],
      );
      if (s.timezone) {
        const cur = (await tx.query(`select timezone from app.companies where id = $1`, [companyId])).rows[0];
        if (cur?.timezone !== s.timezone) {
          if (!mem.permissions.has('company.settings.manage')) throw forbidden('Only owners and admins can change the company time zone.');
          await tx.query(`update app.companies set timezone = $2 where id = $1`, [companyId, s.timezone]);
        }
      }
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payroll.settings_updated', targetType: 'company', targetId: companyId, metadata: { before, after: s }, ...ctx(req) });
    });
    return { ok: true };
  });

  /** Operational dashboard — one round trip, numbers limited to what the caller may see (RLS). */
  app.get('/companies/:companyId/dashboard', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'attendance.view');
    const grace = app.services.config.LATE_GRACE_MINUTES;
    return db.asUser(a.userId, async (tx) => {
      const { rows } = await tx.query(
        `with tz as (select timezone from app.companies where id = $1),
              today as (select (now() at time zone (select timezone from tz))::date as d)
         select
          (select count(*) from app.memberships where company_id = $1 and status = 'active' and role = 'employee') as employees,
          (select count(*) from app.work_sessions where company_id = $1 and status = 'open') as working_now,
          (select count(distinct sa.membership_id) from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id
             where s.company_id = $1 and s.status = 'scheduled'
               and (s.starts_at at time zone (select timezone from tz))::date = (select d from today)) as scheduled_today,
          (select count(*) from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id
             where s.company_id = $1 and s.status = 'scheduled'
               and s.starts_at < now() - make_interval(mins => $2) and s.ends_at > now()
               and not exists (select 1 from app.time_events te where te.membership_id = sa.membership_id
                               and te.type = 'clock_in' and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at)) as not_clocked_in,
          (select count(*) from app.work_sessions where company_id = $1 and status <> 'open'
             and (original_end at time zone (select timezone from tz))::date = (select d from today)) as clocked_out_today,
          (select count(*) from app.job_sites where company_id = $1 and status = 'active') as active_sites,
          (select count(*) from app.shifts where company_id = $1 and status = 'scheduled' and starts_at between now() and now() + interval '7 days') as upcoming_shifts,
          (select count(*) from app.work_sessions where company_id = $1 and status <> 'open' and approval_status = 'pending') as pending_timesheets,
          (select count(*) from app.work_sessions where company_id = $1 and status = 'needs_review') as needs_review,
          (select count(*) from app.disputes where company_id = $1 and status = 'open') as open_disputes,
          (select count(*) from app.adjustments where company_id = $1 and created_at > now() - interval '7 days') as recent_adjustments`,
        [companyId, grace],
      );
      const r = rows[0];
      const num = (v: unknown) => Number(v ?? 0);
      const unread = (
        await tx.query(
          `select count(*) from app.messages msg join app.conversation_members cm on cm.conversation_id = msg.conversation_id
            where cm.membership_id = $1 and msg.sender_membership_id <> $1 and msg.created_at > coalesce(cm.last_read_at, 'epoch')`,
          [m.membershipId],
        )
      ).rows[0];
      return {
        employees: num(r.employees), workingNow: num(r.working_now), scheduledToday: num(r.scheduled_today),
        notClockedIn: num(r.not_clocked_in), clockedOutToday: num(r.clocked_out_today), activeSites: num(r.active_sites),
        upcomingShifts: num(r.upcoming_shifts), pendingTimesheets: num(r.pending_timesheets), needsReview: num(r.needs_review),
        openDisputes: num(r.open_disputes), recentAdjustments: num(r.recent_adjustments), unreadMessages: num(unread?.count),
      };
    });
  });
}
