-- =====================================================================================
-- Blue Collar migration 0100 — quarantine the legacy (pre-rebuild) schema.
--
-- The previous app stored everything in `public` and let browsers write directly to the
-- tables. All existing data is TEST data (owner confirmed 2026-11-25). Nothing is deleted:
-- legacy tables, functions and their RLS policies are MOVED into schema `legacy` and API
-- access to them is revoked. They can be dropped later with an explicit, separate migration.
--
-- Rollback: see supabase/ROLLBACK.md (moves objects back to `public`).
-- =====================================================================================

create schema if not exists legacy;
revoke all on schema legacy from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema legacy from anon, authenticated';
  end if;
end $$;

do $$
declare
  t text;
  f record;
  legacy_tables text[] := array[
    'audit_log', 'notifications', 'pay_summary_items', 'pay_periods', 'shifts', 'sites',
    'employee_invites', 'security_questions', 'employees', 'employers', 'users'
  ];
begin
  foreach t in array legacy_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I set schema legacy', t);
      raise notice 'moved table public.% -> legacy.%', t, t;
    end if;
  end loop;

  -- Legacy helper / RPC functions (any signature).
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auth_role', 'auth_employer_id', 'auth_employee_id', 'get_invite_by_code',
                        'hash_security_answer', 'get_security_questions_by_email',
                        'verify_single_security_answer')
  loop
    execute format('alter function %s set schema legacy', f.sig);
    raise notice 'moved function % -> legacy', f.proname;
  end loop;

  -- Legacy enum types.
  for t in select unnest(array['user_role', 'pay_frequency', 'pay_method', 'shift_status']) loop
    if exists (select 1 from pg_type ty join pg_namespace n on n.oid = ty.typnamespace
               where n.nspname = 'public' and ty.typname = t) then
      execute format('alter type public.%I set schema legacy', t);
    end if;
  end loop;
end $$;

-- No API role may read or write legacy data.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'legacy' and c.relkind in ('r', 'v', 'm', 'S') loop
    execute format('revoke all on legacy.%I from public', r.relname);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on legacy.%I from anon, authenticated', r.relname);
    end if;
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'legacy' loop
    execute format('revoke all on function %s from public', r.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', r.sig);
    end if;
  end loop;
end $$;
