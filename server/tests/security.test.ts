/**
 * Security verification suite — maps to Checklist §28 and the owner's required checks:
 *  - One employer cannot access another employer's records.
 *  - An employee cannot modify their own permissions.
 *  - A supervisor cannot access unassigned sites.
 *  - Discovering the admin URL does not grant access.
 *  - Changing a user ID does not expose another user's information.
 *  - Expired or revoked sessions are rejected.
 *  - Unauthorized attendance adjustments are rejected.
 *  - Database-level protections hold even if the API is bypassed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, createUser, startApp, iso, H, type TestApp, type TestUser } from './helpers';

const DB = 'bc_test_security';
let su: pg.Client;
let t: TestApp;
let ownerA: TestUser, ownerB: TestUser, emp1: TestUser, emp2: TestUser, sup: TestUser, mgr: TestUser, outsider: TestUser, staff: TestUser;
let A: string, B: string;
let site1: string, site2: string;
const mem: Record<string, string> = {};

async function invite(owner: TestUser, company: string, u: TestUser, role: string, extra: Record<string, unknown> = {}) {
  const r = await t.call(owner, 'POST', `/api/v1/companies/${company}/invitations`, { email: u.email, fullName: u.email.split('@')[0], role, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  // Token is only emailed; fetch the hash-matching token by re-issuing a known one for the test.
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const { createHash } = await import('node:crypto');
  await su.query(`update app.invitations set token_hash = $1 where id = $2`, [createHash('sha256').update(token).digest('hex'), r.body.id]);
  return token;
}

beforeAll(async () => {
  su = await createTestDatabase(DB);
  t = await startApp(DB);
  [ownerA, ownerB, emp1, emp2, sup, mgr, outsider, staff] = await Promise.all(
    ['owner.a@test.ca', 'owner.b@test.ca', 'emp1@test.ca', 'emp2@test.ca', 'sup@test.ca', 'mgr@test.ca', 'outsider@test.ca', 'staff@test.ca'].map((e) => createUser(su, e)),
  ) as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
  A = (await t.call(ownerA, 'POST', '/api/v1/companies', { companyName: 'Alpha Electric', fullName: 'Owner A' })).body.id;
  B = (await t.call(ownerB, 'POST', '/api/v1/companies', { companyName: 'Bravo Plumbing', fullName: 'Owner B' })).body.id;
  site1 = (await t.call(ownerA, 'POST', `/api/v1/companies/${A}/sites`, { name: 'Cochrane Tower', lat: 51.19, lng: -114.47, geofenceRadiusM: 200 })).body.id;
  site2 = (await t.call(ownerA, 'POST', `/api/v1/companies/${A}/sites`, { name: 'Airdrie Mall', lat: 51.29, lng: -114.01 })).body.id;
  for (const [u, role, extra] of [
    [emp1, 'employee', { hourlyRate: 30, siteIds: [site1] }],
    [emp2, 'employee', { hourlyRate: 28, siteIds: [site2] }],
    [sup, 'supervisor', { siteIds: [site1] }],
    [mgr, 'manager', {}],
  ] as const) {
    const token = await invite(ownerA, A, u, role, extra);
    const r = await t.call(u, 'POST', '/api/v1/invitations/accept', { token });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    mem[u.email] = r.body.membershipId;
  }
});

afterAll(async () => {
  await t?.close();
  await su?.end();
});

describe('tenant isolation (company A vs company B)', () => {
  it('owner B cannot read company A, its members, sites, shifts or timesheets', async () => {
    for (const url of [`/companies/${A}`, `/companies/${A}/members`, `/companies/${A}/sites`, `/companies/${A}/timesheets?from=2026-01-01&to=2027-12-31`, `/companies/${A}/pay-periods`, `/companies/${A}/conversations`]) {
      const r = await t.call(ownerB, 'GET', `/api/v1${url}`);
      expect(r.status, url).toBe(404);
    }
  });
  it('owner B cannot create a shift in company A using A site ids', async () => {
    const r = await t.call(ownerB, 'POST', `/api/v1/companies/${B}/shifts`, { siteId: site1, startsAt: iso(H), endsAt: iso(5 * H), membershipIds: [mem['emp1@test.ca']] });
    expect([400, 404]).toContain(r.status);
  });
  it('owner B cannot read company A member by id through company B route', async () => {
    const r = await t.call(ownerB, 'GET', `/api/v1/companies/${B}/members/${mem['emp1@test.ca']}`);
    expect(r.status).toBe(404);
  });
});

describe('invitations', () => {
  it('cannot accept an invitation sent to a different email', async () => {
    const token = await invite(ownerA, A, { email: 'someone.else@test.ca' } as TestUser, 'employee');
    const r = await t.call(outsider, 'POST', '/api/v1/invitations/accept', { token });
    expect(r.status).toBe(403);
  });
  it('a manager cannot invite an admin (no privilege escalation)', async () => {
    const r = await t.call(mgr, 'POST', `/api/v1/companies/${A}/invitations`, { email: 'x@test.ca', fullName: 'Xavier', role: 'admin' });
    expect(r.status).toBe(403);
  });
  it('invalid tokens are rejected and nothing is revealed', async () => {
    const r = await t.call(null, 'GET', `/api/v1/invitations/preview?token=${'x'.repeat(43)}`);
    expect(r.status).toBe(404);
  });
});

describe('role and permission escalation', () => {
  it('employee cannot change their own role or permissions', async () => {
    const r = await t.call(emp1, 'PATCH', `/api/v1/companies/${A}/members/${mem['emp1@test.ca']}`, { role: 'owner' });
    expect(r.status).toBe(403);
    const r2 = await t.call(emp1, 'PATCH', `/api/v1/companies/${A}/members/${mem['emp1@test.ca']}`, { extraPermissions: ['payroll.manage'] });
    expect(r2.status).toBe(403);
  });
  it('employee cannot list members or view pay rates of others', async () => {
    expect((await t.call(emp1, 'GET', `/api/v1/companies/${A}/members`)).status).toBe(403);
    expect((await t.call(emp1, 'GET', `/api/v1/companies/${A}/members/${mem['emp2@test.ca']}/pay-rates`)).status).toBe(404);
  });
  it('employee can see own pay rate', async () => {
    const r = await t.call(emp1, 'GET', `/api/v1/companies/${A}/members/${mem['emp1@test.ca']}/pay-rates`);
    expect(r.status).toBe(200);
    expect(r.body.items[0].hourlyRate).toBe('30.00');
  });
  it('manager cannot promote someone to owner or change own role', async () => {
    const mgrMembers = await t.call(ownerA, 'GET', `/api/v1/companies/${A}/members`);
    const mgrId = mgrMembers.body.items.find((m: { email: string }) => m.email === 'mgr@test.ca').membershipId;
    expect((await t.call(mgr, 'PATCH', `/api/v1/companies/${A}/members/${mgrId}`, { role: 'admin' })).status).toBe(403);
  });
  it('payroll settings cannot go below Alberta minimums', async () => {
    const r = await t.call(ownerA, 'PUT', `/api/v1/companies/${A}/payroll-settings`, {
      ruleProfile: 'AB_STANDARD', timezone: 'America/Edmonton', workWeekStartDow: 0, dailyThresholdMinutes: 600, weeklyThresholdMinutes: 2640,
      overtimeMultiplier: 1.5, paidBreaks: false, averaging: null, overtimeAgreementBanking: false, payFrequency: 'biweekly', payPeriodAnchor: '2027-01-03',
    });
    expect(r.status).toBe(400);
  });
});

describe('supervisor site scoping', () => {
  it('supervisor sees only their assigned site', async () => {
    const r = await t.call(sup, 'GET', `/api/v1/companies/${A}/sites`);
    expect(r.status).toBe(200);
    expect(r.body.items.map((s: { id: string }) => s.id)).toEqual([site1]);
  });
  it('supervisor cannot read or edit an unassigned site', async () => {
    expect((await t.call(sup, 'GET', `/api/v1/companies/${A}/sites/${site2}`)).status).toBe(404);
    expect((await t.call(sup, 'POST', `/api/v1/companies/${A}/shifts`, { siteId: site2, startsAt: iso(H), endsAt: iso(3 * H), membershipIds: [mem['emp2@test.ca']] })).status).toBe(404);
  });
  it('supervisor sees only employees of their site', async () => {
    const r = await t.call(sup, 'GET', `/api/v1/companies/${A}/members`);
    const emails = r.body.items.map((m: { email: string }) => m.email);
    expect(emails).toContain('emp1@test.ca');
    expect(emails).not.toContain('emp2@test.ca');
  });
});

describe('admin panel protection', () => {
  it('normal users and company owners get 404 on admin routes', async () => {
    for (const u of [ownerA, emp1, outsider]) expect((await t.call(u, 'GET', '/api/v1/admin/overview')).status).toBe(404);
  });
  it('unauthenticated access is rejected', async () => {
    expect((await t.call(null, 'GET', '/api/v1/admin/overview')).status).toBe(401);
  });
  it('platform staff without MFA (aal1) are refused; with MFA (aal2) allowed', async () => {
    await su.query(`insert into app.profiles (user_id, email, full_name) values ($1, $2, 'Staff')`, [staff.id, staff.email]);
    await su.query(`insert into app.platform_staff (user_id, role) values ($1, 'super_admin')`, [staff.id]);
    expect((await t.call(staff, 'GET', '/api/v1/admin/overview', undefined, { aal: 'aal1' })).status).toBe(403);
    const ok = await t.call(staff, 'GET', '/api/v1/admin/overview', undefined, { aal: 'aal2' });
    expect(ok.status).toBe(200);
    expect(ok.body.companies).toBeGreaterThanOrEqual(2);
  });
  it('critical admin actions require recent re-authentication', async () => {
    const stale = await t.call(staff, 'POST', `/api/v1/admin/companies/${B}/status`, { status: 'suspended', reason: 'Testing suspension' }, { aal: 'aal2', iatOffset: -3600, expiresIn: '2h' });
    expect(stale.status).toBe(403);
  });
  it('platform staff do not see company payroll/hours through company routes', async () => {
    expect((await t.call(staff, 'GET', `/api/v1/companies/${A}/pay-periods`, undefined, { aal: 'aal2' })).status).toBe(404);
  });
});

describe('tokens and sessions', () => {
  it('rejects tampered, expired and malformed tokens', async () => {
    const good = await emp1.token();
    const tampered = good.slice(0, -4) + 'AAAA';
    for (const h of [`Bearer ${tampered}`, 'Bearer abc', 'Basic xyz']) {
      const r = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: h } });
      expect(r.statusCode).toBe(401);
    }
    const expired = await t.call(emp1, 'GET', '/api/v1/me', undefined, { iatOffset: -7200, expiresIn: '1h' });
    expect(expired.status).toBe(401);
  });
  it('sign-out-everywhere revokes the session even for refreshed tokens', async () => {
    const u = await createUser(su, 'revoke.me@test.ca');
    await t.call(u, 'POST', '/api/v1/companies', { companyName: 'Revoke Co', fullName: 'Rev' });
    expect((await t.call(u, 'GET', '/api/v1/me')).status).toBe(200);
    expect((await t.call(u, 'POST', '/api/v1/me/sign-out-everywhere')).status).toBe(200);
    // A "refreshed" token has a newer iat but the same session id → still rejected.
    const r = await t.call(u, 'GET', '/api/v1/me', undefined, { iatOffset: 5 });
    expect(r.status).toBe(401);
  });
});

describe('database-level protections (API bypass)', () => {
  it('Supabase Data API roles cannot read app tables', async () => {
    await su.query('begin');
    await su.query('set local role anon');
    await expect(su.query('select * from app.time_events')).rejects.toThrow(/permission denied/);
    await su.query('rollback');
    await su.query('begin');
    await su.query('set local role authenticated');
    await expect(su.query('select * from app.companies')).rejects.toThrow(/permission denied/);
    await su.query('rollback');
  });
  it('legacy tables are quarantined and not reachable by API roles', async () => {
    await su.query('begin');
    await su.query('set local role authenticated');
    await expect(su.query('select * from legacy.users')).rejects.toThrow(/permission denied/);
    await su.query('rollback');
  });
  it('app_user (as owner B) cannot see company A rows even with raw SQL', async () => {
    await su.query('begin');
    await su.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ownerB.id })]);
    await su.query('set local role app_user');
    const r = await su.query(`select count(*)::int as n from app.memberships where company_id = $1`, [A]);
    await su.query('rollback');
    expect(r.rows[0].n).toBe(0);
  });
  it('an employee cannot insert a time event for another employee', async () => {
    await su.query('begin');
    await su.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: emp1.id })]);
    await su.query('set local role app_user');
    await expect(
      su.query(`insert into app.time_events (id, company_id, membership_id, type, occurred_at, device_time, source, device_id, created_by)
                values ($1, $2, $3, 'clock_in', now(), now(), 'online', 'dev-x', $4)`, [randomUUID(), A, mem['emp2@test.ca'], emp1.id]),
    ).rejects.toThrow(/row-level security/);
    await su.query('rollback');
  });
  it('audit logs and attendance events are append-only for every role', async () => {
    await expect(su.query(`update app.audit_logs set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(su.query(`delete from app.audit_logs`)).rejects.toThrow(/append-only/);
    await expect(su.query(`truncate app.time_events cascade`)).rejects.toThrow(/append-only/);
  });
  it('database rejects payroll settings below the legal minimum', async () => {
    await expect(su.query(`update app.payroll_settings set daily_threshold_minutes = 600 where company_id = $1`, [A])).rejects.toThrow(/payroll_settings_ab_minimums/);
  });
});

describe('input handling', () => {
  it('rejects invalid payloads with field errors, no internals leaked', async () => {
    const r = await t.call(ownerA, 'POST', `/api/v1/companies/${A}/sites`, { name: 'x', lat: 999 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_failed');
    expect(JSON.stringify(r.body)).not.toMatch(/app\.|select|stack/i);
  });
  it('SQL injection strings are stored as plain text, not executed', async () => {
    const name = "Robert'); drop table app.companies;--";
    const r = await t.call(ownerA, 'POST', `/api/v1/companies/${A}/sites`, { name });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe(name);
    expect((await su.query(`select count(*)::int as n from app.companies`)).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it('security headers are present', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['strict-transport-security']).toBeTruthy();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('CORS refuses unknown origins', async () => {
    const r = await t.app.inject({ method: 'OPTIONS', url: '/api/v1/me', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits public endpoints (429 after the per-route limit)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) {
      const r = await t.app.inject({ method: 'GET', url: '/api/v1/invitations/preview?token=' + 'x'.repeat(43), remoteAddress: '203.0.113.77' });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 20).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    const body = (await t.app.inject({ method: 'GET', url: '/api/v1/invitations/preview?token=y', remoteAddress: '203.0.113.77' })).json();
    expect(body.error.code).toBe('rate_limited');
  });
});
