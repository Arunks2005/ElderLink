-- Let the staff dashboard's behaviour-analysis panel re-run as soon as new
-- sensor nights (or recomputed daily scores) arrive.
alter publication supabase_realtime add table public.daily_aggregates;
