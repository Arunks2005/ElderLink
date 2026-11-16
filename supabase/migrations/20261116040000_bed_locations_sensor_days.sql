-- 1. A resident's location is their bed, e.g. "Ward A · Bed 3".
--    residents.room_number is kept (many screens read it) but is now
--    maintained automatically from beds; edit placement in Wards & beds.
create or replace function public.sync_resident_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Resident left this bed (unassigned, moved or bed deleted).
  if tg_op in ('UPDATE', 'DELETE') and old.resident_id is not null
     and (tg_op = 'DELETE' or old.resident_id is distinct from new.resident_id) then
    update public.residents set room_number = null
    where id = old.resident_id
      and not exists (
        select 1 from public.beds b
        where b.resident_id = old.resident_id and (tg_op = 'DELETE' or b.id <> old.id)
      );
  end if;
  -- Resident placed in this bed (or the bed was relabelled).
  if tg_op in ('INSERT', 'UPDATE') and new.resident_id is not null then
    update public.residents r set room_number = w.name || ' · ' || new.label
    from public.wards w
    where w.id = new.ward_id and r.id = new.resident_id;
  end if;
  return null;
end;
$$;

drop trigger if exists beds_sync_location on public.beds;
create trigger beds_sync_location
  after insert or update or delete on public.beds
  for each row execute function public.sync_resident_location();

create or replace function public.sync_ward_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.residents r set room_number = new.name || ' · ' || b.label
  from public.beds b
  where b.ward_id = new.id and r.id = b.resident_id;
  return null;
end;
$$;

drop trigger if exists wards_sync_location on public.wards;
create trigger wards_sync_location
  after update of name on public.wards
  for each row execute function public.sync_ward_rename();

revoke execute on function public.sync_resident_location() from public, anon, authenticated;
revoke execute on function public.sync_ward_rename() from public, anon, authenticated;

-- 2. Nightly sensor summaries live next to the care scores in daily_aggregates
--    (sleep_hours, washroom_visits and sleep_disturbed already exist).
alter table public.daily_aggregates
  add column if not exists night_bed_exits integer check (night_bed_exits is null or night_bed_exits >= 0),
  add column if not exists night_breathing_rate numeric,
  add column if not exists sensor_source text;

-- Staff-only writer for sensor days: used by the simulator now and by a
-- device gateway later. Only sensor columns are touched.
create or replace function public.record_sensor_day(
  p_resident_id uuid,
  p_date date,
  p_sleep_hours numeric,
  p_washroom_visits integer,
  p_night_bed_exits integer,
  p_night_breathing_rate numeric,
  p_sleep_disturbed boolean,
  p_source text default 'simulated'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_room text;
  v_day_index integer;
begin
  if not public.is_care_staff() then
    raise exception 'care staff only' using errcode = '42501';
  end if;
  select full_name, coalesce(room_number, 'Unassigned') into v_name, v_room from public.residents where id = p_resident_id;
  if v_name is null then
    raise exception 'unknown resident';
  end if;
  select coalesce(count(*), 0) + 1 into v_day_index
  from public.daily_aggregates where resident_id = p_resident_id::text and date < p_date;

  insert into public.daily_aggregates (
    resident_id, resident_name, room, date, day_index,
    sleep_hours, washroom_visits, night_bed_exits, night_breathing_rate, sleep_disturbed, sensor_source, updated_at
  ) values (
    p_resident_id::text, v_name, v_room, p_date, v_day_index,
    p_sleep_hours, p_washroom_visits, p_night_bed_exits, p_night_breathing_rate, p_sleep_disturbed, p_source, now()
  )
  on conflict (resident_id, date) do update set
    sleep_hours = excluded.sleep_hours,
    washroom_visits = excluded.washroom_visits,
    night_bed_exits = excluded.night_bed_exits,
    night_breathing_rate = excluded.night_breathing_rate,
    sleep_disturbed = excluded.sleep_disturbed,
    sensor_source = excluded.sensor_source,
    updated_at = now();
end;
$$;
revoke execute on function public.record_sensor_day(uuid, date, numeric, integer, integer, numeric, boolean, text) from public, anon;
grant execute on function public.record_sensor_day(uuid, date, numeric, integer, integer, numeric, boolean, text) to authenticated;

-- 3. The app's Early Warning engine now analyses sleep and bathroom data
--    (1-week personal normal, noise floors, persistence, patterns).
--    Disconnect the older per-row database detector so the same metrics are
--    not alerted twice. The functions are kept; to restore:
--    create trigger daily_aggregates_after_write after insert or update on public.daily_aggregates
--      for each row execute function trg_daily_aggregate_check_patterns();
drop trigger if exists daily_aggregates_after_write on public.daily_aggregates;
