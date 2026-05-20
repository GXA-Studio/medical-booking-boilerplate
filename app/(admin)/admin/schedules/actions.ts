'use server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { sendCancellationWhatsApp } from '@/lib/twilio/client'
import { getBaseUrl } from '@/lib/utils'
import type { TablesInsert } from '@/lib/supabase/types'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME_RE = /^\d{2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const ScheduleSchema = z.object({
  doctor_id:   z.string().uuid(),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time:  z.string().regex(TIME_RE),
  end_time:    z.string().regex(TIME_RE),
})

async function getClinicContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, clinics(slug)')
    .eq('id', user.id)
    .single()
  if (!profile?.clinic_id) throw new Error('No clinic')
  return {
    clinicId:   profile.clinic_id as string,
    clinicSlug: (profile.clinics as { slug: string } | null)?.slug ?? null,
  }
}

async function assertDoctorOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doctorId: string,
) {
  if (!UUID_RE.test(doctorId)) throw new Error('Invalid doctor id')
  const { clinicId, clinicSlug } = await getClinicContext(supabase)
  const { data: doctor } = await supabase
    .from('doctors').select('id').eq('id', doctorId).eq('clinic_id', clinicId).single()
  if (!doctor) throw new Error('Doctor not found')
  return { clinicId, clinicSlug }
}

// Bust both Next.js RSC cache for known affected paths AND the Upstash booking
// cache (services/doctors metadata) so the public booking page also reloads
// from DB on its next request.
async function bustSlotCaches(clinicSlug: string | null) {
  revalidatePath('/admin/schedules')
  revalidatePath('/admin/agenda')
  revalidatePath('/admin/appointments')
  if (clinicSlug) {
    revalidatePath(`/${clinicSlug}`)
    await invalidateBookingCache(clinicSlug)
  }
}

// ─── Weekly schedules ────────────────────────────────────────────────────────
export async function createSchedule(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ScheduleSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { data: doctor } = await supabase
    .from('doctors').select('id').eq('id', parsed.data.doctor_id).eq('clinic_id', clinicId).single()
  if (!doctor) return { error: 'Doctor no encontrado.' }

  const { error } = await supabase.from('schedules').insert({
    doctor_id:   parsed.data.doctor_id,
    day_of_week: parsed.data.day_of_week,
    start_time:  parsed.data.start_time + ':00',
    end_time:    parsed.data.end_time   + ':00',
  })

  if (error) {
    if (error.message.includes('schedule_overlap')) return { error: 'El bloque se solapa con un turno existente.' }
    console.error('[createSchedule] DB error:', error)
    return { error: 'Error al guardar el horario.' }
  }

  await bustSlotCaches(clinicSlug)
  return { success: true }
}

export async function deleteSchedule(id: string) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)

  await supabase.from('schedules').delete().eq('id', id)

  await bustSlotCaches(clinicSlug)
}

export async function toggleSchedule(id: string, isActive: boolean) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)
  await supabase.from('schedules').update({ is_active: isActive }).eq('id', id)
  await bustSlotCaches(clinicSlug)
}

// ─── Schedule exceptions ─────────────────────────────────────────────────────
// New semantic: each row is a "block" (subtraction from availability).
//   kind='full-day' → entire date is unavailable
//   kind='partial'  → only the [start, end) range is unavailable
export type ExceptionInput =
  | {
      doctor_id:      string
      exception_date: string
      kind:           'full-day'
    }
  | {
      doctor_id:      string
      exception_date: string
      kind:           'partial'
      start_time:     string
      end_time:       string
    }

// Conflicting appointment summary returned by checkExceptionConflicts —
// the schedule editor uses it to drive the AlertDialog warning.
export interface ConflictAppointment {
  id:            string
  patient_name:  string
  patient_phone: string
  starts_at:     string
  ends_at:       string
}

const ExceptionSchema = z.object({
  doctor_id:      z.string().uuid(),
  exception_date: z.string().regex(DATE_RE),
  kind:           z.enum(['full-day', 'partial']),
  start_time:     z.string().regex(TIME_RE).optional(),
  end_time:       z.string().regex(TIME_RE).optional(),
}).superRefine((d, ctx) => {
  if (d.kind === 'partial') {
    if (!d.start_time || !d.end_time) {
      ctx.addIssue({ code: 'custom', message: 'Falta la franja horaria del bloqueo.', path: ['start_time'] })
      return
    }
    if (d.start_time >= d.end_time) {
      ctx.addIssue({
        code:    'custom',
        message: 'La hora de inicio debe ser menor que la de fin.',
        path:    ['end_time'],
      })
    }
  }
})

function todayLocalISO(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

// ─── Conflict detection ─────────────────────────────────────────────────────
// Returns the confirmed appointments that overlap with the proposed exception.
//   full-day → every confirmed appointment for that doctor on that date
//   partial  → confirmed appointments whose [starts_at, ends_at) overlaps with
//              [exception_date + start_time, exception_date + end_time)
//              (computed in the clinic's timezone)
export async function checkExceptionConflicts(input: ExceptionInput): Promise<{
  conflicts:   ConflictAppointment[]
  totalCount:  number
} | { error: string }> {
  const parsed = ExceptionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  await assertDoctorOwnership(supabase, parsed.data.doctor_id)

  // Resolve clinic timezone via the doctor's clinic
  const { data: doctorRow } = await supabase
    .from('doctors')
    .select('clinic_id, clinics(timezone)')
    .eq('id', parsed.data.doctor_id)
    .single()
  const timezone = (doctorRow?.clinics as { timezone: string } | null)?.timezone ?? 'UTC'

  // Build the UTC window we need to check overlap against
  const dateStr = parsed.data.exception_date
  let windowStartUtc: Date
  let windowEndUtc:   Date
  if (parsed.data.kind === 'full-day') {
    windowStartUtc = utcFromClinicLocal(`${dateStr}T00:00:00`, timezone)
    windowEndUtc   = utcFromClinicLocal(`${dateStr}T23:59:59.999`, timezone)
  } else {
    windowStartUtc = utcFromClinicLocal(`${dateStr}T${parsed.data.start_time!}:00`, timezone)
    windowEndUtc   = utcFromClinicLocal(`${dateStr}T${parsed.data.end_time!}:00`, timezone)
  }

  // Fetch confirmed appointments for the doctor whose [starts_at, ends_at)
  // overlaps the window. The overlap predicate `a.starts < window_end AND a.ends > window_start`
  // is expressed as two range filters via PostgREST.
  const { data: rows, error } = await supabase
    .from('appointments')
    .select('id, patient_name, patient_phone, starts_at, ends_at')
    .eq('doctor_id', parsed.data.doctor_id)
    .eq('status', 'confirmed')
    .lt('starts_at', windowEndUtc.toISOString())
    .gt('ends_at',   windowStartUtc.toISOString())
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[checkExceptionConflicts] DB error:', error)
    return { error: 'No se pudo verificar el solapamiento de citas.' }
  }

  return {
    conflicts:  (rows ?? []) as ConflictAppointment[],
    totalCount: (rows ?? []).length,
  }
}

// Local datetime ("YYYY-MM-DDTHH:MM[:SS][.SSS]") + IANA TZ → UTC Date.
// Reuses date-fns-tz to stay DST-safe (same library used elsewhere in this codebase).
function utcFromClinicLocal(localDateTime: string, tz: string): Date {
  // Lazy require to avoid bundling overhead in the hot path of public routes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fromZonedTime } = require('date-fns-tz') as typeof import('date-fns-tz')
  return fromZonedTime(localDateTime, tz)
}

export async function createScheduleException(
  input: ExceptionInput,
  options?: { cancelOverlapping?: boolean },
) {
  const parsed = ExceptionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  const { clinicSlug } = await assertDoctorOwnership(supabase, parsed.data.doctor_id)

  if (parsed.data.exception_date < todayLocalISO()) {
    return { error: 'No puedes añadir excepciones para fechas pasadas.' }
  }

  const row: TablesInsert<'doctor_schedule_exceptions'> =
    parsed.data.kind === 'full-day'
      ? {
          doctor_id:      parsed.data.doctor_id,
          exception_date: parsed.data.exception_date,
          is_working:     false,
          start_time:     null,
          end_time:       null,
        }
      : {
          doctor_id:      parsed.data.doctor_id,
          exception_date: parsed.data.exception_date,
          is_working:     false,
          // superRefine guarantees both are present when kind === 'partial'
          start_time:     parsed.data.start_time! + ':00',
          end_time:       parsed.data.end_time!   + ':00',
        }

  const { error } = await supabase.from('doctor_schedule_exceptions').insert(row)

  if (error) {
    if (error.code === '23505') {
      return { error: 'Ya existe una excepción idéntica para esa fecha y rango.' }
    }
    console.error('[createScheduleException] DB error:', error)
    return { error: 'Error al guardar la excepción.' }
  }

  // Optional: cancel overlapping confirmed appointments and notify patients.
  // Bookkeeping for the caller (UI toast) so we can report what we cleaned up.
  let cancelledCount = 0
  if (options?.cancelOverlapping) {
    cancelledCount = await cancelOverlappingAppointments({
      doctorId: parsed.data.doctor_id,
      kind:     parsed.data.kind,
      date:     parsed.data.exception_date,
      startHM:  parsed.data.kind === 'partial' ? parsed.data.start_time! : null,
      endHM:    parsed.data.kind === 'partial' ? parsed.data.end_time!   : null,
    })
  }

  await bustSlotCaches(clinicSlug)
  return { success: true, cancelledCount }
}

// Finds confirmed appointments overlapping the exception window, marks them
// as cancelled in a single UPDATE, then defers Twilio notifications via
// after() + Promise.allSettled so the response stays fast (Vercel will keep
// the function alive until the WhatsApp calls resolve).
async function cancelOverlappingAppointments(args: {
  doctorId: string
  kind:     'full-day' | 'partial'
  date:     string
  startHM:  string | null
  endHM:    string | null
}): Promise<number> {
  const supabase = await createClient()

  const { data: doctorRow } = await supabase
    .from('doctors')
    .select('name, clinic_id, clinics(slug, name, timezone)')
    .eq('id', args.doctorId)
    .single()
  const clinic     = doctorRow?.clinics as { slug: string; name: string; timezone: string } | null
  const timezone   = clinic?.timezone ?? 'UTC'
  const clinicName = clinic?.name     ?? 'la clínica'
  const clinicSlug = clinic?.slug     ?? null
  const doctorName = (doctorRow as { name?: string } | null)?.name ?? null

  let windowStartUtc: Date
  let windowEndUtc:   Date
  if (args.kind === 'full-day') {
    windowStartUtc = utcFromClinicLocal(`${args.date}T00:00:00`, timezone)
    windowEndUtc   = utcFromClinicLocal(`${args.date}T23:59:59.999`, timezone)
  } else {
    windowStartUtc = utcFromClinicLocal(`${args.date}T${args.startHM!}:00`, timezone)
    windowEndUtc   = utcFromClinicLocal(`${args.date}T${args.endHM!}:00`, timezone)
  }

  // Service-role client to bypass RLS for the bulk update + notify pipeline.
  const svc = createServiceClient()
  const { data: cancelled, error } = await svc
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('doctor_id', args.doctorId)
    .eq('status', 'confirmed')
    .lt('starts_at', windowEndUtc.toISOString())
    .gt('ends_at',   windowStartUtc.toISOString())
    .select('id, patient_name, patient_phone, starts_at')

  if (error) {
    console.error('[cancelOverlappingAppointments] DB error:', error)
    return 0
  }

  const rows = cancelled ?? []
  if (rows.length === 0) return 0

  // Defer Twilio so the action returns immediately. Promise.allSettled keeps
  // one failed send from blocking the others.
  after(async () => {
    const baseUrl      = getBaseUrl()
    const rescheduleUrl = clinicSlug ? `${baseUrl}/${clinicSlug}` : undefined
    const results = await Promise.allSettled(
      rows.map((r) =>
        sendCancellationWhatsApp({
          to:          r.patient_phone as string,
          patientName: r.patient_name as string,
          clinicName,
          startsAt:    r.starts_at as string,
          timezone,
          doctorName:   doctorName ?? undefined,
          rescheduleUrl,
        })
      )
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) {
      console.error(`[cancelOverlappingAppointments] ${failed}/${rows.length} WhatsApp sends failed`)
    }
  })

  return rows.length
}

export async function deleteScheduleException(id: string) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)

  await supabase.from('doctor_schedule_exceptions').delete().eq('id', id)

  await bustSlotCaches(clinicSlug)
}
