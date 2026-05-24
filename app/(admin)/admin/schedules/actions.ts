'use server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { fromZonedTime } from 'date-fns-tz'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { sendCancellationWhatsApp } from '@/lib/twilio/client'
import { getBaseUrl } from '@/lib/utils'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'
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
  if (await isGuestMode()) return DEMO_RESULT
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
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)

  await supabase.from('schedules').delete().eq('id', id)

  await bustSlotCaches(clinicSlug)
}

export async function toggleSchedule(id: string, isActive: boolean) {
  if (await isGuestMode()) return DEMO_RESULT
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

  const { startUtc: windowStartUtc, endUtc: windowEndUtc } = buildExceptionWindow({
    date:     parsed.data.exception_date,
    kind:     parsed.data.kind,
    startHM:  parsed.data.kind === 'partial' ? parsed.data.start_time! : null,
    endHM:    parsed.data.kind === 'partial' ? parsed.data.end_time!   : null,
    timezone,
  })

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
  return fromZonedTime(localDateTime, tz)
}

// Increment a YYYY-MM-DD by one calendar day. Uses Date's local constructor so
// month/year rollover is automatic and we never round-trip through UTC.
function nextDayLocal(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    String(next.getDate()).padStart(2, '0'),
  ].join('-')
}

// B-2 — Single source of truth for the exception window. Full-day blocks end
// at the next day's 00:00 (the first instant NOT covered), partial blocks end
// at their declared end_time. Both endpoints are exclusive, matching the
// PostgREST predicate `starts_at < windowEnd AND ends_at > windowStart`.
function buildExceptionWindow(args: {
  date:     string
  kind:     'full-day' | 'partial'
  startHM:  string | null
  endHM:    string | null
  timezone: string
}): { startUtc: Date; endUtc: Date } {
  if (args.kind === 'full-day') {
    return {
      startUtc: utcFromClinicLocal(`${args.date}T00:00:00`, args.timezone),
      endUtc:   utcFromClinicLocal(`${nextDayLocal(args.date)}T00:00:00`, args.timezone),
    }
  }
  return {
    startUtc: utcFromClinicLocal(`${args.date}T${args.startHM!}:00`, args.timezone),
    endUtc:   utcFromClinicLocal(`${args.date}T${args.endHM!}:00`,   args.timezone),
  }
}

export async function createScheduleException(
  input: ExceptionInput,
  options?: { cancelOverlapping?: boolean },
) {
  if (await isGuestMode()) return DEMO_RESULT
  const parsed = ExceptionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await assertDoctorOwnership(supabase, parsed.data.doctor_id)

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

  // B-1 race-condition mitigation: persist the exception BEFORE cancelling
  // overlapping appointments. From the INSERT onward, get_available_slots /
  // book_slot_confirmed will reject any new reservation in the window, so a
  // patient cannot squeeze a booking in between the admin confirmation and
  // the bulk cancel below. Any appointment that already existed (or slipped
  // through before this INSERT) is captured by the UPDATE's RETURNING set,
  // which then becomes the sole source of truth for Twilio notifications.
  const { data: inserted, error: insertError } = await supabase
    .from('doctor_schedule_exceptions')
    .insert(row)
    .select('id')
    .single()

  if (insertError || !inserted) {
    if (insertError?.code === '23505') {
      return { error: 'Ya existe una excepción idéntica para esa fecha y rango.' }
    }
    console.error('[createScheduleException] DB error:', insertError)
    return { error: 'Error al guardar la excepción.' }
  }

  let cancelledCount = 0
  if (options?.cancelOverlapping) {
    const cancelResult = await cancelOverlappingAppointments({
      clinicId,
      doctorId: parsed.data.doctor_id,
      kind:     parsed.data.kind,
      date:     parsed.data.exception_date,
      startHM:  parsed.data.kind === 'partial' ? parsed.data.start_time! : null,
      endHM:    parsed.data.kind === 'partial' ? parsed.data.end_time!   : null,
    })

    if (cancelResult.error) {
      // Rollback the exception so the admin can retry cleanly — leaving it
      // in place would block future bookings without ever notifying the
      // patients whose appointments fall inside the window.
      const { error: rollbackError } = await supabase
        .from('doctor_schedule_exceptions')
        .delete()
        .eq('id', inserted.id)
      if (rollbackError) {
        console.error('[createScheduleException] rollback failed:', rollbackError)
      }
      return { error: 'No se pudieron cancelar las citas afectadas. Vuelve a intentarlo.' }
    }

    cancelledCount = cancelResult.rows.length
  }

  await bustSlotCaches(clinicSlug)
  return { success: true, cancelledCount }
}

// Cancels confirmed appointments overlapping the exception window in a single
// UPDATE ... RETURNING. The returned set is the canonical list of affected
// patients — Twilio notifications are dispatched exclusively from it, so the
// admin never gets a count that diverges from the rows actually mutated.
type CancelledRow = {
  id:            string
  patient_name:  string
  patient_phone: string
  starts_at:     string
}

async function cancelOverlappingAppointments(args: {
  clinicId: string
  doctorId: string
  kind:     'full-day' | 'partial'
  date:     string
  startHM:  string | null
  endHM:    string | null
}): Promise<{ rows: CancelledRow[]; error?: string }> {
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

  const { startUtc: windowStartUtc, endUtc: windowEndUtc } = buildExceptionWindow({
    date:     args.date,
    kind:     args.kind,
    startHM:  args.startHM,
    endHM:    args.endHM,
    timezone,
  })

  // Service-role client to bypass RLS for the bulk update + notify pipeline.
  const svc = createServiceClient()

  // S-A6 defence-in-depth: build the canonical doctor-ID set for the
  // verified clinic and AND-scope the UPDATE by it. Even if `args.doctorId`
  // were tampered with to point at another tenant, the `.in()` filter would
  // reject the row before it reaches the appointments table.
  const { data: clinicDoctors, error: doctorListError } = await svc
    .from('doctors')
    .select('id')
    .eq('clinic_id', args.clinicId)
  if (doctorListError) {
    console.error('[cancelOverlappingAppointments] doctor-list lookup failed:', doctorListError)
    return { rows: [], error: doctorListError.message }
  }
  const allowedDoctorIds = (clinicDoctors ?? []).map((d) => d.id)
  if (!allowedDoctorIds.includes(args.doctorId)) {
    console.error(
      '[cancelOverlappingAppointments] cross-tenant attempt blocked',
      { clinicId: args.clinicId, doctorId: args.doctorId },
    )
    return { rows: [], error: 'Doctor outside clinic scope' }
  }

  const { data: cancelled, error } = await svc
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('doctor_id', args.doctorId)
    .in('doctor_id', allowedDoctorIds)
    .eq('status', 'confirmed')
    .lt('starts_at', windowEndUtc.toISOString())
    .gt('ends_at',   windowStartUtc.toISOString())
    .select('id, patient_name, patient_phone, starts_at')

  if (error) {
    console.error('[cancelOverlappingAppointments] DB error:', error)
    return { rows: [], error: error.message }
  }

  const rows = (cancelled ?? []) as CancelledRow[]
  if (rows.length === 0) return { rows }

  // Defer Twilio so the action returns immediately. Promise.allSettled keeps
  // one failed send from blocking the others. The closure iterates ONLY the
  // rows returned by RETURNING — never recomputes a window query — so the
  // notification set cannot diverge from the cancelled set.
  after(async () => {
    const baseUrl      = getBaseUrl()
    const rescheduleUrl = clinicSlug ? `${baseUrl}/${clinicSlug}` : undefined
    const results = await Promise.allSettled(
      rows.map((r) =>
        sendCancellationWhatsApp({
          to:          r.patient_phone,
          patientName: r.patient_name,
          clinicName,
          startsAt:    r.starts_at,
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

  return { rows }
}

export async function deleteScheduleException(id: string) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)

  await supabase.from('doctor_schedule_exceptions').delete().eq('id', id)

  await bustSlotCaches(clinicSlug)
}
