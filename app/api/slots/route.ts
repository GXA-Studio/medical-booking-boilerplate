import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { slotsLimiter } from '@/lib/rate-limit'

// GET /api/slots
//
// Mode A — doctor-first (legacy):
//   ?doctorId=<uuid>&serviceId=<uuid>&date=YYYY-MM-DD
//   → { slots: string[] }   (ISO UTC timestamps)
//
// Mode B — service-first (Time-First UX):
//   ?serviceId=<uuid>&date=YYYY-MM-DD
//   → { slots: Array<{ start: string; doctors: Array<{ id, name, specialty }> }> }
//
// Both modes call SECURITY DEFINER RPCs via the anon client (H-02 compliant).

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const doctorId  = searchParams.get('doctorId')
  const serviceId = searchParams.get('serviceId')
  const date      = searchParams.get('date')

  if (!serviceId || !date) {
    return NextResponse.json(
      { error: 'serviceId and date query params are required' },
      { status: 400 }
    )
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid serviceId format' }, { status: 400 })
  }
  if (doctorId && !uuidRe.test(doctorId)) {
    return NextResponse.json({ error: 'Invalid doctorId format' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const ip = getClientIp(req)
  try {
    const { success: ratePassed } = await slotsLimiter.limit(ip)
    if (!ratePassed) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
    }
  } catch {
    // Fail open if Redis unavailable
  }

  const supabase = await createClient()

  // ── Mode A: doctor-first (existing behaviour) ────────────────────
  if (doctorId) {
    const { data: slots, error } = await supabase.rpc('get_available_slots', {
      p_doctor_id:  doctorId,
      p_service_id: serviceId,
      p_date:       date,
    })

    if (error) {
      if (error.code === 'P0003' || error.code === 'P0004') {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      console.error('[GET /api/slots mode-A]', error)
      return NextResponse.json({ error: 'Failed to fetch available slots' }, { status: 500 })
    }

    return NextResponse.json(
      { slots: (slots ?? []).map((s: { slot_start: string }) => s.slot_start) },
      // no-store: schedule exceptions can change between requests; a 30s cache
      // was masking exception writes (slots looked free for up to 30s after a block).
      { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
    )
  }

  // ── Mode B: service-first ─────────────────────────────────────────
  const { data: rows, error } = await supabase.rpc('get_slots_for_service', {
    p_service_id: serviceId,
    p_date:       date,
  })

  if (error) {
    if (error.code === 'P0003') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('[GET /api/slots mode-B]', error)
    return NextResponse.json({ error: 'Failed to fetch available slots' }, { status: 500 })
  }

  // Group rows by slot_start, aggregating doctors for each slot
  type Row = { slot_start: string; doctor_id: string; doctor_name: string; doctor_specialty: string | null }
  const slotsMap = new Map<string, { id: string; name: string; specialty: string | null }[]>()

  for (const row of (rows ?? []) as Row[]) {
    if (!slotsMap.has(row.slot_start)) slotsMap.set(row.slot_start, [])
    slotsMap.get(row.slot_start)!.push({
      id:        row.doctor_id,
      name:      row.doctor_name,
      specialty: row.doctor_specialty,
    })
  }

  const slots = Array.from(slotsMap.entries())
    .map(([start, doctors]) => ({ start, doctors }))
    .sort((a, b) => a.start.localeCompare(b.start))

  return NextResponse.json(
    { slots },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
  )
}
