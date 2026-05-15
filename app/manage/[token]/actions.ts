'use server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendCancellationWhatsApp, sendRescheduleWhatsApp } from '@/lib/twilio/client'
import { getBaseUrl } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function cancelByToken(token: string): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(token)) return { success: false, error: 'Token inválido.' }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('cancellation_token', token)
    .eq('status', 'confirmed')
    .gt('starts_at', new Date().toISOString())
    .select('id, patient_name, patient_phone, starts_at, clinics(name, timezone)')
    .single()

  if (error || !data) {
    return { success: false, error: 'No se pudo cancelar la cita. Es posible que ya esté cancelada o haya pasado.' }
  }

  const clinic = Array.isArray(data.clinics) ? data.clinics[0] : data.clinics as { name: string; timezone: string } | null

  try {
    await sendCancellationWhatsApp({
      to:          data.patient_phone as string,
      patientName: data.patient_name as string,
      clinicName:  clinic?.name ?? 'la clínica',
      startsAt:    data.starts_at as string,
      timezone:    clinic?.timezone ?? 'Europe/Madrid',
    })
  } catch (err) {
    console.error('[cancelByToken] WhatsApp notification failed:', err)
  }

  return { success: true }
}

export async function rescheduleAppointment(
  token: string,
  newDoctorId: string,
  newStartsAt: string,
): Promise<{ success: boolean; newStartsAt?: string; error?: string }> {
  if (!UUID_RE.test(token) || !UUID_RE.test(newDoctorId)) {
    return { success: false, error: 'Parámetros inválidos.' }
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_cancellation_token: token,
    p_new_doctor_id:      newDoctorId,
    p_new_starts_at:      newStartsAt,
  })

  if (error) {
    if (error.code === 'P0001') {
      return { success: false, error: 'Este hueco ya está ocupado. Por favor elige otro.' }
    }
    if (error.code === 'P0002') {
      return { success: false, error: 'No encontramos tu cita o ya fue cancelada anteriormente.' }
    }
    if (error.code === 'P0004') {
      return { success: false, error: 'La nueva hora seleccionada ya ha pasado.' }
    }
    console.error('[rescheduleAppointment] RPC error:', error)
    return { success: false, error: 'Error al reprogramar la cita. Por favor inténtalo de nuevo.' }
  }

  const appt = Array.isArray(data) ? data[0] : data as { starts_at: string }
  const confirmedStartsAt = appt?.starts_at ?? newStartsAt

  const { data: apptDetails } = await supabase
    .from('appointments')
    .select('patient_name, patient_phone, clinics(name, timezone)')
    .eq('cancellation_token', token)
    .single()

  if (apptDetails) {
    const clinic = Array.isArray(apptDetails.clinics)
      ? apptDetails.clinics[0]
      : apptDetails.clinics as { name: string; timezone: string } | null

    try {
      await sendRescheduleWhatsApp({
        to:                apptDetails.patient_phone as string,
        patientName:       apptDetails.patient_name as string,
        clinicName:        clinic?.name ?? 'la clínica',
        startsAt:          confirmedStartsAt,
        timezone:          clinic?.timezone ?? 'Europe/Madrid',
        cancellationToken: token,
        baseUrl:           getBaseUrl(),
      })
    } catch (err) {
      console.error('[rescheduleAppointment] WhatsApp notification failed:', err)
    }
  }

  return { success: true, newStartsAt: confirmedStartsAt }
}
