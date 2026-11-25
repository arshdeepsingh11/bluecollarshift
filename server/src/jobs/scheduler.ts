import type { Services } from '../app';
import { notify, staffUserIds } from '../services/notify';
import { templates } from '../services/email';

/**
 * Background jobs. Every run takes a Postgres advisory lock, so with several API instances each
 * job runs once. Every notification has a dedupe key, so a retried run never notifies twice.
 * Run records go to app.job_runs (visible in the platform admin).
 */
type Job = { name: string; everyMs: number; run: (s: Services) => Promise<number> };

const LOCK_BASE = 74_210_000;

export const jobs: Job[] = [
  {
    name: 'late_shifts',
    everyMs: 60_000,
    async run(s) {
      return s.db.asSystem(async (tx) => {
        const { rows } = await tx.query(
          `select s.id as shift_id, s.company_id, s.site_id, s.starts_at, js.name as site_name, sa.membership_id, m.user_id, p.full_name
             from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.memberships m on m.id = sa.membership_id and m.status = 'active'
             join app.profiles p on p.user_id = m.user_id join app.job_sites js on js.id = s.site_id join app.companies c on c.id = s.company_id and c.status = 'active'
            where s.status = 'scheduled' and s.starts_at < now() - make_interval(mins => $1) and s.starts_at > now() - interval '6 hours' and s.ends_at > now()
              and not exists (select 1 from app.time_events te where te.membership_id = sa.membership_id and te.type = 'clock_in'
                              and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at)`,
          [s.config.LATE_GRACE_MINUTES],
        );
        for (const r of rows) {
          const staff = await staffUserIds(tx, r.company_id, ['owner', 'admin', 'manager', 'supervisor'], r.site_id);
          await notify(tx, { userIds: staff, companyId: r.company_id, type: 'attendance.late', title: 'Employee has not clocked in',
            body: `${r.full_name} has not clocked in at ${r.site_name}.`, data: { shiftId: r.shift_id, membershipId: r.membership_id, companyId: r.company_id },
            dedupeKey: `late:${r.shift_id}:${r.membership_id}`, email: true }, s.emit);
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'attendance.late', title: 'You have not clocked in',
            body: `Your shift at ${r.site_name} has started.`, data: { shiftId: r.shift_id, companyId: r.company_id }, dedupeKey: `late-self:${r.shift_id}` }, s.emit);
        }
        return rows.length;
      });
    },
  },
  {
    name: 'missing_clock_outs',
    everyMs: 5 * 60_000,
    async run(s) {
      return s.db.asSystem(async (tx) => {
        const { rows } = await tx.query(
          `select ws.id, ws.company_id, ws.site_id, m.user_id, p.full_name
             from app.work_sessions ws join app.memberships m on m.id = ws.membership_id join app.profiles p on p.user_id = m.user_id
             left join app.shifts sh on sh.id = ws.shift_id
            where ws.status = 'open' and (
              (sh.id is not null and sh.ends_at < now() - interval '60 minutes') or ws.original_start < now() - interval '14 hours')`,
        );
        for (const r of rows) {
          const staff = await staffUserIds(tx, r.company_id, ['owner', 'admin', 'manager', 'supervisor'], r.site_id);
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'attendance.missing_clock_out', title: 'Did you forget to clock out?',
            body: 'You are still clocked in. Clock out now or tell your manager the correct time.', data: { sessionId: r.id, companyId: r.company_id }, dedupeKey: `missing-out-self:${r.id}` }, s.emit);
          await notify(tx, { userIds: staff, companyId: r.company_id, type: 'attendance.missing_clock_out', title: 'Missing clock-out',
            body: `${r.full_name} is still clocked in after their shift.`, data: { sessionId: r.id, companyId: r.company_id }, dedupeKey: `missing-out:${r.id}` }, s.emit);
        }
        return rows.length;
      });
    },
  },
  {
    name: 'shift_reminders',
    everyMs: 5 * 60_000,
    async run(s) {
      return s.db.asSystem(async (tx) => {
        const { rows } = await tx.query(
          `select s.id, s.company_id, s.starts_at, js.name as site_name, m.user_id
             from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.memberships m on m.id = sa.membership_id and m.status = 'active'
             join app.job_sites js on js.id = s.site_id
            where s.status = 'scheduled' and s.starts_at between now() + interval '50 minutes' and now() + interval '70 minutes'`,
        );
        for (const r of rows) {
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'shift.reminder', title: 'Shift starts in about 1 hour',
            body: `${r.site_name}`, data: { shiftId: r.id, companyId: r.company_id }, dedupeKey: `reminder:${r.id}` }, s.emit);
        }
        return rows.length;
      });
    },
  },
  {
    name: 'push_delivery',
    everyMs: 15_000,
    async run(s) {
      if (!s.push.enabled) return 0;
      const pending = await s.db.asSystem(async (tx) => (await tx.query(
        `select n.id, n.user_id, n.title, n.body, n.data, n.push_attempts from app.notifications n
          where n.push_status = 'pending' and n.created_at > now() - interval '6 hours' order by n.created_at limit 200 for update skip locked`)).rows);
      if (!pending.length) return 0;
      const tokens = await s.db.asSystem(async (tx) => (await tx.query(
        `select user_id, token from app.device_tokens where disabled_at is null and user_id = any($1)`, [[...new Set(pending.map((p) => p.user_id))]])).rows);
      const msgs = pending.flatMap((n) => tokens.filter((t) => t.user_id === n.user_id).map((t) => ({ nid: n.id as string, to: t.token as string, title: n.title, body: n.body, data: n.data })));
      const results = await s.push.send(msgs).catch(() => msgs.map((m) => ({ token: m.to, ok: false, invalidToken: false })));
      await s.db.asSystem(async (tx) => {
        for (const n of pending) {
          const mine = msgs.map((m, i) => ({ m, r: results[i] })).filter((x) => x.m.nid === n.id);
          const status = mine.length === 0 ? 'skipped' : mine.some((x) => x.r?.ok) ? 'sent' : n.push_attempts >= 4 ? 'failed' : 'pending';
          await tx.query(`update app.notifications set push_status = $2, push_attempts = push_attempts + 1 where id = $1`, [n.id, status]);
        }
        const dead = results.filter((r) => r.invalidToken).map((r) => r.token);
        if (dead.length) await tx.query(`update app.device_tokens set disabled_at = now() where token = any($1)`, [dead]);
      });
      s.metrics.inc('push.sent', results.filter((r) => r.ok).length);
      s.metrics.inc('push.failed', results.filter((r) => !r.ok).length);
      return msgs.length;
    },
  },
  {
    name: 'email_delivery',
    everyMs: 30_000,
    async run(s) {
      const rows = await s.db.asSystem(async (tx) => (await tx.query(
        `update app.notifications n set email_status = 'sent' from app.profiles p
          where n.id in (select id from app.notifications where email_status = 'pending' order by created_at limit 50 for update skip locked)
            and p.user_id = n.user_id
          returning n.id, n.type, n.title, n.body, p.email`)).rows);
      for (const r of rows) {
        const res = await s.mailer.send({ to: r.email, ...templates.attendanceAlert({ title: r.title, body: r.body, url: s.config.APP_URL }), tag: r.type }).catch(() => ({ delivered: false }));
        if (!res.delivered) await s.db.asSystem((tx) => tx.query(`update app.notifications set email_status = 'failed' where id = $1`, [r.id]));
      }
      return rows.length;
    },
  },
];

export function startScheduler(s: Services, log: { error: (o: object, m: string) => void }) {
  const timers: NodeJS.Timeout[] = [];
  jobs.forEach((job, i) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      const client = await s.db.pool.connect().catch(() => null);
      if (!client) {
        running = false;
        return;
      }
      try {
        const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_BASE + i]);
        if (!rows[0]?.ok) return;
        const key = new Date().toISOString().slice(0, 16);
        try {
          await s.db.asSystem((tx) => tx.query(`insert into app.job_runs (job, run_key) values ($1, $2) on conflict (job, run_key) do update set status = 'running', started_at = now()`, [job.name, key]));
          const n = await job.run(s);
          await s.db.asSystem((tx) => tx.query(`update app.job_runs set status = 'succeeded', finished_at = now(), error = $3 where job = $1 and run_key = $2`, [job.name, key, n ? `processed ${n}` : null]));
        } catch (err) {
          log.error({ err, job: job.name }, 'job failed');
          s.metrics.inc(`job.${job.name}.failed`);
          await s.db.asSystem((tx) => tx.query(`update app.job_runs set status = 'failed', finished_at = now(), error = $3 where job = $1 and run_key = $2`, [job.name, key, String((err as Error).message).slice(0, 500)])).catch(() => undefined);
        } finally {
          await client.query('select pg_advisory_unlock($1)', [LOCK_BASE + i]);
        }
      } finally {
        client.release();
        running = false;
      }
    };
    timers.push(setInterval(() => void tick(), job.everyMs));
  });
  // Keep job history bounded.
  timers.push(setInterval(() => void s.db.asSystem((tx) => tx.query(`delete from app.job_runs where started_at < now() - interval '14 days'`)).catch(() => undefined), 6 * 3600_000));
  return () => timers.forEach(clearInterval);
}
