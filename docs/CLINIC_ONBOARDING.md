# Onboarding de una clínica nueva

Checklist operativo para desplegar el sistema para un cliente nuevo. Tiempo objetivo: **30 minutos** para un operador familiarizado.

> Pre-requisitos: cuenta Supabase activa, cuenta Vercel activa, cuenta Twilio activa, este repo clonado y `npx` disponible.

---

## 0. Datos a recopilar antes de empezar

Pídele al cliente, en una sola conversación, todo esto:

- [ ] Nombre comercial (ej. "Clínica Dental Sonrisa")
- [ ] Razón social oficial (puede coincidir con el comercial)
- [ ] CIF / NIF
- [ ] Domicilio social completo
- [ ] Email administrativo (ej. `admin@clinicasonrisa.es`) — para el acceso al panel
- [ ] Teléfono de contacto
- [ ] Color de marca preferido (HEX) — opcional
- [ ] Logo en PNG/SVG (opcional)
- [ ] Lista inicial de servicios + duración aproximada
- [ ] Doctores / especialistas con sus horarios habituales
- [ ] Slug deseado (ej. `clinica-sonrisa`) — debe ser URL-safe, sin acentos ni espacios

---

## 1. Crear el proyecto Supabase

1. Ir a [supabase.com/dashboard](https://supabase.com/dashboard) → **New Project**.
2. Nombre: `mbb-{slug}` (ej. `mbb-clinica-sonrisa`).
3. Región: **West EU (Ireland)** o **Frankfurt** según residencia del cliente.
4. Anotar:
   - `Project URL` → variable `NEXT_PUBLIC_SUPABASE_URL`
   - `anon key`   → variable `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → variable `SUPABASE_SERVICE_ROLE_KEY` (mantener en secreto)
   - `Project Ref` (parte antes de `.supabase.co`)

**✅ Verificación**: el proyecto aparece como "Active" en el dashboard.

---

## 2. Aplicar el schema

```bash
cd ~/projects/medical-booking-boilerplate
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Si el cliente prefiere ejecutar SQL directo, abrir el SQL Editor en Supabase Dashboard y pegar el contenido de `supabase/migrations/20260515_final_schema.sql` + las migraciones posteriores en orden cronológico.

**✅ Verificación**:
```sql
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';
-- Debe devolver al menos 6 tablas: clinics, profiles, doctors, services, appointments, marketing_leads
```

---

## 3. Insertar la clínica con sus datos legales

En el SQL Editor del nuevo proyecto:

```sql
INSERT INTO public.clinics (slug, name, legal_name, cif, address, phone, timezone)
VALUES (
  'clinica-sonrisa',                          -- slug
  'Clínica Dental Sonrisa',                   -- nombre comercial
  'Sonrisa Dental S.L.',                      -- razón social
  'B-12345678',                                -- CIF
  'C/ Mayor 12, 46001 Valencia, España',      -- dirección
  '+34963123456',                              -- teléfono
  'Europe/Madrid'
);
```

**✅ Verificación**:
```sql
SELECT * FROM public.clinics;  -- una sola fila, datos correctos
```

---

## 4. Crear el usuario administrador

1. Supabase Dashboard → **Authentication** → **Users** → **Add user**.
2. Email del cliente + contraseña temporal segura (avisar al cliente que la cambie).
3. El trigger `trg_on_auth_user_created` crea automáticamente la fila en `profiles`.

**✅ Verificación**:
```sql
SELECT u.email, p.role, p.clinic_id
FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC LIMIT 1;
-- Debe devolver el email + role NULL + clinic_id NULL todavía
```

---

## 5. Vincular el administrador a la clínica

```sql
UPDATE public.profiles
SET    clinic_id = (SELECT id FROM public.clinics WHERE slug = 'clinica-sonrisa' LIMIT 1),
       role      = 'admin'
WHERE  id = (SELECT id FROM auth.users WHERE email = 'admin@clinicasonrisa.es' LIMIT 1);
```

**✅ Verificación**:
```sql
SELECT p.role, u.email, c.name AS clinic
FROM   public.profiles p
JOIN   auth.users      u ON u.id = p.id
JOIN   public.clinics  c ON c.id = p.clinic_id;
-- Debe devolver: admin | <email> | Clínica Dental Sonrisa
```

---

## 6. Configurar Twilio para esta clínica

### Opción A — Producción (con WABA aprobado)

Si el cliente paga el tier Pro y tenemos un número WABA aprobado dedicado:
- `TWILIO_WHATSAPP_FROM=whatsapp:+34<NUMERO_WABA>`

### Opción B — Sandbox (provisional, primeros 30 días)

Para clientes Starter o mientras el WABA no esté aprobado, usar el sandbox global:
- `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`
- **Importante**: cada paciente que reciba un WhatsApp tiene que haber enviado primero `join <keyword>` al sandbox. Avisar al cliente que esto es provisional y comunicar el keyword en su recepción.

Ver `docs/TWILIO_WABA_SETUP.md` para el proceso de aprobación WABA completo.

---

## 7. Crear el proyecto Vercel

```bash
npx vercel link --project mbb-clinica-sonrisa
# Responder: Linking to new project? Y
# Project name: mbb-clinica-sonrisa
# Framework: Next.js (detectado)
```

> Alternativa multi-tenant futura (Fase 2): un único proyecto Vercel con dominio dinámico por clínica. Por ahora, **un proyecto Vercel por cliente**, para aislamiento total.

---

## 8. Configurar las variables de entorno en Vercel

En el dashboard del proyecto Vercel → **Settings** → **Environment Variables**, o por CLI:

```bash
echo "https://<project-ref>.supabase.co"  | npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
echo "eyJhbGciOi..."                       | npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
echo "eyJhbGciOi..."                       | npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
echo "<project-ref>"                       | npx vercel env add SUPABASE_PROJECT_ID production
echo "AC..."                                | npx vercel env add TWILIO_ACCOUNT_SID production
echo "..."                                  | npx vercel env add TWILIO_AUTH_TOKEN production
echo "+1500..."                             | npx vercel env add TWILIO_PHONE_NUMBER production
echo "whatsapp:+14155238886"                | npx vercel env add TWILIO_WHATSAPP_FROM production
echo "https://your-redis.upstash.io"        | npx vercel env add UPSTASH_REDIS_REST_URL production
echo "..."                                  | npx vercel env add UPSTASH_REDIS_REST_TOKEN production
echo "$(openssl rand -hex 32)"              | npx vercel env add OTP_HASH_PEPPER production
echo "$(openssl rand -hex 32)"              | npx vercel env add CRON_SECRET production
echo "https://mbb-clinica-sonrisa.vercel.app" | npx vercel env add NEXT_PUBLIC_APP_URL production
echo "Europe/Madrid"                        | npx vercel env add NEXT_PUBLIC_DEFAULT_TIMEZONE production
```

**Optional** (solo si este deploy debe enviar emails de notificación de leads a studiogxa@gmail.com):
```bash
echo "studiogxa@gmail.com"                  | npx vercel env add GMAIL_APP_USER production
echo "xxxx xxxx xxxx xxxx"                  | npx vercel env add GMAIL_APP_PASSWORD production
```
> El App Password se genera en https://myaccount.google.com/apppasswords (requiere 2-Step Verification activado).
> En despliegues de cliente (clínicas), normalmente NO hace falta — solo en el deploy "central" que sirve la landing de venta.

> Las claves Upstash pueden compartirse entre clientes — el rate-limit por IP funciona transversalmente; los prefijos por proyecto se diferencian gracias a las URLs de los rate limiters internos.

---

## 9. Desplegar

```bash
npx vercel --prod
```

Anotar la URL pública (ej. `https://mbb-clinica-sonrisa.vercel.app`) y actualizar `NEXT_PUBLIC_APP_URL` si la URL final es distinta a la prevista.

**✅ Verificación**: abrir `https://mbb-clinica-sonrisa.vercel.app/clinica-sonrisa` → la portada de booking carga sin errores.

---

## 10. Smoke test end-to-end

Desde un navegador en modo incógnito (sin sesión admin):

1. [ ] Ir a `/clinica-sonrisa` → ver la lista de servicios.
2. [ ] Seleccionar un servicio → ver doctores disponibles.
3. [ ] Seleccionar doctor → ver slots libres (un día concreto).
4. [ ] Reservar slot con tu propio nombre y teléfono `+34<TU_NUMERO>`.
5. [ ] Confirmar — debe llegar WhatsApp de confirmación a tu teléfono (recuerda haber hecho "join <keyword>" si estás en sandbox).
6. [ ] Abrir el link `/manage/<token>` del WhatsApp → ver tu cita.
7. [ ] Cancelar — debe llegar WhatsApp de cancelación.
8. [ ] Volver a `/clinica-sonrisa` y reservar el mismo slot → debe estar disponible de nuevo.
9. [ ] Abrir `/privacidad?slug=clinica-sonrisa` → ver el nombre comercial + CIF + domicilio reales de la clínica (no el placeholder genérico).
10. [ ] Acceder a `/auth/login` con el email admin → entrar al panel `/admin`.

Si todos los pasos pasan: **listo para entregar**.

---

## 11. Entregar al cliente

Email final al cliente con:

- URL pública: `https://mbb-clinica-sonrisa.vercel.app/clinica-sonrisa`
- URL admin: `https://mbb-clinica-sonrisa.vercel.app/auth/login`
- Email admin + contraseña temporal (con instrucción de cambiarla en primer acceso)
- Guía rápida de uso del panel (TODO: pendiente de redactar `docs/CLINIC_USER_GUIDE.md`)
- Email de soporte: `studiogxa@gmail.com`

---

## Mejoras pendientes (Fase 2)

- [ ] Script `scripts/onboard-clinic.js` que automatice pasos 1, 2, 7, 8 vía Supabase Management API + Vercel API.
- [ ] Threading del `clinic_slug` a `components/booking/step-patient.tsx` y al webhook de WhatsApp para que el link "privacidad" siempre incluya `?slug=`.
- [ ] Templating de `/aviso-legal` con datos reales del CIF y dirección de GXA Studio (hoy es placeholder).
- [ ] Dominio propio del cliente (ej. `reservas.clinicasonrisa.es`) apuntando a Vercel.
