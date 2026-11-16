-- ============================================================================
-- ElderLink security hardening + schema fixes (2026-11-16)
--
-- Problems found in the live database:
--   * residents (incl. medical_notes) were readable by the anon role, i.e. by
--     anyone holding the public anon key that ships in the browser bundle.
--   * "auth users manage …" policies let ANY signed-in user (including family
--     accounts and accounts with no role) insert/update/delete residents,
--     family_contacts, incidents and emergency_alerts.
--   * care logs, behaviour alerts, daily aggregates, handover notes,
--     assistance requests, family messages and staff details were readable by
--     every signed-in user, so families could see every resident's data.
--   * fall_events could be read, created and resolved anonymously.
--   * any signed-in user could create/delete roles.
--   * handle_new_user() created an ADMIN for anyone who signed up with
--     role=admin in their metadata (the public signup form offers this).
--   * claim_family_contact(user_email text) let any user link themselves to
--     any unclaimed family contact by passing someone else's email.
--   * internal SECURITY DEFINER functions were callable over the REST API.
--   * handover_notes, behavior_alerts and assistance_requests had no INSERT
--     policy, so the app could not write them; assistance_requests lacked the
--     resident_id/message columns the app sends.
--
-- Rollback reference: supabase/rollback/20261116_policies_before_hardening.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: is the caller care staff (staff or admin)?
-- ---------------------------------------------------------------------------
create or replace function public.is_care_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid())
      or exists (select 1 from public.admins where id = auth.uid());
$$;
grant execute on function public.is_care_staff() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- residents
-- ---------------------------------------------------------------------------
drop policy if exists "auth users manage residents" on public.residents;
drop policy if exists "Allow fall detector to read residents" on public.residents;
-- kept: "Admins manage residents", "Staff can view residents",
--       staff_admin_read_all_residents, family_read_own_resident

-- ---------------------------------------------------------------------------
-- family_contacts
-- ---------------------------------------------------------------------------
drop policy if exists "auth users manage family_contacts" on public.family_contacts;
-- kept: admin manage, staff/admin read, family self read

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------
drop policy if exists "auth users manage incidents" on public.incidents;
-- kept: admin manage, staff insert own, staff view, family read own

-- ---------------------------------------------------------------------------
-- emergency_alerts
-- ---------------------------------------------------------------------------
drop policy if exists "auth users manage emergency_alerts" on public.emergency_alerts;
create policy "Staff can update emergency_alerts" on public.emergency_alerts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- kept: admin manage, staff raise (raised_by = self), staff view, family read own

-- ---------------------------------------------------------------------------
-- care_logs_demo
-- ---------------------------------------------------------------------------
drop policy if exists "staff can read demo logs" on public.care_logs_demo;
drop policy if exists "staff can insert care logs" on public.care_logs_demo;
drop policy if exists "staff can update care logs" on public.care_logs_demo;
create policy care_staff_read_care_logs on public.care_logs_demo
  for select to authenticated using (public.is_care_staff());
create policy family_read_own_care_logs on public.care_logs_demo
  for select to authenticated using (
    resident_id in (select fc.resident_id from public.family_contacts fc where fc.profile_id = auth.uid())
  );
create policy care_staff_insert_care_logs on public.care_logs_demo
  for insert to authenticated with check (public.is_care_staff());
create policy care_staff_update_care_logs on public.care_logs_demo
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- daily_aggregates (written by the care-log trigger, SECURITY DEFINER)
-- ---------------------------------------------------------------------------
drop policy if exists "staff can read daily_aggregates" on public.daily_aggregates;
create policy care_staff_read_daily_aggregates on public.daily_aggregates
  for select to authenticated using (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- behavior_alerts
-- ---------------------------------------------------------------------------
drop policy if exists "staff can read and update behavior_alerts" on public.behavior_alerts;
drop policy if exists "staff can resolve alerts" on public.behavior_alerts;
create policy care_staff_read_behavior_alerts on public.behavior_alerts
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_behavior_alerts on public.behavior_alerts
  for insert to authenticated with check (public.is_care_staff());
create policy care_staff_update_behavior_alerts on public.behavior_alerts
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- assistance_requests: add the columns the staff dashboard sends
-- ---------------------------------------------------------------------------
alter table public.assistance_requests
  add column if not exists resident_id uuid references public.residents(id) on delete set null,
  add column if not exists message text;
drop policy if exists "Allow authenticated read on assistance_requests" on public.assistance_requests;
create policy care_staff_read_assistance on public.assistance_requests
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_assistance on public.assistance_requests
  for insert to authenticated
  with check (public.is_care_staff() and (requested_by is null or requested_by = auth.uid()));
create policy care_staff_update_assistance on public.assistance_requests
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- handover_notes
-- ---------------------------------------------------------------------------
drop policy if exists "Allow authenticated read on handover_notes" on public.handover_notes;
create policy care_staff_read_handover on public.handover_notes
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_handover on public.handover_notes
  for insert to authenticated with check (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- family_messages
-- ---------------------------------------------------------------------------
drop policy if exists "Allow insert for authenticated users" on public.family_messages;
drop policy if exists "Allow read for authenticated users" on public.family_messages;
create policy care_staff_read_family_messages on public.family_messages
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_family_messages on public.family_messages
  for insert to authenticated with check (public.is_care_staff());
-- kept: family_read_own_messages, family_insert_own_messages

-- ---------------------------------------------------------------------------
-- fall_events: staff/admin only (the phone fall detector now needs a login)
-- ---------------------------------------------------------------------------
drop policy if exists "Allow fall event inserts" on public.fall_events;
drop policy if exists "Allow fall event reads" on public.fall_events;
drop policy if exists "Allow fall event updates" on public.fall_events;
drop policy if exists "Staff can acknowledge fall events" on public.fall_events;
drop policy if exists "Staff can read fall events" on public.fall_events;
create policy care_staff_read_fall_events on public.fall_events
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_fall_events on public.fall_events
  for insert to authenticated with check (public.is_care_staff());
create policy care_staff_update_fall_events on public.fall_events
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- roles: only admins change roles
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated can add roles" on public.roles;
drop policy if exists "authenticated can delete roles" on public.roles;
create policy admins_insert_roles on public.roles
  for insert to authenticated with check (public.is_admin());
create policy admins_update_roles on public.roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admins_delete_roles on public.roles
  for delete to authenticated using (public.is_admin());
-- kept: "authenticated can read roles"

-- ---------------------------------------------------------------------------
-- staff_details: staff/admin can read; families cannot
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated users can read staff_details" on public.staff_details;
create policy care_staff_read_staff_details on public.staff_details
  for select to authenticated using (public.is_care_staff());

-- ---------------------------------------------------------------------------
-- end_of_shift_reports (used by the end-of-shift summary)
-- ---------------------------------------------------------------------------
create table if not exists public.end_of_shift_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff(id) on delete set null,
  summary jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.end_of_shift_reports enable row level security;
create policy staff_insert_own_shift_report on public.end_of_shift_reports
  for insert to authenticated with check (public.is_staff() and staff_id = auth.uid());
create policy staff_read_own_shift_report on public.end_of_shift_reports
  for select to authenticated using (staff_id = auth.uid());
create policy admins_read_shift_reports on public.end_of_shift_reports
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Signup trigger: never create admins from self-signup metadata.
-- Admins are promoted by an existing admin (see supabase/README.md).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role text := new.raw_user_meta_data->>'role';
begin
  -- 'admin' requested at signup is treated as staff.
  if user_role in ('staff', 'admin') then
    insert into public.staff (id, full_name, email, phone_number, job_title)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      new.raw_user_meta_data->>'phone_number',
      new.raw_user_meta_data->>'job_title'
    );
  end if;
  -- Family accounts have no role and get no staff row.
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Family linking: keep only the safe, email-from-session version
-- ---------------------------------------------------------------------------
drop function if exists public.claim_family_contact(text);
revoke execute on function public.claim_family_contact() from public, anon;
grant execute on function public.claim_family_contact() to authenticated;

-- ---------------------------------------------------------------------------
-- Internal functions must not be callable over the REST API
-- (triggers still run them).
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.recompute_daily_aggregate(uuid, date) from public, anon, authenticated;
revoke execute on function public.seed_simulated_sensor_data(text, date, date) from public, anon, authenticated;
revoke execute on function public.trg_care_log_to_aggregate() from public, anon, authenticated;
revoke execute on function public.trg_daily_aggregate_check_patterns() from public, anon, authenticated;
revoke execute on function public.detect_pattern_deviation(uuid, text) from public, anon, authenticated;
revoke execute on function public.detect_pattern_deviation(text, text) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.trg_daily_aggregate_check_patterns() set search_path = public;
alter function public.detect_pattern_deviation(text, text) set search_path = public;

-- ---------------------------------------------------------------------------
-- Staff-callable refresh of daily_aggregates for recent care logs
-- (used by the "Analyse now" button; the per-insert trigger stays in place).
-- ---------------------------------------------------------------------------
create or replace function public.refresh_recent_aggregates(p_days integer default 28)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if not public.is_care_staff() then
    raise exception 'care staff only' using errcode = '42501';
  end if;
  for r in
    select distinct resident_id, created_at::date as d
    from public.care_logs_demo
    where resident_id is not null
      and created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
  loop
    perform public.recompute_daily_aggregate(r.resident_id, r.d);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.refresh_recent_aggregates(integer) from public, anon;
grant execute on function public.refresh_recent_aggregates(integer) to authenticated;
