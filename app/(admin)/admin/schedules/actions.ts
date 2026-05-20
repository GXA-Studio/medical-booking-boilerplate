'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
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

export async function createScheduleException(input: ExceptionInput) {
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
    // Unique index on (doctor, date, is_working, COALESCE start, COALESCE end)
    // prevents identical duplicates — surface a friendly message.
    if (error.code === '23505') {
      return { error: 'Ya existe una excepción idéntica para esa fecha y rango.' }
    }
    console.error('[createScheduleException] DB error:', error)
    return { error: 'Error al guardar la excepción.' }
  }

  await bustSlotCaches(clinicSlug)
  return { success: true }
}

export async function deleteScheduleException(id: string) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicSlug } = await getClinicContext(supabase)

  await supabase.from('doctor_schedule_exceptions').delete().eq('id', id)

  await bustSlotCaches(clinicSlug)
}
