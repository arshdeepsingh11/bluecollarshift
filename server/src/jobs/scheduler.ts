import type { Services } from '../app';
import { notify, staffUserIds } from '../services/notify';
import { templates } from '../services/email';
import { normalizeLocale } from '../i18n/messages';

/**
 * Background jobs. Every run takes a Postgres advisory lock, so with several API instances each
 * job runs once. Every notification has a dedupe key, so a retried run never notifies twice.
 * Run records go to app.job_runs (visible in the platform admin).
 */
type Job = { name: string; everyMs: number; run: (s: Services) => Promise<number> };

const LOCK_BASE = 74_210_000;
/** Stable lock id per job NAME (adding or reordering jobs never changes another job's lock). */
export function lockId(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 100_000;
  return LOCK_BASE + h;
}

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
                              and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at)
              and not exists (select 1 from app.time_off_requests t where t.membership_id = sa.membership_id and t.status = 'approved'
                              and (s.starts_at at time zone c.timezone)::date between t.starts_on and t.ends_on)`,
          [s.config.LATE_GRACE_MINUTES],
        );
        for (const r of rows) {
          const staff = await staffUserIds(tx, r.company_id, ['owner', 'admin', 'manager', 'supervisor'], r.site_id);
          await notify(tx, { userIds: staff, companyId: r.company_id, type: 'attendance.late', msg: { key: 'att.late', vars: { name: r.full_name, site: r.site_name } }, data: { shiftId: r.shift_id, membershipId: r.membership_id, companyId: r.company_id },
            dedupeKey: `late:${r.shift_id}:${r.membership_id}`, email: true }, s.emit);
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'attendance.late', msg: { key: 'att.late_self', vars: { site: r.site_name } }, data: { shiftId: r.shift_id, companyId: r.company_id }, dedupeKey: `late-self:${r.shift_id}` }, s.emit);
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
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'attendance.missing_clock_out', msg: { key: 'att.out_self' }, data: { sessionId: r.id, companyId: r.company_id }, dedupeKey: `missing-out-self:${r.id}` }, s.emit);
          await notify(tx, { userIds: staff, companyId: r.company_id, type: 'attendance.missing_clock_out', msg: { key: 'att.out', vars: { name: r.full_name } }, data: { sessionId: r.id, companyId: r.company_id }, dedupeKey: `missing-out:${r.id}` }, s.emit);
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
          await notify(tx, { userIds: [r.user_id], companyId: r.company_id, type: 'shift.reminder', msg: { key: 'shift.reminder', vars: { site: r.site_name } }, data: { shiftId: r.id, companyId: r.company_id }, dedupeKey: `reminder:${r.id}` }, s.emit);
        }
        return rows.length;
      });
    },
  },
  {
    // Escalation: still not clocked in 60 minutes after the shift started.
    name: 'no_shows',
    everyMs: 5 * 60_000,
    async run(s) {
      return s.db.asSystem(async (tx) => {
        const { rows } = await tx.query(
          `select s.id as shift_id, s.company_id, s.site_id, js.name as site_name, sa.membership_id, p.full_name
             from app.shifts s join app.shift_assignments sa on sa.shift_id = s.id join app.memberships m on m.id = sa.membership_id and m.status = 'active'
             join app.profiles p on p.user_id = m.user_id join app.job_sites js on js.id = s.site_id join app.companies c on c.id = s.company_id and c.status = 'active'
            where s.status = 'scheduled' and s.starts_at < now() - interval '60 minutes' and s.starts_at > now() - interval '12 hours'
              and not exists (select 1 from app.time_events te where te.membership_id = sa.membership_id and te.type = 'clock_in'
                              and te.occurred_at between s.starts_at - interval '2 hours' and s.ends_at)
              and not exists (select 1 from app.time_off_requests t where t.membership_id = sa.membership_id and t.status = 'approved'
                              and (s.starts_at at time zone c.timezone)::date between t.starts_on and t.ends_on)`,
        );
        for (const r of rows) {
          const staff = await staffUserIds(tx, r.company_id, ['owner', 'admin', 'manager', 'supervisor'], r.site_id);
          await notify(tx, { userIds: staff, companyId: r.company_id, type: 'attendance.no_show', msg: { key: 'att.no_show', vars: { name: r.full_name, site: r.site_name } }, data: { shiftId: r.shift_id, membershipId: r.membership_id, companyId: r.company_id },
            dedupeKey: `noshow:${r.shift_id}:${r.membership_id}`, email: true }, s.emit);
        }
        return rows.length;
      });
    },
  },
  {
    // Weekly overtime watch: tell managers BEFORE someone goes into overtime (worked + still scheduled this week).
    name: 'overtime_watch',
    everyMs: 30 * 60_000,
    async run(s) {
      return s.db.asSystem(async (tx) => {
        const { rows } = await tx.query(
          `with c as (
             select c.id, c.timezone, ps.work_week_start_dow as dow, ps.weekly_threshold_minutes as thr
               from app.companies c join app.payroll_settings ps on ps.company_id = c.id
              where c.status = 'active' and ps.weekly_overtime_enabled and not ps.averaging_enabled),
           w as (select c.*, (now() at time zone c.timezone)::date - ((extract(dow from (now() at time zone c.timezone))::int - c.dow + 7) % 7) as week_start from c),
           worked as (
             select w.id as company_id, e.membership_id,
                    sum(greatest(0, extract(epoch from (coalesce(e.effective_end, now()) - e.effective_start)) / 60 - e.effective_break_minutes)) as mins
               from w join app.work_sessions_effective e on e.company_id = w.id
              where (e.effective_start at time zone w.timezone)::date >= w.week_start and e.approval_status <> 'rejected'
              group by 1, 2),
           sched as (
             select w.id as company_id, sa.membership_id,
                    sum(greatest(0, extract(epoch from (s.ends_at - greatest(s.starts_at, now()))) / 60 - case when s.starts_at > now() then s.break_minutes else 0 end)) as mins
               from w join app.shifts s on s.company_id = w.id and s.status = 'scheduled' and s.ends_at > now()
                    and (s.starts_at at time zone w.timezone)::date < w.week_start + 7
               join app.shift_assignments sa on sa.shift_id = s.id
              where not exists (select 1 from app.work_sessions ws where ws.membership_id = sa.membership_id and ws.shift_id = s.id)
              group by 1, 2)
           select w.id as company_id, w.week_start, w.thr, m.id as membership_id, p.full_name,
                  coalesce(wk.mins, 0)::int as worked, coalesce(sc.mins, 0)::int as scheduled
             from w join app.memberships m on m.company_id = w.id and m.status = 'active' and not m.overtime_exempt
             join app.profiles p on p.user_id = m.user_id
             left join worked wk on wk.company_id = w.id and wk.membership_id = m.id
             left join sched sc on sc.company_id = w.id and sc.membership_id = m.id
            where coalesce(wk.mins, 0) + coalesce(sc.mins, 0) > w.thr`,
        );
        const h = (m: number) => (m / 60).toFixed(1);
        for (const r of rows) {
          const staff = await staffUserIds(tx, r.company_id, ['owner', 'admin', 'manager', 'supervisor', 'payroll']);
          const reached = r.worked > r.thr;
          await notify(tx, {
            userIds: staff, companyId: r.company_id, type: 'overtime.watch',
            msg: { key: reached ? 'ot.reached' : 'ot.projected', vars: { name: r.full_name, worked: h(r.worked), scheduled: h(r.scheduled), limit: h(r.thr) } },
            data: { membershipId: r.membership_id, companyId: r.company_id, weekStart: r.week_start },
            dedupeKey: `ot:${r.membership_id}:${r.week_start}:${reached ? 'reached' : 'projected'}`,
          }, s.emit);
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
          returning n.id, n.type, n.title, n.body, p.email, p.locale`)).rows);
      for (const r of rows) {
        const res = await s.mailer.send({ to: r.email, ...templates.attendanceAlert({ title: r.title, body: r.body, url: s.config.APP_URL, locale: normalizeLocale(r.locale) }), tag: r.type }).catch(() => ({ delivered: false }));
        if (!res.delivered) await s.db.asSystem((tx) => tx.query(`update app.notifications set email_status = 'failed' where id = $1`, [r.id]));
      }
      return rows.length;
    },
  },
];

export function startScheduler(s: Services, log: { error: (o: object, m: string) => void }) {
  const timers: NodeJS.Timeout[] = [];
  jobs.forEach((job) => {
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
        const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [lockId(job.name)]);
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
          await client.query('select pg_advisory_unlock($1)', [lockId(job.name)]);
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
