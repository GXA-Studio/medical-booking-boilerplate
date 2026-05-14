import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendOtpSms } from '@/lib/twilio/client'
import { generateOTP, hashOTP, isValidE164 } from '@/lib/utils'

const SendOtpSchema = z.object({
  clinicId:     z.string().uuid(),
  doctorId:     z.string().uuid(),
  serviceId:    z.string().uuid(),
  patientName:  z.string().min(2).max(100).trim(),
  patientPhone: z.string().refine(isValidE164, {
    message: 'Phone must be in E.164 format, e.g. +521554001234',
  }),
  startsAt: z.string().datetime({ offset: true }), // ISO 8601 UTC string
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendOtpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const { clinicId, doctorId, serviceId, patientName, patientPhone, startsAt } = parsed.data

  // Reject requests for slots in the past
  if (new Date(startsAt) < new Date()) {
    return NextResponse.json({ error: 'Cannot book a slot in the past' }, { status: 422 })
  }

  const supabase = createServiceClient()

  // Verify clinic exists and fetch name for SMS
  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, name')
    .eq('id', clinicId)
    .single()

  if (!clinic) {
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  }

  const otp     = generateOTP()
  const otpHash = hashOTP(otp)

  // Atomically claim the slot — releases expired-pending blockers, then inserts.
  // The EXCLUDE constraint on appointments prevents double-booking at the DB level.
  const { data: appointment, error: bookError } = await supabase.rpc('book_slot', {
    p_clinic_id:     clinicId,
    p_doctor_id:     doctorId,
    p_service_id:    serviceId,
    p_patient_name:  patientName,
    p_patient_phone: patientPhone,
    p_starts_at:     startsAt,
    p_otp_code_hash: otpHash,
  })

  if (bookError) {
    if (bookError.code === 'P0001') {
      return NextResponse.json(
        { error: 'SLOT_TAKEN', message: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      )
    }
    console.error('[POST /api/otp/send] book_slot error:', bookError)
    return NextResponse.json({ error: 'Booking failed. Please try again.' }, { status: 500 })
  }

  const appt = Array.isArray(appointment) ? appointment[0] : appointment

  // Send OTP via Twilio. If this fails, cancel the just-created appointment
  // so the slot is released back to the pool.
  try {
    await sendOtpSms({ to: patientPhone, otp, clinicName: clinic.name })
  } catch (smsError) {
    console.error('[POST /api/otp/send] Twilio error:', smsError)
    await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id)
    return NextResponse.json(
      { error: 'SMS delivery failed. Please check your phone number and try again.' },
      { status: 502 }
    )
  }

  // Never expose the OTP or its hash in the response
  return NextResponse.json({ appointmentId: appt.id }, { status: 201 })
}
