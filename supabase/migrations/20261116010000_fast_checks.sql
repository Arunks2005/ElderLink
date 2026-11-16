-- BE-FAST stroke checks recorded by care staff (ElderLink FAST check page).
create table if not exists public.fast_checks (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete cascade,
  performed_by uuid references auth.users(id) on delete set null,
  last_known_well timestamptz not null,
  balance boolean,
  eyes boolean,
  face boolean,
  arms boolean,
  speech boolean,
  arm_left_deg numeric,
  arm_right_deg numeric,
  outcome text not null check (outcome in ('positive', 'negative', 'incomplete')),
  ambulance_called boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.fast_checks enable row level security;

create policy care_staff_read_fast_checks on public.fast_checks
  for select to authenticated using (public.is_care_staff());
create policy care_staff_insert_fast_checks on public.fast_checks
  for insert to authenticated
  with check (public.is_care_staff() and performed_by = auth.uid());
create policy care_staff_update_fast_checks on public.fast_checks
  for update to authenticated
  using (public.is_care_staff() and performed_by = auth.uid())
  with check (public.is_care_staff() and performed_by = auth.uid());

create index if not exists fast_checks_resident_created_idx
  on public.fast_checks (resident_id, created_at desc);
