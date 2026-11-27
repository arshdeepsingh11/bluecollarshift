-- =====================================================================================
-- Blue Collar migration 0500 — Release A.
--
--  1. Company-defined overtime (no province rules), currency, external payroll ids.
--  2. Crew clock-in (a lead records attendance for crew members).
--  3. Open shifts, shift pickup / drop / swap requests.
--  4. Time-off requests and weekly availability.
--  5. Safety: incident / near-miss / hazard reports, toolbox talks with sign-offs.
--  6. Product feedback (text, voice note, screenshot) for the platform team.
--  7. Private storage bucket for voice notes, screenshots and safety photos.
--
-- Additive only: no table or row is deleted. Rollback: supabase/ROLLBACK.md, section 0500.
-- =====================================================================================

-- ---------- 1. Company policy instead of province rules ----------
alter table app.payroll_settings drop constraint if exists payroll_settings_ab_minimums;
alter table app.payroll_settings drop constraint if exists payroll_settings_rule_profile_check;
update app.payroll_settings set rule_profile = 'COMPANY_POLICY' where rule_profile <> 'COMPANY_POLICY';
alter table app.payroll_settings alter column rule_profile set default 'COMPANY_POLICY';
alter table app.payroll_settings add constraint payroll_settings_rule_profile_check check (rule_profile in ('COMPANY_POLICY'));
alter table app.payroll_settings
  add column if not exists daily_overtime_enabled boolean not null default true,
  add column if not exists weekly_overtime_enabled boolean not null default true,
  add column if not exists adp_company_code text check (adp_company_code is null or adp_company_code ~ '^[A-Za-z0-9]{2,3}$');
-- Sanity bounds only (the company decides its own policy).
alter table app.payroll_settings add constraint payroll_settings_bounds check (
  daily_threshold_minutes between 60 and 1440
  and weekly_threshold_minutes between 60 and 10080
  and overtime_multiplier >= 1 and overtime_multiplier <= 5);

alter table app.companies
  add column if not exists currency text not null default 'CAD' check (currency in ('CAD', 'USD', 'MXN')),
  add column if not exists country text not null default 'CA' check (country in ('CA', 'US', 'MX'));
grant update (currency, country) on app.companies to app_user;

-- Employee number in the company's payroll provider (ADP "File #", etc.).
alter table app.memberships
  add column if not exists payroll_id text check (payroll_id is null or char_length(payroll_id) between 1 and 32),
  -- A crew lead may clock crew members in and out (an employee-level privilege, set by managers).
  add column if not exists crew_lead boolean not null default false;

-- ---------- Fix: a clock-out with no flags at all must not fail ----------
-- array_agg() over an empty set is NULL; work_sessions.flags is NOT NULL. Same function as 0300 with coalesce().
create or replace function app.tg_time_event_apply() returns trigger
language plpgsql security definer
set search_path = app, pg_catalog
as $$
declare
  m app.memberships%rowtype;
  s app.work_sessions%rowtype;
  v_site app.job_sites%rowtype;
  v_flags text[] := '{}';
  v_review text[] := array['outside_geofence', 'out_of_order', 'duplicate_clock_in', 'no_open_session',
                           'device_clock_skew', 'session_already_approved', 'break_not_started',
                           'not_assigned_to_shift'];
  v_session_id uuid;
  v_site_id uuid;
begin
  select * into m from app.memberships where id = new.membership_id for update;
  if not found or m.status <> 'active' then
    raise exception 'Membership is not active' using errcode = 'P0002';
  end if;
  new.company_id := m.company_id;
  new.server_received_at := now();

  -- Server time is authoritative online; offline events keep device time but are bounded and flagged.
  if new.source = 'online' then
    new.occurred_at := new.server_received_at;
    if abs(extract(epoch from (new.device_time - new.server_received_at))) > 300 then
      v_flags := array_append(v_flags, 'device_clock_skew');
    end if;
  else
    new.occurred_at := new.device_time;
    v_flags := array_append(v_flags, 'offline_device_time');
    if new.device_time > new.server_received_at + interval '2 minutes' then
      raise exception 'Offline event is in the future' using errcode = 'P0003';
    end if;
    if new.device_time < new.server_received_at - interval '14 days' then
      raise exception 'Offline event is older than 14 days' using errcode = 'P0003';
    end if;
  end if;

  -- Shift must be one the employee is assigned to.
  if new.shift_id is not null then
    if not exists (select 1 from app.shift_assignments
                   where shift_id = new.shift_id and membership_id = new.membership_id) then
      v_flags := array_append(v_flags, 'not_assigned_to_shift');
      new.shift_id := null;
    else
      select js.* into v_site from app.shifts sh join app.job_sites js on js.id = sh.site_id where sh.id = new.shift_id;
      v_site_id := v_site.id;
    end if;
  end if;

  -- Location checks (GPS can be inaccurate: flags for review, never automatic rejection).
  if new.lat is null then
    v_flags := array_append(v_flags, 'no_location');
  else
    if new.accuracy_m is not null and new.accuracy_m > 150 then v_flags := array_append(v_flags, 'low_location_accuracy'); end if;
    if v_site.id is not null and v_site.lat is not null then
      new.distance_from_site_m := app.distance_m(new.lat, new.lng, v_site.lat, v_site.lng);
      if v_site.geofence_radius_m is not null
         and new.distance_from_site_m > v_site.geofence_radius_m + coalesce(new.accuracy_m, 0) then
        v_flags := array_append(v_flags, 'outside_geofence');
      end if;
    end if;
  end if;

  select * into s from app.work_sessions where membership_id = new.membership_id and status = 'open' for update;

  if new.type = 'clock_in' then
    if s.id is not null then
      v_flags := array_append(v_flags, 'duplicate_clock_in');
      new.session_id := s.id;
    elsif exists (select 1 from app.work_sessions ws
                  where ws.membership_id = new.membership_id
                    and ws.original_start <= new.occurred_at
                    and ws.original_end > new.occurred_at) then
      -- A late-arriving offline clock-in that falls inside an existing session.
      v_flags := array_append(v_flags, 'out_of_order');
    else
      insert into app.work_sessions (company_id, membership_id, shift_id, site_id, original_start, flags)
      values (m.company_id, m.id, new.shift_id, v_site_id, new.occurred_at, v_flags)
      returning id into v_session_id;
      new.session_id := v_session_id;
    end if;

  elsif new.type = 'clock_out' then
    if s.id is null then
      v_flags := array_append(v_flags, 'no_open_session');
    elsif new.occurred_at < s.original_start then
      v_flags := array_append(v_flags, 'out_of_order');
      new.session_id := s.id;
    else
      new.session_id := s.id;
      update app.work_sessions set
        original_end = new.occurred_at,
        original_break_minutes = original_break_minutes + case when break_started_at is null then 0
                                   else greatest(0, floor(extract(epoch from (new.occurred_at - break_started_at)) / 60))::int end,
        break_started_at = null,
        flags = (select coalesce(array_agg(distinct f), '{}') from unnest(s.flags || v_flags) f),
        status = case when (s.flags || v_flags) && v_review then 'needs_review' else 'closed' end,
        version = version + 1
      where id = s.id;
    end if;

  elsif new.type = 'break_start' then
    if s.id is null then
      v_flags := array_append(v_flags, 'no_open_session');
    else
      new.session_id := s.id;
      if s.break_started_at is null then
        update app.work_sessions set break_started_at = new.occurred_at, version = version + 1 where id = s.id;
      end if;
    end if;

  elsif new.type = 'break_end' then
    if s.id is null or s.break_started_at is null then
      v_flags := array_append(v_flags, 'break_not_started');
      new.session_id := s.id;
    else
      new.session_id := s.id;
      update app.work_sessions set
        original_break_minutes = original_break_minutes
          + greatest(0, floor(extract(epoch from (new.occurred_at - break_started_at)) / 60))::int,
        break_started_at = null,
        version = version + 1
      where id = s.id;
    end if;
  end if;

  -- Record flags raised by a clock-in on its session too (e.g. outside geofence at start).
  if new.type <> 'clock_out' and new.session_id is not null and v_flags && v_review then
    update app.work_sessions set flags = (select coalesce(array_agg(distinct f), '{}') from unnest(flags || v_flags) f), version = version + 1
     where id = new.session_id and v_session_id is distinct from new.session_id;
  end if;

  new.flags := (select coalesce(array_agg(distinct f), '{}') from unnest(v_flags) f);
  new.review_status := case when new.flags && v_review then 'needs_review' else 'accepted' end;
  return new;
end $$;

-- Language of the invitation email (and the new person's starting language).
alter table app.invitations
  add column if not exists locale text not null default 'en' check (locale in ('en', 'es-MX', 'fr-CA', 'pa', 'hi', 'gu'));

-- ---------- 2. Crew clock-in ----------
alter table app.time_events
  add column if not exists entry_method text not null default 'self' check (entry_method in ('self', 'crew')),
  add column if not exists recorded_by_membership_id uuid;
alter table app.time_events
  add constraint time_events_recorded_by_fk foreign key (recorded_by_membership_id, company_id)
  references app.memberships (id, company_id);
alter table app.time_events add constraint time_events_crew_check
  check ((entry_method = 'crew') = (recorded_by_membership_id is not null));

-- ---------- 3. Open shifts and shift requests ----------
alter table app.shifts add column if not exists open_slots smallint not null default 0 check (open_slots between 0 and 50);
create index if not exists shifts_open_idx on app.shifts (company_id, starts_at) where open_slots > 0 and status = 'scheduled';

-- Version bumps also when open slots change.
create or replace function app.tg_shift_version() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if row(new.site_id, new.starts_at, new.ends_at, new.break_minutes, new.instructions, new.status, new.open_slots)
     is distinct from row(old.site_id, old.starts_at, old.ends_at, old.break_minutes, old.instructions, old.status, old.open_slots) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create table if not exists app.shift_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  shift_id uuid not null,
  kind text not null check (kind in ('pickup', 'drop', 'swap')),
  requester_membership_id uuid not null,
  target_membership_id uuid,
  status text not null default 'pending' check (status in ('pending_peer', 'pending', 'approved', 'rejected', 'cancelled')),
  note text check (note is null or char_length(note) <= 500),
  decided_by uuid references app.profiles (user_id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'swap') = (target_membership_id is not null)),
  check (target_membership_id is null or target_membership_id <> requester_membership_id),
  foreign key (shift_id, company_id) references app.shifts (id, company_id) on delete cascade,
  foreign key (requester_membership_id, company_id) references app.memberships (id, company_id),
  foreign key (target_membership_id, company_id) references app.memberships (id, company_id)
);
create index if not exists shift_requests_company_idx on app.shift_requests (company_id, status, created_at desc);
create index if not exists shift_requests_requester_idx on app.shift_requests (requester_membership_id, created_at desc);
create index if not exists shift_requests_target_idx on app.shift_requests (target_membership_id) where target_membership_id is not null;
-- One open request per person per shift.
create unique index if not exists shift_requests_one_open_idx on app.shift_requests (shift_id, requester_membership_id)
  where status in ('pending_peer', 'pending');

-- ---------- 4. Time off and availability ----------
create table if not exists app.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  membership_id uuid not null,
  kind text not null check (kind in ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  starts_on date not null,
  ends_on date not null,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references app.profiles (user_id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 366),
  foreign key (membership_id, company_id) references app.memberships (id, company_id)
);
create index if not exists time_off_company_idx on app.time_off_requests (company_id, status, starts_on);
create index if not exists time_off_member_idx on app.time_off_requests (membership_id, starts_on);

-- Weekly availability. No row for a day = available all day.
create table if not exists app.availability (
  membership_id uuid not null,
  company_id uuid not null,
  dow smallint not null check (dow between 0 and 6),
  available boolean not null,
  start_minute smallint check (start_minute between 0 and 1440),
  end_minute smallint check (end_minute between 0 and 1440),
  updated_at timestamptz not null default now(),
  primary key (membership_id, dow),
  check (not available or start_minute is null or (end_minute is not null and end_minute > start_minute)),
  foreign key (membership_id, company_id) references app.memberships (id, company_id) on delete cascade
);

-- ---------- 5. Safety ----------
create table if not exists app.safety_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  kind text not null check (kind in ('incident', 'near_miss', 'hazard')),
  site_id uuid,
  occurred_at timestamptz not null,
  description text not null check (char_length(description) between 5 and 4000),
  injured boolean not null default false,
  injury_details text check (injury_details is null or char_length(injury_details) <= 2000),
  action_taken text check (action_taken is null or char_length(action_taken) <= 2000),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  reported_by_membership_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references app.profiles (user_id),
  closed_at timestamptz,
  close_note text check (close_note is null or char_length(close_note) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (site_id, company_id) references app.job_sites (id, company_id),
  foreign key (reported_by_membership_id, company_id) references app.memberships (id, company_id),
  unique (id, company_id)
);
create index if not exists safety_reports_company_idx on app.safety_reports (company_id, created_at desc);

create table if not exists app.toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  site_id uuid,
  topic text not null check (char_length(topic) between 3 and 200),
  notes text check (notes is null or char_length(notes) <= 4000),
  held_at timestamptz not null,
  led_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (site_id, company_id) references app.job_sites (id, company_id),
  foreign key (led_by_membership_id, company_id) references app.memberships (id, company_id),
  unique (id, company_id)
);
create index if not exists toolbox_talks_company_idx on app.toolbox_talks (company_id, held_at desc);

create table if not exists app.toolbox_talk_attendees (
  talk_id uuid not null,
  membership_id uuid not null,
  company_id uuid not null,
  signed_at timestamptz,
  primary key (talk_id, membership_id),
  foreign key (talk_id, company_id) references app.toolbox_talks (id, company_id) on delete cascade,
  foreign key (membership_id, company_id) references app.memberships (id, company_id)
);
create index if not exists toolbox_attendees_member_idx on app.toolbox_talk_attendees (membership_id) where signed_at is null;

-- ---------- 6. Product feedback (platform-level, read by Blue Collar staff) ----------
create table if not exists app.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (user_id) on delete cascade,
  company_id uuid references app.companies (id) on delete set null,
  kind text not null check (kind in ('improvement', 'complaint', 'bug')),
  message text check (message is null or char_length(message) <= 4000),
  audio_path text check (audio_path is null or char_length(audio_path) <= 300),
  screenshot_path text check (screenshot_path is null or char_length(screenshot_path) <= 300),
  platform text not null check (platform in ('web', 'ios', 'android')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  locale text check (locale is null or char_length(locale) <= 10),
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'closed')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (message is not null or audio_path is not null)
);
create index if not exists feedback_status_idx on app.feedback (status, created_at desc);
create index if not exists feedback_user_idx on app.feedback (user_id, created_at desc);

-- ---------- Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['shift_requests', 'time_off_requests', 'feedback'] loop
    execute format('drop trigger if exists touch_updated_at on app.%I', t);
    execute format('create trigger touch_updated_at before update on app.%I for each row execute function app.tg_touch_updated_at()', t);
  end loop;
end $$;

-- ---------- Privileges ----------
revoke all on app.shift_requests, app.time_off_requests, app.availability, app.safety_reports, app.toolbox_talks,
  app.toolbox_talk_attendees, app.feedback from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.shift_requests, app.time_off_requests, app.availability, app.safety_reports, app.toolbox_talks, app.toolbox_talk_attendees, app.feedback from anon, authenticated';
  end if;
end $$;
grant select, insert, update on app.shift_requests, app.time_off_requests, app.availability, app.safety_reports,
  app.toolbox_talks, app.toolbox_talk_attendees, app.feedback to app_system;
grant delete on app.availability to app_system;

grant select, insert on app.shift_requests to app_user;
grant update (status, decided_by, decided_at, decision_note) on app.shift_requests to app_user;
grant select, insert on app.time_off_requests to app_user;
grant update (status, decided_by, decided_at, decision_note) on app.time_off_requests to app_user;
grant select, insert, update, delete on app.availability to app_user;
grant select, insert on app.safety_reports to app_user;
grant update (status, closed_by, closed_at, close_note) on app.safety_reports to app_user;
grant select, insert on app.toolbox_talks, app.toolbox_talk_attendees to app_user;
grant update (signed_at) on app.toolbox_talk_attendees to app_user;
grant update (open_slots) on app.shifts to app_user;
-- feedback: no app_user access at all (written and read through the API's system role only).

-- ---------- Row-level security ----------
do $$
declare t text;
begin
  foreach t in array array['shift_requests', 'time_off_requests', 'availability', 'safety_reports', 'toolbox_talks',
                           'toolbox_talk_attendees', 'feedback'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists system_all on app.%I', t);
    execute format('create policy system_all on app.%I as permissive for all to app_system using (true) with check (true)', t);
  end loop;
end $$;

-- Shift requests: own (requester or target), or schedulers of the company (scoped by site).
create policy read_requests on app.shift_requests for select to app_user using (
  requester_membership_id = any ((select app.my_memberships())::uuid[])
  or target_membership_id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_full_companies())::uuid[])
  or shift_id in (select s.id from app.shifts s where s.site_id = any ((select app.my_scoped_sites())::uuid[])));
create policy own_insert on app.shift_requests for insert to app_user
  with check (requester_membership_id = any ((select app.my_memberships())::uuid[]));
create policy participant_update on app.shift_requests for update to app_user using (
  requester_membership_id = any ((select app.my_memberships())::uuid[])
  or target_membership_id = any ((select app.my_memberships())::uuid[])
  or (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
      and (company_id = any ((select app.my_full_companies())::uuid[])
           or shift_id in (select s.id from app.shifts s where s.site_id = any ((select app.my_scoped_sites())::uuid[])))));

-- Time off: own, or staff who can see the member.
create policy read_time_off on app.time_off_requests for select to app_user using (
  membership_id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_full_companies())::uuid[])
  or membership_id = any ((select app.my_scoped_members())::uuid[]));
create policy own_insert on app.time_off_requests for insert to app_user
  with check (membership_id = any ((select app.my_memberships())::uuid[]));
create policy decide_update on app.time_off_requests for update to app_user using (
  membership_id = any ((select app.my_memberships())::uuid[])
  or (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
      and (company_id = any ((select app.my_full_companies())::uuid[]) or membership_id = any ((select app.my_scoped_members())::uuid[]))));

-- Availability: the employee manages their own; staff read.
create policy read_availability on app.availability for select to app_user using (
  membership_id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_full_companies())::uuid[])
  or membership_id = any ((select app.my_scoped_members())::uuid[]));
create policy own_write on app.availability for all to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]))
  with check (membership_id = any ((select app.my_memberships())::uuid[]));

-- Safety reports: reporter, or company staff.
create policy read_safety on app.safety_reports for select to app_user using (
  reported_by_membership_id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]));
create policy member_insert on app.safety_reports for insert to app_user
  with check (reported_by_membership_id = any ((select app.my_memberships())::uuid[]));
create policy staff_close on app.safety_reports for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]));

-- Toolbox talks: staff and attendees read; staff or crew leads create.
-- Helpers are SECURITY DEFINER so the two tables' policies do not reference each other (no recursion).
create or replace function app.my_led_talks() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(t.id), '{}') from app.toolbox_talks t join app.memberships m on m.id = t.led_by_membership_id
      where m.user_id = app.uid() and m.status = 'active' $$;
create or replace function app.my_attended_talks() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(a.talk_id), '{}') from app.toolbox_talk_attendees a join app.memberships m on m.id = a.membership_id
      where m.user_id = app.uid() and m.status = 'active' $$;
revoke all on function app.my_led_talks(), app.my_attended_talks() from public;
grant execute on function app.my_led_talks(), app.my_attended_talks() to app_user, app_system;

create policy read_talks on app.toolbox_talks for select to app_user using (
  company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
  or led_by_membership_id = any ((select app.my_memberships())::uuid[])
  or id = any ((select app.my_attended_talks())::uuid[]));
create policy lead_insert on app.toolbox_talks for insert to app_user
  with check (led_by_membership_id = any ((select app.my_memberships())::uuid[]));
create policy read_attendees on app.toolbox_talk_attendees for select to app_user using (
  membership_id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
  or talk_id = any ((select app.my_led_talks())::uuid[]));
create policy lead_insert on app.toolbox_talk_attendees for insert to app_user
  with check (talk_id = any ((select app.my_led_talks())::uuid[]));
create policy own_sign on app.toolbox_talk_attendees for update to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]))
  with check (membership_id = any ((select app.my_memberships())::uuid[]));

-- feedback: no app_user policy => default deny (RLS on, only system_all).

-- ---------- 7. Private storage bucket (Supabase only; skipped on plain Postgres) ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('uploads', 'uploads', false, 5242880,
            array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    -- No storage policies are created: browsers and phones can only use short-lived signed URLs issued by the API.
  end if;
end $$;
