-- =====================================================================================
-- Blue Collar migration 0300 — helper functions and integrity triggers.
-- All SECURITY DEFINER functions pin search_path and are not executable by PUBLIC.
-- =====================================================================================

-- ---------- Identity helpers (read the verified JWT subject set by the API per transaction) ----------
create or replace function app.uid() returns uuid
language sql stable
set search_path = pg_catalog
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function app.distance_m(lat1 double precision, lng1 double precision,
                                          lat2 double precision, lng2 double precision)
returns integer language sql immutable
set search_path = pg_catalog
as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::integer
$$;

-- Role of the current user in a company ('' when not an active member).
create or replace function app.member_role(p_company uuid) returns text
language sql stable security definer
set search_path = app, pg_catalog
as $$
  select coalesce((select m.role from app.memberships m
                   where m.company_id = p_company and m.user_id = app.uid() and m.status = 'active'), '')
$$;

create or replace function app.is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$ select app.member_role(p_company) <> '' $$;

create or replace function app.is_staff(p_company uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$ select app.member_role(p_company) in ('owner', 'admin', 'manager', 'supervisor', 'payroll') $$;

create or replace function app.has_role(p_company uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$ select app.member_role(p_company) = any (p_roles) $$;

-- Can the current user see records for this job site? (supervisors and scoped managers)
create or replace function app.can_access_site(p_company uuid, p_site uuid) returns boolean
language plpgsql stable security definer set search_path = app, pg_catalog
as $$
declare
  v_member app.memberships%rowtype;
  v_has_scopes boolean;
begin
  select * into v_member from app.memberships
   where company_id = p_company and user_id = app.uid() and status = 'active';
  if not found or v_member.role = 'employee' then return false; end if;
  if v_member.role in ('owner', 'admin', 'payroll') then return true; end if;
  select exists (select 1 from app.membership_sites where membership_id = v_member.id) into v_has_scopes;
  if v_member.role = 'manager' and not v_has_scopes then return true; end if;
  if p_site is null then return v_member.role = 'manager' and not v_has_scopes; end if;
  return exists (select 1 from app.membership_sites where membership_id = v_member.id and site_id = p_site);
end $$;

create or replace function app.is_own_membership(p_membership uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$ select exists (select 1 from app.memberships where id = p_membership and user_id = app.uid() and status = 'active') $$;

create or replace function app.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$
  select exists (select 1 from app.conversation_members cm
                 join app.memberships m on m.id = cm.membership_id
                 where cm.conversation_id = p_conversation and m.user_id = app.uid() and m.status = 'active')
$$;

-- Can the current (staff) user see this employee? Scoped roles only see employees assigned to their sites.
create or replace function app.can_access_member(p_company uuid, p_membership uuid) returns boolean
language plpgsql stable security definer set search_path = app, pg_catalog
as $$
declare v_role text := app.member_role(p_company); v_me uuid;
begin
  if v_role in ('owner', 'admin', 'payroll') then return true; end if;
  if v_role not in ('manager', 'supervisor') then return false; end if;
  select id into v_me from app.memberships where company_id = p_company and user_id = app.uid() and status = 'active';
  if v_role = 'manager' and not exists (select 1 from app.membership_sites where membership_id = v_me) then return true; end if;
  return exists (
    select 1 from app.membership_sites mine
    where mine.membership_id = v_me and (
      exists (select 1 from app.membership_sites theirs where theirs.membership_id = p_membership and theirs.site_id = mine.site_id)
      or exists (select 1 from app.shift_assignments sa join app.shifts s on s.id = sa.shift_id
                 where sa.membership_id = p_membership and s.site_id = mine.site_id
                   and s.starts_at > now() - interval '120 days')
    ));
end $$;

-- Does the current user share a conversation with this membership? (to show names in chats)
create or replace function app.shares_conversation(p_membership uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$
  select exists (select 1 from app.conversation_members a join app.conversation_members b on b.conversation_id = a.conversation_id
                 join app.memberships me on me.id = a.membership_id
                 where b.membership_id = p_membership and me.user_id = app.uid() and me.status = 'active')
$$;
create or replace function app.is_conversation_creator(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, pg_catalog
as $$
  select exists (select 1 from app.conversations c join app.memberships m on m.id = c.created_by_membership_id
                 where c.id = p_conversation and m.user_id = app.uid() and m.status = 'active')
$$;
revoke all on function app.is_conversation_creator(uuid) from public;
grant execute on function app.is_conversation_creator(uuid) to app_user, app_system;
revoke all on function app.shares_conversation(uuid) from public;
grant execute on function app.shares_conversation(uuid) to app_user, app_system;

revoke all on function app.member_role(uuid), app.is_member(uuid), app.is_staff(uuid), app.has_role(uuid, text[]),
  app.can_access_site(uuid, uuid), app.is_own_membership(uuid), app.is_conversation_member(uuid),
  app.can_access_member(uuid, uuid) from public;
grant execute on function app.uid(), app.distance_m(double precision, double precision, double precision, double precision),
  app.member_role(uuid), app.is_member(uuid), app.is_staff(uuid), app.has_role(uuid, text[]),
  app.can_access_site(uuid, uuid), app.is_own_membership(uuid), app.is_conversation_member(uuid),
  app.can_access_member(uuid, uuid) to app_user, app_system;

-- ---------- Set-based helpers for fast RLS ----------
-- Policies call these as `(select app.fn())` so PostgreSQL evaluates them ONCE per query
-- (an InitPlan) instead of once per row. Measured: see Testing.md (performance section).
create or replace function app.my_memberships() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(id), '{}') from app.memberships where user_id = app.uid() and status = 'active' $$;

create or replace function app.my_companies() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(company_id), '{}') from app.memberships where user_id = app.uid() and status = 'active' $$;

create or replace function app.my_role_companies(p_roles text[]) returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(company_id), '{}') from app.memberships
      where user_id = app.uid() and status = 'active' and role = any (p_roles) $$;

-- Companies where the user sees everything (owner/admin/payroll, or a manager without site scopes).
create or replace function app.my_full_companies() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(m.company_id), '{}') from app.memberships m
      where m.user_id = app.uid() and m.status = 'active'
        and (m.role in ('owner', 'admin', 'payroll')
             or (m.role = 'manager' and not exists (select 1 from app.membership_sites s where s.membership_id = m.id))) $$;

-- Sites a scoped supervisor/manager may manage.
create or replace function app.my_scoped_sites() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(s.site_id), '{}') from app.memberships m join app.membership_sites s on s.membership_id = m.id
      where m.user_id = app.uid() and m.status = 'active' and m.role in ('manager', 'supervisor') $$;

-- Employees visible to a scoped supervisor/manager: assigned to their sites, or recently scheduled there.
create or replace function app.my_scoped_members() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$
  with sites as (select unnest(app.my_scoped_sites()) as site_id)
  select coalesce(array_agg(distinct x.membership_id), '{}') from (
    select ms.membership_id from app.membership_sites ms join sites on sites.site_id = ms.site_id
    union
    select sa.membership_id from app.shifts sh join sites on sites.site_id = sh.site_id
      join app.shift_assignments sa on sa.shift_id = sh.id where sh.starts_at > now() - interval '120 days'
  ) x
$$;

revoke all on function app.my_memberships(), app.my_companies(), app.my_role_companies(text[]), app.my_full_companies(),
  app.my_scoped_sites(), app.my_scoped_members() from public;
grant execute on function app.my_memberships(), app.my_companies(), app.my_role_companies(text[]), app.my_full_companies(),
  app.my_scoped_sites(), app.my_scoped_members() to app_user, app_system;

create or replace function app.my_conversations() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(cm.conversation_id), '{}') from app.conversation_members cm
      join app.memberships m on m.id = cm.membership_id where m.user_id = app.uid() and m.status = 'active' $$;

create or replace function app.my_conversation_peers() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(distinct b.membership_id), '{}') from app.conversation_members a
      join app.conversation_members b on b.conversation_id = a.conversation_id
      join app.memberships me on me.id = a.membership_id where me.user_id = app.uid() and me.status = 'active' $$;

-- Sites an employee works at (assigned, or has a shift there).
create or replace function app.my_assigned_sites() returns uuid[]
language sql stable security definer set search_path = app, pg_catalog
as $$ select coalesce(array_agg(distinct x.site_id), '{}') from (
        select ms.site_id from app.membership_sites ms join app.memberships m on m.id = ms.membership_id
         where m.user_id = app.uid() and m.status = 'active'
        union
        select sh.site_id from app.shifts sh join app.shift_assignments sa on sa.shift_id = sh.id
          join app.memberships m on m.id = sa.membership_id where m.user_id = app.uid() and m.status = 'active') x $$;

revoke all on function app.my_conversations(), app.my_conversation_peers(), app.my_assigned_sites() from public;
grant execute on function app.my_conversations(), app.my_conversation_peers(), app.my_assigned_sites() to app_user, app_system;

-- ---------- Generic triggers ----------
create or replace function app.tg_touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin new.updated_at := now(); return new; end $$;

create or replace function app.tg_append_only() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'Table %.% is append-only: % is not allowed', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'profiles', 'platform_staff', 'memberships', 'job_sites', 'shifts',
                           'work_sessions', 'pay_periods', 'payroll_records'] loop
    execute format('create trigger touch_updated_at before update on app.%I for each row execute function app.tg_touch_updated_at()', t);
  end loop;
  -- Immutable history tables. Applies to EVERY role, including the API's system role.
  foreach t in array array['time_events', 'adjustments', 'audit_logs', 'security_events', 'pay_rates', 'messages'] loop
    execute format('create trigger append_only before update or delete on app.%I for each row execute function app.tg_append_only()', t);
    execute format('create trigger append_only_truncate before truncate on app.%I for each statement execute function app.tg_append_only()', t);
  end loop;
end $$;

-- Shift edits bump the version (optimistic concurrency).
create or replace function app.tg_shift_version() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if row(new.site_id, new.starts_at, new.ends_at, new.break_minutes, new.instructions, new.status)
     is distinct from row(old.site_id, old.starts_at, old.ends_at, old.break_minutes, old.instructions, old.status) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger shift_version before update on app.shifts for each row execute function app.tg_shift_version();

-- Paid payroll is immutable; corrections go through new adjustments and the next pay period.
create or replace function app.tg_payroll_record_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only draft payroll records can be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'paid' then raise exception 'Paid payroll records cannot be changed' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger payroll_record_guard before update or delete on app.payroll_records
  for each row execute function app.tg_payroll_record_guard();

create or replace function app.tg_pay_period_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'A paid pay period cannot be reopened' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger pay_period_guard before update on app.pay_periods for each row execute function app.tg_pay_period_guard();

-- ---------- Attendance: the heart of data integrity ----------
-- Applies every attendance event to the employee's work session, inside the same transaction,
-- with the employee's membership row locked (serialises concurrent clock events).
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
        flags = (select array_agg(distinct f) from unnest(s.flags || v_flags) f),
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
    update app.work_sessions set flags = (select array_agg(distinct f) from unnest(flags || v_flags) f), version = version + 1
     where id = new.session_id and v_session_id is distinct from new.session_id;
  end if;

  new.flags := (select coalesce(array_agg(distinct f), '{}') from unnest(v_flags) f);
  new.review_status := case when new.flags && v_review then 'needs_review' else 'accepted' end;
  return new;
end $$;
revoke all on function app.tg_time_event_apply() from public;
create trigger time_event_apply before insert on app.time_events
  for each row execute function app.tg_time_event_apply();

-- Adjustments become the session's effective values; approval resets so a human re-approves.
create or replace function app.tg_adjustment_apply() returns trigger
language plpgsql security definer set search_path = app, pg_catalog
as $$
declare s app.work_sessions%rowtype;
begin
  select * into s from app.work_sessions where id = new.session_id for update;
  if s.status = 'open' then
    raise exception 'Cannot adjust a session that is still open' using errcode = 'P0004';
  end if;
  new.company_id := s.company_id;
  new.after_payment := exists (
    select 1 from app.payroll_records pr join app.pay_periods pp on pp.id = pr.pay_period_id
    where pr.membership_id = s.membership_id and pr.status = 'paid'
      and coalesce(s.original_start::date, now()::date) between pp.starts_on - 7 and pp.ends_on + 7);
  return new;
end $$;
create trigger adjustment_apply before insert on app.adjustments for each row execute function app.tg_adjustment_apply();

create or replace function app.tg_adjustment_after() returns trigger
language plpgsql security definer set search_path = app, pg_catalog
as $$
begin
  update app.work_sessions
     set current_adjustment_id = new.id, approval_status = 'pending', approved_by = null, approved_at = null,
         version = version + 1
   where id = new.session_id;
  return null;
end $$;
create trigger adjustment_after after insert on app.adjustments for each row execute function app.tg_adjustment_after();
revoke all on function app.tg_adjustment_apply(), app.tg_adjustment_after() from public;

-- Messages: sender must be a member of the conversation; bump last_message_at.
create or replace function app.tg_message_guard() returns trigger
language plpgsql security definer set search_path = app, pg_catalog
as $$
begin
  if not exists (select 1 from app.conversation_members
                 where conversation_id = new.conversation_id and membership_id = new.sender_membership_id and can_post) then
    raise exception 'Sender is not allowed to post in this conversation' using errcode = 'P0005';
  end if;
  new.created_at := now();
  update app.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
revoke all on function app.tg_message_guard() from public;
create trigger message_guard before insert on app.messages for each row execute function app.tg_message_guard();

-- Effective values view (original unless adjusted). security_invoker => caller's RLS applies.
create or replace view app.work_sessions_effective with (security_invoker = true) as
select ws.*,
       coalesce(a.adjusted_start, ws.original_start) as effective_start,
       case when a.id is not null then a.adjusted_end else ws.original_end end as effective_end,
       coalesce(a.adjusted_break_minutes, ws.original_break_minutes) as effective_break_minutes,
       (a.id is not null) as adjusted
from app.work_sessions ws
left join app.adjustments a on a.id = ws.current_adjustment_id;
