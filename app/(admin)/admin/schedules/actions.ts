'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!data?.clinic_id) throw new Error('No clinic')
  return data.clinic_id as string
}

async function assertDoctorOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doctorId: string,
) {
  if (!UUID_RE.test(doctorId)) throw new Error('Invalid doctor id')
  const clinicId = await getClinicId(supabase)
  const { data: doctor } = await supabase
    .from('doctors').select('id').eq('id', doctorId).eq('clinic_id', clinicId).single()
  if (!doctor) throw new Error('Doctor not found')
}

// ─── Weekly schedules ────────────────────────────────────────────────────────
export async function createSchedule(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ScheduleSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

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

  revalidatePath('/admin/schedules')
  return { success: true }
}

export async function deleteSchedule(id: string) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  await getClinicId(supabase) // auth check — RLS enforces clinic ownership

  await supabase.from('schedules').delete().eq('id', id)

  revalidatePath('/admin/schedules')
}

export async function toggleSchedule(id: string, isActive: boolean) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  await getClinicId(supabase) // auth check
  await supabase.from('schedules').update({ is_active: isActive }).eq('id', id)
  revalidatePath('/admin/schedules')
}

// ─── Schedule exceptions ─────────────────────────────────────────────────────
const ExceptionSchema = z.object({
  doctor_id:      z.string().uuid(),
  exception_date: z.string().regex(DATE_RE),
  is_working:     z.boolean(),
  start_time:     z.string().regex(TIME_RE).optional().nullable(),
  end_time:       z.string().regex(TIME_RE).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.is_working) {
    if (!data.start_time || !data.end_time) {
      ctx.addIssue({ code: 'custom', message: 'Si trabaja, indica las horas.' })
      return
    }
    if (data.start_time >= data.end_time) {
      ctx.addIssue({ code: 'custom', message: 'La hora de inicio debe ser menor que la de fin.' })
    }
  }
})

export type ExceptionInput = z.infer<typeof ExceptionSchema>

export async function upsertScheduleException(input: ExceptionInput) {
  const parsed = ExceptionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  await assertDoctorOwnership(supabase, parsed.data.doctor_id)

  // Don't allow exceptions for past dates
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const targetDate = new Date(parsed.data.exception_date + 'T00:00:00')
  if (targetDate < today) {
    return { error: 'No puedes añadir excepciones para fechas pasadas.' }
  }

  const row = {
    doctor_id:      parsed.data.doctor_id,
    exception_date: parsed.data.exception_date,
    is_working:     parsed.data.is_working,
    start_time:     parsed.data.is_working ? (parsed.data.start_time! + ':00') : null,
    end_time:       parsed.data.is_working ? (parsed.data.end_time!   + ':00') : null,
  }

  const { error } = await supabase
    .from('doctor_schedule_exceptions')
    .upsert(row, { onConflict: 'doctor_id,exception_date' })

  if (error) {
    console.error('[upsertScheduleException] DB error:', error)
    return { error: 'Error al guardar la excepción.' }
  }

  revalidatePath('/admin/schedules')
  revalidatePath('/admin/agenda')
  return { success: true }
}

export async function toggleExceptionWorking(id: string, isWorking: boolean) {
  if (!UUID_RE.test(id)) return { error: 'ID inválido.' }
  const supabase = await createClient()
  await getClinicId(supabase) // RLS enforces clinic ownership via the policy

  // When flipping to non-working, clear the hours to keep the CHECK constraint happy.
  const update = isWorking
    ? { is_working: true }
    : { is_working: false, start_time: null, end_time: null }

  const { error } = await supabase
    .from('doctor_schedule_exceptions')
    .update(update)
    .eq('id', id)

  if (error) {
    console.error('[toggleExceptionWorking] DB error:', error)
    return { error: 'Error al actualizar.' }
  }

  revalidatePath('/admin/schedules')
  revalidatePath('/admin/agenda')
  return { success: true }
}

export async function deleteScheduleException(id: string) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  await getClinicId(supabase)

  await supabase.from('doctor_schedule_exceptions').delete().eq('id', id)

  revalidatePath('/admin/schedules')
  revalidatePath('/admin/agenda')
}
