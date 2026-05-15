# PROJECT STATE — Medical Booking Boilerplate
> **Single source of truth** for all future sessions.  
> Last updated: **2026-05-15** — MVP Premium completado. Admin con creación manual activa.

---

## 1. Tech Stack

| Capa | Tecnología | Detalles |
|---|---|---|
| Framework | Next.js 15 (App Router) | TypeScript strict, React 19 |
| Base de datos | Supabase (PostgreSQL 15+) | Auth + DB + RLS + SECURITY DEFINER RPCs |
| Hosting | Vercel | Serverless Edge/Node.js Route Handlers |
| Mensajería | Twilio WhatsApp Sandbox | `whatsapp:+14155238886` — reemplazar por número aprobado en prod |
| SMS (legacy) | Twilio SMS | OTP flow clásico — mantenido por compatibilidad |
| UI | shadcn/ui + Tailwind CSS | framer-motion para animaciones de pasos |
| Cache / Rate-limit | Upstash Redis | 4 limiters: otp-send, otp-verify, booking-ip, slots-ip |
| Validación | Zod | En todos los Route Handlers públicos |
| Fechas | date-fns-tz | Conversión UTC ↔ timezone local |

---

## 2. Flujos Principales (MVP Premium Completado)

### 2.1 Reserva de Pacientes — Fricción Cero

El flujo de reserva para el paciente no requiere cuenta ni registro. Opera enteramente mediante RPCs con `SECURITY DEFINER`.

**Ruta**: `POST /api/book`  
**RPC**: `book_slot_confirmed(clinic_id, doctor_id, service_id, patient_name, patient_phone, starts_at)`

```
Paciente → selecciona servicio / médico / franja horaria / datos personales
        → POST /api/book (validado con Zod + rate-limit IP)
        → RPC book_slot_confirmed (INSERT status='confirmed', atomic)
        → sendWhatsAppConfirmation (WhatsApp con link de autogestión)
        → appointmentId devuelto al frontend → pantalla de éxito
```

**Anti-colisión**: la tabla `appointments` tiene una constraint `EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status <> 'cancelled')`. PostgreSQL rechaza un INSERT con `exclusion_violation (23P01)`, capturado por la RPC como `SLOT_TAKEN (P0001)`.

La RPC libera además slots `pending` con OTP expirado antes del INSERT para evitar bloqueos fantasma.

**Componentes del wizard** (`components/booking/`):  
`booking-wizard.tsx` → `step-service.tsx` → `step-doctor.tsx` → `step-slot.tsx` → `step-patient.tsx` → `step-confirmed.tsx`

---

### 2.2 Notificaciones Automáticas (Twilio WhatsApp)

Todas las funciones están en `lib/twilio/client.ts` y usan `await` estricto (Vercel Node.js runtime).

| Evento | Función | Disparado desde |
|---|---|---|
| Reserva confirmada | `sendWhatsAppConfirmation` | `POST /api/book`, `bookAppointmentManual` (admin) |
| Cancelación por paciente | `sendCancellationWhatsApp` | `cancelByToken` (server action) |
| Reprogramación por paciente | `sendRescheduleWhatsApp` | `rescheduleAppointment` (server action) |
| Recordatorio 24h | `sendWhatsAppReminder` | `GET /api/cron/reminders` (en stand-by — ver §5) |

El mensaje de confirmación incluye siempre el link de autogestión: `{baseUrl}/manage/{cancellation_token}`.

---

### 2.3 Portal del Paciente — Autogestión

**Ruta**: `/manage/[token]`  
El token es un UUID único generado por defecto en `appointments.cancellation_token`.

```
Paciente accede a su link de autogestión
  ├── Cita activa y futura → botones Cancelar / Reprogramar
  ├── Cita pasada          → vista de solo lectura
  └── Cita cancelada       → estado informativo
```

**Server Actions** (`app/manage/[token]/actions.ts`):

- `cancelByToken(token)` — actualiza `status='cancelled'` solo si `status='confirmed'` y `starts_at > now()`. Envía `sendCancellationWhatsApp`. Usa `createServiceClient()` (service role, bypassa RLS).
- `rescheduleAppointment(token, newDoctorId, newStartsAt)` — llama a la RPC `reschedule_appointment` que valida colisiones con el mismo EXCLUDE constraint. Envía `sendRescheduleWhatsApp`.

---

## 3. Admin Panel (Actualizado)

### Acceso y Layout

- **Login**: `/auth/login` con Supabase Auth (email + password).
- **Redirect**: `/admin` redirige a `/admin/appointments` (dashboard eliminado).
- **Shell**: `AdminShell` (`components/admin/admin-shell.tsx`) — sidebar fijo en desktop, drawer con overlay en móvil.
- **Sidebar**: `components/admin/sidebar.tsx` — navegación: Citas, Médicos, Servicios, Horarios.

### Pantallas del Panel

| Pantalla | Ruta | Componente clave |
|---|---|---|
| Citas | `/admin/appointments` | `AppointmentsTable` + `NewAppointmentDialog` |
| Médicos | `/admin/doctors` | `DoctorsClient` |
| Servicios | `/admin/services` | `ServicesClient` |
| Horarios | `/admin/schedules` | `ScheduleEditor` |

### Vista de Citas — Diseño Responsive

La vista en `/admin/appointments` es mobile-first:
- **< md**: tarjetas apiladas con icono de estado, doctor, fecha y botón de cancelar.
- **≥ md**: tabla con columnas Paciente / Médico·Servicio / Fecha·Hora / Estado / Acciones.
- **Stats strip**: 4 contadores (Total / Pendientes / Confirmadas / Canceladas).
- **Filtros**: selector de estado + input de fecha, con botón "Limpiar filtros".

### Creación Manual de Citas (Staff → Paciente)

El staff puede crear citas telefónicamente desde `/admin/appointments` sin que el paciente tenga que pasar por el wizard.

**Botón**: "Nueva cita" (esquina superior derecha del encabezado de la página).

**Flujo del dialog** (`components/admin/new-appointment-dialog.tsx`):
1. Nombre del paciente + teléfono en formato E.164.
2. Selector de médico (carga médicos activos de la clínica).
3. Selector de servicio (filtrado automáticamente a los servicios del médico seleccionado).
4. Selector de fecha (input `date`, mínimo = hoy).
5. Horarios disponibles (fetch live a `GET /api/slots?doctorId=...&serviceId=...&date=...`).
6. Resumen visual de la cita seleccionada antes de confirmar.

**Server Action** (`bookAppointmentManual` en `app/(admin)/admin/appointments/actions.ts`):
- Valida nombre, teléfono E.164, UUIDs y que `startsAt` sea futuro.
- Obtiene `clinic_id` del perfil autenticado del admin.
- Llama a `book_slot_confirmed` via `createServiceClient()` — misma RPC que usa el flujo de pacientes; el EXCLUDE constraint sigue siendo la red de seguridad contra colisiones.
- Envía `sendWhatsAppConfirmation` al paciente con su link de autogestión.
- Hace `revalidatePath('/admin/appointments')` para refrescar la tabla.

**Regla de oro**: cualquier cita creada por el admin es indistinguible de una creada por el paciente. El paciente recibe el mismo WhatsApp de confirmación y tiene el mismo portal `/manage/[token]` para gestionar su cita.

---

## 4. Seguridad y Legal (Auditado)

### Rate Limiting (Upstash Redis)

| Limiter | Prefijo | Ventana | Límite |
|---|---|---|---|
| OTP envío | `@mbb/otp:send` | 10 min sliding | 3 por teléfono |
| OTP verificación | `@mbb/otp:verify` | 10 min fixed | 5 por appointmentId |
| Booking por IP | `@mbb/booking:ip` | 1 h sliding | 10 por IP |
| Slot lookup | `@mbb/slots:ip` | 1 min sliding | 60 por IP |

Todos los limiters fallan abiertos (`fail open`) si Redis no está disponible, para no bloquear usuarios en caso de caída del cache.

### Validaciones de Seguridad

- **UUID validation**: regex `/^[0-9a-f]{8}-[0-9a-f]{4}…$/i` antes de cualquier query a la BD.
- **OTP hashing**: HMAC-SHA256 con pepper (`OTP_HASH_PEPPER`) — plaintext nunca persiste.
- **Phone sanitization**: solo formato E.164 (`/^\+[1-9]\d{7,14}$/`).
- **Name sanitization**: strip de caracteres de control para prevenir SMS injection.
- **`server-only`**: importado en todos los módulos de servidor para prevenir fugas al bundle del cliente.
- **RLS**: Row Level Security activo — admin solo opera sobre su `clinic_id`.
- **SECURITY DEFINER RPCs**: `book_slot_confirmed`, `confirm_appointment`, `get_available_slots`, `reschedule_appointment` — ejecutan con permisos elevados desde el rol anon.

### Textos Legales (España — LSSI-CE / RGPD)

Configurados bajo el modelo **Beta Comercial / Pre-constitución** a nombre de **GXA Studio**:

| Página | Ruta |
|---|---|
| Política de Privacidad | `/privacidad` |
| Aviso Legal | `/aviso-legal` |
| Política de Cookies | `/cookies` |

El mensaje de confirmación WhatsApp incluye el aviso RGPD/AEPD: `"Tratamos tus datos según el RGPD. Responde INFO para más detalles."`

---

## 5. Stand-By / Pending (NO modificar ni intentar arreglar)

### Recordatorios Automáticos 24h

**Estado**: implementado en código, **cron desactivado intencionadamente**.

**Por qué está en stand-by**: el plan Hobby de Vercel no soporta crons con frecuencia horaria (`0 * * * *`). El trigger no se añade a `vercel.json` hasta migrar a un plan de pago en producción.

**Qué está implementado** (no tocar):

| Pieza | Archivo | Estado |
|---|---|---|
| Columna `reminder_sent BOOLEAN DEFAULT false` | `supabase/migrations/003_whatsapp_instant_booking.sql` | ✅ En BD |
| Índice de rendimiento para el cron | misma migración | ✅ En BD |
| `sendWhatsAppReminder()` | `lib/twilio/client.ts:164` | ✅ Listo |
| `GET /api/cron/reminders` | `app/api/cron/reminders/route.ts` | ✅ Listo |
| `vercel.json` | raíz del proyecto | ⏸ Vacío (cron desactivado) |

**Cómo activar cuando llegue el momento**:
1. Actualizar `vercel.json`:
   ```json
   {
     "crons": [{ "path": "/api/cron/reminders", "schedule": "0 * * * *" }]
   }
   ```
2. Añadir `CRON_SECRET` en Vercel Dashboard → Settings → Environment Variables.
3. El endpoint ya valida `Authorization: Bearer CRON_SECRET` y devuelve `{ sent, failed }`.

---

## 6. Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # SERVER-SIDE ONLY
SUPABASE_PROJECT_ID=              # Solo para npm run db:types

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=              # SMS (OTP legacy)
TWILIO_WHATSAPP_FROM=             # WhatsApp sender (sandbox: whatsapp:+14155238886)

# App
NEXT_PUBLIC_APP_URL=              # e.g. https://medical-booking-boilerplate.vercel.app
OTP_HASH_PEPPER=                  # 32-byte hex random — NUNCA cambiar en prod (invalida OTPs)
INTERNAL_API_SECRET=              # 32-byte hex random

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Cron (cuando se active)
CRON_SECRET=                      # 32-byte hex random — pendiente de añadir en Vercel Dashboard
```

---

## 7. Base de Datos — Esquema Activo

### Tablas Principales

```
clinics          id, name, slug*, timezone, phone, address, settings(jsonb)
profiles         id→auth.users, clinic_id, full_name, role(admin|staff)
services         id, clinic_id, name, duration_minutes, price, is_active
doctors          id, clinic_id, name, email, specialty, avatar_url, is_active
doctor_services  doctor_id, service_id  [PK composite]
schedules        id, doctor_id, day_of_week(0-6), start_time, end_time, is_active
appointments     id, clinic_id, doctor_id, service_id,
                 patient_name, patient_phone,
                 starts_at(UTC), ends_at(UTC),
                 status(pending|confirmed|cancelled),
                 cancellation_token(UUID, UNIQUE),
                 reminder_sent(BOOLEAN, DEFAULT false),
                 otp_code_hash, otp_expires_at, notes
```

### RPCs Activas

| Función | Caller | Auth |
|---|---|---|
| `get_available_slots(doctor_id, service_id, date)` | `/api/slots` | anon |
| `get_slots_for_service(service_id, date)` | `/api/slots` (mode B) | anon |
| `book_slot(clinic_id, doctor_id, service_id, name, phone, starts_at, otp_hash)` | `/api/otp/send` | anon |
| `confirm_appointment(appointment_id, otp_hash)` | `/api/otp/verify` | anon |
| `book_slot_confirmed(clinic_id, doctor_id, service_id, name, phone, starts_at)` | `/api/book`, `bookAppointmentManual` | anon |
| `reschedule_appointment(cancellation_token, new_doctor_id, new_starts_at)` | `rescheduleAppointment` | service role |

### Migraciones Aplicadas en Producción

| Archivo | Contenido |
|---|---|
| `20260515_final_schema.sql` | Schema completo + seed + trigger auto-perfil (CERTIFICADO) |
| `20260515_perf_indexes.sql` | 5 índices B-Tree (clínica, servicios, médicos, citas) |
| `003_whatsapp_instant_booking.sql` | `cancellation_token`, `reminder_sent`, `book_slot_confirmed` RPC |

---

## 8. Git — Estado del Repositorio

**Remote**: `https://github.com/GXA-Studio/medical-booking-boilerplate.git`  
**Vercel**: `https://medical-booking-boilerplate.vercel.app`  
**Rama activa**: `main`

| Hash | Descripción |
|---|---|
| `0d0b462` | chore(init): setup nextjs structure, db schema and context |
| `87e4bf8` | fix(security): apply audit patches (C-01 through M-04) |
| `e438e36` | feat(admin): complete admin dashboard |
| `a7ff83d` | fix(admin): make timezone dynamic |
| `b3a116f` | feat(booking): add patient booking flow + fix TypeScript types |
| `faa19d2` | fix(types): upgrade @supabase/ssr 0.5.2→0.10.3 (52 errors → 0) |
| `8ccd130` | test(e2e): add Playwright booking funnel + Vercel deployment config |
| `33aecb9` | chore: final quality audit and typescript fixes |
| `4c815e5` | perf: implement parallel fetching, redis caching, and db indexing |
| `625198c` | feat: add 24h automated whatsapp reminders and admin manual booking UI |
| `(HEAD)` | docs: update PROJECT_STATE.md with current MVP status and standby features |
