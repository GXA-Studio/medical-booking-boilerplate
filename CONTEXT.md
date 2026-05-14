# CONTEXT — Medical Booking Boilerplate

> **State of the Union** — update this file at the end of every major step and commit.  
> Last updated: Step 3 (Route Handlers completed)

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | TypeScript strict, React 19 |
| Database | Supabase (PostgreSQL 15+) | Auth + DB + RLS |
| Hosting | Vercel | Serverless Edge/Node.js Route Handlers |
| SMS / OTP | Twilio (SMS only) | No WhatsApp — avoids Meta template approval per clinic |
| UI | shadcn/ui + Tailwind | framer-motion for step animations |
| Validation | Zod | On all API route inputs |

---

## Architectural Decisions

### Double-booking prevention
Uses a PostgreSQL `EXCLUDE USING gist` constraint on `appointments`:
```sql
EXCLUDE USING gist (
  doctor_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status <> 'cancelled')
```
Requires `btree_gist` extension. PostgreSQL serializes concurrent INSERTs via predicate locks on the GiST index — **zero race conditions possible**. If two requests hit the same slot simultaneously, one gets `exclusion_violation (23P01)` → caught in `book_slot` RPC → returned as `SLOT_TAKEN (P0001)`.

### Multi-shift schedules
`schedules` table allows multiple rows per `(doctor_id, day_of_week)`. A morning shift (09:00–13:00) and afternoon shift (16:00–20:00) are two separate rows. Overlap between blocks is prevented by the `trg_check_schedule_overlap` BEFORE trigger using PostgreSQL's `OVERLAPS` operator.

### Timezones
- **Database**: everything stored in UTC (`TIMESTAMPTZ`)
- **`schedules.start_time` / `end_time`**: stored as `TIME` in the clinic's local timezone
- **Conversion**: `get_available_slots` uses `timezone(clinic.timezone, local_timestamp)` to convert to UTC — handles DST automatically
- **UI / SMS**: converts UTC → local only at display/send time using `date-fns-tz`

### OTP security
- 6-digit code generated with `crypto.randomInt` (CSPRNG)
- Stored as **SHA-256 hash** — plaintext never persisted
- 5-minute TTL enforced at DB level (`otp_expires_at`)
- After confirmation, both `otp_code_hash` and `otp_expires_at` cleared → replay-proof
- Twilio credentials exist **only** in Route Handlers (server-side) — never in client bundles

### Patient guest flow
No Supabase Auth account for patients. Flow:
1. Select service → select doctor → select slot
2. Enter phone (E.164 format) + name → `POST /api/otp/send`
   - `book_slot` RPC creates PENDING appointment (slot claimed atomically)
   - Twilio sends SMS with 6-digit OTP
3. Enter OTP → `POST /api/otp/verify`
   - `confirm_appointment` RPC verifies hash → status = confirmed
   - Twilio sends confirmation SMS
4. Appointment confirmed — no account created

### Multi-tenant white-label
Each deployment: `git clone` → inject `.env` → `npm run db:types` → deploy.  
No code changes required between tenants. `clinics.slug` drives URL routing (`/[clinicSlug]`).

---

## Database Schema

### Tables

```
clinics          id, name, slug*, timezone, phone, address, settings(jsonb), updated_at
profiles         id→auth.users, clinic_id, full_name, role(admin|staff)
services         id, clinic_id, name, duration_minutes, price, is_active
doctors          id, clinic_id, name, email, specialty, avatar_url, is_active
doctor_services  doctor_id, service_id  [PK composite]
schedules        id, doctor_id, day_of_week(0-6), start_time, end_time, is_active
appointments     id, clinic_id, doctor_id, service_id, patient_name, patient_phone,
                 starts_at(UTC), ends_at(UTC), status(pending|confirmed|cancelled),
                 otp_code_hash, otp_expires_at, notes
```

### Key constraints
- `appointments`: `EXCLUDE USING gist (doctor_id WITH =, tstzrange(...) WITH &&) WHERE status <> 'cancelled'`
- `schedules`: BEFORE trigger prevents overlapping blocks per doctor per day
- Cascade deletes: service/doctor rows deleted → appointments protected (`ON DELETE RESTRICT`)

### RLS summary
| Table | Public read | Admin write |
|---|---|---|
| clinics | — | own clinic only |
| services | active rows | own clinic |
| doctors | active rows | own clinic |
| schedules | active rows | own clinic's doctors |
| appointments | — | own clinic |
| profiles | own row only | own row only |

### RPC functions
| Function | Caller | Auth |
|---|---|---|
| `get_available_slots(doctor_id, service_id, date)` | Frontend / `/api/slots` | anon |
| `book_slot(clinic_id, doctor_id, service_id, name, phone, starts_at, otp_hash)` | `/api/otp/send` | anon (SECURITY DEFINER) |
| `confirm_appointment(appointment_id, otp_hash)` | `/api/otp/verify` | anon (SECURITY DEFINER) |

---

## Environment Variables

```bash
# Supabase — NEXT_PUBLIC_* are safe to expose in the browser
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # SERVER-SIDE ONLY — never expose to client
SUPABASE_PROJECT_ID=         # Only needed for npm run db:types

# Twilio — SERVER-SIDE ONLY
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# App
NEXT_PUBLIC_APP_URL=         # e.g. https://clinica-salud.vercel.app
INTERNAL_API_SECRET=         # 32-byte random hex, used to validate internal calls
```

---

## Project Status

| Step | Description | Status |
|---|---|---|
| 1 | Scaffolding (Next.js, config, Supabase clients, Twilio client, utils) | ✅ Done |
| 2 | Database schema (`001_initial.sql`) — multi-shift schedules, EXCLUDE constraint, RPCs, RLS | ✅ Done |
| 3 | Route Handlers (`/api/otp/send`, `/api/otp/verify`, `/api/slots`, `/api/webhooks/twilio`) | ✅ Done |
| 4 | Admin Dashboard (Supabase Auth, services/doctors/schedules CRUD, appointment calendar) | ⏳ Pending |
| 5 | Patient Booking Flow (animated step-by-step with framer-motion, OTP modal) | ⏳ Pending |

---

## Next Action

**Step 4**: Build the Admin Dashboard — protected routes under `app/(admin)/admin/`.  
Screens: Login, Dashboard overview, Services CRUD, Doctors CRUD, Schedules (multi-shift calendar editor), Appointments list.  
Stack: shadcn/ui DataTable + Calendar + Forms; Supabase Auth session via `@supabase/ssr`.
