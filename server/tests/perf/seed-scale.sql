-- PERFORMANCE BENCHMARK DATA ONLY (local). Creates ~400 companies, ~10k employees and
-- ~60 days of attendance (~480k sessions, ~960k events). Triggers are bypassed for speed.
set session_replication_role = replica;
insert into auth.users (id, email)
select gen_random_uuid(), 'perf' || g || '@perf.test' from generate_series(1, 10400) g;
insert into app.profiles (user_id, email, full_name)
select id, email, 'Perf ' || split_part(email, '@', 1) from auth.users where email like 'perf%';

insert into app.companies (id, name)
select gen_random_uuid(), 'Perf Company ' || g from generate_series(1, 400) g;
insert into app.payroll_settings (company_id) select id from app.companies where name like 'Perf Company %';

with c as (select id, row_number() over (order by name) rn from app.companies where name like 'Perf Company %'),
     u as (select user_id, row_number() over (order by email) rn from app.profiles where email like 'perf%')
insert into app.memberships (company_id, user_id, role)
select c.id, u.user_id, case when (u.rn - 1) % 26 = 0 then 'owner' when (u.rn - 1) % 26 = 1 then 'manager' else 'employee' end
from u join c on c.rn = ((u.rn - 1) / 26) + 1;

insert into app.job_sites (company_id, name, lat, lng, geofence_radius_m)
select c.id, 'Site ' || s, 51 + random(), -114 + random(), 200 from app.companies c, generate_series(1, 5) s where c.name like 'Perf Company %';

-- 60 days of shifts per employee (weekdays), one session each.
insert into app.work_sessions (company_id, membership_id, site_id, original_start, original_end, original_break_minutes, status, approval_status)
select m.company_id, m.id, (select id from app.job_sites js where js.company_id = m.company_id limit 1),
       d + time '15:00' + (random() * interval '20 minutes'), d + time '23:30' + (random() * interval '40 minutes'), 30, 'closed',
       case when random() < 0.8 then 'approved' else 'pending' end
from app.memberships m, generate_series(current_date - 60, current_date - 1, interval '1 day') d
where m.role = 'employee' and extract(isodow from d) < 6 and m.company_id in (select id from app.companies where name like 'Perf Company %');

insert into app.time_events (id, company_id, membership_id, session_id, type, occurred_at, device_time, source, device_id, created_by, lat, lng)
select gen_random_uuid(), ws.company_id, ws.membership_id, ws.id, t.type, t.at, t.at, 'online', 'perf-device', m.user_id, 51.1, -114.1
from app.work_sessions ws join app.memberships m on m.id = ws.membership_id
cross join lateral (values ('clock_in', ws.original_start), ('clock_out', ws.original_end)) t(type, at)
where ws.company_id in (select id from app.companies where name like 'Perf Company %');
set session_replication_role = origin;
analyze;
select (select count(*) from app.companies) companies, (select count(*) from app.memberships) memberships,
       (select count(*) from app.work_sessions) sessions, (select count(*) from app.time_events) events;
