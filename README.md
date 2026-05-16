# Medical Booking Boilerplate

White-label patient booking system. Zero-friction instant booking, GDPR-compliant, race-condition-proof.

**Stack:** Next.js 15 (App Router) · Supabase (PostgreSQL + Auth + RLS) · Twilio WhatsApp · Upstash Redis · shadcn/ui · Vercel

---

## Database Setup

### Deployment Model: Single-Tenant (one Supabase project per clinic)

Each clinic deployment is an isolated Supabase project. This gives each clinic their own database, auth namespace, and API keys — zero data leakage between tenants. No code changes are needed between deployments: only environment variables change.

```
Clinic A → Supabase project A → vercel-clinic-a.vercel.app
Clinic B → Supabase project B → vercel-clinic-b.vercel.app
```

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Note the **Project URL**, **anon key**, and **service_role key** from Settings → API

### Step 2 — Apply the schema

**Option A — Supabase CLI (recommended for automation)**

```bash
# Link to your project
npx supabase link --project-ref <your-project-ref>

# Push all migrations (applies 001_initial.sql, 002_add_phone_constraint.sql)
npx supabase db push
```

**Option B — Single idempotent file (recommended for new projects)**

Open Supabase Dashboard → SQL Editor → paste and run:

```
supabase/migrations/20260515_final_schema.sql
```

This is the **certified, idempotent** file — tables, triggers (auto-profile on sign-up), RPCs, RLS, grants, profile backfill, and admin linkage. Safe to re-run on existing projects.

> For projects that already have 001 + 002 applied, run only Parts 10–11 of `20260515_final_schema.sql` (missing trigger fix + admin linkage).

### Step 3 — Create the first admin user

1. Go to Supabase Dashboard → **Authentication** → **Add user**
2. Enter the admin email (e.g. `studiogxa@gmail.com`) and a temporary password

The trigger `trg_on_auth_user_created` (installed in the schema) automatically creates a `profiles` row when the user signs up. If you applied `20260515_final_schema.sql`, this trigger is already in place.

> **If the admin gets "Esta cuenta no tiene una clínica asociada"** after login, it means their profile row exists but `clinic_id` is NULL. Run Step 4.

### Step 4 — Link the admin to the clinic

The admin–clinic relationship is in **`profiles.clinic_id`**, not in a `clinics.admin_id` column. This design allows multiple admins and staff per clinic.

```sql
-- Run in Supabase SQL Editor after the user has signed up
UPDATE public.profiles
SET    clinic_id = (SELECT id FROM public.clinics WHERE slug = 'clinica-prueba' LIMIT 1),
       role      = 'admin'
WHERE  id = (SELECT id FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL@example.com' LIMIT 1)
  AND  clinic_id IS NULL;
```

> **Root cause note**: If a user signed up BEFORE the trigger was installed (early deployments), their `profiles` row was never created. Fix by running Part 10 of `20260515_final_schema.sql`, which backfills all missing profile rows.

### Step 5 — Verify

```sql
-- Should return 1 row with clinic name and admin email
SELECT p.role, u.email, c.name AS clinic, c.slug
FROM   public.profiles p
JOIN   auth.users      u ON u.id = p.id
JOIN   public.clinics  c ON c.id = p.clinic_id
WHERE  u.email = 'studiogxa@gmail.com';
```

The booking page is live at: `https://your-domain.vercel.app/clinica-prueba`

---

## Full Deployment Guide (new tenant from zero)

### 1 — Clone & install

```bash
git clone https://github.com/GXA-Studio/medical-booking-boilerplate.git
cd medical-booking-boilerplate
npm install
```

### 2 — Configure environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Description | Visibility |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — bypasses RLS | **Server only** |
| `SUPABASE_PROJECT_ID` | Project ref — only for `npm run db:types` | Local dev |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | **Server only** |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | **Server only** |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender (sandbox: `whatsapp:+14155238886`) | **Server only** |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL — rate limiting (booking + slot lookup) | **Server only** |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token | **Server only** |
| `NEXT_PUBLIC_APP_URL` | Public base URL (e.g. `https://clinica-a.vercel.app`) | Public |

### 3 — Apply database schema

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 4 — Regenerate TypeScript types (after schema changes)

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
# Upload each secret (repeat for all variables)
echo "value" | npx vercel env add VARIABLE_NAME production
npx vercel --prod

# Subsequent deploys — push to main, Vercel auto-deploys via GitHub integration
git push origin main
```

---

## Running E2E Tests

Tests use Playwright + a fixture page (`/test-fixture`) with static data — no database or Twilio required.

```bash
# Install browsers (first time)
npx playwright install chromium

# Local — starts dev server automatically
npx playwright test

# Against Vercel production
PLAYWRIGHT_BASE_URL=https://medical-booking-boilerplate.vercel.app npx playwright test
```

All 8 tests cover: service selection → doctor (specific or "any specialist") → slot → patient data → confirmed screen.

---

## Architecture Highlights

| Feature | Implementation |
|---|---|
| Double-booking prevention | PostgreSQL `EXCLUDE USING gist` — race-condition proof at DB level |
| Rate limiting | Upstash Redis — 2 active limiters: booking (10/h per IP), slot lookup (60/min per IP) |
| Instant booking | No OTP required — single POST to `book_slot_confirmed` RPC, status always `'confirmed'` |
| Multi-tenant routing | `clinics.slug` drives `/[clinicSlug]` — no code changes between tenants |
| Patient privacy | Patients never create accounts; all writes via `SECURITY DEFINER` RPCs |
| Admin access | Row-Level Security; profiles link users to their clinic |

See [PROJECT_STATE.md](PROJECT_STATE.md) for full architectural decisions, schema documentation, RPC specs, and known invariants.
