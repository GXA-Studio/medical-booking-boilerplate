import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/slots?doctorId=<uuid>&serviceId=<uuid>&date=YYYY-MM-DD
//
// Returns available UTC slot-start timestamps for a given doctor+service on a
// local calendar date (YYYY-MM-DD in the clinic's timezone).
//
// The get_available_slots RPC derives the clinic timezone from the doctor row,
// so no clinicId param is needed here.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const doctorId  = searchParams.get('doctorId')
  const serviceId = searchParams.get('serviceId')
  const date      = searchParams.get('date')  // YYYY-MM-DD

  if (!doctorId || !serviceId || !date) {
    return NextResponse.json(
      { error: 'doctorId, serviceId, and date query params are required' },
      { status: 400 }
    )
  }

  // Validate UUID format
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(doctorId) || !uuidRe.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid doctorId or serviceId format' }, { status: 400 })
  }

  // Validate date format YYYY-MM-DD and that it's not in the past
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: slots, error } = await supabase.rpc('get_available_slots', {
    p_doctor_id:  doctorId,
    p_service_id: serviceId,
    p_date:       date,
  })

  if (error) {
    // Surface doctor/service not found as 404
    if (error.code === 'P0003' || error.code === 'P0004') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('[GET /api/slots] get_available_slots error:', error)
    return NextResponse.json({ error: 'Failed to fetch available slots' }, { status: 500 })
  }

  const slotStarts = (slots ?? []).map(
    (s: { slot_start: string }) => s.slot_start
  )

  return NextResponse.json({ slots: slotStarts }, {
    headers: {
      // Short cache: slots change frequently as bookings come in
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    },
  })
}
