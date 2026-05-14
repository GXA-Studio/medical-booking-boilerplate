import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendConfirmationSms } from '@/lib/twilio/client'
import { hashOTP } from '@/lib/utils'

const VerifyOtpSchema = z.object({
  appointmentId: z.string().uuid(),
  otp:           z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
})

// Shapes the DB row into a safe, client-facing response.
// Never exposes otp_code_hash, otp_expires_at, or raw IDs beyond appointmentId.
function buildPublicAppointment(
  appt: {
    id: string
    patient_name: string
    patient_phone: string
    starts_at: string
    ends_at: string
    status: string
  },
  enriched: {
    doctors: { name: string } | null
    services: { name: string; duration_minutes: number } | null
    clinics: { name: string; timezone: string } | null
  } | null
) {
  return {
    id:           appt.id,
    patientName:  appt.patient_name,
    startsAt:     appt.starts_at,
    endsAt:       appt.ends_at,
    status:       appt.status,
    doctor:       enriched?.doctors  ?? null,
    service:      enriched?.services ?? null,
    clinicName:   enriched?.clinics?.name     ?? null,
    clinicTimezone: enriched?.clinics?.timezone ?? null,
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = VerifyOtpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const { appointmentId, otp } = parsed.data
  const otpHash  = hashOTP(otp)
  const supabase = createServiceClient()

  // Atomically verify hash + transition pending → confirmed.
  // Clears otp_code_hash after success (replay-proof).
  const { data: confirmed, error: confirmError } = await supabase.rpc('confirm_appointment', {
    p_appointment_id: appointmentId,
    p_otp_code_hash:  otpHash,
  })

  if (confirmError) {
    if (confirmError.code === 'P0002') {
      return NextResponse.json(
        { error: 'INVALID_OTP', message: 'The code is incorrect or has expired. Please request a new one.' },
        { status: 401 }
      )
    }
    console.error('[POST /api/otp/verify] confirm_appointment error:', confirmError)
    return NextResponse.json({ error: 'Confirmation failed. Please try again.' }, { status: 500 })
  }

  const appt = Array.isArray(confirmed) ? confirmed[0] : confirmed

  // Fetch enriched data for SMS + response (doctor name, service name, clinic timezone)
  const { data: enriched } = await supabase
    .from('appointments')
    .select(`
      id, patient_name, patient_phone, starts_at, ends_at, status,
      doctors  ( name ),
      services ( name, duration_minutes ),
      clinics  ( name, timezone )
    `)
    .eq('id', appt.id)
    .single()

  // Best-effort confirmation SMS — don't fail the response if Twilio errors
  if (enriched) {
    const clinic  = enriched.clinics  as { name: string; timezone: string } | null
    const doctor  = enriched.doctors  as { name: string } | null
    const service = enriched.services as { name: string; duration_minutes: number } | null

    if (clinic && doctor && service) {
      sendConfirmationSms({
        to:          enriched.patient_phone,
        patientName: enriched.patient_name,
        clinicName:  clinic.name,
        startsAt:    enriched.starts_at,
        timezone:    clinic.timezone,
        doctorName:  doctor.name,
        serviceName: service.name,
      }).catch((err) => console.error('[POST /api/otp/verify] confirmation SMS error:', err))
    }
  }

  return NextResponse.json({
    appointment: buildPublicAppointment(appt, enriched ? {
      doctors:  enriched.doctors  as { name: string } | null,
      services: enriched.services as { name: string; duration_minutes: number } | null,
      clinics:  enriched.clinics  as { name: string; timezone: string } | null,
    } : null),
  })
}
