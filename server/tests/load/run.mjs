// Load test (local): starts the built API against the benchmark database and measures key endpoints.
// Usage: node tests/load/run.mjs   (requires dist/ build and the bc_perf database from tests/perf/seed-scale.sql)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import autocannon from 'autocannon';
import pg from 'pg';
import { SignJWT } from 'jose';

const SECRET = 'load-test-secret-load-test-secret-0123456789';
const SUPA = 'https://perf.supabase.co';
const PORT = 8099;
const db = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', database: process.env.PERF_DB ?? 'bc_perf' });
await db.connect();
const mgr = (await db.query(`select m.user_id, m.company_id, p.email from app.memberships m join app.profiles p on p.user_id = m.user_id join app.companies c on c.id = m.company_id where m.role = 'manager' and c.name = 'Perf Company 200'`)).rows[0];
const emp = (await db.query(`select m.user_id, m.id, p.email from app.memberships m join app.profiles p on p.user_id = m.user_id where m.company_id = $1 and m.role = 'employee' limit 1`, [mgr.company_id])).rows[0];
await db.end();

const token = (u) => new SignJWT({ email: u.email, role: 'authenticated', aal: 'aal1', session_id: randomUUID() })
  .setProtectedHeader({ alg: 'HS256' }).setSubject(u.user_id).setIssuer(`${SUPA}/auth/v1`).setAudience('authenticated')
  .setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(SECRET));
const [mt, et] = [await token(mgr), await token(emp)];

const server = spawn('node', ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'development', RATE_LIMITS_ENABLED: 'false', PORT: String(PORT), DATABASE_URL: `postgres://bc_api@localhost:54329/${process.env.PERF_DB ?? 'bc_perf'}`,
    DATABASE_SSL: 'disable', SUPABASE_URL: SUPA, SUPABASE_JWT_SECRET: SECRET, CORS_ORIGINS: 'https://app.bluecollarshift.com', RESEND_API_KEY: 'x',
    JOBS_ENABLED: 'false', LOG_LEVEL: 'error', DATABASE_POOL_MAX: '10' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
// production config refuses DATABASE_SSL=disable; that is intended — use a dedicated override for this local benchmark.
await new Promise((r) => setTimeout(r, 1500));

const base = `http://127.0.0.1:${PORT}/api/v1`;
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
const cases = [
  ['GET /me (manager)', { url: `${base}/me`, headers: { authorization: `Bearer ${mt}` } }],
  ['GET dashboard (manager)', { url: `${base}/companies/${mgr.company_id}/dashboard`, headers: { authorization: `Bearer ${mt}` } }],
  ['GET timesheets 1 week (manager)', { url: `${base}/companies/${mgr.company_id}/timesheets?from=${weekAgo}&to=${today}`, headers: { authorization: `Bearer ${mt}` } }],
  ['GET attendance/me (employee)', { url: `${base}/companies/${mgr.company_id}/attendance/me`, headers: { authorization: `Bearer ${et}` } }],
];
{
  const r = await fetch(`${base}/companies/${mgr.company_id}/sync/events`, { method: 'POST', headers: { authorization: `Bearer ${et}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events: [{ id: randomUUID(), type: 'break_start', deviceTime: new Date().toISOString(), offline: false, deviceId: 'load-dev' }] }) });
  void ('sync probe', r.status, (await r.text()).slice(0, 300));
}
const results = [];
for (const [name, opts] of cases) {
  // 1) Single user: true request latency.  2) 10 concurrent connections: throughput on this machine.
  const one = await autocannon({ connections: 1, duration: 5, ...opts });
  const many = await autocannon({ connections: 10, duration: 8, ...opts });
  results.push({ endpoint: name, single_p50_ms: one.latency.p50, single_p99_ms: one.latency.p99, conc10_rps: Math.round(many.requests.average),
    conc10_p50_ms: many.latency.p50, conc10_p99_ms: many.latency.p99, errors: one.errors + one.non2xx + many.errors + many.non2xx, total: one.requests.total + many.requests.total });
}
// Offline sync endpoint: custom loop (unique event ids per request).
async function syncLoop(concurrency, ms) {
  const lat = [];
  let errors = 0;
  const until = Date.now() + ms;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (Date.now() < until) {
      const t0 = performance.now();
      const r = await fetch(`${base}/companies/${mgr.company_id}/sync/events`, {
        method: 'POST', headers: { authorization: `Bearer ${et}`, 'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ id: randomUUID(), type: 'break_start', deviceTime: new Date().toISOString(), offline: false, deviceId: 'load-dev' }] }),
      });
      const text = await r.text();
      if (r.status !== 200) { if (errors++ === 0) console.error('first sync error', r.status, text.slice(0, 300)); }
      lat.push(performance.now() - t0);
    }
  }));
  lat.sort((a, b) => a - b);
  const p = (q) => Math.round(lat[Math.floor(q * (lat.length - 1))] * 10) / 10;
  return { rps: Math.round(lat.length / (ms / 1000)), p50: p(0.5), p99: p(0.99), errors, total: lat.length };
}
const one = await syncLoop(1, 5000);
const many = await syncLoop(10, 8000);
results.push({ endpoint: 'POST sync/events (employee, 1 event)', single_p50_ms: one.p50, single_p99_ms: one.p99, conc10_rps: many.rps, conc10_p50_ms: many.p50, conc10_p99_ms: many.p99, errors: one.errors + many.errors, total: one.total + many.total });
server.kill('SIGTERM');
console.table(results);
console.log(JSON.stringify(results));
