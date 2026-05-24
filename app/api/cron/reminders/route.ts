import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppReminder } from '@/lib/twilio/client'

// S-A4: derive the cancellation/reschedule base URL from the forwarded
// headers Vercel injects on every request, mirroring the Twilio webhook
// pattern. NEXT_PUBLIC_APP_URL drifts from the actual host on preview
// deployments, which broke reminder links whenever the cron fired against
// a *.vercel.app URL different from the production env value.
function buildBaseUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

// GET /api/cron/reminders
//
// Sends 24h WhatsApp reminders for upcoming confirmed appointments.
// Protected by Authorization: Bearer <CRON_SECRET>.
// Schedule via Vercel Cron (vercel.json) or external scheduler at ~T-24h UTC.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/reminders] CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase  = createServiceClient()
  const baseUrl   = buildBaseUrl(req)
  const now       = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)  // T+23h
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000)  // T+25h

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(`
      id, starts_at, patient_name, patient_phone, cancellation_token,
      doctors  ( name ),
      clinics  ( name, timezone )
    `)
    .eq('status', 'confirmed')
    .eq('reminder_sent', false)
    .gte('starts_at', windowStart.toISOString())
    .lte('starts_at', windowEnd.toISOString())

  if (error) {
    console.error('[cron/reminders] Query error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  // Dispatch every reminder concurrently so the cron stays well below the
  // Vercel function timeout even when Twilio adds latency. Promise.allSettled
  // ensures one Twilio failure does not abort the rest, and the per-row
  // try/catch keeps the reminder_sent flip strictly coupled to a successful
  // send (a failed Twilio call leaves the row eligible for the next run).
  const results = await Promise.allSettled(
    (appointments ?? []).map(async (appt) => {
      const clinic = appt.clinics as { name: string; timezone: string } | null
      const doctor = appt.doctors as { name: string }                   | null

      await sendWhatsAppReminder({
        to:                appt.patient_phone,
        patientName:       appt.patient_name,
        clinicName:        clinic?.name ?? 'tu clínica',
        doctorName:        doctor?.name ?? 'tu médico',
        startsAt:          appt.starts_at,
        timezone:          clinic?.timezone ?? 'Europe/Madrid',
        cancellationToken: appt.cancellation_token,
        baseUrl,
      })

      const { error: flipError } = await supabase
        .from('appointments')
        .update({ reminder_sent: true })
        .eq('id', appt.id)

      if (flipError) throw flipError
      return appt.id
    })
  )

  let sent = 0
  let failed = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      sent++
    } else {
      failed++
      console.error(
        `[cron/reminders] Failed for appointment ${appointments?.[i]?.id}:`,
        r.reason,
      )
    }
  }

  console.info(`[cron/reminders] Done — sent: ${sent}, failed: ${failed}`)
  return NextResponse.json({ sent, failed })
}
