# ElderLink database (Supabase)

## Migrations

| File | What it does |
|---|---|
| `migrations/20261116000000_security_hardening.sql` | Locks down row-level security, stops admin self-signup, removes an unsafe family-linking function, adds missing columns/policies/table used by the app. **Applied to the ElderLink project on 2026-11-16.** |
| `migrations/20261116010000_fast_checks.sql` | Adds `fast_checks` (BE-FAST stroke checks), readable/writable by care staff only. **Applied 2026-11-16.** |
| `rollback/20261116_policies_before_hardening.sql` | The policies as they were before, for reference only. Several were unsafe. |

## Who can see what (after hardening)

| Role | Can read | Can write |
|---|---|---|
| Not signed in (anon) | nothing | nothing |
| Staff / admin | all residents, care logs, alerts, falls, handover notes, assistance requests, family contacts | care logs, falls, behaviour alerts, handover notes, assistance requests; admins also manage residents, staff, family contacts, roles |
| Family | only their own relative: resident record, care logs, incidents, emergency alerts, messages | messages about their own relative |
| Signed in with no role | nothing | nothing |

Verified with SQL role simulation after the migration: anon 0 rows; staff all
15 residents; family 1 resident / 11 logs; family updates and deletes of other
records affect 0 rows.

## Admin accounts

Self-signup can no longer create admins: choosing "Admin" on the signup form
now creates a **staff** account. To promote a trusted user, run this in the
Supabase SQL editor (as the project owner):

```sql
insert into public.admins (id, full_name, email, phone_number)
select id, full_name, email, phone_number from public.staff where email = 'person@example.com';
```

## Daily scores pipeline

* Every insert/update on `care_logs_demo` recomputes that resident-day in
  `daily_aggregates` (trigger `care_logs_demo_after_write`).
* "Analyse now" on the Behaviour Alerts page calls
  `refresh_recent_aggregates(28)` (staff/admin only), then the app's
  personal-baseline engine adds new rows to `behavior_alerts`.
* Note: `recompute_daily_aggregate` groups by the UTC date of each log.

## Still to do in the Supabase dashboard

* Auth → Password security: turn on **Leaked password protection**.
* Decide whether `sensor_events` should keep accepting anonymous inserts
  (policy "Allow inserts from device"). Nothing in the app uses it yet.

## Demo data (seeded 2026-11-16)

`care_logs_demo` holds 1,138 rows with `entry_source = 'demo'` and
`staff_id = null`, covering the 28 days up to 16 Nov 2026 for the 11 active
residents. They are demonstration data, not real observations:

| Resident | Scripted scenario |
|---|---|
| Antonio Lopez | low fluids + new confusion + slightly raised temperature (last 3 days) |
| Maria Fernandez | eating less and lower mood (last 5 days); has the family test login |
| Frank Nguyen | refusing evening medication (last 3 days) |
| Ramanna | knee pain rising from ~3/10 to ~6.5/10 (last 3 days) |
| Helen Osei | logged once a day while others get four (under-observed) |
| everyone else | normal day-to-day variation (should NOT be flagged) |

The app ignores these rows unless `ELDERLINK_INCLUDE_DEMO_DATA=true`; then
every screen that uses them shows a DEMO notice. The daily-score trigger has
already built `daily_aggregates` for these days.

To remove the demo data later:

```sql
delete from public.care_logs_demo where entry_source = 'demo' and staff_id is null
  and created_at >= '2026-10-19';
```
