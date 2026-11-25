\pset pager off
select m.user_id as mgr_user, m.company_id as cid from app.memberships m join app.companies c on c.id = m.company_id where m.role = 'manager' and c.name = 'Perf Company 200' \gset
select m.id as emp_mem, m.user_id as emp_user from app.memberships m where m.company_id = :'cid' and m.role = 'employee' limit 1 \gset
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr_user')::text, true);
set local role app_user;
\echo '=== Q1 timesheets: one company, one week (manager, RLS on)'
explain (analyze, buffers off, costs off, summary on)
select e.id, p.full_name, e.effective_start, e.effective_end from app.work_sessions_effective e
  join app.memberships m on m.id = e.membership_id join app.profiles p on p.user_id = m.user_id
 where e.company_id = :'cid' and (e.effective_start at time zone 'America/Edmonton')::date between current_date - 7 and current_date
 order by e.effective_start desc limit 1000;
\echo '=== Q2 live board: open sessions'
explain (analyze, costs off, summary on)
select ws.id from app.work_sessions ws where ws.company_id = :'cid' and ws.status = 'open';
\echo '=== Q3 pending approvals count'
explain (analyze, costs off, summary on)
select count(*) from app.work_sessions where company_id = :'cid' and status <> 'open' and approval_status = 'pending';
rollback;
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'emp_user')::text, true);
set local role app_user;
\echo '=== Q4 employee: own last event + own sessions last 8 days'
explain (analyze, costs off, summary on)
select type, occurred_at from app.time_events where membership_id = :'emp_mem' order by occurred_at desc limit 1;
explain (analyze, costs off, summary on)
select sum(extract(epoch from (coalesce(effective_end, now()) - effective_start))) from app.work_sessions_effective where membership_id = :'emp_mem' and effective_start > now() - interval '8 days';
rollback;
