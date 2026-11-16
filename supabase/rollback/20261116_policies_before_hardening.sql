-- ROLLBACK REFERENCE: the public-schema RLS policies as they existed on
-- 2026-11-16, before migration 20261116000000_security_hardening.sql.
-- Exported from pg_policies. To restore one, drop the hardened policy of the
-- same purpose first and run the matching statement below.
--
-- Several of these are UNSAFE (see the hardening migration for why).
-- Do not restore them on a database that holds real resident data.

create policy "Admins can manage admins" on public.admins as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Admins can view admins" on public.admins as PERMISSIVE for SELECT to public using (is_admin());
create policy "Allow authenticated read on assistance_requests" on public.assistance_requests as PERMISSIVE for SELECT to authenticated using (true);
create policy "staff can read and update behavior_alerts" on public.behavior_alerts as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "staff can resolve alerts" on public.behavior_alerts as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy "staff can insert care logs" on public.care_logs_demo as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));
create policy "staff can read demo logs" on public.care_logs_demo as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "staff can update care logs" on public.care_logs_demo as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy "staff can read daily_aggregates" on public.daily_aggregates as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "Admins manage emergency_alerts" on public.emergency_alerts as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Staff can raise alerts" on public.emergency_alerts as PERMISSIVE for INSERT to public with check ((is_staff() AND (raised_by = auth.uid())));
create policy "Staff can view emergency_alerts" on public.emergency_alerts as PERMISSIVE for SELECT to public using (is_staff());
create policy "auth users manage emergency_alerts" on public.emergency_alerts as PERMISSIVE for ALL to public using ((auth.uid() IS NOT NULL));
create policy family_read_own_emergency_alerts on public.emergency_alerts as PERMISSIVE for SELECT to authenticated using ((resident_id IN ( SELECT fc.resident_id FROM family_contacts fc WHERE (fc.profile_id = auth.uid()))));
create policy "Allow fall event inserts" on public.fall_events as PERMISSIVE for INSERT to anon, authenticated with check (true);
create policy "Allow fall event reads" on public.fall_events as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "Allow fall event updates" on public.fall_events as PERMISSIVE for UPDATE to anon, authenticated using (true) with check (true);
create policy "Staff can acknowledge fall events" on public.fall_events as PERMISSIVE for UPDATE to public using ((auth.role() = 'authenticated'::text));
create policy "Staff can read fall events" on public.fall_events as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "Admins manage family_contacts" on public.family_contacts as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "auth users manage family_contacts" on public.family_contacts as PERMISSIVE for ALL to public using ((auth.uid() IS NOT NULL));
create policy family_contacts_self_read on public.family_contacts as PERMISSIVE for SELECT to authenticated using ((profile_id = auth.uid()));
create policy family_read_own_contact on public.family_contacts as PERMISSIVE for SELECT to public using ((profile_id = auth.uid()));
create policy staff_admin_read_family_contacts on public.family_contacts as PERMISSIVE for SELECT to authenticated using (((EXISTS ( SELECT 1 FROM staff WHERE (staff.id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM admins WHERE (admins.id = auth.uid())))));
create policy "Allow insert for authenticated users" on public.family_messages as PERMISSIVE for INSERT to authenticated with check (true);
create policy "Allow read for authenticated users" on public.family_messages as PERMISSIVE for SELECT to authenticated using (true);
create policy family_insert_own_messages on public.family_messages as PERMISSIVE for INSERT to public with check ((resident_id IN ( SELECT my_residents.resident_id FROM my_residents)));
create policy family_read_own_messages on public.family_messages as PERMISSIVE for SELECT to public using ((resident_id IN ( SELECT my_residents.resident_id FROM my_residents)));
create policy "Allow authenticated read on handover_notes" on public.handover_notes as PERMISSIVE for SELECT to authenticated using (true);
create policy "Admins manage incidents" on public.incidents as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Staff can insert own incidents" on public.incidents as PERMISSIVE for INSERT to public with check ((is_staff() AND (staff_id = auth.uid())));
create policy "Staff can view incidents" on public.incidents as PERMISSIVE for SELECT to public using (is_staff());
create policy "auth users manage incidents" on public.incidents as PERMISSIVE for ALL to public using ((auth.uid() IS NOT NULL));
create policy family_read_own_incidents on public.incidents as PERMISSIVE for SELECT to authenticated using ((resident_id IN ( SELECT fc.resident_id FROM family_contacts fc WHERE (fc.profile_id = auth.uid()))));
create policy "Users can read own profile" on public.profiles as PERMISSIVE for SELECT to authenticated using ((id = ( SELECT auth.uid() AS uid)));
create policy "Admins manage residents" on public.residents as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Allow fall detector to read residents" on public.residents as PERMISSIVE for SELECT to anon using (true);
create policy "Staff can view residents" on public.residents as PERMISSIVE for SELECT to public using (is_staff());
create policy "auth users manage residents" on public.residents as PERMISSIVE for ALL to public using ((auth.uid() IS NOT NULL));
create policy family_read_own_resident on public.residents as PERMISSIVE for SELECT to authenticated using ((id IN ( SELECT fc.resident_id FROM family_contacts fc WHERE (fc.profile_id = auth.uid()))));
create policy staff_admin_read_all_residents on public.residents as PERMISSIVE for SELECT to public using (((EXISTS ( SELECT 1 FROM staff WHERE (staff.id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM admins WHERE (admins.id = auth.uid())))));
create policy "authenticated can add roles" on public.roles as PERMISSIVE for INSERT to public with check ((auth.role() = 'authenticated'::text));
create policy "authenticated can delete roles" on public.roles as PERMISSIVE for DELETE to public using ((auth.role() = 'authenticated'::text));
create policy "authenticated can read roles" on public.roles as PERMISSIVE for SELECT to public using ((auth.role() = 'authenticated'::text));
create policy "Allow inserts from device" on public.sensor_events as PERMISSIVE for INSERT to anon with check (true);
create policy "Admins manage staff" on public.staff as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Staff can view own row" on public.staff as PERMISSIVE for SELECT to public using ((id = auth.uid()));
create policy "Admins manage staff_details" on public.staff_details as PERMISSIVE for ALL to public using (is_admin()) with check (is_admin());
create policy "Staff can view own details" on public.staff_details as PERMISSIVE for SELECT to public using ((id = auth.uid()));
create policy "authenticated users can manage own staff_details" on public.staff_details as PERMISSIVE for ALL to public using ((auth.uid() = id));
create policy "authenticated users can read staff_details" on public.staff_details as PERMISSIVE for SELECT to public using ((auth.uid() IS NOT NULL));

-- Functions changed by the hardening migration (previous behaviour):
--   handle_new_user(): created an admins row when signup metadata had role='admin'.
--   claim_family_contact(user_email text): linked ANY unclaimed family contact
--     with that email to the caller (dropped as unsafe).
