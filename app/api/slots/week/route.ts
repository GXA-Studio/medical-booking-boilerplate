import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/slots/week?serviceId=<uuid>&startDate=YYYY-MM-DD[&doctorId=<uuid>]
// Returns 7 days of slots grouped by doctor.
// Response: { dates: string[], slots: Record<doctorId, Record<date, string[]>> }
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const serviceId = searchParams.get('serviceId')
  const startDate = searchParams.get('startDate')
  const doctorId  = searchParams.get('doctorId')

  if (!serviceId || !startDate) {
    return NextResponse.json(
      { error: 'serviceId and startDate are required' },
      { status: 400 }
    )
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid serviceId' }, { status: 400 })
  }
  if (doctorId && !uuidRe.test(doctorId)) {
    return NextResponse.json({ error: 'Invalid doctorId' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 })
  }

  // Build 7-day window from startDate
  const dates: string[] = []
  const base = new Date(startDate + 'T00:00:00Z')
  for (let i = 0; i < 7; i++) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }

  const supabase = await createClient()

  type ServiceFirstRow = {
    slot_start:       string
    doctor_id:        string
    doctor_name:      string
    doctor_specialty: string | null
  }

  // Fetch all 7 days in parallel
  const dayResults = await Promise.all(
    dates.map(async (date) => {
      if (doctorId) {
        // Single-doctor mode: get_available_slots (doctor-first RPC)
        const { data, error } = await supabase.rpc('get_available_slots', {
          p_doctor_id:  doctorId,
          p_service_id: serviceId,
          p_date:       date,
        })
        if (error) {
          console.error('[slots/week] get_available_slots error:', { date, doctorId, error })
        }
        return {
          date,
          rows: ((data ?? []) as { slot_start: string }[]).map((s) => ({
            slot_start:       s.slot_start,
            doctor_id:        doctorId,
            doctor_name:      '',
            doctor_specialty: null,
          })) as ServiceFirstRow[],
        }
      }

      // All-doctors mode: get_slots_for_service (service-first RPC)
      const { data, error } = await supabase.rpc('get_slots_for_service', {
        p_service_id: serviceId,
        p_date:       date,
      })
      if (error) {
        console.error('[slots/week] get_slots_for_service error:', { date, serviceId, error })
      }
      return { date, rows: ((data ?? []) as ServiceFirstRow[]) }
    })
  )

  // Aggregate: slots[doctorId][date] = ISO UTC starts[]
  const slots: Record<string, Record<string, string[]>> = {}

  for (const { date, rows } of dayResults) {
    for (const row of rows) {
      if (!slots[row.doctor_id]) {
        slots[row.doctor_id] = Object.fromEntries(dates.map((d) => [d, []]))
      }
      slots[row.doctor_id][date].push(row.slot_start)
    }
  }

  return NextResponse.json(
    { dates, slots },
    // no-store: schedule exceptions can change between requests; a 30s cache
    // was masking exception writes (slots looked free for up to 30s after a block).
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
  )
}
