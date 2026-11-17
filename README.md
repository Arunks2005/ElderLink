# ElderLink

Care-home platform for Indian shared wards: QR bed tags, voice care logs in
regional languages, a personal-normal behaviour engine, fall response with
escalation, live help requests, ElderAI for staff, and a family portal.

Sensors (bed load cells, 60 GHz bathroom radar, phone fall sensor) are
**simulated** in this version and labelled as such in the app.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
npm run dev:phone            # https, for the phone fall sensor (motion needs https)
```

Tests: `npm run test:early-warning`

## Deploy (Vercel)

- Framework: Next.js, Root Directory: repository root.
- Environment variables (Production + Preview): see `.env.example`.
  `SUPABASE_SERVICE_ROLE_KEY` is not used by the app.
- Add the deployed address to Supabase → Authentication → URL Configuration
  (Site URL and Redirect URLs) so sign-in and email links work.

Database migrations and access rules: `supabase/README.md`.
