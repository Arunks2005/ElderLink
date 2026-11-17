-- Help requests ("I need a second pair of hands") become visible live on
-- every dashboard, with who is coming and when it was done.
-- Status flow: open -> accepted -> done.

alter table public.assistance_requests
  add column if not exists requested_by_name text,
  add column if not exists location text,
  add column if not exists accepted_by uuid,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_at timestamptz,
  add column if not exists resolved_at timestamptz;

alter table public.assistance_requests alter column created_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'assistance_requests'
  ) then
    alter publication supabase_realtime add table public.assistance_requests;
  end if;
end $$;
