import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendLeadNotificationEmail } from '@/lib/email/notifier'
import { leadsIpLimiter } from '@/lib/rate-limit'

const LeadSchema = z.object({
  name:    z.string().trim().min(2).max(120),
  email:   z.string().trim().email().max(200),
  clinic:  z.string().trim().min(2).max(200),
  message: z.string().trim().max(2000).optional().or(z.literal('').transform(() => undefined)),
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

  const parsed = LeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const ip = getClientIp(req)
  try {
    const { success: ratePassed } = await leadsIpLimiter.limit(ip)
    if (!ratePassed) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'Demasiados envíos desde esta IP. Vuelve a intentarlo más tarde.' },
        { status: 429 }
      )
    }
  } catch (err) {
    // Fail open: if Redis is down, don't block lead capture
    console.warn('[POST /api/leads] Rate limiter unavailable, proceeding without limit check:', err)
  }

  const { name, email, clinic, message } = parsed.data
  const userAgent = req.headers.get('user-agent') ?? null

  const supabase = createServiceClient()
  // `marketing_leads` table added in migration 20260522120000_marketing_leads.sql.
  // Until `npm run db:types` is re-run, the generated Database type doesn't know this table.
  // We cast the client to bypass the static check; the actual SQL exists at runtime.
  const { data: lead, error: insertError } = await (supabase
    .from('marketing_leads' as never) as ReturnType<typeof supabase.from>)
    .insert({
      name,
      email,
      clinic,
      message: message ?? null,
      ip: ip === 'unknown' ? null : ip,
      user_agent: userAgent,
      source: 'landing',
    } as never)
    .select('id')
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null }

  if (insertError) {
    console.error('[POST /api/leads] insert error:', insertError)
    return NextResponse.json(
      { error: 'Lead capture failed. Please try again or email us directly.' },
      { status: 500 }
    )
  }

  // Email notification is best-effort: a failure here must NOT prevent confirming the lead to the user.
  try {
    await sendLeadNotificationEmail({ name, email, clinic, message })
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string }
    console.error(
      '[POST /api/leads] Email notification failed (lead still saved):',
      JSON.stringify({ message: e.message, code: e.code })
    )
  }

  return NextResponse.json({ leadId: lead?.id ?? null }, { status: 201 })
}
