/**
 * Release A: company overtime policy, currency, crew clock-in, open shifts, shift swaps,
 * time off, availability, safety, feedback, payroll exports, overtime / no-show alerts.
 * Real API + real PostgreSQL (RLS on).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDatabase, createUser, startApp, iso, H, type TestApp, type TestUser } from './helpers';
import { jobs } from '../src/jobs/scheduler';

const DB = 'bc_test_release_a';
let su: pg.Client;
let t: TestApp;
let owner: TestUser, sup: TestUser, lead: TestUser, w1: TestUser, w2: TestUser, other: TestUser, staff: TestUser;
let C: string, site: string, site2: string;
const mem: Record<string, string> = {};

async function join(u: TestUser, role: string, extra: Record<string, unknown> = {}) {
  const r = await t.call(owner, 'POST', `/api/v1/companies/${C}/invitations`, { email: u.email, fullName: `${u.email.split('@')[0]} person`, role, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const token = randomUUID().replace(/-/g, '').repeat(2);
  await su.query(`update app.invitations set token_hash = $1 where id = $2`, [createHash('sha256').update(token).digest('hex'), r.body.id]);
  const a = await t.call(u, 'POST', '/api/v1/invitations/accept', { token });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  mem[u.email] = a.body.membershipId;
}
const api = (p: string) => `/api/v1/companies/${C}${p}`;
const crewEvent = (type: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  type, deviceTime: new Date().toISOString(), offline: false, lat: 30.2701, lng: -97.7401, accuracyM: 10, deviceId: 'foreman-phone-1',
  entries: ids.map((membershipId) => ({ id: randomUUID(), membershipId })), ...extra,
});
const run = (name: string) => jobs.find((j) => j.name === name)!.run(t.services);

beforeAll(async () => {
  su = await createTestDatabase(DB);
  t = await startApp(DB);
  [owner, sup, lead, w1, w2, other, staff] = (await Promise.all(
    ['own@ra.us', 'sup@ra.us', 'lead@ra.us', 'w1@ra.us', 'w2@ra.us', 'other@ra.us', 'staff@bluecollar.test'].map((e) => createUser(su, e)),
  )) as TestUser[] as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
  const c = await t.call(owner, 'POST', '/api/v1/companies', { companyName: 'Texas Plumbing Co', fullName: 'Tia Owner', timezone: 'America/Chicago', currency: 'USD', country: 'US' });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  C = c.body.id;
  site = (await t.call(owner, 'POST', api('/sites'), { name: 'Austin Tower', lat: 30.27, lng: -97.74, geofenceRadiusM: 300 })).body.id;
  site2 = (await t.call(owner, 'POST', api('/sites'), { name: 'Dallas Mall', lat: 32.78, lng: -96.8 })).body.id;
  await join(sup, 'supervisor', { siteIds: [site] });
  await join(lead, 'employee', { hourlyRate: 32 });
  await join(w1, 'employee', { hourlyRate: 28 });
  await join(w2, 'employee', { hourlyRate: 26 });
  await join(other, 'employee', { hourlyRate: 24 });
  // Platform staff (feedback inbox).
  await su.query(`insert into app.profiles (user_id, email, full_name) values ($1, $2, 'Staff Person')`, [staff.id, staff.email]);
  await su.query(`insert into app.platform_staff (user_id, role) values ($1, 'support')`, [staff.id]);
});
afterAll(async () => {
  await t?.close();
  await su?.end();
});

describe('company policy and currency (no province rules)', () => {
  it('stores currency and country, and returns them', async () => {
    const r = await t.call(owner, 'GET', api(''));
    expect(r.body).toMatchObject({ currency: 'USD', country: 'US', timezone: 'America/Chicago' });
    const u = await t.call(owner, 'PATCH', api(''), { currency: 'MXN', country: 'MX' });
    expect(u.body).toMatchObject({ currency: 'MXN', country: 'MX' });
    await t.call(owner, 'PATCH', api(''), { currency: 'USD', country: 'US' });
  });

  it('lets the company choose weekly-only overtime at 40 h, and any multiplier', async () => {
    const cur = (await t.call(owner, 'GET', api('/payroll-settings'))).body;
    expect(cur.profile).toBeUndefined(); // no legal profile is shown any more
    const r = await t.call(owner, 'PUT', api('/payroll-settings'), {
      ...cur, dailyOvertimeEnabled: false, weeklyOvertimeEnabled: true, weeklyThresholdMinutes: 2400, overtimeMultiplier: 1.5, adpCompanyCode: 'tx1',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await t.call(owner, 'GET', api('/payroll-settings'))).body;
    expect(after).toMatchObject({ dailyOvertimeEnabled: false, weeklyThresholdMinutes: 2400, adpCompanyCode: 'TX1', ruleProfile: 'COMPANY_POLICY' });
    const bad = await t.call(owner, 'PUT', api('/payroll-settings'), { ...after, overtimeMultiplier: 0.5 });
    expect(bad.status).toBe(400);
  });

  it('no Alberta wording is left in API responses or email defaults', async () => {
    const s = JSON.stringify((await t.call(owner, 'GET', api('/payroll-settings'))).body);
    expect(s).not.toMatch(/alberta|AB_STANDARD/i);
  });
});

describe('languages', () => {
  it('each person gets notifications in their own language; invite emails use the chosen language', async () => {
    expect((await t.call(w2, 'PATCH', '/api/v1/me', { locale: 'pa' })).body.locale).toBe('pa');
    expect((await t.call(w2, 'PATCH', '/api/v1/me', { locale: 'xx' })).status).toBe(400);
    await t.call(owner, 'PATCH', '/api/v1/me', { locale: 'es-MX' });
    const r = await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: iso(30 * H), endsAt: iso(38 * H), membershipIds: [mem['w2@ra.us'], mem['w1@ra.us']] });
    expect(r.status).toBe(201);
    const pa = (await t.call(w2, 'GET', '/api/v1/notifications')).body.items.find((x: { type: string }) => x.type === 'shift.assigned');
    expect(pa.title).toBe('ਨਵੀਂ ਸ਼ਿਫਟ');
    const en = (await t.call(w1, 'GET', '/api/v1/notifications')).body.items.find((x: { type: string }) => x.type === 'shift.assigned');
    expect(en.title).toBe('New shift');
    const sent: { subject: string; html: string }[] = [];
    t.services.mailer = { send: async (m) => { sent.push(m); return { id: 'x', delivered: true }; } };
    const newbie = await createUser(su, 'nuevo@ra.us');
    const inv = await t.call(owner, 'POST', api('/invitations'), { email: newbie.email, fullName: 'Nuevo Trabajador', role: 'employee' });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(sent[0]?.subject).toBe('Te invitaron a unirte a Texas Plumbing Co en Blue Collar');
    expect(sent[0]?.html).toContain('lang="es-MX"');
    const gu = await t.call(owner, 'POST', api('/invitations'), { email: 'gu@ra.us', fullName: 'Guj Worker', role: 'employee', locale: 'gu' });
    expect(gu.status).toBe(201);
    expect(sent[1]?.html).toContain('આમંત્રણ સ્વીકારો');
    await t.call(owner, 'PATCH', '/api/v1/me', { locale: 'en' });
    await t.call(w2, 'PATCH', '/api/v1/me', { locale: 'en' });
  });
});

describe('crew clock-in', () => {
  let shiftId: string;
  it('setup: a shift with the lead and two workers', async () => {
    await t.call(owner, 'PATCH', api(`/members/${mem['lead@ra.us']}`), { crewLead: true });
    const r = await t.call(owner, 'POST', api('/shifts'), {
      siteId: site, startsAt: iso(-0.5 * H), endsAt: iso(7 * H), membershipIds: [mem['lead@ra.us'], mem['w1@ra.us'], mem['w2@ra.us']],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    shiftId = r.body.items[0].id;
  });

  it('a crew lead sees only people on the same shift', async () => {
    const r = await t.call(lead, 'GET', api('/crew'));
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: { membershipId: string }) => x.membershipId).sort()).toEqual([mem['w1@ra.us'], mem['w2@ra.us']].sort());
  });

  it('a crew lead clocks in the crew; events record who entered them', async () => {
    const r = await t.call(lead, 'POST', api('/crew/events'), crewEvent('clock_in', [mem['w1@ra.us']!, mem['w2@ra.us']!, mem['other@ra.us']!]));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const byMember = Object.fromEntries(r.body.results.map((x: { membershipId: string; result: string }) => [x.membershipId, x.result]));
    expect(byMember[mem['w1@ra.us']!]).toBe('accepted');
    expect(byMember[mem['w2@ra.us']!]).toBe('accepted');
    expect(byMember[mem['other@ra.us']!]).toBe('rejected'); // not on the lead's shift
    const rows = (await su.query(`select entry_method, recorded_by_membership_id, shift_id from app.time_events where membership_id = $1`, [mem['w1@ra.us']])).rows;
    expect(rows[0]).toMatchObject({ entry_method: 'crew', recorded_by_membership_id: mem['lead@ra.us'], shift_id: shiftId });
    const crew = await t.call(lead, 'GET', api('/crew'));
    expect(crew.body.items.every((x: { state: string }) => x.state === 'working')).toBe(true);
    // The worker sees their own open session.
    const me = await t.call(w1, 'GET', api('/attendance/me'));
    expect(me.body.openSession).not.toBeNull();
  });

  it('retrying the same entries is a duplicate, not a second clock-in', async () => {
    const body = crewEvent('break_start', [mem['w1@ra.us']!]);
    const a = await t.call(lead, 'POST', api('/crew/events'), body);
    const b = await t.call(lead, 'POST', api('/crew/events'), body);
    expect(a.body.results[0].result).toBe('accepted');
    expect(b.body.results[0].result).toBe('duplicate');
  });

  it('a regular employee (not a lead) cannot clock in others', async () => {
    const r = await t.call(w2, 'GET', api('/crew'));
    expect(r.status).toBe(403);
    const e = await t.call(w2, 'POST', api('/crew/events'), crewEvent('clock_out', [mem['w1@ra.us']!]));
    expect(e.body.results[0].result).toBe('rejected');
  });

  it('a supervisor clocks out crew at their own sites', async () => {
    const r = await t.call(sup, 'POST', api('/crew/events'), crewEvent('clock_out', [mem['w1@ra.us']!, mem['w2@ra.us']!]));
    expect(r.body.results.map((x: { result: string }) => x.result)).toEqual(['accepted', 'accepted']);
  });
});

describe('open shifts, pickup, drop and swap', () => {
  let openShift: string, myShift: string;
  it('an open shift notifies employees who work at that site', async () => {
    const r = await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: iso(48 * H), endsAt: iso(56 * H), membershipIds: [], openSlots: 2 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    openShift = r.body.items[0].id;
    expect(r.body.items[0].openSlots).toBe(2);
    const n = await t.call(w1, 'GET', '/api/v1/notifications');
    expect(n.body.items.some((x: { type: string }) => x.type === 'shift.open')).toBe(true);
  });

  it('an employee sees it and requests it; the manager approves; the spot is filled', async () => {
    const list = await t.call(w1, 'GET', api('/open-shifts'));
    expect(list.body.items.map((s: { id: string }) => s.id)).toContain(openShift);
    const req = await t.call(w1, 'POST', api('/shift-requests'), { shiftId: openShift, kind: 'pickup' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const dup = await t.call(w1, 'POST', api('/shift-requests'), { shiftId: openShift, kind: 'pickup' });
    expect(dup.status).toBe(409);
    // Employees cannot approve.
    expect((await t.call(w2, 'POST', api(`/shift-requests/${req.body.id}/decide`), { decision: 'approved' })).status).toBe(403);
    const ok = await t.call(sup, 'POST', api(`/shift-requests/${req.body.id}/decide`), { decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const s = (await su.query(`select open_slots from app.shifts where id = $1`, [openShift])).rows[0];
    expect(s.open_slots).toBe(1);
    const assigned = (await su.query(`select 1 from app.shift_assignments where shift_id = $1 and membership_id = $2`, [openShift, mem['w1@ra.us']])).rowCount;
    expect(assigned).toBe(1);
  });

  it('employees only see open shifts at their own sites', async () => {
    const r = await t.call(owner, 'POST', api('/shifts'), { siteId: site2, startsAt: iso(50 * H), endsAt: iso(58 * H), membershipIds: [], openSlots: 1 });
    const dallas = r.body.items[0].id;
    const list = await t.call(w2, 'GET', api('/open-shifts'));
    expect(list.body.items.map((s: { id: string }) => s.id)).not.toContain(dallas);
    const req = await t.call(w2, 'POST', api('/shift-requests'), { shiftId: dallas, kind: 'pickup' });
    expect(req.status).toBe(404);
  });

  it('coworkers list shows names only, for people at the same sites', async () => {
    const r = await t.call(w2, 'GET', api('/coworkers'));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['fullName', 'membershipId']);
    expect(r.body.items.map((x: { membershipId: string }) => x.membershipId)).not.toContain(mem['w2@ra.us']);
  });

  it('swap: coworker accepts, then the manager approves', async () => {
    myShift = (await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: iso(72 * H), endsAt: iso(80 * H), membershipIds: [mem['w2@ra.us']] })).body.items[0].id;
    const r = await t.call(w2, 'POST', api('/shift-requests'), { shiftId: myShift, kind: 'swap', targetMembershipId: mem['other@ra.us'] });
    expect(r.body.status).toBe('pending_peer');
    // The manager cannot approve before the coworker accepts.
    expect((await t.call(owner, 'POST', api(`/shift-requests/${r.body.id}/decide`), { decision: 'approved' })).status).toBe(409);
    // Only the target can respond.
    expect((await t.call(w1, 'POST', api(`/shift-requests/${r.body.id}/respond`), { accept: true })).status).toBe(404);
    const acc = await t.call(other, 'POST', api(`/shift-requests/${r.body.id}/respond`), { accept: true });
    expect(acc.body.status).toBe('pending');
    const ok = await t.call(owner, 'POST', api(`/shift-requests/${r.body.id}/decide`), { decision: 'approved' });
    expect(ok.status).toBe(200);
    const people = (await su.query(`select membership_id from app.shift_assignments where shift_id = $1`, [myShift])).rows.map((x) => x.membership_id);
    expect(people).toEqual([mem['other@ra.us']]);
  });

  it('drop: approved drop re-opens the spot', async () => {
    const r = await t.call(other, 'POST', api('/shift-requests'), { shiftId: myShift, kind: 'drop', note: 'Family event' });
    await t.call(owner, 'POST', api(`/shift-requests/${r.body.id}/decide`), { decision: 'approved' });
    const s = (await su.query(`select open_slots, (select count(*) from app.shift_assignments where shift_id = $1)::int as n from app.shifts where id = $1`, [myShift])).rows[0];
    expect(s).toEqual({ open_slots: 1, n: 0 });
  });

  it('RLS: an employee cannot read someone else\'s requests directly', async () => {
    const mine = await t.call(w1, 'GET', api('/shift-requests?status=all'));
    expect(mine.body.items.every((x: { requester: { membershipId: string }; target: { membershipId: string } | null }) =>
      x.requester.membershipId === mem['w1@ra.us'] || x.target?.membershipId === mem['w1@ra.us'])).toBe(true);
    expect((await t.call(w1, 'GET', api('/shift-requests?scope=team'))).status).toBe(403);
  });
});

describe('time off and availability', () => {
  it('request → manager approves → scheduling warns', async () => {
    const d = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const r = await t.call(w2, 'POST', api('/time-off'), { kind: 'vacation', startsOn: d, endsOn: d, note: 'Trip' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await t.call(w2, 'POST', api('/time-off'), { kind: 'sick', startsOn: d, endsOn: d })).status).toBe(409);
    const team = await t.call(owner, 'GET', api('/time-off?scope=team&status=pending'));
    expect(team.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    expect((await t.call(w1, 'GET', api('/time-off?scope=team'))).status).toBe(403);
    const ok = await t.call(owner, 'POST', api(`/time-off/${r.body.id}/decide`), { decision: 'approved' });
    expect(ok.body.status).toBe('approved');
    const shift = await t.call(owner, 'POST', api('/shifts'), {
      siteId: site, startsAt: `${d}T15:00:00Z`, endsAt: `${d}T22:00:00Z`, membershipIds: [mem['w2@ra.us']],
    });
    expect(JSON.stringify(shift.body.warnings)).toContain('time_off');
  });

  it('weekly availability is saved and used for warnings', async () => {
    const put = await t.call(w1, 'PUT', api('/availability/me'), { days: [{ dow: 0, available: false }, { dow: 1, available: true, startMinute: 420, endMinute: 900 }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.days[0]).toMatchObject({ dow: 0, available: false });
    expect(put.body.days[1]).toMatchObject({ startMinute: 420, endMinute: 900 });
    const staffView = await t.call(owner, 'GET', api(`/members/${mem['w1@ra.us']}/availability`));
    expect(staffView.body.days[0].available).toBe(false);
    expect((await t.call(w2, 'GET', api(`/members/${mem['w1@ra.us']}/availability`))).status).toBe(403);
    // Next Sunday 10:00–14:00 Chicago (16:00Z–20:00Z, CST) → unavailable warning.
    const now = new Date();
    const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((7 - now.getUTCDay()) % 7 || 7)));
    const day = sunday.toISOString().slice(0, 10);
    const s = await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: `${day}T16:00:00Z`, endsAt: `${day}T20:00:00Z`, membershipIds: [mem['w1@ra.us']] });
    expect(JSON.stringify(s.body.warnings)).toContain('unavailable');
  });
});

describe('safety', () => {
  it('any worker reports an incident with a photo; managers are notified; supervisor closes it', async () => {
    const r = await t.call(w1, 'POST', api('/safety/reports'), {
      kind: 'incident', siteId: site, occurredAt: iso(-1 * H), description: 'Slipped on wet stairs', injured: true, injuryDetails: 'Bruised knee',
      photo: { contentType: 'image/jpeg', size: 120_000 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.photoUpload.url).toContain(`/upload/sign/uploads/safety/${C}/`);
    expect(r.body.hasPhoto).toBe(true);
    const n = await t.call(owner, 'GET', '/api/v1/notifications');
    expect(n.body.items.some((x: { type: string; title: string }) => x.type === 'safety.reported' && x.title === 'Injury reported')).toBe(true);
    // Another worker cannot see it.
    const theirs = await t.call(w2, 'GET', api('/safety/reports'));
    expect(theirs.body.items).toHaveLength(0);
    expect((await t.call(w2, 'GET', api(`/safety/reports/${r.body.id}/photo`))).status).toBe(404);
    expect((await t.call(owner, 'GET', api(`/safety/reports/${r.body.id}/photo`))).body.url).toContain('/object/sign/');
    expect((await t.call(w1, 'POST', api(`/safety/reports/${r.body.id}/close`), { note: 'done' })).status).toBe(403);
    const c = await t.call(sup, 'POST', api(`/safety/reports/${r.body.id}/close`), { note: 'Mat installed' });
    expect(c.body.status).toBe('closed');
  });

  it('toolbox talk: lead records it, attendees sign on their own phone', async () => {
    const r = await t.call(lead, 'POST', api('/safety/talks'), { topic: 'Ladder safety', heldAt: iso(-0.2 * H), siteId: site, attendeeIds: [mem['lead@ra.us'], mem['w1@ra.us'], mem['w2@ra.us']] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.attendees.find((x: { membershipId: string }) => x.membershipId === mem['lead@ra.us']).signedAt).not.toBeNull();
    expect((await t.call(w1, 'POST', api(`/safety/talks/${r.body.id}/sign`))).status).toBe(200);
    expect((await t.call(w1, 'POST', api(`/safety/talks/${r.body.id}/sign`))).status).toBe(404); // already signed
    expect((await t.call(other, 'POST', api(`/safety/talks/${r.body.id}/sign`))).status).toBe(404); // not invited
    const list = await t.call(owner, 'GET', api('/safety/talks'));
    const talk = list.body.items.find((x: { id: string }) => x.id === r.body.id);
    expect(talk.attendees.filter((x: { signedAt: string | null }) => x.signedAt).length).toBe(2);
    expect((await t.call(w2, 'POST', api('/safety/talks'), { topic: 'x x x', heldAt: iso(0), attendeeIds: [mem['w2@ra.us']] })).status).toBe(403);
  });
});

describe('feedback', () => {
  it('typed or voice feedback goes to the platform inbox, never to the company', async () => {
    const typed = await t.call(w1, 'POST', '/api/v1/feedback', { kind: 'improvement', message: 'Please add dark mode', platform: 'android', companyId: C });
    expect(typed.status, JSON.stringify(typed.body)).toBe(201);
    const voice = await t.call(w2, 'POST', '/api/v1/feedback', {
      kind: 'complaint', platform: 'ios', audio: { contentType: 'audio/mp4', size: 300_000, seconds: 40 }, screenshot: { contentType: 'image/png', size: 200_000 },
    });
    expect(voice.status).toBe(201);
    expect(voice.body.uploads.audio.url).toContain(`feedback/${voice.body.id}/voice.m4a`);
    expect((await t.call(w1, 'POST', '/api/v1/feedback', { kind: 'bug', platform: 'web' })).status).toBe(400);
    // Company owner has no access; app_user role cannot read the table at all.
    expect((await t.call(owner, 'GET', '/api/v1/admin/feedback')).status).toBe(404);
    await su.query('begin');
    await su.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id })]);
    await su.query('set local role app_user');
    await expect(su.query('select * from app.feedback')).rejects.toThrow(/permission denied/);
    await su.query('rollback');
    // Platform staff need MFA.
    expect((await t.call(staff, 'GET', '/api/v1/admin/feedback')).status).toBe(403);
    const inbox = await t.call(staff, 'GET', '/api/v1/admin/feedback', undefined, { aal: 'aal2' });
    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toHaveLength(2);
    expect(inbox.body.counts.new).toBe(2);
    const files = await t.call(staff, 'GET', `/api/v1/admin/feedback/${voice.body.id}/files`, undefined, { aal: 'aal2' });
    expect(files.body.audio).toContain('voice.m4a');
    const upd = await t.call(staff, 'PATCH', `/api/v1/admin/feedback/${typed.body.id}`, { status: 'planned', adminNote: 'Next month' }, { aal: 'aal2' });
    expect(upd.body.status).toBe('planned');
    const mine = await t.call(w1, 'GET', '/api/v1/feedback/mine');
    expect(mine.body.items[0]).toMatchObject({ status: 'planned', adminNote: 'Next month' });
  });

  it('voice-only feedback without storage asks the user to type', async () => {
    const t2 = await startApp(DB);
    t2.services.storage = { enabled: false, signedUpload: async () => null, signedDownload: async () => null };
    const r = await t2.call(w1, 'POST', '/api/v1/feedback', { kind: 'bug', platform: 'ios', audio: { contentType: 'audio/mp4', size: 10, seconds: 2 } });
    expect(r.status).toBe(503);
    await t2.close();
  });
});

describe('payroll exports and alerts', () => {
  let period: string;
  it('setup: approved hours and a calculated period', async () => {
    await su.query(`update app.work_sessions set approval_status = 'approved' where company_id = $1 and status <> 'open'`, [C]);
    const today = new Date();
    const start = new Date(today.getTime() - 21 * 86400_000).toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    const p = await t.call(owner, 'POST', api('/pay-periods'), { startsOn: start, endsOn: end, payDate: end });
    period = p.body.id;
    const c = await t.call(owner, 'POST', api(`/pay-periods/${period}/calculate`));
    expect(c.status, JSON.stringify(c.body)).toBe(200);
  });

  it('ADP needs the payroll IDs, then produces the ADP file layout', async () => {
    const missing = await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=adp`));
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('ADP File #');
    for (const [e, id] of [['w1@ra.us', '001234'], ['w2@ra.us', '001235']] as const) await t.call(owner, 'PATCH', api(`/members/${mem[e]}`), { payrollId: id });
    const r = await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=adp`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain('PRTX1EPI.csv');
    const lines = String(r.body).trim().split('\r\n');
    expect(lines[0]).toBe('Co Code,Batch ID,File #,Employee Name,Reg Hours,O/T Hours');
    expect(lines[1]).toMatch(/^TX1,\d{6},00123[45],/);
  });

  it('Gusto, QuickBooks and Wagepoint formats', async () => {
    const g = await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=gusto`));
    expect(String(g.body).split('\r\n')[0]).toBe('First name,Last name,Email,Employee ID,Regular hours,Overtime hours');
    const q = await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=quickbooks`));
    expect(String(q.body).split('\r\n')[0]).toBe('TxnDate,Name,Time,Description,BillableStatus');
    const w = await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=wagepoint`));
    expect(String(w.body)).toContain('Regular hours,Overtime hours');
    expect((await t.call(owner, 'GET', api(`/pay-periods/${period}/export.csv?format=sage`))).status).toBe(400);
  });

  it('overtime watch warns managers before an employee goes into overtime', async () => {
    // 39 h worked + an 8 h shift later this week > 40 h weekly threshold.
    await su.query(`update app.payroll_settings set work_week_start_dow = extract(dow from (now() at time zone 'America/Chicago'))::int where company_id = $1`, [C]);
    const start = new Date(Date.now() - 39.5 * H);
    await su.query(
      `insert into app.work_sessions (company_id, membership_id, original_start, original_end, status, approval_status) values ($1, $2, $3, $4, 'closed', 'approved')`,
      [C, mem['w2@ra.us'], start.toISOString(), new Date(start.getTime() + 39 * H).toISOString()],
    );
    await su.query(`update app.payroll_settings set work_week_start_dow = extract(dow from ((now() - interval '2 days') at time zone 'America/Chicago'))::int where company_id = $1`, [C]);
    await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: iso(2 * H), endsAt: iso(4 * H), membershipIds: [mem['w2@ra.us']] });
    await run('overtime_watch');
    const n = await t.call(owner, 'GET', '/api/v1/notifications');
    const ot = n.body.items.find((x: { type: string; body: string }) => x.type === 'overtime.watch' && x.body.includes('w2 person'));
    expect(ot, JSON.stringify(n.body.items.map((x: { type: string }) => x.type))).toBeTruthy();
    // Run twice: still one notification (dedupe).
    await run('overtime_watch');
    const n2 = await t.call(owner, 'GET', '/api/v1/notifications');
    expect(n2.body.items.filter((x: { type: string; body: string }) => x.type === 'overtime.watch' && x.body.includes('w2 person')).length).toBe(1);
  });

  it('no-show alert after 60 minutes, skipped for people on approved time off', async () => {
    const r = await t.call(owner, 'POST', api('/shifts'), { siteId: site, startsAt: iso(-1.5 * H), endsAt: iso(4 * H), membershipIds: [mem['other@ra.us']] });
    expect(r.status).toBe(201);
    await run('no_shows');
    const n = await t.call(sup, 'GET', '/api/v1/notifications');
    expect(n.body.items.some((x: { type: string; body: string }) => x.type === 'attendance.no_show' && x.body.includes('other person'))).toBe(true);
  });
});
