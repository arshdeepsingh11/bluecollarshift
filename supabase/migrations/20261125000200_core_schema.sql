-- =====================================================================================
-- Blue Collar migration 0200 — core schema.
--
-- Design principles (see Database.md):
--  * All business tables live in schema `app`, which is NOT exposed through the Supabase
--    Data API (PostgREST). Browsers and the mobile app cannot reach tables directly; every
--    read/write goes through the Node.js API.
--  * The API connects as login role `bc_api` and switches per request to:
--      - app_user   : row-level security applies, as the signed-in user (defence in depth)
--      - app_system : trusted server operations (registration, jobs, platform admin)
--  * Every company-owned row carries company_id; composite foreign keys guarantee that
--    related rows belong to the SAME company (tenant integrity enforced by the database).
--  * Original attendance events are immutable. Corrections are separate adjustment rows.
-- =====================================================================================

-- ---------- Roles ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_system') then create role app_system nologin; end if;
  -- Login role used by the API server. Password is set manually per environment (Deployment.md):
  --   alter role bc_api with password '<generated 32+ char secret>';
  if not exists (select 1 from pg_roles where rolname = 'bc_api') then create role bc_api login noinherit; end if;
end $$;
grant app_user, app_system to bc_api;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to app_user, app_system;

-- ---------- Companies & identity ----------
create table app.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  phone text check (phone is null or char_length(phone) <= 32),
  address text check (address is null or char_length(address) <= 300),
  timezone text not null default 'America/Edmonton' check (char_length(timezone) <= 64),
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  locale text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- "Sign out everywhere": any session first seen before this instant is rejected by the API.
  sessions_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on app.profiles (email);

-- Supabase keeps session_id stable across token refreshes, so revoking by session survives refresh.
create table app.user_sessions (
  session_id uuid primary key,
  user_id uuid not null references app.profiles (user_id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  aal text not null default 'aal1',
  ip inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  revoked_at timestamptz,
  revoked_by uuid references app.profiles (user_id)
);
create index user_sessions_user_idx on app.user_sessions (user_id, last_seen_at desc);

create table app.platform_staff (
  user_id uuid primary key references app.profiles (user_id) on delete cascade,
  role text not null check (role in ('super_admin', 'platform_admin', 'support', 'operations', 'billing', 'auditor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  invited_by uuid references app.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete restrict,
  user_id uuid not null references app.profiles (user_id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'manager', 'supervisor', 'payroll', 'employee')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  job_title text check (job_title is null or char_length(job_title) <= 80),
  overtime_exempt boolean not null default false,
  extra_permissions text[] not null default '{}',
  revoked_permissions text[] not null default '{}',
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id),
  unique (id, company_id)
);
create index memberships_user_idx on app.memberships (user_id) where status = 'active';
create index memberships_company_idx on app.memberships (company_id, status, role);

create table app.job_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  address text check (address is null or char_length(address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geofence_radius_m integer check (geofence_radius_m between 25 and 5000),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (id, company_id)
);
create index job_sites_company_idx on app.job_sites (company_id, status);

create table app.membership_sites (
  membership_id uuid not null,
  site_id uuid not null,
  company_id uuid not null,
  primary key (membership_id, site_id),
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete cascade,
  foreign key (site_id, company_id) references app.job_sites (id, company_id) on delete cascade
);
create index membership_sites_site_idx on app.membership_sites (site_id);

create table app.pay_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  membership_id uuid not null,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0 and hourly_rate_cents <= 1000000),
  effective_from date not null,
  created_by uuid references app.profiles (user_id),
  created_at timestamptz not null default now(),
  unique (membership_id, effective_from),
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete restrict
);

create table app.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  role text not null check (role in ('admin', 'manager', 'supervisor', 'payroll', 'employee')),
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents > 0),
  site_ids uuid[] not null default '{}',
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references app.profiles (user_id),
  revoked_at timestamptz,
  invited_by uuid not null references app.profiles (user_id),
  created_at timestamptz not null default now()
);
create unique index invitations_open_email_idx on app.invitations (company_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------- Scheduling ----------
create table app.shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  site_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 240),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  series_id uuid,
  version integer not null default 1,
  created_by uuid references app.profiles (user_id),
  updated_by uuid references app.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  foreign key (site_id, company_id) references app.job_sites (id, company_id) on delete restrict,
  unique (id, company_id)
);
create index shifts_company_time_idx on app.shifts (company_id, starts_at);
create index shifts_site_time_idx on app.shifts (site_id, starts_at);

create table app.shift_assignments (
  shift_id uuid not null,
  membership_id uuid not null,
  company_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (shift_id, membership_id),
  foreign key (shift_id, company_id) references app.shifts (id, company_id) on delete cascade,
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete restrict
);
create index shift_assignments_member_idx on app.shift_assignments (membership_id, shift_id);

-- ---------- Attendance ----------
create table app.work_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  membership_id uuid not null,
  shift_id uuid,
  site_id uuid,
  original_start timestamptz not null,
  original_end timestamptz,
  original_break_minutes integer not null default 0 check (original_break_minutes >= 0),
  break_started_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'needs_review')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by uuid references app.profiles (user_id),
  approved_at timestamptz,
  approval_note text check (approval_note is null or char_length(approval_note) <= 1000),
  flags text[] not null default '{}',
  current_adjustment_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (original_end is null or original_end >= original_start),
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete restrict,
  foreign key (shift_id, company_id) references app.shifts (id, company_id) on delete set null (shift_id),
  foreign key (site_id, company_id) references app.job_sites (id, company_id) on delete set null (site_id),
  unique (id, company_id)
);
-- One open session per employee (prevents duplicate clock-ins under concurrency).
create unique index work_sessions_one_open_idx on app.work_sessions (membership_id) where status = 'open';
create index work_sessions_member_time_idx on app.work_sessions (membership_id, original_start);
create index work_sessions_company_time_idx on app.work_sessions (company_id, original_start);
create index work_sessions_review_idx on app.work_sessions (company_id, approval_status, status);

create table app.time_events (
  id uuid primary key, -- generated on the device: idempotency key for offline sync
  company_id uuid not null,
  membership_id uuid not null,
  shift_id uuid,
  session_id uuid,
  type text not null check (type in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  occurred_at timestamptz not null,
  device_time timestamptz not null,
  server_received_at timestamptz not null default now(),
  source text not null check (source in ('online', 'offline')),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  device_id text not null check (char_length(device_id) between 4 and 128),
  distance_from_site_m integer,
  flags text[] not null default '{}',
  review_status text not null default 'accepted' check (review_status in ('accepted', 'needs_review')),
  created_by uuid not null references app.profiles (user_id),
  check ((lat is null) = (lng is null)),
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete restrict,
  foreign key (shift_id, company_id) references app.shifts (id, company_id),
  foreign key (session_id, company_id) references app.work_sessions (id, company_id)
);
create index time_events_member_time_idx on app.time_events (membership_id, occurred_at);
create index time_events_session_idx on app.time_events (session_id);
create index time_events_company_received_idx on app.time_events (company_id, server_received_at);

create table app.adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null,
  adjusted_start timestamptz not null,
  adjusted_end timestamptz not null,
  adjusted_break_minutes integer not null default 0 check (adjusted_break_minutes between 0 and 600),
  reason text not null check (char_length(reason) between 5 and 1000),
  created_by uuid not null references app.profiles (user_id),
  after_payment boolean not null default false,
  created_at timestamptz not null default now(),
  check (adjusted_end > adjusted_start),
  foreign key (session_id, company_id) references app.work_sessions (id, company_id) on delete restrict
);
create index adjustments_session_idx on app.adjustments (session_id, created_at);
alter table app.work_sessions
  add constraint work_sessions_current_adjustment_fk foreign key (current_adjustment_id) references app.adjustments (id);

create table app.disputes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null,
  adjustment_id uuid references app.adjustments (id),
  raised_by_membership_id uuid not null,
  explanation text not null check (char_length(explanation) between 5 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references app.profiles (user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (session_id, company_id) references app.work_sessions (id, company_id) on delete restrict,
  foreign key (raised_by_membership_id, company_id) references app.memberships (id, company_id)
);
create index disputes_company_status_idx on app.disputes (company_id, status);
create index disputes_session_idx on app.disputes (session_id);

-- ---------- Payroll ----------
create table app.payroll_settings (
  company_id uuid primary key references app.companies (id) on delete cascade,
  rule_profile text not null default 'AB_STANDARD' check (rule_profile in ('AB_STANDARD')),
  work_week_start_dow smallint not null default 0 check (work_week_start_dow between 0 and 6),
  daily_threshold_minutes integer not null default 480,
  weekly_threshold_minutes integer not null default 2640,
  overtime_multiplier numeric(4, 2) not null default 1.50,
  paid_breaks boolean not null default false,
  averaging_enabled boolean not null default false,
  averaging_weeks smallint check (averaging_weeks between 1 and 52),
  averaging_anchor date,
  overtime_banking boolean not null default false,
  pay_frequency text not null default 'biweekly' check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  pay_period_anchor date not null default date '2027-01-03',
  updated_by uuid references app.profiles (user_id),
  updated_at timestamptz not null default now(),
  -- Legal minimums for Alberta enforced by the database as a second layer (Rules.md, Rule 2).
  constraint payroll_settings_ab_minimums check (
    rule_profile <> 'AB_STANDARD' or (
      daily_threshold_minutes between 60 and 480
      and weekly_threshold_minutes between 60 and 2640
      and overtime_multiplier >= 1.5 and overtime_multiplier <= 5
    )
  ),
  check (not averaging_enabled or (averaging_weeks is not null and averaging_anchor is not null))
);

create table app.pay_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  pay_date date not null,
  status text not null default 'open' check (status in ('open', 'calculated', 'approved', 'paid')),
  calculated_at timestamptz,
  approved_by uuid references app.profiles (user_id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_by uuid references app.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 31),
  unique (company_id, starts_on),
  unique (id, company_id)
);

create table app.payroll_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pay_period_id uuid not null,
  membership_id uuid not null,
  regular_minutes integer not null check (regular_minutes >= 0),
  overtime_minutes integer not null check (overtime_minutes >= 0),
  hourly_rate_cents integer not null check (hourly_rate_cents >= 0),
  overtime_multiplier numeric(4, 2) not null,
  gross_regular_cents bigint not null,
  gross_overtime_cents bigint not null,
  gross_total_cents bigint not null check (gross_total_cents = gross_regular_cents + gross_overtime_cents),
  trace jsonb not null,
  engine_version text not null,
  pending_sessions integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pay_period_id, membership_id),
  foreign key (pay_period_id, company_id) references app.pay_periods (id, company_id) on delete restrict,
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete restrict
);
create index payroll_records_member_idx on app.payroll_records (membership_id, created_at desc);

-- ---------- Messaging ----------
create table app.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete restrict,
  kind text not null check (kind in ('direct', 'group', 'announcement')),
  title text check (title is null or char_length(title) <= 120),
  direct_key text, -- "<membershipA>:<membershipB>" sorted, makes direct chats unique
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (id, company_id),
  unique (company_id, direct_key),
  foreign key (created_by_membership_id, company_id) references app.memberships (id, company_id)
);
create index conversations_company_last_idx on app.conversations (company_id, last_message_at desc nulls last);

create table app.conversation_members (
  conversation_id uuid not null,
  membership_id uuid not null,
  company_id uuid not null,
  can_post boolean not null default true,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, membership_id),
  foreign key (conversation_id, company_id) references app.conversations (id, company_id) on delete cascade,
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete cascade
);
create index conversation_members_member_idx on app.conversation_members (membership_id);

create table app.messages (
  id uuid primary key, -- client-generated: idempotent offline retries
  company_id uuid not null,
  conversation_id uuid not null,
  sender_membership_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  client_created_at timestamptz,
  -- v2: attachments go in app.message_attachments(message_id, storage_key, mime, size, scan_status)
  foreign key (conversation_id, company_id) references app.conversations (id, company_id) on delete restrict,
  foreign key (sender_membership_id, company_id) references app.memberships (id, company_id)
);
create index messages_conversation_time_idx on app.messages (conversation_id, created_at desc);

-- ---------- Notifications ----------
create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (user_id) on delete cascade,
  company_id uuid references app.companies (id) on delete cascade,
  type text not null check (char_length(type) <= 64),
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 1000),
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  push_status text not null default 'pending' check (push_status in ('pending', 'sent', 'failed', 'skipped')),
  push_attempts smallint not null default 0,
  email_status text not null default 'skipped' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on app.notifications (user_id, created_at desc);
create index notifications_push_pending_idx on app.notifications (created_at) where push_status = 'pending';

create table app.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (user_id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index device_tokens_user_idx on app.device_tokens (user_id) where disabled_at is null;

-- ---------- Audit, security, operations ----------
create table app.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'platform', 'system')),
  action text not null check (char_length(action) <= 100),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  request_id text,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on app.audit_logs (company_id, created_at desc);
create index audit_logs_actor_idx on app.audit_logs (actor_user_id, created_at desc);
create index audit_logs_target_idx on app.audit_logs (target_type, target_id);

create table app.security_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  type text not null check (char_length(type) <= 64),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  ip inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_time_idx on app.security_events (created_at desc);
create index security_events_type_idx on app.security_events (type, created_at desc);

create table app.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references app.companies (id) on delete cascade,
  staff_user_id uuid not null references app.platform_staff (user_id),
  reason text not null check (char_length(reason) between 10 and 500),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_access_active_idx on app.support_access_grants (staff_user_id, company_id, expires_at);

create table app.job_runs (
  job text not null,
  run_key text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  primary key (job, run_key)
);

create table app.platform_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  updated_by uuid references app.profiles (user_id),
  updated_at timestamptz not null default now()
);
