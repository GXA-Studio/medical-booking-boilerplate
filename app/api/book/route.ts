import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppConfirmation } from '@/lib/twilio/client'
import { isValidE164, sanitizeName, getBaseUrl } from '@/lib/utils'
import { bookingIpLimiter } from '@/lib/rate-limit'

const BookSchema = z.object({
  clinicId:  z.string().uuid(),
  doctorId:  z.string().uuid(),
  serviceId: z.string().uuid(),
  patientName: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .transform(sanitizeName),
  patientPhone: z.string().refine(isValidE164, {
    message: 'Phone must be E.164 format, e.g. +34612345678',
  }),
  startsAt: z.string().datetime({ offset: true }),
  // L-A9: GDPR consent must be explicit. Booleans other than true
  // are rejected so a forgotten checkbox cannot persist a booking.
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'GDPR consent is required to book an appointment.' }),
  }),
})

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const { clinicId, doctorId, serviceId, patientName, patientPhone, startsAt } = parsed.data

  if (new Date(startsAt) < new Date()) {
    return NextResponse.json({ error: 'Cannot book a slot in the past' }, { status: 422 })
  }

  const ip = getClientIp(req)
  try {
    const { success: ratePassed } = await bookingIpLimiter.limit(ip)
    if (!ratePassed) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'Too many booking requests from this IP. Try again later.' },
        { status: 429 }
      )
    }
  } catch (err) {
    // Fail open: if Redis is unavailable, let the booking proceed rather than block users
    console.warn('[POST /api/book] Rate limiter unavailable, proceeding without limit check:', err)
  }

  const supabase = createServiceClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, name, timezone')
    .eq('id', clinicId)
    .single()

  if (!clinic) {
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  }

  // L-A9: stamp the consent at the moment the validated request reaches the
  // server — the timestamp lives in DB next to the booking so the controller
  // can demonstrate when consent was granted (art. 7.1 RGPD).
  const consentAt = new Date().toISOString()

  const { data: appointment, error: bookError } = await supabase.rpc('book_slot_confirmed', {
    p_clinic_id:     clinicId,
    p_doctor_id:     doctorId,
    p_service_id:    serviceId,
    p_patient_name:  patientName,
    p_patient_phone: patientPhone,
    p_starts_at:     startsAt,
    p_consent_at:    consentAt,
  })

  if (bookError) {
    if (bookError.code === 'P0001') {
      return NextResponse.json(
        { error: 'SLOT_TAKEN', message: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      )
    }
    console.error('[POST /api/book] book_slot_confirmed error:', bookError)
    return NextResponse.json({ error: 'Booking failed. Please try again.' }, { status: 500 })
  }

  const appt = Array.isArray(appointment) ? appointment[0] : appointment as {
    id: string
    starts_at: string
    cancellation_token: string
  }

  const [{ data: doctor }, { data: service }] = await Promise.all([
    supabase.from('doctors').select('name').eq('id', doctorId).single(),
    supabase.from('services').select('name').eq('id', serviceId).single(),
  ])

  const baseUrl = getBaseUrl()

  try {
    await sendWhatsAppConfirmation({
      to:                patientPhone,
      patientName,
      clinicName:        (clinic as { name: string }).name,
      doctorName:        doctor?.name ?? 'tu médico',
      serviceName:       service?.name ?? 'consulta',
      startsAt:          appt.starts_at,
      timezone:          (clinic as { timezone: string }).timezone,
      cancellationToken: appt.cancellation_token,
      baseUrl,
    })
  } catch (err: unknown) {
    const e = err as { status?: number; code?: number; message?: string; moreInfo?: string }
    console.error(
      '\n\n🚨🚨🚨 [TWILIO WHATSAPP SEND FAILED] 🚨🚨🚨',
      '\n  to:      whatsapp:' + patientPhone,
      '\n  message:', e.message,
      '\n  code:   ', e.code,
      '\n  moreInfo:', e.moreInfo,
      '\n🚨🚨🚨 [END TWILIO ERROR] 🚨🚨🚨\n\n'
    )
  }

  return NextResponse.json({ appointmentId: appt.id }, { status: 201 })
}
