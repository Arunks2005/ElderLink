-- Fall response workflow: who responded and how fast, escalation when nobody
-- responds, the at-scene safety check, the outcome, and family notification.
-- Status flow: unresolved -> acknowledged -> resolved.

alter table public.fall_events
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid,
  add column if not exists acknowledged_by_name text,
  add column if not exists escalation_level smallint not null default 0,
  add column if not exists escalated_at timestamptz,
  add column if not exists assessment jsonb,
  add column if not exists outcome text,
  add column if not exists outcome_notes text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_by_name text,
  add column if not exists family_notified_at timestamptz;

alter table public.fall_events drop constraint if exists fall_events_outcome_check;
alter table public.fall_events
  add constraint fall_events_outcome_check
  check (outcome is null or outcome in ('no_injury', 'minor_injury', 'hospital', 'false_alarm'));

alter table public.fall_events drop constraint if exists fall_events_escalation_check;
alter table public.fall_events
  add constraint fall_events_escalation_check check (escalation_level between 0 and 3);

create index if not exists fall_events_open_idx
  on public.fall_events (triggered_at desc)
  where status in ('unresolved', 'active', 'acknowledged');
