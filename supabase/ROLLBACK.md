# Rollback notes (one per migration)

Tested 2026-11-27 on a scratch Postgres 16 database (0500 block); 2026-11-25 (0100–0400 blocks, newest first): legacy tables, functions and enum types returned to `public`.
Note: roles are cluster-wide; on a server with other databases using them, `drop role` fails until those are cleaned too (Supabase has one database, so this does not apply there).

Always prefer restoring the backup taken before applying (Step 2 of `README.md`).
Manual rollback, newest first:

## 20261127000500_release_a.sql
Removes Release A (crew clock-in, shift requests, time off, availability, safety, feedback, company policy, currency).
**Data in the new tables is deleted** (requests, time off, safety reports, toolbox talks, feedback). Export them first if they matter.
Existing companies, people, shifts, clock events, timesheets and payroll are kept.
The clock-out fix (no error when a session has no flags) is deliberately kept.
```sql
begin;
drop table if exists app.toolbox_talk_attendees, app.toolbox_talks, app.safety_reports, app.feedback,
  app.availability, app.time_off_requests, app.shift_requests;
drop function if exists app.my_led_talks(), app.my_attended_talks();
alter table app.time_events drop constraint if exists time_events_crew_check;
alter table app.time_events drop constraint if exists time_events_recorded_by_fk;
alter table app.time_events drop column if exists entry_method, drop column if exists recorded_by_membership_id;
drop index if exists app.shifts_open_idx;
alter table app.shifts drop column if exists open_slots;
create or replace function app.tg_shift_version() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if row(new.site_id, new.starts_at, new.ends_at, new.break_minutes, new.instructions, new.status)
     is distinct from row(old.site_id, old.starts_at, old.ends_at, old.break_minutes, old.instructions, old.status) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
alter table app.memberships drop column if exists payroll_id, drop column if exists crew_lead;
alter table app.invitations drop column if exists locale;
alter table app.companies drop column if exists currency, drop column if exists country;
alter table app.payroll_settings drop constraint if exists payroll_settings_bounds;
alter table app.payroll_settings drop constraint if exists payroll_settings_rule_profile_check;
alter table app.payroll_settings drop column if exists daily_overtime_enabled, drop column if exists weekly_overtime_enabled,
  drop column if exists adp_company_code;
update app.payroll_settings set rule_profile = 'AB_STANDARD';
alter table app.payroll_settings alter column rule_profile set default 'AB_STANDARD';
alter table app.payroll_settings add constraint payroll_settings_rule_profile_check check (rule_profile in ('AB_STANDARD'));
-- NOT VALID: companies that chose a policy outside the old Alberta range keep working; new edits are checked.
alter table app.payroll_settings add constraint payroll_settings_ab_minimums check (
  rule_profile <> 'AB_STANDARD' or (daily_threshold_minutes between 60 and 480 and weekly_threshold_minutes between 60 and 2640
  and overtime_multiplier >= 1.5 and overtime_multiplier <= 5)) not valid;
commit;
-- Storage: files stay in the private "uploads" bucket. Delete them in Supabase > Storage if wanted.
```
Then deploy the previous API and web versions (they do not know the new columns).

## 20261125000400_rls_and_grants.sql
```sql
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'app' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop; end $$;
revoke all on all tables in schema app from app_user, app_system;
```
Effect: API stops working (expected). No data lost.

## 20261125000300_functions_triggers.sql
```sql
drop view if exists app.work_sessions_effective;
-- drop triggers and functions in schema app:
do $$ declare r record; begin
  for r in select event_object_schema s, event_object_table t, trigger_name n from information_schema.triggers where event_object_schema = 'app' loop
    execute format('drop trigger if exists %I on %I.%I', r.n, r.s, r.t);
  end loop; end $$;
drop function if exists app.uid() cascade;  -- repeat for app.* functions or use: drop schema app cascade (next step)
```

## 20261125000200_core_schema.sql
```sql
drop schema app cascade;          -- removes ALL new tables and their data
drop owned by bc_api, app_user, app_system;   -- removes remaining grants in this database
drop role if exists bc_api; drop role if exists app_user; drop role if exists app_system;
```
**Destroys data created by the new app.** Only on dev, only after export.

## 20261125000100_quarantine_legacy.sql
Moves objects back to `public` (data untouched):
```sql
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'legacy' loop
    execute format('alter table legacy.%I set schema public', r.tablename);
  end loop;
  for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'legacy' loop
    execute format('alter function %s set schema public', r.sig);
  end loop;
  for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'legacy' and t.typtype = 'e' loop
    execute format('alter type legacy.%I set schema public', r.typname);
  end loop; end $$;
-- then re-apply original grants from supabase/rls_policies.sql
```
