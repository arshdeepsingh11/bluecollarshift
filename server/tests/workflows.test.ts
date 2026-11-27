/**
 * End-to-end business workflows through the real API and real PostgreSQL:
 * attendance (online + offline + conflicts), adjustments, disputes, payroll, messaging, jobs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDatabase, createUser, startApp, iso, H, type TestApp, type TestUser } from './helpers';
import { jobs } from '../src/jobs/scheduler';

const DB = 'bc_test_workflows';
let su: pg.Client;
let t: TestApp;
let owner: TestUser, emp: TestUser, emp2: TestUser, mgr: TestUser;
let C: string, site: string;
const mem: Record<string, string> = {};

const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), type, deviceTime: new Date().toISOString(), offline: false, lat: 51.1901, lng: -114.4701, accuracyM: 12, deviceId: 'iphone-test-1', ...extra,
});

async function join(u: TestUser, role: string, extra: Record<string, unknown> = {}) {
  const r = await t.call(owner, 'POST', `/api/v1/companies/${C}/invitations`, { email: u.email, fullName: `${role} person`, role, ...extra });
  const token = randomUUID().replace(/-/g, '').repeat(2);
  await su.query(`update app.invitations set token_hash = $1 where id = $2`, [createHash('sha256').update(token).digest('hex'), r.body.id]);
  const a = await t.call(u, 'POST', '/api/v1/invitations/accept', { token });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  mem[u.email] = a.body.membershipId;
}

beforeAll(async () => {
  su = await createTestDatabase(DB);
  t = await startApp(DB);
  [owner, emp, emp2, mgr] = await Promise.all(['o@wf.ca', 'e@wf.ca', 'e2@wf.ca', 'm@wf.ca'].map((e) => createUser(su, e))) as [TestUser, TestUser, TestUser, TestUser];
  C = (await t.call(owner, 'POST', '/api/v1/companies', { companyName: 'Workflow Builders', fullName: 'Olivia Owner' })).body.id;
  site = (await t.call(owner, 'POST', `/api/v1/companies/${C}/sites`, { name: 'Cochrane Tower', address: '1 Main St, Cochrane AB', lat: 51.19, lng: -114.47, geofenceRadiusM: 300 })).body.id;
  await join(emp, 'employee', { hourlyRate: 30 });
  await join(emp2, 'employee', { hourlyRate: 25 });
  await join(mgr, 'manager');
});
afterAll(async () => {
  await t?.close();
  await su?.end();
});

describe('scheduling', () => {
  it('creates a shift, notifies the employee, and the employee sees it', async () => {
    const r = await t.call(owner, 'POST', `/api/v1/companies/${C}/shifts`, { siteId: site, startsAt: iso(-1 * H), endsAt: iso(7 * H), breakMinutes: 30, membershipIds: [mem['e@wf.ca']], instructions: 'Bring harness' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const shift = r.body.items[0];
    const notes = await t.call(emp, 'GET', '/api/v1/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'shift.assigned')).toBe(true);
    const mine = await t.call(emp, 'GET', `/api/v1/companies/${C}/shifts?from=${iso(-24 * H)}&to=${iso(24 * H)}`);
    expect(mine.body.items.map((s: { id: string }) => s.id)).toContain(shift.id);
    // Other employee cannot see this shift.
    const other = await t.call(emp2, 'GET', `/api/v1/companies/${C}/shifts?from=${iso(-24 * H)}&to=${iso(24 * H)}`);
    expect(other.body.items).toHaveLength(0);
  });
  it('rejects stale edits (optimistic concurrency) and keeps history in audit', async () => {
    const list = await t.call(owner, 'GET', `/api/v1/companies/${C}/shifts?from=${iso(-24 * H)}&to=${iso(24 * H)}`);
    const s = list.body.items[0];
    const ok = await t.call(owner, 'PATCH', `/api/v1/companies/${C}/shifts/${s.id}`, { version: s.version, instructions: 'Bring harness and gloves' });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(s.version + 1);
    const stale = await t.call(mgr, 'PATCH', `/api/v1/companies/${C}/shifts/${s.id}`, { version: s.version, breakMinutes: 0 });
    expect(stale.status).toBe(409);
  });
});

describe('attendance — online', () => {
  let sessionId: string;
  let shiftId: string;
  it('employer roles cannot clock in (permission matrix)', async () => {
    expect((await t.call(owner, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_in'))).status).toBe(403);
  });
  it('clock in uses SERVER time, links the shift and checks the geofence', async () => {
    shiftId = (await t.call(emp, 'GET', `/api/v1/companies/${C}/attendance/me`)).body.shifts[0].id;
    const fake = ev('clock_in', { shiftId, deviceTime: iso(-3 * H) }); // device clock wrong by 3h
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, fake);
    expect(r.status).toBe(200);
    expect(r.body.flags).toContain('device_clock_skew');
    sessionId = r.body.sessionId;
    const row = (await su.query(`select occurred_at, device_time, distance_from_site_m from app.time_events where id = $1`, [fake.id])).rows[0];
    expect(Math.abs(row.occurred_at.getTime() - Date.now())).toBeLessThan(10_000); // server time, not device time
    expect(row.distance_from_site_m).toBeLessThan(300);
    expect(t.emitted.some((e) => e.room === `company:${C}:staff` && e.event === 'attendance:update')).toBe(true);
  });
  it('the same event id sent twice is a duplicate, never a second record', async () => {
    const e1 = ev('break_start');
    expect((await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, e1)).body.result).toBe('accepted');
    expect((await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, e1)).body.result).toBe('duplicate');
    expect((await su.query(`select count(*)::int as n from app.time_events where id = $1`, [e1.id])).rows[0].n).toBe(1);
  });
  it('a second clock-in while working is flagged for review', async () => {
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_in'));
    expect(r.body.result).toBe('needs_review');
    expect(r.body.flags).toContain('duplicate_clock_in');
  });
  it('break end + clock out closes the session', async () => {
    await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('break_end'));
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_out'));
    expect(r.body.sessionId).toBe(sessionId);
    const s = (await su.query(`select status, original_end from app.work_sessions where id = $1`, [sessionId])).rows[0];
    expect(s.original_end).not.toBeNull();
    expect(['closed', 'needs_review']).toContain(s.status);
  });
  it('clocking in far from the site is flagged outside_geofence (not rejected)', async () => {
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_in', { shiftId, lat: 51.0447, lng: -114.0719 })); // Calgary, ~30 km away
    expect(r.body.result).toBe('needs_review');
    expect(r.body.flags).toContain('outside_geofence');
    await t.call(emp, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_out'));
    const notes = await t.call(owner, 'GET', '/api/v1/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'attendance.review')).toBe(true);
  });
});

describe('attendance — offline synchronisation', () => {
  it('a batch of offline events keeps device time, is ordered, and is idempotent on retry', async () => {
    const inT = iso(-30 * H);
    const outT = iso(-22 * H);
    const batch = [ev('clock_out', { offline: true, deviceTime: outT }), ev('clock_in', { offline: true, deviceTime: inT })]; // out of order on purpose
    const r1 = await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, { events: batch });
    expect(r1.status).toBe(200);
    expect(r1.body.results.map((x: { result: string }) => x.result)).toEqual(['accepted', 'accepted']);
    const s = (await su.query(`select original_start, original_end, status, flags from app.work_sessions where membership_id = $1`, [mem['e2@wf.ca']])).rows[0];
    expect(s.original_start.toISOString()).toBe(inT);
    expect(s.original_end.toISOString()).toBe(outT);
    expect(s.flags).toContain('offline_device_time');
    // Retry the same batch (e.g. response lost on a bad connection): nothing duplicated.
    const r2 = await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, { events: batch });
    expect(r2.body.results.every((x: { result: string }) => x.result === 'duplicate')).toBe(true);
    expect((await su.query(`select count(*)::int as n from app.time_events where membership_id = $1`, [mem['e2@wf.ca']])).rows[0].n).toBe(2);
  });
  it('an offline clock-in inside an existing session is preserved and flagged, not merged silently', async () => {
    const r = await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, { events: [ev('clock_in', { offline: true, deviceTime: iso(-26 * H) })] });
    expect(r.body.results[0].result).toBe('needs_review');
    expect(r.body.results[0].flags).toContain('out_of_order');
  });
  it('future-dated and too-old offline events are rejected individually, the rest of the batch is kept', async () => {
    const good = ev('clock_in', { offline: true, deviceTime: iso(-10 * H) });
    const r = await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, {
      events: [ev('clock_in', { offline: true, deviceTime: iso(2 * H) }), ev('clock_in', { offline: true, deviceTime: iso(-20 * 24 * H) }), good],
    });
    const byId = Object.fromEntries(r.body.results.map((x: { id: string }) => [x.id, x]));
    expect(byId[good.id].result).toBe('accepted');
    expect(r.body.results.filter((x: { result: string }) => x.result === 'rejected')).toHaveLength(2);
    await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, { events: [ev('clock_out', { offline: true, deviceTime: iso(-2 * H) })] });
  });
  it('an event id cannot be hijacked by another employee', async () => {
    const e = ev('clock_in');
    await t.call(emp2, 'POST', `/api/v1/companies/${C}/sync/events`, { events: [{ ...e, offline: true, deviceTime: iso(-60_000) }] });
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/sync/events`, { events: [e] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results[0].result).toBe('rejected');
    await t.call(emp2, 'POST', `/api/v1/companies/${C}/attendance/events`, ev('clock_out'));
  });
});

describe('timesheets — adjustments, transparency, disputes', () => {
  let sessionId: string;
  let version: number;
  it('manager adjusts hours with a reason; original is preserved; employee is notified', async () => {
    const list = await t.call(mgr, 'GET', `/api/v1/companies/${C}/timesheets?from=2020-01-01&to=2030-12-31&membershipId=${mem['e2@wf.ca']}`);
    const closed = list.body.items.filter((x: { originalEnd: string | null; status: string }) => x.originalEnd && x.status !== 'open');
    const dur = (x: { originalStart: string; originalEnd: string }) => Date.parse(x.originalEnd) - Date.parse(x.originalStart);
    const s = closed.sort((a: never, b: never) => dur(b) - dur(a))[0];
    sessionId = s.id;
    version = s.version;
    const adjEnd = new Date(Date.parse(s.originalEnd) - 30 * 60_000).toISOString();
    const r = await t.call(mgr, 'POST', `/api/v1/companies/${C}/timesheets/${sessionId}/adjustments`, {
      expectedVersion: version, adjustedStart: s.originalStart, adjustedEnd: adjEnd, adjustedBreakMinutes: 30, reason: 'Left site 30 min early per foreman',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.originalEnd).toBe(s.originalEnd); // original kept
    expect(r.body.effectiveEnd).toBe(adjEnd);
    expect(r.body.adjustments[0].reason).toContain('30 min early');
    expect(r.body.adjustments[0].createdBy.fullName).toBe('manager person');
    const notes = await t.call(emp2, 'GET', '/api/v1/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'timesheet.adjusted')).toBe(true);
  });
  it('employee sees original and adjusted values on their own timesheet', async () => {
    const d = await t.call(emp2, 'GET', `/api/v1/companies/${C}/timesheets/${sessionId}`);
    expect(d.status).toBe(200);
    expect(d.body.adjusted).toBe(true);
    expect(d.body.originalEnd).not.toBe(d.body.effectiveEnd);
  });
  it('adjusting with an old version is refused (concurrent change / synced offline event)', async () => {
    const r = await t.call(mgr, 'POST', `/api/v1/companies/${C}/timesheets/${sessionId}/adjustments`, {
      expectedVersion: version, adjustedStart: iso(-30 * H), adjustedEnd: iso(-23 * H), adjustedBreakMinutes: 0, reason: 'Second change attempt',
    });
    expect(r.status).toBe(409);
  });
  it('employees cannot adjust hours, nor see other employees timesheets', async () => {
    const r = await t.call(emp2, 'POST', `/api/v1/companies/${C}/timesheets/${sessionId}/adjustments`, { expectedVersion: 1, adjustedStart: iso(-30 * H), adjustedEnd: iso(-20 * H), adjustedBreakMinutes: 0, reason: 'I worked more' });
    expect(r.status).toBe(403);
    expect((await t.call(emp, 'GET', `/api/v1/companies/${C}/timesheets/${sessionId}`)).status).toBe(404);
  });
  it('employee disputes; manager resolves; employee is notified', async () => {
    const d = await t.call(emp2, 'POST', `/api/v1/companies/${C}/timesheets/${sessionId}/disputes`, { explanation: 'I stayed to clean up the site.' });
    expect(d.status).toBe(201);
    expect((await t.call(emp2, 'POST', `/api/v1/companies/${C}/timesheets/${sessionId}/disputes`, { explanation: 'Again please review' })).status).toBe(409);
    const r = await t.call(mgr, 'POST', `/api/v1/companies/${C}/disputes/${d.body.id}/resolve`, { status: 'rejected', resolutionNote: 'Foreman confirmed early departure.' });
    expect(r.status).toBe(200);
    const notes = await t.call(emp2, 'GET', '/api/v1/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'dispute.closed')).toBe(true);
  });
});

describe('payroll', () => {
  it('only approved hours flow into payroll; overtime and gross are traceable; paid is immutable', async () => {
    // Fixture: 5 × 10h days for emp in a past week (via offline sync, then approve).
    await su.query(`update app.payroll_settings set work_week_start_dow = 0 where company_id = $1`, [C]);
    const events = [];
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    for (const d of days) {
      events.push({ id: randomUUID(), type: 'clock_in', deviceTime: `${d}T15:00:00.000Z`, offline: true, deviceId: 'iphone-test-1', lat: 51.19, lng: -114.47 });
      events.push({ id: randomUUID(), type: 'clock_out', deviceTime: `${d}T23:30:00.000Z`, offline: true, deviceId: 'iphone-test-1', lat: 51.19, lng: -114.47 });
    }
    // Make the events "recent" relative to the 14-day offline window by shifting server clock check: insert via API only works within 14 days.
    const recent = events.map((e) => ({ ...e, deviceTime: new Date(Date.parse(e.deviceTime) + (Date.now() - Date.parse('2026-11-08T00:00:00Z'))).toISOString() }));
    const sync = await t.call(emp, 'POST', `/api/v1/companies/${C}/sync/events`, { events: recent });
    expect(sync.body.results.every((r: { result: string }) => r.result !== 'rejected')).toBe(true);

    const ts = await t.call(owner, 'GET', `/api/v1/companies/${C}/timesheets?from=2020-01-01&to=2030-12-31&membershipId=${mem['e@wf.ca']}`);
    const ids = ts.body.items.filter((s: { status: string }) => s.status !== 'open').map((s: { id: string }) => s.id);
    const ap = await t.call(owner, 'POST', `/api/v1/companies/${C}/timesheets/approve`, { sessionIds: ids, decision: 'approved' });
    expect(ap.body.updated.length).toBe(ids.length);

    const dates = recent.map((e) => e.deviceTime.slice(0, 10)).sort();
    const start = dates[0]!;
    const per = await t.call(owner, 'POST', `/api/v1/companies/${C}/pay-periods`, { startsOn: addDays(start, -10), endsOn: addDays(start, 10), payDate: addDays(start, 15) });
    expect(per.status, JSON.stringify(per.body)).toBe(201);
    const calc = await t.call(owner, 'POST', `/api/v1/companies/${C}/pay-periods/${per.body.id}/calculate`);
    expect(calc.status, JSON.stringify(calc.body)).toBe(200);
    const recs = await t.call(owner, 'GET', `/api/v1/companies/${C}/pay-periods/${per.body.id}/records`);
    const mine = recs.body.items.find((r: { membershipId: string }) => r.membershipId === mem['e@wf.ca']);
    expect(mine).toBeTruthy();
    // Each day 8.5h → daily OT 0.5h ×5 = 2.5h; weekly 42.5h → 0 → OT = 150 min (greater of).
    expect(mine.overtimeMinutes).toBeGreaterThanOrEqual(150);
    expect(mine.grossTotalCents).toBe(mine.grossRegularCents + mine.grossOvertimeCents);
    expect(mine.trace.blocks.length).toBeGreaterThan(0);

    // Employee 2 sees only their own payroll record; employee 1 cannot see others.
    const empView = await t.call(emp, 'GET', `/api/v1/companies/${C}/pay-periods/${per.body.id}/records`);
    expect(empView.body.items.every((r: { membershipId: string }) => r.membershipId === mem['e@wf.ca'])).toBe(true);

    expect((await t.call(owner, 'POST', `/api/v1/companies/${C}/pay-periods/${per.body.id}/approve`)).status).toBe(200);
    expect((await t.call(owner, 'POST', `/api/v1/companies/${C}/pay-periods/${per.body.id}/mark-paid`)).status).toBe(200);
    expect((await t.call(owner, 'POST', `/api/v1/companies/${C}/pay-periods/${per.body.id}/calculate`)).status).toBe(409);
    await expect(su.query(`update app.payroll_records set gross_total_cents = 1, gross_regular_cents = 1, gross_overtime_cents = 0 where pay_period_id = $1`, [per.body.id])).rejects.toThrow(/Paid payroll records cannot be changed/);
    const mypay = await t.call(emp, 'GET', `/api/v1/companies/${C}/my-pay`);
    expect(mypay.body.items[0].status).toBe('paid');

    const csv = await t.call(owner, 'GET', `/api/v1/companies/${C}/pay-periods/${per.body.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('does not calculate taxes or deductions');
  });
});

describe('messaging', () => {
  let convId: string;
  it('employee can message a manager; employee cannot message another employee', async () => {
    const r = await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations`, { kind: 'direct', memberIds: [mem['m@wf.ca']] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    convId = r.body.id;
    expect((await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations`, { kind: 'direct', memberIds: [mem['e2@wf.ca']] })).status).toBe(403);
    // The same direct conversation is reused.
    expect((await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations`, { kind: 'direct', memberIds: [mem['m@wf.ca']] })).body.id).toBe(convId);
  });
  it('messages are persisted, delivered in real time, idempotent on retry, and private', async () => {
    const id = randomUUID();
    const r1 = await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations/${convId}/messages`, { id, body: 'Ladder at site 1 is damaged' });
    expect(r1.status).toBe(201);
    expect(t.emitted.some((e) => e.room === `conv:${convId}` && e.event === 'message:new')).toBe(true);
    const r2 = await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations/${convId}/messages`, { id, body: 'Ladder at site 1 is damaged' });
    expect(r2.status).toBe(200);
    expect((await su.query(`select count(*)::int as n from app.messages where id = $1`, [id])).rows[0].n).toBe(1);
    const list = await t.call(mgr, 'GET', `/api/v1/companies/${C}/conversations/${convId}/messages`);
    expect(list.body.items.map((m: { body: string }) => m.body)).toContain('Ladder at site 1 is damaged');
    expect((await t.call(emp2, 'GET', `/api/v1/companies/${C}/conversations/${convId}/messages`)).status).toBe(404);
    const note = (await t.call(mgr, 'GET', '/api/v1/notifications')).body.items.find((n: { type: string }) => n.type === 'message.new');
    expect(note.body).not.toContain('Ladder'); // no content on lock screen
  });
  it('read receipts update', async () => {
    const list = await t.call(mgr, 'GET', `/api/v1/companies/${C}/conversations/${convId}/messages`);
    const last = list.body.items[list.body.items.length - 1];
    expect((await t.call(mgr, 'POST', `/api/v1/companies/${C}/conversations/${convId}/read`, { messageId: last.id })).status).toBe(200);
    const again = await t.call(emp, 'GET', `/api/v1/companies/${C}/conversations/${convId}/messages`);
    expect(again.body.items[again.body.items.length - 1].readBy).toBe(1);
  });
  it('announcements: employees receive but cannot post', async () => {
    const a = await t.call(owner, 'POST', `/api/v1/companies/${C}/conversations`, { kind: 'announcement', title: 'Safety', memberIds: [mem['e@wf.ca'], mem['e2@wf.ca']] });
    expect(a.status).toBe(201);
    const post = await t.call(emp, 'POST', `/api/v1/companies/${C}/conversations/${a.body.id}/messages`, { id: randomUUID(), body: 'reply' });
    expect(post.status).toBe(400);
  });
});

describe('background jobs', () => {
  it('late-shift detection notifies staff once even if the job runs twice', async () => {
    const e3 = await createUser(su, 'e3@wf.ca');
    await join(e3, 'employee');
    await t.call(owner, 'POST', `/api/v1/companies/${C}/shifts`, { siteId: site, startsAt: iso(-30 * 60_000), endsAt: iso(4 * H), membershipIds: [mem['e3@wf.ca']] });
    const late = jobs.find((j) => j.name === 'late_shifts')!;
    expect(await late.run(t.services)).toBeGreaterThanOrEqual(1);
    await late.run(t.services);
    const n = (await su.query(`select count(*)::int as n from app.notifications n join app.profiles p on p.user_id = n.user_id where p.email = 'o@wf.ca' and n.type = 'attendance.late'`)).rows[0].n;
    expect(n).toBe(1);
  });
  it('dashboard counts reflect the late employee', async () => {
    const d = await t.call(owner, 'GET', `/api/v1/companies/${C}/dashboard`);
    expect(d.status).toBe(200);
    expect(d.body.notClockedIn).toBeGreaterThanOrEqual(1);
    expect(d.body.employees).toBe(3);
  });
  it('reports export CSV with formula injection neutralised', async () => {
    await su.query(`update app.profiles set full_name = '=HYPERLINK("http://evil")' where email = 'e2@wf.ca'`);
    const r = await t.call(owner, 'GET', `/api/v1/companies/${C}/reports/hours?from=2026-01-01&to=2026-12-31&format=csv`);
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

function addDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}
