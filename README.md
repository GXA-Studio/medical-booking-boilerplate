# Medical Booking Boilerplate

White-label patient booking system. Multi-tenant, OTP-verified, GDPR-compliant.

**Stack:** Next.js 15 (App Router) · Supabase (PostgreSQL + Auth + RLS) · Twilio SMS · Upstash Redis (rate limiting) · shadcn/ui · Vercel

---

## Quick Start (new tenant deployment)

### 1 — Clone & install

```bash
git clone https://github.com/GXA-Studio/medical-booking-boilerplate.git
cd medical-booking-boilerplate
npm install
```

### 2 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note the **Project URL**, **anon key**, and **service_role key**
3. Apply the database schema:

```bash
# Option A — Supabase CLI (recommended)
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# Option B — Paste supabase/migrations/001_initial.sql into the SQL Editor in the Dashboard
```

### 3 — Configure environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Description | Visibility |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | **Server only** |
| `SUPABASE_PROJECT_ID` | Project ref (for `npm run db:types`) | Local dev only |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | **Server only** |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | **Server only** |
| `TWILIO_PHONE_NUMBER` | Twilio sender number (E.164) | **Server only** |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | **Server only** |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token | **Server only** |
| `OTP_HASH_PEPPER` | 32-byte random hex for OTP HMAC | **Server only** |
| `NEXT_PUBLIC_APP_URL` | Public base URL (e.g. https://your-clinic.vercel.app) | Public |

### 4 — Generate TypeScript types (after any schema change)

```bash
npm run db:types
```

### 5 — Run locally

```bash
npm run dev
# → http://localhost:3000
```

### 6 — Deploy to Vercel

```bash
# First time
npx vercel link
npx vercel env add <VARIABLE_NAME> production   # repeat for each secret
npx vercel --prod

# Subsequent deploys (auto-triggered by git push to main if GitHub is connected)
git push origin main
```

---

## Seed a clinic (after schema is applied)

Use the Supabase Dashboard → SQL Editor, or insert via the admin panel at `/auth/login`.

Minimum seed for a working booking page:

```sql
-- 1. Insert clinic
INSERT INTO clinics (name, slug, timezone) VALUES
  ('Clínica Demo', 'clinica-demo', 'America/Mexico_City');

-- 2. Insert a service
INSERT INTO services (clinic_id, name, duration_minutes, price)
SELECT id, 'Consulta General', 30, 350 FROM clinics WHERE slug = 'clinica-demo';

-- 3. Insert a doctor
INSERT INTO doctors (clinic_id, name, specialty)
SELECT id, 'Dra. Laura Martínez', 'Medicina General' FROM clinics WHERE slug = 'clinica-demo';

-- 4. Link doctor ↔ service
INSERT INTO doctor_services (doctor_id, service_id)
SELECT d.id, s.id FROM doctors d, services s
WHERE d.name = 'Dra. Laura Martínez' AND s.name = 'Consulta General';

-- 5. Add a schedule (Mon–Fri, 09:00–13:00)
INSERT INTO schedules (doctor_id, day_of_week, start_time, end_time)
SELECT d.id, g.day, '09:00', '13:00'
FROM doctors d, generate_series(1, 5) AS g(day)
WHERE d.name = 'Dra. Laura Martínez';
```

The booking page is then live at: `https://your-domain.vercel.app/clinica-demo`

---

## Running E2E Tests

Tests use Playwright with a fixture page that requires no database.

```bash
# Local (starts dev server automatically)
npx playwright test

# Against Vercel production
PLAYWRIGHT_BASE_URL=https://medical-booking-boilerplate.vercel.app npx playwright test
```

The fixture page (`/test-fixture`) renders the full booking wizard with static data and mocks all API routes — no Twilio SMS is sent during tests.

---

## Architecture highlights

- **Double-booking prevention**: PostgreSQL `EXCLUDE USING gist` constraint — zero race conditions
- **OTP security**: SHA-256 hashed, 5-minute TTL, CSPRNG, replay-proof after confirmation
- **Rate limiting**: Upstash Redis via `@upstash/ratelimit` on `/api/otp/send`
- **Multi-tenant**: `clinics.slug` drives URL routing — no code changes between tenants
- **RLS**: Row-level security on all tables; patients never create accounts

See [CONTEXT.md](CONTEXT.md) for full architectural decisions and schema documentation.
