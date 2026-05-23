'use server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppConfirmation } from '@/lib/twilio/client'
import { getBaseUrl, isValidE164, sanitizeName } from '@/lib/utils'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Normalize phone input so staff don't need to type E.164 manually.
 * - Strips spaces, dashes, dots, parentheses
 * - If result is 9 digits starting with 6 or 7 (Spanish mobile), prepends +34
 */
function sanitizePhone(raw: string): string {
  const stripped = raw.trim().replace(/[\s\-().]/g, '')
  if (/^[67]\d{8}$/.test(stripped)) return `+34${stripped}`
  return stripped
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
}

export async function bookAppointmentManual(data: BookManualFormData) {
  if (await isGuestMode()) return DEMO_RESULT
  const { patientName, patientPhone, doctorId, serviceId, startsAt } = data

  const name  = sanitizeName(patientName)
  const phone = sanitizePhone(patientPhone)

  if (name.length < 2)    return { error: 'El nombre del paciente debe tener al menos 2 caracteres.' }
  if (!isValidE164(phone)) return { error: 'Teléfono no válido. Introduce un número como 612345678 o +34612345678.' }
  if (!UUID_RE.test(doctorId))  return { error: 'Médico no válido.' }
  if (!UUID_RE.test(serviceId)) return { error: 'Servicio no válido.' }
  if (new Date(startsAt) < new Date()) return { error: 'La fecha y hora deben ser en el futuro.' }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { data: clinic } = await supabase
    .from('clinics')
    .select('name, timezone')
    .eq('id', clinicId)
    .single()
  if (!clinic) return { error: 'Clínica no encontrada.' }

  const serviceSupabase = createServiceClient()
  const { data: appointment, error: bookError } = await serviceSupabase.rpc('book_slot_confirmed', {
    p_clinic_id:     clinicId,
    p_doctor_id:     doctorId,
    p_service_id:    serviceId,
    p_patient_name:  name,
    p_patient_phone: phone,
    p_starts_at:     startsAt,
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
