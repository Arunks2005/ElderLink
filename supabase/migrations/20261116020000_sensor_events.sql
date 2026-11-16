-- Sensor events for the sensor simulator and future real devices
-- (ceiling mmWave radar, bed mat, wearable pulse/SpO2, night breathing radar).
alter table public.sensor_events
  add column if not exists sensor_type text,
  add column if not exists device_id text,
  add column if not exists value numeric,
  add column if not exists unit text,
  add column if not exists payload jsonb;

-- The old policy let ANYONE with the public anon key insert events.
drop policy if exists "Allow inserts from device" on public.sensor_events;

create policy care_staff_read_sensor_events on public.sensor_events
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_sensor_events on public.sensor_events
  for insert to authenticated with check (public.is_care_staff());
create policy care_staff_update_sensor_events on public.sensor_events
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());
create policy care_staff_delete_simulated_sensor_events on public.sensor_events
  for delete to authenticated using (public.is_care_staff() and source = 'simulated_sensor');

-- Staff may clear simulated fall events created by the simulator.
create policy care_staff_delete_simulated_falls on public.fall_events
  for delete to authenticated using (public.is_care_staff() and device_id like 'SIM-%');

create index if not exists sensor_events_resident_created_idx
  on public.sensor_events (resident_id, created_at desc);

-- Live feed on the simulator page.
alter publication supabase_realtime add table public.sensor_events;
