// Bootstrap the FIRST platform super admin (one-time, run by the owner with a direct DB connection).
// The person must already have signed up and verified their email in the app.
// Usage: DATABASE_URL=postgres://postgres:...@db.<ref>.supabase.co:5432/postgres node scripts/create-super-admin.mjs you@example.com
import pg from 'pg';
const email = (process.argv[2] ?? '').toLowerCase().trim();
if (!email) throw new Error('Usage: node scripts/create-super-admin.mjs <email>');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin');
  const u = (await c.query(`select id, email from auth.users where lower(email) = $1 and email_confirmed_at is not null`, [email])).rows[0];
  if (!u) throw new Error('No VERIFIED user with that email. Sign up and confirm the email first.');
  const existing = (await c.query(`select count(*)::int as n from app.platform_staff where role = 'super_admin'`)).rows[0].n;
  if (existing > 0 && process.env.ALLOW_ADDITIONAL !== 'yes') throw new Error('A super admin already exists. Add staff from the admin panel instead.');
  await c.query(`insert into app.profiles (user_id, email, full_name) values ($1, $2, $2) on conflict (user_id) do nothing`, [u.id, u.email]);
  await c.query(`insert into app.platform_staff (user_id, role) values ($1, 'super_admin') on conflict (user_id) do update set role = 'super_admin', status = 'active'`, [u.id]);
  await c.query(`insert into app.audit_logs (actor_type, action, target_type, target_id, metadata) values ('system', 'platform.super_admin_bootstrapped', 'user', $1, $2)`, [u.id, JSON.stringify({ email })]);
  await c.query('commit');
  console.log(`✔ ${email} is now a super admin. Enrol MFA (TOTP) at first admin sign-in — the admin panel requires it.`);
} catch (e) {
  await c.query('rollback');
  console.error('✖', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
