# Rollback notes (one per migration)

Tested 2026-11-25 on a scratch Postgres 16 database (all four blocks, newest first): legacy tables, functions and enum types returned to `public`.
Note: roles are cluster-wide; on a server with other databases using them, `drop role` fails until those are cleaned too (Supabase has one database, so this does not apply there).

Always prefer restoring the backup taken before applying (Step 2 of `README.md`).
Manual rollback, newest first:

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
