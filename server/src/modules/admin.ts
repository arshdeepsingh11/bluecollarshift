import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { companyStatusSchema, inviteStaffSchema, PLATFORM_ROLES, supportAccessSchema } from '@bluecollar/shared';
import { actorOf, parse } from '../app';
import { invalidateActor, requirePlatform, type Actor } from '../lib/actor';
import { auditSystemTx, securityEvent } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { ctx, idParam } from '../lib/http';

/** Critical platform operations require a session that completed MFA within the last 10 minutes. */
function requireRecentAuth(a: Actor) {
  const ageSeconds = Date.now() / 1000 - a.claims.issuedAt;
  if (ageSeconds > 600) throw forbidden('Please confirm your identity again (sign in with MFA) to continue.');
}

async function alert(app: FastifyInstance, text: string) {
  const url = app.services.config.ALERT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

export default async function adminRoutes(app: FastifyInstance) {
  const { db } = app.services;
  const p = (req: FastifyRequest) => ({ ...ctx(req) });

  app.get('/admin/overview', async (req) => {
    requirePlatform(actorOf(req), 'platform.overview.view');
    return db.asSystem(async (tx) => {
      const r = (await tx.query(`select
          (select count(*) from app.companies)::int as companies,
          (select count(*) from app.companies where status = 'active')::int as active_companies,
          (select count(*) from app.companies where status = 'suspended')::int as suspended_companies,
          (select count(*) from app.profiles)::int as users,
          (select count(*) from app.memberships where role = 'owner')::int as employers,
          (select count(*) from app.memberships where role = 'employee' and status = 'active')::int as employees,
          (select count(distinct user_id) from app.user_sessions where last_seen_at > now() - interval '24 hours')::int as active_users_24h,
          (select count(*) from app.time_events where server_received_at > now() - interval '24 hours')::int as events_24h,
          (select count(*) from app.time_events where server_received_at > now() - interval '24 hours' and review_status = 'needs_review')::int as flagged_events_24h,
          (select count(*) from app.notifications where push_status = 'failed' and created_at > now() - interval '24 hours')::int as failed_push_24h,
          (select count(*) from app.security_events where severity <> 'info' and created_at > now() - interval '24 hours')::int as security_warnings_24h`)).rows[0];
      const recent = (await tx.query(`select id, name, status, created_at from app.companies order by created_at desc limit 10`)).rows;
      const jobs = (await tx.query(`select distinct on (job) job, status, started_at, finished_at, error from app.job_runs order by job, started_at desc`)).rows;
      return { ...r, recentCompanies: recent, jobs };
    });
  });

  // Company information only — NO payroll, hours or conversations (requires a support-access grant).
  app.get('/admin/companies', async (req) => {
    requirePlatform(actorOf(req), 'platform.companies.view');
    const q = parse(z.object({ search: z.string().trim().max(100).optional(), status: z.enum(['active', 'suspended', 'all']).default('all'), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }), req.query);
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `select c.id, c.name, c.status, c.timezone, c.created_at, c.suspended_reason, op.email as owner_email, op.full_name as owner_name,
              (select count(*) from app.memberships m where m.company_id = c.id and m.status = 'active')::int as members
         from app.companies c
         left join lateral (select p.email, p.full_name from app.memberships m join app.profiles p on p.user_id = m.user_id where m.company_id = c.id and m.role = 'owner' order by m.created_at limit 1) op on true
        where ($1::text is null or c.name ilike '%' || $1 || '%' or op.email ilike '%' || $1 || '%') and ($2 = 'all' or c.status = $2)
        order by c.created_at desc limit $3 offset $4`,
      [q.search ?? null, q.status, q.limit, q.offset])).rows);
    return { items: rows };
  });

  app.get('/admin/companies/:id', async (req) => {
    requirePlatform(actorOf(req), 'platform.companies.view');
    const { id } = parse(idParam, req.params);
    const r = await db.asSystem(async (tx) => {
      const c = (await tx.query(`select id, name, phone, address, timezone, status, suspended_reason, created_at from app.companies where id = $1`, [id])).rows[0];
      if (!c) throw notFound();
      const usage = (await tx.query(`select
          (select count(*) from app.memberships where company_id = $1 and status = 'active')::int as members,
          (select count(*) from app.job_sites where company_id = $1 and status = 'active')::int as sites,
          (select count(*) from app.shifts where company_id = $1 and starts_at > now() - interval '30 days')::int as shifts_30d,
          (select count(*) from app.time_events where company_id = $1 and server_received_at > now() - interval '30 days')::int as events_30d`, [id])).rows[0];
      const owners = (await tx.query(`select p.full_name, p.email, m.role from app.memberships m join app.profiles p on p.user_id = m.user_id where m.company_id = $1 and m.role in ('owner','admin')`, [id])).rows;
      return { ...c, usage, owners };
    });
    return r;
  });

  app.post('/admin/companies/:id/status', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.companies.manage');
    requireRecentAuth(a);
    const { id } = parse(idParam, req.params);
    const b = parse(companyStatusSchema, req.body);
    await db.asSystem(async (tx) => {
      // Suspension never deletes data.
      const r = await tx.query(`update app.companies set status = $2, suspended_reason = case when $2 = 'suspended' then $3 else null end where id = $1`, [id, b.status, b.reason]);
      if (!r.rowCount) throw notFound();
      await auditSystemTx(tx, { companyId: id, actorUserId: a.userId, actorType: 'platform', action: `platform.company_${b.status === 'suspended' ? 'suspended' : 'restored'}`, targetType: 'company', targetId: id, metadata: { reason: b.reason }, ...p(req) });
    });
    invalidateActor();
    await alert(app, `Blue Collar: company ${id} ${b.status} by ${a.email}. Reason: ${b.reason}`);
    return { ok: true };
  });

  // ---------- Platform staff ----------
  app.get('/admin/staff', async (req) => {
    requirePlatform(actorOf(req), 'platform.staff.view');
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `select ps.user_id, p.full_name, p.email, ps.role, ps.status, ps.created_at,
              (select max(last_seen_at) from app.user_sessions us where us.user_id = ps.user_id) as last_seen
         from app.platform_staff ps join app.profiles p on p.user_id = ps.user_id order by p.full_name`)).rows);
    return { items: rows };
  });

  /** Only super admins add staff; the person must already have a verified Blue Collar login. */
  app.post('/admin/staff', async (req, reply) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.staff.manage');
    requireRecentAuth(a);
    const b = parse(inviteStaffSchema, req.body);
    if (b.role === 'super_admin' && a.platform?.role !== 'super_admin') throw forbidden();
    const userId = await db.asSystem(async (tx) => {
      const prof = (await tx.query(`select user_id from app.profiles where email = $1`, [b.email])).rows[0];
      if (!prof) throw badRequest('This person must create a Blue Collar account (and verify their email) first.');
      const exists = (await tx.query(`select 1 from app.platform_staff where user_id = $1`, [prof.user_id])).rowCount;
      if (exists) throw conflict('This person is already platform staff.');
      await tx.query(`insert into app.platform_staff (user_id, role, invited_by) values ($1, $2, $3)`, [prof.user_id, b.role, a.userId]);
      await auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'platform.staff_added', targetType: 'user', targetId: prof.user_id, metadata: { role: b.role }, ...p(req) });
      return prof.user_id as string;
    });
    invalidateActor(userId);
    await alert(app, `Blue Collar: platform staff ${b.email} added as ${b.role} by ${a.email}`);
    void securityEvent(db, { userId: a.userId, type: 'platform_staff_added', severity: 'warning', ip: req.ip, metadata: { target: userId, role: b.role } });
    return reply.status(201).send({ userId });
  });

  app.patch('/admin/staff/:id', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.staff.manage');
    requireRecentAuth(a);
    const { id } = parse(idParam, req.params);
    if (id === a.userId) throw forbidden('You cannot change your own platform role or status.');
    const b = parse(z.object({ role: z.enum(PLATFORM_ROLES).optional(), status: z.enum(['active', 'suspended']).optional() }), req.body);
    if (b.role === 'super_admin' && a.platform?.role !== 'super_admin') throw forbidden();
    await db.asSystem(async (tx) => {
      const cur = (await tx.query(`select role, status from app.platform_staff where user_id = $1 for update`, [id])).rows[0];
      if (!cur) throw notFound();
      if (cur.role === 'super_admin' && a.platform?.role !== 'super_admin') throw forbidden();
      await tx.query(`update app.platform_staff set role = coalesce($2, role), status = coalesce($3, status) where user_id = $1`, [id, b.role ?? null, b.status ?? null]);
      if (b.status === 'suspended') {
        await tx.query(`update app.user_sessions set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null`, [id, a.userId]);
        await tx.query(`update app.profiles set sessions_revoked_at = now() where user_id = $1`, [id]);
      }
      await auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'platform.staff_updated', targetType: 'user', targetId: id, metadata: { before: cur, changes: b }, ...p(req) });
    });
    invalidateActor(id);
    await alert(app, `Blue Collar: platform staff ${id} changed by ${a.email}: ${JSON.stringify(b)}`);
    return { ok: true };
  });

  /** Emergency: sign a user out everywhere (any user — e.g. suspected account takeover). */
  app.post('/admin/users/:id/revoke-sessions', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.staff.manage');
    requireRecentAuth(a);
    const { id } = parse(idParam, req.params);
    await db.asSystem(async (tx) => {
      const r = await tx.query(`update app.profiles set sessions_revoked_at = now() where user_id = $1`, [id]);
      if (!r.rowCount) throw notFound();
      await tx.query(`update app.user_sessions set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null`, [id, a.userId]);
      await auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'platform.user_sessions_revoked', targetType: 'user', targetId: id, ...p(req) });
    });
    invalidateActor(id);
    return { ok: true };
  });

  // ---------- Audit & security ----------
  app.get('/admin/audit', async (req) => {
    requirePlatform(actorOf(req), 'platform.audit.view');
    const q = parse(z.object({ companyId: z.string().uuid().optional(), action: z.string().max(100).optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `select al.id, al.company_id, al.actor_type, al.action, al.target_type, al.target_id, al.metadata, al.ip::text, al.request_id, al.success, al.created_at, p.email as actor_email
         from app.audit_logs al left join app.profiles p on p.user_id = al.actor_user_id
        where ($1::uuid is null or al.company_id = $1) and ($2::text is null or al.action like $2 || '%') and ($3::bigint is null or al.id < $3)
        order by al.id desc limit $4`,
      [q.companyId ?? null, q.action ?? null, q.before ?? null, q.limit])).rows);
    return { items: rows };
  });

  app.get('/admin/security-events', async (req) => {
    requirePlatform(actorOf(req), 'platform.security.view');
    const q = parse(z.object({ severity: z.enum(['info', 'warning', 'critical', 'all']).default('all'), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `select id, user_id, type, severity, ip::text, metadata, created_at from app.security_events where ($1 = 'all' or severity = $1) order by id desc limit $2`,
      [q.severity, q.limit])).rows);
    const summary = await db.asSystem(async (tx) => (await tx.query(
      `select type, count(*)::int as n from app.security_events where created_at > now() - interval '24 hours' group by type order by n desc`)).rows);
    return { items: rows, last24h: summary };
  });

  // ---------- Controlled, audited, time-limited support access ----------
  app.post('/admin/support-access', async (req, reply) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.support_access.request');
    requireRecentAuth(a);
    const b = parse(supportAccessSchema, req.body);
    const id = await db.asSystem(async (tx) => {
      const c = (await tx.query(`select id from app.companies where id = $1`, [b.companyId])).rowCount;
      if (!c) throw notFound();
      const g = (await tx.query(`insert into app.support_access_grants (company_id, staff_user_id, reason, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4)) returning id`, [b.companyId, a.userId, b.reason, b.minutes])).rows[0];
      await auditSystemTx(tx, { companyId: b.companyId, actorUserId: a.userId, actorType: 'platform', action: 'platform.support_access_granted', targetType: 'company', targetId: b.companyId, metadata: { reason: b.reason, minutes: b.minutes }, ...p(req) });
      return g.id as string;
    });
    await alert(app, `Blue Collar: support access to company ${b.companyId} by ${a.email} for ${b.minutes} min. Reason: ${b.reason}`);
    return reply.status(201).send({ id });
  });

  app.get('/admin/support-access', async (req) => {
    requirePlatform(actorOf(req), 'platform.audit.view');
    const rows = await db.asSystem(async (tx) => (await tx.query(
      `select g.id, g.company_id, c.name as company_name, p.email as staff_email, g.reason, g.expires_at, g.revoked_at, g.created_at
         from app.support_access_grants g join app.companies c on c.id = g.company_id join app.profiles p on p.user_id = g.staff_user_id
        order by g.created_at desc limit 200`)).rows);
    return { items: rows };
  });

  app.get('/admin/settings', async (req) => {
    requirePlatform(actorOf(req), 'platform.overview.view');
    const rows = await db.asSystem(async (tx) => (await tx.query(`select key, value, updated_at from app.platform_settings order by key`)).rows);
    return { items: rows };
  });

  app.put('/admin/settings/:key', async (req) => {
    const a = actorOf(req);
    requirePlatform(a, 'platform.settings.manage');
    requireRecentAuth(a);
    const { key } = parse(z.object({ key: z.enum(['maintenance_mode', 'min_mobile_version', 'feature_flags']) }), req.params);
    const { value } = parse(z.object({ value: z.union([z.boolean(), z.string().max(50), z.record(z.string().max(64), z.boolean())]) }), req.body);
    await db.asSystem(async (tx) => {
      await tx.query(`insert into app.platform_settings (key, value, updated_by) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`, [key, JSON.stringify(value), a.userId]);
      await auditSystemTx(tx, { actorUserId: a.userId, actorType: 'platform', action: 'platform.setting_changed', targetType: 'setting', targetId: key, metadata: { value }, ...p(req) });
    });
    await alert(app, `Blue Collar: platform setting ${key} changed by ${a.email}`);
    return { ok: true };
  });
}
