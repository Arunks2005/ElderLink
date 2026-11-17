-- "What is my relative doing right now?" – a coarse, family-friendly status
-- from the per-bed load-cell sensor: in bed, or up and about.
-- Deliberately coarse: no bathroom / minute-by-minute tracking for families.
-- Until real sensors exist, rows are SIMULATED (source = 'simulated').

create table if not exists public.resident_presence (
  resident_id uuid primary key references public.residents(id) on delete cascade,
  state text not null check (state in ('in_bed', 'up')),
  since timestamptz not null default now(),
  source text not null default 'simulated' check (source in ('simulated', 'sensor')),
  updated_at timestamptz not null default now()
);

alter table public.resident_presence enable row level security;

drop policy if exists care_staff_read_presence on public.resident_presence;
create policy care_staff_read_presence on public.resident_presence
  for select to authenticated using (public.is_care_staff());

drop policy if exists care_staff_write_presence on public.resident_presence;
create policy care_staff_write_presence on public.resident_presence
  for insert to authenticated with check (public.is_care_staff());

drop policy if exists care_staff_update_presence on public.resident_presence;
create policy care_staff_update_presence on public.resident_presence
  for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

drop policy if exists family_read_own_presence on public.resident_presence;
create policy family_read_own_presence on public.resident_presence
  for select to authenticated using (
    resident_id in (select fc.resident_id from public.family_contacts fc where fc.profile_id = auth.uid())
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resident_presence'
  ) then
    alter publication supabase_realtime add table public.resident_presence;
  end if;
end $$;

-- Seed every resident who has a bed from a simple daily routine
-- (India time): night sleep 21:30–06:30, afternoon rest 13:30–15:00.
with now_ist as (select (now() at time zone 'Asia/Kolkata') as t),
blocks as (
  select
    case
      when t::time >= '21:30' or t::time < '06:30' then 'in_bed'
      when t::time >= '13:30' and t::time < '15:00' then 'in_bed'
      else 'up'
    end as state,
    case
      when t::time >= '21:30' then (date_trunc('day', t) + time '21:30') at time zone 'Asia/Kolkata'
      when t::time < '06:30' then (date_trunc('day', t) - interval '1 day' + time '21:30') at time zone 'Asia/Kolkata'
      when t::time >= '15:00' then (date_trunc('day', t) + time '15:00') at time zone 'Asia/Kolkata'
      when t::time >= '13:30' then (date_trunc('day', t) + time '13:30') at time zone 'Asia/Kolkata'
      else (date_trunc('day', t) + time '06:30') at time zone 'Asia/Kolkata'
    end as since
  from now_ist
)
insert into public.resident_presence (resident_id, state, since, source)
select b.resident_id, blocks.state, blocks.since, 'simulated'
from public.beds b cross join blocks
where b.resident_id is not null
on conflict (resident_id) do nothing;
