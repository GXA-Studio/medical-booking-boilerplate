'use server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendCancellationWhatsApp, sendRescheduleWhatsApp } from '@/lib/twilio/client'
import { getBaseUrl } from '@/lib/utils'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .single()
  if (!data?.clinic_id) throw new Error('No clinic found for user')
  return data.clinic_id as string
}

type ClinicShape = { name: string; timezone: string } | null

function pickClinic(raw: unknown): ClinicShape {
  if (!raw) return null
  const c = Array.isArray(raw) ? raw[0] : raw
  return (c as ClinicShape)
}

// ─── Cancel ───────────────────────────────────────────────────────────────────
export async function adminCancelAppointment(
  appointmentId: string,
): Promise<{ success: boolean; error?: string; demo?: boolean }> {
  if (await isGuestMode()) return { ...DEMO_RESULT, success: true }
  if (!UUID_RE.test(appointmentId)) return { success: false, error: 'ID de cita inválido.' }

  const supabase = await createClient()
  const clinicId = await resolveClinicId(supabase)
  const svc = createServiceClient()

  const { data, error } = await svc
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .eq('status', 'confirmed')
    .gt('starts_at', new Date().toISOString())   // only future appointments
    .select('patient_name, patient_phone, starts_at, clinics(name, timezone)')
    .single()

  if (error || !data) {
    console.error('[adminCancelAppointment] DB error or no rows:', error)
    return {
      success: false,
      error: 'No se pudo cancelar. La cita ya fue cancelada o ya ha pasado.',
    }
  }

  const clinic = pickClinic(data.clinics)

  // Defer Twilio after DB commit — non-blocking
  after(() => {
    void sendCancellationWhatsApp({
      to:          data.patient_phone as string,
      patientName: data.patient_name as string,
      clinicName:  clinic?.name ?? 'la clínica',
      startsAt:    data.starts_at as string,
      timezone:    clinic?.timezone ?? 'Europe/Madrid',
    }).catch(err =>
      console.error('[adminCancelAppointment] WhatsApp error:', err)
    )
  })

  revalidatePath('/admin/agenda')
  revalidatePath('/admin/appointments')
  return { success: true }
}

// ─── Reschedule ───────────────────────────────────────────────────────────────
export async function adminRescheduleAppointment(
  appointmentId: string,
  newDoctorId:   string,
  newStartsAt:   string,
): Promise<{ success: boolean; error?: string; demo?: boolean }> {
  if (await isGuestMode()) return { ...DEMO_RESULT, success: true }
  if (!UUID_RE.test(appointmentId) || !UUID_RE.test(newDoctorId)) {
    return { success: false, error: 'Parámetros inválidos.' }
  }

  const supabase = await createClient()
  const clinicId = await resolveClinicId(supabase)

  // Fetch token + contact info in a single query
  const { data: appt } = await supabase
    .from('appointments')
    .select('cancellation_token, patient_name, patient_phone, clinics(name, timezone)')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .single()

  if (!appt?.cancellation_token) {
    return { success: false, error: 'Cita no encontrada o sin permisos.' }
  }

  const svc = createServiceClient()
  const { data, error } = await svc.rpc('reschedule_appointment', {
    p_cancellation_token: appt.cancellation_token,
    p_new_doctor_id:      newDoctorId,
    p_new_starts_at:      newStartsAt,
  })

  if (error) {
    const msg =
      error.code === 'P0001' ? 'Este hueco ya está ocupado. Elige otro.' :
      error.code === 'P0002' ? 'Cita no encontrada o ya cancelada.' :
      error.code === 'P0004' ? 'La hora seleccionada ya ha pasado.' :
      'Error al reprogramar. Inténtalo de nuevo.'
    console.error('[adminRescheduleAppointment] RPC error:', error)
    return { success: false, error: msg }
  }

  const rescheduled = (Array.isArray(data) ? data[0] : data) as { starts_at: string } | null
  const confirmedStartsAt = rescheduled?.starts_at ?? newStartsAt
  const clinic = pickClinic(appt.clinics)

  after(() => {
    void sendRescheduleWhatsApp({
      to:                appt.patient_phone as string,
      patientName:       appt.patient_name as string,
      clinicName:        clinic?.name ?? 'la clínica',
      startsAt:          confirmedStartsAt,
      timezone:          clinic?.timezone ?? 'Europe/Madrid',
      cancellationToken: appt.cancellation_token as string,
      baseUrl:           getBaseUrl(),
    }).catch(err =>
      console.error('[adminRescheduleAppointment] WhatsApp error:', err)
    )
  })

  revalidatePath('/admin/agenda')
  revalidatePath('/admin/appointments')
  return { success: true }
}

// ─── Update color ─────────────────────────────────────────────────────────────
const VALID_COLORS = ['blue', 'emerald', 'purple', 'amber', 'rose'] as const

export async function adminUpdateAppointmentColor(
  appointmentId: string,
  color: string,
): Promise<{ success: boolean; error?: string; demo?: boolean }> {
  if (await isGuestMode()) return { ...DEMO_RESULT, success: true }
  if (!UUID_RE.test(appointmentId)) return { success: false, error: 'ID de cita inválido.' }
  if (!(VALID_COLORS as readonly string[]).includes(color)) return { success: false, error: 'Color inválido.' }

  const supabase = await createClient()
  const clinicId = await resolveClinicId(supabase)

  const { error } = await supabase
    .from('appointments')
    .update({ color })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)

  if (error) {
    console.error('[adminUpdateAppointmentColor] DB error:', error)
    return { success: false, error: 'Error al actualizar el color.' }
  }

  revalidatePath('/admin/agenda')
  return { success: true }
}
