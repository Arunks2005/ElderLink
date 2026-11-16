-- Shared wards: ward → beds (one resident per bed) → sensor zones.
-- Indian care homes usually have 5–6 residents per ward rather than single
-- rooms, so sensors and QR bed tags map to beds and zones, not rooms.

create table if not exists public.wards (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  floor text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.beds (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete cascade,
  label text not null,
  position integer not null default 1,
  resident_id uuid unique references public.residents(id) on delete set null,
  -- Random token printed as a QR code on the bed. Scanning opens that
  -- resident's care log (the page itself still requires a staff login).
  qr_token text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now(),
  unique (ward_id, label)
);

create table if not exists public.sensor_zones (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete cascade,
  bed_id uuid references public.beds(id) on delete cascade,
  kind text not null check (kind in ('bed', 'bathroom', 'walkway')),
  label text not null,
  device_type text not null check (device_type in ('bed_mat', 'mmwave_radar', 'presence_radar', 'pir')),
  device_id text,
  created_at timestamptz not null default now()
);

alter table public.wards enable row level security;
alter table public.beds enable row level security;
alter table public.sensor_zones enable row level security;

create policy care_staff_read_wards on public.wards for select to authenticated using (public.is_care_staff());
create policy admins_manage_wards on public.wards for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy care_staff_read_beds on public.beds for select to authenticated using (public.is_care_staff());
create policy admins_manage_beds on public.beds for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy care_staff_read_sensor_zones on public.sensor_zones for select to authenticated using (public.is_care_staff());
create policy admins_manage_sensor_zones on public.sensor_zones for all to authenticated using (public.is_admin()) with check (public.is_admin());

create index if not exists beds_ward_idx on public.beds (ward_id, position);
create index if not exists sensor_zones_ward_idx on public.sensor_zones (ward_id);
