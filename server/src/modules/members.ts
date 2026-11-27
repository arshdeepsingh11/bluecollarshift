import type { FastifyInstance } from 'fastify';
import { normalizeLocale } from '../i18n/messages';
import { z } from 'zod';
import {
  acceptInviteSchema,
  canAssignRole,
  inviteSchema,
  payRateSchema,
  toCents,
  updateMemberSchema,
  type CompanyRole,
  type Member,
} from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { invalidateActor, requireCompany } from '../lib/actor';
import { auditSystemTx, auditTx, securityEvent } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { companyIdParams, companyParams, ctx, newToken, sha256 } from '../lib/http';
import { templates } from '../services/email';
import type { Tx } from '../db';

const ROLE_RANK: Record<CompanyRole, number> = { owner: 5, admin: 4, manager: 3, payroll: 2, supervisor: 2, employee: 1 };
const INVITE_DAYS = 7;

async function loadMembers(tx: Tx, companyId: string, includeRates: boolean, onlyId?: string): Promise<Member[]> {
  const { rows } = await tx.query(
    `select m.id, m.user_id, p.full_name, p.email, m.role, m.status, m.job_title, m.overtime_exempt,
            m.payroll_id, m.crew_lead, m.extra_permissions, m.revoked_permissions, m.created_at,
            (select coalesce(array_agg(site_id), '{}') from app.membership_sites ms where ms.membership_id = m.id) as site_ids,
            ${includeRates ? `(select pr.hourly_rate_cents from app.pay_rates pr where pr.membership_id = m.id
                               and pr.effective_from <= current_date order by pr.effective_from desc limit 1)` : 'null'} as rate
       from app.memberships m join app.profiles p on p.user_id = m.user_id
      where m.company_id = $1 and ($2::uuid is null or m.id = $2)
      order by m.status, p.full_name`,
    [companyId, onlyId ?? null],
  );
  return rows.map((r) => ({
    membershipId: r.id,
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    status: r.status,
    jobTitle: r.job_title,
    overtimeExempt: r.overtime_exempt,
    hourlyRate: r.rate === null || r.rate === undefined ? null : (Number(r.rate) / 100).toFixed(2),
    siteIds: r.site_ids,
    extraPermissions: r.extra_permissions,
    revokedPermissions: r.revoked_permissions,
    payrollId: r.payroll_id ?? null,
    crewLead: !!r.crew_lead,
    createdAt: r.created_at,
  }));
}

export default async function memberRoutes(app: FastifyInstance) {
  const { db, config } = app.services;
  const mailer = { send: (m: Parameters<typeof app.services.mailer.send>[0]) => app.services.mailer.send(m) };

  app.get('/companies/:companyId/members', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'members.view');
    // RLS limits scoped supervisors/managers to employees of their sites.
    return { items: await db.asUser(a.userId, (tx) => loadMembers(tx, companyId, m.permissions.has('payrates.view'))) };
  });

  app.get('/companies/:companyId/members/:membershipId', async (req) => {
    const a = actorOf(req);
    const { companyId, membershipId } = parse(companyIdParams('membershipId'), req.params);
    const m = requireCompany(a, companyId);
    const self = m.membershipId === membershipId;
    if (!self && !m.permissions.has('members.view')) throw notFound();
    const [member] = await db.asUser(a.userId, (tx) => loadMembers(tx, companyId, self || m.permissions.has('payrates.view'), membershipId));
    if (!member) throw notFound();
    return member;
  });

  app.patch('/companies/:companyId/members/:membershipId', async (req) => {
    const a = actorOf(req);
    const { companyId, membershipId } = parse(companyIdParams('membershipId'), req.params);
    const m = requireCompany(a, companyId, 'members.manage');
    const body = parse(updateMemberSchema, req.body);
    if (membershipId === m.membershipId) throw forbidden('You cannot change your own role or permissions.');
    if ((body.extraPermissions || body.revokedPermissions) && !m.permissions.has('roles.manage')) throw forbidden();
    if (body.siteIds && body.siteIds.length && !m.permissions.has('sites.manage')) throw forbidden();

    const result = await db.asUser(a.userId, async (tx) => {
      const target = (await tx.query(`select id, user_id, role, status from app.memberships where id = $1 and company_id = $2 for update`, [membershipId, companyId])).rows[0];
      if (!target) throw notFound();
      // You may only manage people ranked below you, and only assign roles you are allowed to grant.
      if (ROLE_RANK[target.role as CompanyRole] >= ROLE_RANK[m.role]) throw forbidden('You cannot manage someone at or above your own role.');
      if (body.role && body.role !== target.role && !canAssignRole(m.role, body.role)) throw forbidden(`You cannot assign the ${body.role} role.`);
      if (body.siteIds) {
        const valid = (await tx.query(`select count(*)::int as n from app.job_sites where company_id = $1 and id = any($2)`, [companyId, body.siteIds])).rows[0];
        if (valid.n !== body.siteIds.length) throw badRequest('One or more job sites are invalid.');
      }
      await tx.query(
        `update app.memberships set role = coalesce($3, role), job_title = case when $4::boolean then $5 else job_title end,
                status = coalesce($6, status), overtime_exempt = coalesce($7, overtime_exempt),
                extra_permissions = coalesce($8, extra_permissions), revoked_permissions = coalesce($9, revoked_permissions),
                deactivated_at = case when $6 = 'inactive' then now() when $6 = 'active' then null else deactivated_at end,
                payroll_id = case when $10::boolean then $11 else payroll_id end, crew_lead = coalesce($12, crew_lead)
          where id = $1 and company_id = $2`,
        [membershipId, companyId, body.role ?? null, body.jobTitle !== undefined, body.jobTitle ?? null, body.status ?? null,
          body.overtimeExempt ?? null, body.extraPermissions ?? null, body.revokedPermissions ?? null,
          body.payrollId !== undefined, body.payrollId ?? null, body.crewLead ?? null],
      );
      if (body.siteIds) {
        await tx.query(`delete from app.membership_sites where membership_id = $1`, [membershipId]);
        if (body.siteIds.length)
          await tx.query(`insert into app.membership_sites (membership_id, site_id, company_id) select $1, unnest($2::uuid[]), $3`, [membershipId, body.siteIds, companyId]);
      }
      if (body.status === 'inactive') {
        // Deactivation ends access immediately; history (timesheets, payroll) is preserved.
        await tx.query('set local role app_system');
        await tx.query(`update app.work_sessions set status = 'needs_review', flags = flags || '{deactivated_while_open}' where membership_id = $1 and status = 'open'`, [membershipId]);
        await tx.query('set local role app_user');
      }
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'member.updated', targetType: 'membership', targetId: membershipId, metadata: { before: target, changes: body }, ...ctx(req) });
      return target.user_id as string;
    });
    invalidateActor(result);
    const [member] = await db.asUser(a.userId, (tx) => loadMembers(tx, companyId, m.permissions.has('payrates.view'), membershipId));
    return member;
  });

  // ---------- Pay rates (history is kept; a new rate applies from its effective date) ----------
  app.get('/companies/:companyId/members/:membershipId/pay-rates', async (req) => {
    const a = actorOf(req);
    const { companyId, membershipId } = parse(companyIdParams('membershipId'), req.params);
    const m = requireCompany(a, companyId);
    if (m.membershipId !== membershipId && !m.permissions.has('payrates.view')) throw notFound();
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(`select id, hourly_rate_cents, effective_from, created_at from app.pay_rates where membership_id = $1 and company_id = $2 order by effective_from desc`, [membershipId, companyId])).rows,
    );
    return { items: rows.map((r) => ({ id: r.id, hourlyRate: (r.hourly_rate_cents / 100).toFixed(2), effectiveFrom: r.effective_from, createdAt: r.created_at })) };
  });

  app.post('/companies/:companyId/members/:membershipId/pay-rates', async (req, reply) => {
    const a = actorOf(req);
    const { companyId, membershipId } = parse(companyIdParams('membershipId'), req.params);
    const m = requireCompany(a, companyId, 'payrates.manage');
    if (m.membershipId === membershipId) throw forbidden('You cannot change your own pay rate.');
    const body = parse(payRateSchema, req.body);
    const row = await db.asUser(a.userId, async (tx) => {
      const exists = (await tx.query(`select 1 from app.memberships where id = $1 and company_id = $2`, [membershipId, companyId])).rowCount;
      if (!exists) throw notFound();
      const { rows } = await tx.query(
        `insert into app.pay_rates (company_id, membership_id, hourly_rate_cents, effective_from, created_by) values ($1, $2, $3, $4, $5)
         on conflict (membership_id, effective_from) do nothing returning id, hourly_rate_cents, effective_from`,
        [companyId, membershipId, toCents(body.hourlyRate), body.effectiveFrom, a.userId],
      );
      if (!rows[0]) throw conflict('A rate already starts on that date. Choose another date.');
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'payrate.created', targetType: 'membership', targetId: membershipId, metadata: { hourlyRate: body.hourlyRate, effectiveFrom: body.effectiveFrom }, ...ctx(req) });
      return rows[0];
    });
    return reply.status(201).send({ id: row.id, hourlyRate: (row.hourly_rate_cents / 100).toFixed(2), effectiveFrom: row.effective_from });
  });

  // ---------- Invitations ----------
  app.get('/companies/:companyId/invitations', async (req) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    requireCompany(a, companyId, 'members.invite');
    const rows = await db.asUser(a.userId, async (tx) =>
      (await tx.query(`select id, email, full_name, role, expires_at, accepted_at, revoked_at, created_at from app.invitations where company_id = $1 order by created_at desc limit 200`, [companyId])).rows,
    );
    return { items: rows.map((r) => ({ id: r.id, email: r.email, fullName: r.full_name, role: r.role, expiresAt: r.expires_at, acceptedAt: r.accepted_at, revokedAt: r.revoked_at, createdAt: r.created_at })) };
  });

  app.post('/companies/:companyId/invitations', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { companyId } = parse(companyParams, req.params);
    const m = requireCompany(a, companyId, 'members.invite');
    const body = parse(inviteSchema, req.body);
    if (!canAssignRole(m.role, body.role)) throw forbidden(`You cannot invite someone as ${body.role}.`);
    if (body.hourlyRate !== undefined && !m.permissions.has('payrates.manage')) throw forbidden('You cannot set pay rates.');
    const { token, hash } = newToken();
    const inv = await db.asUser(a.userId, async (tx) => {
      const already = await tx.query(
        `select 1 from app.memberships m join app.profiles p on p.user_id = m.user_id where m.company_id = $1 and p.email = $2`,
        [companyId, body.email],
      );
      if (already.rowCount) throw conflict('This person is already a member of your company.');
      if (body.siteIds.length) {
        const n = (await tx.query(`select count(*)::int as n from app.job_sites where company_id = $1 and id = any($2)`, [companyId, body.siteIds])).rows[0].n;
        if (n !== body.siteIds.length) throw badRequest('One or more job sites are invalid.');
      }
      // Replace any previous open invitation for the same email.
      await tx.query(`update app.invitations set revoked_at = now() where company_id = $1 and email = $2 and accepted_at is null and revoked_at is null`, [companyId, body.email]);
      const { rows } = await tx.query(
        `insert into app.invitations (company_id, email, full_name, role, hourly_rate_cents, site_ids, token_hash, expires_at, invited_by, locale)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8), $9, $10) returning id, email, full_name, role, expires_at, created_at, locale`,
        [companyId, body.email, body.fullName, body.role, body.hourlyRate !== undefined ? toCents(body.hourlyRate) : null, body.siteIds, hash, INVITE_DAYS, a.userId,
          normalizeLocale(body.locale ?? a.locale)],
      );
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'invitation.created', targetType: 'invitation', targetId: rows[0].id, metadata: { email: body.email, role: body.role }, ...ctx(req) });
      return rows[0];
    });
    const url = `${config.APP_URL}/invite?token=${encodeURIComponent(token)}`;
    const tz = (await db.asSystem((tx) => tx.query(`select timezone from app.companies where id = $1`, [companyId]))).rows[0]?.timezone ?? 'UTC';
    await mailer.send({ to: body.email, ...templates.invitation({ companyName: m.companyName, inviterName: a.fullName ?? m.companyName, role: body.role, url, expiresAt: inv.expires_at, locale: normalizeLocale(inv.locale), timeZone: tz }) });
    return reply.status(201).send({ id: inv.id, email: inv.email, fullName: inv.full_name, role: inv.role, expiresAt: inv.expires_at, acceptedAt: null, revokedAt: null, createdAt: inv.created_at });
  });

  app.post('/companies/:companyId/invitations/:invitationId/revoke', async (req) => {
    const a = actorOf(req);
    const { companyId, invitationId } = parse(companyIdParams('invitationId'), req.params);
    requireCompany(a, companyId, 'members.invite');
    await db.asUser(a.userId, async (tx) => {
      const r = await tx.query(`update app.invitations set revoked_at = now() where id = $1 and company_id = $2 and accepted_at is null and revoked_at is null`, [invitationId, companyId]);
      if (!r.rowCount) throw notFound();
      await auditTx(tx, { companyId, actorUserId: a.userId, action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, ...ctx(req) });
    });
    return { ok: true };
  });

  // Public, rate-limited: shows only what the invitee needs to decide. Token is never stored in plain text.
  app.get('/invitations/preview', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(32).max(128) }), req.query);
    const r = await db.asSystem(async (tx) =>
      (await tx.query(
        `select i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, c.name from app.invitations i join app.companies c on c.id = i.company_id where i.token_hash = $1`,
        [sha256(token)],
      )).rows[0],
    );
    if (!r) {
      void securityEvent(db, { type: 'invite_token_invalid', severity: 'info', ip: req.ip });
      throw notFound('This invitation link is not valid.');
    }
    const [user, domain] = String(r.email).split('@');
    return {
      companyName: r.name,
      role: r.role,
      email: `${user?.slice(0, 2)}***@${domain}`,
      status: r.revoked_at ? 'revoked' : r.accepted_at ? 'accepted' : Date.parse(r.expires_at) < Date.now() ? 'expired' : 'valid',
    };
  });

  /** Accept: the signed-in user's VERIFIED email must match the invitation (cannot join an arbitrary company). */
  app.post('/invitations/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = actorOf(req);
    const body = parse(acceptInviteSchema, req.body);
    const result = await db.asSystem(async (tx) => {
      const inv = (await tx.query(`select * from app.invitations where token_hash = $1 for update`, [sha256(body.token)])).rows[0];
      if (!inv || inv.revoked_at || inv.accepted_at || Date.parse(inv.expires_at) < Date.now()) {
        throw badRequest('This invitation is no longer valid. Ask your employer to send a new one.');
      }
      if (inv.email !== a.email) {
        await auditSystemTx(tx, { companyId: inv.company_id, actorUserId: a.userId, action: 'invitation.accept_email_mismatch', targetType: 'invitation', targetId: inv.id, success: false, ...ctx(req) });
        throw forbidden('This invitation was sent to a different email address.');
      }
      await tx.query(
        `insert into app.profiles (user_id, email, full_name, locale) values ($1, $2, $3, $4) on conflict (user_id) do nothing`,
        [a.userId, a.email, body.fullName ?? inv.full_name, inv.locale ?? 'en'],
      );
      const existing = (await tx.query(`select id from app.memberships where company_id = $1 and user_id = $2`, [inv.company_id, a.userId])).rows[0];
      if (existing) throw conflict('You are already a member of this company.');
      const mem = (await tx.query(`insert into app.memberships (company_id, user_id, role) values ($1, $2, $3) returning id`, [inv.company_id, a.userId, inv.role])).rows[0];
      if (inv.hourly_rate_cents)
        await tx.query(`insert into app.pay_rates (company_id, membership_id, hourly_rate_cents, effective_from, created_by) values ($1, $2, $3, current_date, $4)`, [inv.company_id, mem.id, inv.hourly_rate_cents, inv.invited_by]);
      if (inv.site_ids?.length)
        await tx.query(`insert into app.membership_sites (membership_id, site_id, company_id) select $1, s, $2 from unnest($3::uuid[]) s`, [mem.id, inv.company_id, inv.site_ids]);
      await tx.query(`update app.invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, a.userId]);
      await auditSystemTx(tx, { companyId: inv.company_id, actorUserId: a.userId, action: 'invitation.accepted', targetType: 'membership', targetId: mem.id, ...ctx(req) });
      return { companyId: inv.company_id as string, membershipId: mem.id as string, role: inv.role as string };
    });
    invalidateActor(a.userId);
    return reply.status(201).send(result);
  });
}
