# CONTEXT — Medical Booking Boilerplate

> **State of the Union** — update this file at the end of every major step and commit.  
> Last updated: Step 4 (Admin Dashboard completed)

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
| 4 | Admin Dashboard (Supabase Auth, services/doctors/schedules CRUD, appointment calendar) | ✅ Done |
| 5 | Patient Booking Flow (animated step-by-step with framer-motion, OTP modal) | ✅ Done |

---

## Admin Dashboard — Screen Inventory (Step 4)

| Screen | Path | Component | Status |
|---|---|---|---|
| Login | `/auth/login` | `app/auth/login/page.tsx` | ✅ |
| Dashboard | `/admin` | `app/(admin)/admin/page.tsx` | ✅ |
| Services | `/admin/services` | `components/admin/services-client.tsx` | ✅ |
| Doctors | `/admin/doctors` | `components/admin/doctors-client.tsx` | ✅ |
| Schedules | `/admin/schedules` | `components/admin/schedule-editor.tsx` | ✅ |
| Appointments | `/admin/appointments` | `components/admin/appointments-table.tsx` | ✅ |

---

## Patient Booking Flow — Component Inventory (Step 5)

| Component | Responsibility |
|---|---|
| `app/(booking)/[clinicSlug]/layout.tsx` | Sticky header with clinic name |
| `app/(booking)/[clinicSlug]/page.tsx` | Server: fetch clinic + active services + active doctors |
| `components/booking/booking-wizard.tsx` | Orchestrator: global state, progress bar (framer-motion), AnimatePresence |
| `components/booking/step-service.tsx` | Service cards (duration, price, doctor count) |
| `components/booking/step-doctor.tsx` | Doctor cards with initials avatar |
| `components/booking/step-slot.tsx` | 14-day date strip + slot grid (fetches `/api/slots`, timezone-aware) |
| `components/booking/step-patient.tsx` | Name + E.164 phone + **GDPR/RGPD consent block + mandatory checkbox** |
| `components/booking/step-otp.tsx` | 6 individual inputs with auto-advance, paste, 60s resend cooldown |
| `components/booking/step-confirmed.tsx` | Spring-animated success state + booking summary card |

---

## ⚠️ ESTADO PARA LA NUEVA SESIÓN

**El codebase está COMPLETO.** Todos los pasos (1–5) están implementados y commiteados.  
No escribir código nuevo hasta completar los dos pasos de calidad siguientes en orden estricto:

### Paso A — Regenerar tipos TypeScript (BLOQUEANTE)

Hay 50 errores de TypeScript activos. Son **exclusivamente** errores de inferencia de Supabase
(`TS2339: never`) causados por el archivo `lib/supabase/types.ts` escrito a mano. Se resuelven
en su totalidad ejecutando el siguiente comando contra la base de datos de producción:

```bash
npx supabase gen types typescript \
  --project-id eeqmtmryyqdacjcrrkwd \
  --schema public \
  > lib/supabase/types.ts
```

Si el comando falla por permisos de Management API, usar la alternativa con la URL directa:

```bash
SUPABASE_ACCESS_TOKEN=<personal_access_token> \
npx supabase gen types typescript \
  --project-id eeqmtmryyqdacjcrrkwd \
  > lib/supabase/types.ts
```

Tras regenerar: ejecutar `npx tsc --noEmit`. El resultado esperado es **0 errores**.  
Luego hacer commit: `fix(types): regenerate from live supabase schema`.

### Paso B — Auditoría E2E con Playwright

Crear `tests/booking-flow.spec.ts` que cubra el embudo completo de conversión:

1. Navegar a `/<clinicSlug>`
2. Seleccionar servicio → médico → slot → datos de paciente
3. Verificar que el checkbox RGPD es obligatorio (no envía sin él)
4. Mock del endpoint `/api/otp/send` (no enviar SMS reales en tests)
5. Verificar que los 6 inputs OTP aceptan pegado y auto-avanzan el foco
6. Mock de `/api/otp/verify` → verificar que se muestra `step-confirmed`

Instalar Playwright si no está: `npm init playwright@latest`.

---

## Git — Estado del Repositorio

| Commit | Hash | Descripción |
|---|---|---|
| 1 | `0d0b462` | chore(init): setup nextjs structure, db schema and context |
| 2 | `87e4bf8` | fix(security): apply ruflo audit patches (C-01 through M-04) |
| 3 | `e438e36` | feat(admin): complete admin dashboard |
| 4 | `a7ff83d` | fix(admin): make timezone dynamic |
| 5 | `b3a116f` | feat(booking): add patient booking flow + fix TypeScript types |
| 6 | `(handoff)` | chore(context): prepare handoff state |

**Remote**: `https://github.com/GXA-Studio/medical-booking-boilerplate.git`  
**Push pendiente**: La CLI de gh está autenticada como `automatizacionesibiza`, no como `GXA-Studio`.  
Para desbloquear el push en la nueva sesión, ejecutar primero:

```bash
! gh auth login   # login con la cuenta GXA-Studio o añadir token con permisos push
git push -u origin main
```
