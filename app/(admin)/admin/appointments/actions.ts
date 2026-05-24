'use server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppConfirmation } from '@/lib/twilio/client'
import { getBaseUrl, isValidE164, sanitizeName } from '@/lib/utils'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Strip whitespace and common separators; do NOT inject any country code.
// The downstream isValidE164 check rejects anything that isn't already in
// canonical form, which keeps the action neutral across clinic locales.
function sanitizePhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '')
}

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!data?.clinic_id) throw new Error('No clinic')
  return data.clinic_id as string
}

export async function cancelAppointment(id: string) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return { error: 'Invalid appointment ID format' }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .in('status', ['confirmed'])

  if (error) {
    console.error('[cancelAppointment] DB error:', error)
    return { error: 'Error al actualizar la cita.' }
  }

  revalidatePath('/admin/appointments')
  return { success: true }
}

export interface BookManualFormData {
  patientName: string
  patientPhone: string
  doctorId: string
  serviceId: string
  startsAt: string
  // L-A9: the receptionist must affirm that verbal GDPR consent was obtained
  // before the appointment is persisted. The flag is recorded as consent_at.
  consentAccepted: boolean
}

export async function bookAppointmentManual(data: BookManualFormData) {
  if (await isGuestMode()) return DEMO_RESULT
  const { patientName, patientPhone, doctorId, serviceId, startsAt, consentAccepted } = data

  const name  = sanitizeName(patientName)
  const phone = sanitizePhone(patientPhone)

  if (name.length < 2)    return { error: 'El nombre del paciente debe tener al menos 2 caracteres.' }
  if (!isValidE164(phone)) return { error: 'Teléfono no válido. Introduce el número en formato internacional E.164 (p.ej. +34612345678).' }
  if (!UUID_RE.test(doctorId))  return { error: 'Médico no válido.' }
  if (!UUID_RE.test(serviceId)) return { error: 'Servicio no válido.' }
  if (new Date(startsAt) < new Date()) return { error: 'La fecha y hora deben ser en el futuro.' }
  if (consentAccepted !== true) {
    return { error: 'Debes confirmar que el paciente ha otorgado su consentimiento RGPD.' }
  }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { data: clinic } = await supabase
    .from('clinics')
    .select('name, timezone')
    .eq('id', clinicId)
    .single()
  if (!clinic) return { error: 'Clínica no encontrada.' }

  // book_slot_confirmed is GRANTed to anon/authenticated and validates its own
  // clinic/doctor/service relationships (S-1 through S-4); the admin's session
  // client is enough to invoke it. L-A9: stamp consent at the moment the action
  // runs server-side so the timestamp matches the booking transaction.
  const consentAt = new Date().toISOString()
  const { data: appointment, error: bookError } = await supabase.rpc('book_slot_confirmed', {
    p_clinic_id:     clinicId,
    p_doctor_id:     doctorId,
    p_service_id:    serviceId,
    p_patient_name:  name,
    p_patient_phone: phone,
    p_starts_at:     startsAt,
    p_consent_at:    consentAt,
  })

  if (bookError) {
    if (bookError.code === 'P0001') {
      return { error: 'Ese horario ya no está disponible. Elige otro.' }
    }
    console.error('[bookAppointmentManual] RPC error:', bookError)
    return { error: 'Error al crear la cita. Inténtalo de nuevo.' }
  }

  const appt = (Array.isArray(appointment) ? appointment[0] : appointment) as {
    id: string
    starts_at: string
    cancellation_token: string
  }

  const [{ data: doctor }, { data: service }] = await Promise.all([
    supabase.from('doctors').select('name').eq('id', doctorId).single(),
    supabase.from('services').select('name').eq('id', serviceId).single(),
  ])

  const baseUrl = getBaseUrl()

  // Defer Twilio after the response is returned — avoids blocking the UI on external latency.
  // The booking is already committed to the DB at this point, so the notification is safe to run async.
  after(() => {
    void sendWhatsAppConfirmation({
      to:                phone,
      patientName:       name,
      clinicName:        (clinic as { name: string }).name,
      doctorName:        doctor?.name ?? 'tu médico',
      serviceName:       service?.name ?? 'consulta',
      startsAt:          appt.starts_at,
      timezone:          (clinic as { timezone: string }).timezone,
      cancellationToken: appt.cancellation_token,
      baseUrl,
    }).catch((err) => {
      console.error(
        '\n🚨 Twilio Admin Booking Error 🚨',
        '\n  to:', phone,
        '\n  patient:', name,
        '\n  booking:', appt.id,
        '\n  error:', err,
      )
    })
  })

  revalidatePath('/admin/appointments')
  return { success: true, appointmentId: appt.id }
}
