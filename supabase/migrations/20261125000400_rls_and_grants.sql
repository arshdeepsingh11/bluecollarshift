-- =====================================================================================
-- Blue Collar migration 0400 — privileges and row-level security.
--
-- Layer 1: the API authorises every request (role + permission + scope).
-- Layer 2 (this file): even if the API had a bug, app_user can only touch rows of
--          companies the signed-in user belongs to, and employees only their own rows.
-- anon / authenticated (Supabase Data API roles) get NOTHING in schema app.
-- =====================================================================================

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon, authenticated';
    execute 'revoke all on all tables in schema app from anon, authenticated';
    execute 'revoke all on all functions in schema app from anon, authenticated';
  end if;
end $$;
revoke all on all tables in schema app from public;

-- ---------- Table privileges ----------
-- app_system: trusted server operations. No DELETE except on link tables.
grant select, insert, update on all tables in schema app to app_system;
grant delete on app.membership_sites, app.shift_assignments, app.conversation_members, app.device_tokens,
  app.payroll_records, app.support_access_grants, app.job_runs to app_system;

-- app_user: least privilege, per table.
grant select on app.companies, app.profiles, app.memberships, app.membership_sites, app.pay_rates,
  app.invitations, app.job_sites, app.shifts, app.shift_assignments, app.work_sessions,
  app.work_sessions_effective, app.time_events, app.adjustments, app.disputes, app.payroll_settings,
  app.pay_periods, app.payroll_records, app.conversations, app.conversation_members, app.messages,
  app.notifications, app.device_tokens, app.audit_logs to app_user;
grant update (name, phone, address, timezone) on app.companies to app_user;
grant update (full_name, locale) on app.profiles to app_user;
grant insert, update on app.memberships to app_user;
grant insert, delete on app.membership_sites to app_user;
grant insert on app.pay_rates to app_user;
grant insert, update (revoked_at) on app.invitations to app_user;
grant insert, update on app.job_sites to app_user;
grant insert, update on app.shifts to app_user;
grant insert, delete on app.shift_assignments to app_user;
grant insert on app.time_events to app_user;
grant update (approval_status, approved_by, approved_at, approval_note, version) on app.work_sessions to app_user;
grant insert on app.adjustments to app_user;
grant insert, update (status, resolution_note, resolved_by, resolved_at) on app.disputes to app_user;
grant insert, update on app.payroll_settings to app_user;
grant insert, update on app.pay_periods to app_user;
grant insert, update, delete on app.payroll_records to app_user;
grant insert on app.conversations to app_user;
grant update (last_message_at) on app.conversations to app_user;
grant insert on app.conversation_members to app_user;
grant update (last_read_at) on app.conversation_members to app_user;
grant insert on app.messages to app_user;
grant update (read_at) on app.notifications to app_user;
grant insert, update, delete on app.device_tokens to app_user;

-- ---------- Enable RLS everywhere ----------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relkind = 'r' loop
    execute format('alter table app.%I enable row level security', t.relname);
    -- Trusted server role: explicit full-row policy (no BYPASSRLS needed).
    execute format('create policy system_all on app.%I as permissive for all to app_system using (true) with check (true)', t.relname);
  end loop;
end $$;

-- ---------- app_user policies ----------
-- Every helper is wrapped in (select …) so it is evaluated once per query (fast at 10k+ employees).

-- Companies
create policy member_read on app.companies for select to app_user using (id = any ((select app.my_companies())::uuid[]));
create policy owner_update on app.companies for update to app_user
  using (id = any ((select app.my_role_companies(array['owner', 'admin']))::uuid[])) with check (id = any ((select app.my_role_companies(array['owner', 'admin']))::uuid[]));

-- Profiles: yourself, or people whose membership you are allowed to see.
create policy self_or_colleague_read on app.profiles for select to app_user using (
  user_id = (select app.uid()) or user_id in (select m.user_id from app.memberships m));
create policy self_update on app.profiles for update to app_user
  using (user_id = (select app.uid())) with check (user_id = (select app.uid()));

-- Memberships
create policy read_members on app.memberships for select to app_user using (
  id = any ((select app.my_memberships())::uuid[])
  or company_id = any ((select app.my_full_companies())::uuid[])
  or id = any ((select app.my_scoped_members())::uuid[])
  or (company_id = any ((select app.my_companies())::uuid[]) and role <> 'employee' and status = 'active')  -- employees can see their managers (contacts)
  or id = any ((select app.my_conversation_peers())::uuid[]));
create policy managers_insert on app.memberships for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and role <> 'owner');
create policy managers_update on app.memberships for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and (company_id = any ((select app.my_full_companies())::uuid[]) or id = any ((select app.my_scoped_members())::uuid[])))
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and user_id <> (select app.uid()));

create policy read_self_or_staff on app.membership_sites for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor', 'payroll']))::uuid[]));
create policy managers_write on app.membership_sites for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]));
create policy managers_delete on app.membership_sites for delete to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]));

-- Pay rates: own, or owner/admin/payroll. Nobody sets their own rate.
create policy read_own_or_payroll on app.pay_rates for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_insert on app.pay_rates for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]) and not (membership_id = any ((select app.my_memberships())::uuid[])));

-- Invitations
create policy managers_read on app.invitations for select to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]));
create policy managers_insert on app.invitations for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and invited_by = (select app.uid()));
create policy managers_revoke on app.invitations for update to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]));

-- Job sites: full-access staff, scoped staff (their sites), employees (sites they work at).
create policy read_sites on app.job_sites for select to app_user using (
  company_id = any ((select app.my_full_companies())::uuid[]) or id = any ((select app.my_scoped_sites())::uuid[]) or id = any ((select app.my_assigned_sites())::uuid[]));
create policy staff_insert on app.job_sites for insert to app_user with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]));
create policy staff_update on app.job_sites for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and (company_id = any ((select app.my_full_companies())::uuid[]) or id = any ((select app.my_scoped_sites())::uuid[])));

-- Shifts
create policy read_shifts on app.shifts for select to app_user using (
  company_id = any ((select app.my_full_companies())::uuid[]) or site_id = any ((select app.my_scoped_sites())::uuid[])
  or id in (select sa.shift_id from app.shift_assignments sa where sa.membership_id = any ((select app.my_memberships())::uuid[])));
create policy staff_insert on app.shifts for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]) and (company_id = any ((select app.my_full_companies())::uuid[]) or site_id = any ((select app.my_scoped_sites())::uuid[])));
create policy staff_update on app.shifts for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]) and (company_id = any ((select app.my_full_companies())::uuid[]) or site_id = any ((select app.my_scoped_sites())::uuid[])))
  with check (company_id = any ((select app.my_full_companies())::uuid[]) or site_id = any ((select app.my_scoped_sites())::uuid[]));

create policy read_assignments on app.shift_assignments for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor', 'payroll']))::uuid[]));
create policy staff_insert on app.shift_assignments for insert to app_user
  with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]));
create policy staff_delete on app.shift_assignments for delete to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[]));

-- Attendance: employees insert ONLY their own events; nobody updates or deletes (trigger too).
create policy read_events on app.time_events for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_full_companies())::uuid[]) or membership_id = any ((select app.my_scoped_members())::uuid[]));
create policy own_insert on app.time_events for insert to app_user
  with check (membership_id = any ((select app.my_memberships())::uuid[]) and created_by = (select app.uid()));

create policy read_sessions on app.work_sessions for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_full_companies())::uuid[]) or membership_id = any ((select app.my_scoped_members())::uuid[]));
create policy reviewers_update on app.work_sessions for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
         and (company_id = any ((select app.my_full_companies())::uuid[]) or membership_id = any ((select app.my_scoped_members())::uuid[]))
         and not (membership_id = any ((select app.my_memberships())::uuid[])))
  with check (not (membership_id = any ((select app.my_memberships())::uuid[])));

create policy read_adjustments on app.adjustments for select to app_user using (
  company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor', 'payroll']))::uuid[])
  or session_id in (select ws.id from app.work_sessions ws where ws.membership_id = any ((select app.my_memberships())::uuid[])));
create policy reviewers_insert on app.adjustments for insert to app_user with check (
  created_by = (select app.uid()) and exists (
    select 1 from app.work_sessions ws where ws.id = adjustments.session_id
      and ws.company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor']))::uuid[])
      and (ws.company_id = any ((select app.my_full_companies())::uuid[]) or ws.membership_id = any ((select app.my_scoped_members())::uuid[]))
      and not (ws.membership_id = any ((select app.my_memberships())::uuid[]))));

create policy read_disputes on app.disputes for select to app_user
  using (raised_by_membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor', 'payroll']))::uuid[]));
create policy own_insert on app.disputes for insert to app_user with check (
  raised_by_membership_id = any ((select app.my_memberships())::uuid[])
  and exists (select 1 from app.work_sessions ws where ws.id = disputes.session_id and ws.membership_id = disputes.raised_by_membership_id));
create policy reviewers_update on app.disputes for update to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager']))::uuid[]) and not (raised_by_membership_id = any ((select app.my_memberships())::uuid[])));

-- Payroll
create policy staff_read on app.payroll_settings for select to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'manager', 'supervisor', 'payroll']))::uuid[]));
create policy payroll_write on app.payroll_settings for insert to app_user with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_update on app.payroll_settings for update to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));

create policy read_periods on app.pay_periods for select to app_user using (
  company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[])
  or id in (select pr.pay_period_id from app.payroll_records pr where pr.membership_id = any ((select app.my_memberships())::uuid[])));
create policy payroll_insert on app.pay_periods for insert to app_user with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_update on app.pay_periods for update to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));

create policy read_records on app.payroll_records for select to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[]) or company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_insert on app.payroll_records for insert to app_user with check (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_update on app.payroll_records for update to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));
create policy payroll_delete on app.payroll_records for delete to app_user using (company_id = any ((select app.my_role_companies(array['owner', 'admin', 'payroll']))::uuid[]));

-- Messaging
create policy members_read on app.conversations for select to app_user
  using (id = any ((select app.my_conversations())::uuid[]) or created_by_membership_id = any ((select app.my_memberships())::uuid[]));
create policy members_insert on app.conversations for insert to app_user
  with check (company_id = any ((select app.my_companies())::uuid[]) and created_by_membership_id = any ((select app.my_memberships())::uuid[]));
create policy members_touch on app.conversations for update to app_user using (id = any ((select app.my_conversations())::uuid[]));

create policy members_read on app.conversation_members for select to app_user using (conversation_id = any ((select app.my_conversations())::uuid[]));
create policy creator_insert on app.conversation_members for insert to app_user
  with check (app.is_conversation_creator(conversation_id));
create policy own_read_marker on app.conversation_members for update to app_user
  using (membership_id = any ((select app.my_memberships())::uuid[])) with check (membership_id = any ((select app.my_memberships())::uuid[]));

create policy members_read on app.messages for select to app_user using (conversation_id = any ((select app.my_conversations())::uuid[]));
create policy members_insert on app.messages for insert to app_user
  with check (sender_membership_id = any ((select app.my_memberships())::uuid[]) and conversation_id = any ((select app.my_conversations())::uuid[]));

-- Notifications & devices: strictly your own.
create policy own_read on app.notifications for select to app_user using (user_id = (select app.uid()));
create policy own_mark_read on app.notifications for update to app_user
  using (user_id = (select app.uid())) with check (user_id = (select app.uid()));
create policy own_all on app.device_tokens for all to app_user
  using (user_id = (select app.uid())) with check (user_id = (select app.uid()));

-- Audit: company owners/admins read their company trail. Writes are server-only (app_system).
create policy company_admin_read on app.audit_logs for select to app_user
  using (company_id = any ((select app.my_role_companies(array['owner', 'admin']))::uuid[]));

-- Tables with no app_user policy (platform_staff, user_sessions, security_events, support_access_grants,
-- job_runs, platform_settings) are invisible to app_user by default (RLS default-deny).
