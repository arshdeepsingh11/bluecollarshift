-- LOCAL TESTING ONLY. Reproduces the parts of Supabase that our migrations depend on
-- (auth schema, auth.users, auth.uid(), standard roles). NEVER run against a real Supabase project.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    raise exception 'auth schema already exists — refusing to run emulation (is this a real Supabase database?)';
  end if;
end $$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase grants new public tables to API roles by default; reproduce that so tests catch leaks.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
