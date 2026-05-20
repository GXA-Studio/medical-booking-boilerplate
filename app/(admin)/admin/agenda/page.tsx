import { Suspense } from 'react'
import { format, getDay } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/server'
import { getAdminProfile } from '@/lib/admin/profile'
import { DayNav } from '@/components/admin/day-nav'
import { DailyResourceGrid } from '@/components/admin/daily-resource-grid'
import type { GridDoctor, GridSchedule, GridAppointment, GridService, GridException } from '@/components/admin/daily-resource-grid'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Skeleton shown during streaming ──────────────────────────────────────────
function AgendaSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Header row */}
      <div className="flex border-b border-slate-200 h-14">
        <div className="w-16 shrink-0 border-r border-slate-200 bg-slate-50" />
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 min-w-[172px] border-r border-slate-200 p-3 last:border-r-0">
            <Skeleton className="h-4 w-28 mb-1.5" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      {/* Body */}
      <div className="flex h-80 items-center justify-center">
        <p className="animate-pulse text-sm text-muted-foreground">Cargando agenda…</p>
      </div>
    </div>
  )
}

// ─── Async data + grid (inside Suspense) ──────────────────────────────────────
async function AgendaContent({
  date,
  clinicId,
  timezone,
}: {
  date: string
  clinicId: string
  timezone: string
}) {
  const supabase = await createClient()

  // JS day_of_week: 0=Sun … 6=Sat (matches the `schedules.day_of_week` column)
  const [y, mo, d] = date.split('-').map(Number)
  const dayOfWeek  = getDay(new Date(y, mo - 1, d))

  // UTC boundaries for this clinic-local calendar day
  const dayStartUtc = fromZonedTime(`${date}T00:00:00`, timezone)
  const dayEndUtc   = fromZonedTime(`${date}T23:59:59`, timezone)

  // 1. Fetch active doctors (with their linked services for the dialog)
  const { data: rawDoctors } = await supabase
    .from('doctors')
    .select('id, name, specialty, doctor_services(service_id)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name')

  const doctors    = (rawDoctors ?? []) as GridDoctor[]
  const doctorIds  = doctors.map(d => d.id)

  // 2 + 3 + 4 + 5. Fetch schedules, appointments, services and exceptions in parallel
  const [
    { data: rawSchedules },
    { data: rawAppointments },
    { data: rawServices },
    { data: rawExceptions },
  ] = await Promise.all([
    // Schedules for this day_of_week (empty if no doctors)
    doctorIds.length > 0
      ? supabase
          .from('schedules')
          .select('id, doctor_id, day_of_week, start_time, end_time, is_active')
          .in('doctor_id', doctorIds)
          .eq('day_of_week', dayOfWeek)
          .eq('is_active', true)
      : Promise.resolve({ data: [] as GridSchedule[], error: null }),

    // Confirmed appointments that START within this clinic-local day
    supabase
      .from('appointments')
      .select('id, doctor_id, service_id, cancellation_token, patient_name, patient_phone, starts_at, ends_at, status, color, services(name, duration_minutes, color)')
      .eq('clinic_id', clinicId)
      .eq('status', 'confirmed')
      .gte('starts_at', dayStartUtc.toISOString())
      .lte('starts_at', dayEndUtc.toISOString()),

    // Active services (for the NewAppointmentDialog + color lookup in EditDialog)
    supabase
      .from('services')
      .select('id, name, duration_minutes, color')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),

    // Schedule exceptions for the day (full-day off + partial blocks).
    // The grid renders these as striped overlays per doctor.
    doctorIds.length > 0
      ? supabase
          .from('doctor_schedule_exceptions')
          .select('id, doctor_id, exception_date, is_working, start_time, end_time')
          .in('doctor_id', doctorIds)
          .eq('exception_date', date)
      : Promise.resolve({ data: [] as GridException[], error: null }),
  ])

  return (
    <DailyResourceGrid
      date={date}
      timezone={timezone}
      doctors={doctors}
      schedules={(rawSchedules ?? []) as GridSchedule[]}
      appointments={(rawAppointments ?? []) as GridAppointment[]}
      services={(rawServices ?? []) as GridService[]}
      exceptions={(rawExceptions ?? []) as GridException[]}
    />
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date: rawDate } = await searchParams
  const { clinicId, timezone } = await getAdminProfile()

  // Compute "today" in the clinic's timezone (avoids server-UTC vs clinic-TZ mismatch)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const date  = /^\d{4}-\d{2}-\d{2}$/.test(rawDate ?? '') ? rawDate! : today

  // Human-readable year for the page header
  const year = format(new Date(date.replace(/-/g, '/')), 'yyyy')

  return (
    <div className="flex flex-col gap-4">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda {year}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Vista diaria por médico · Haz clic en un hueco libre para crear una cita
          </p>
        </div>
        <DayNav date={date} />
      </div>

      {/* ── Grid (streams independently) ─────────────────────────────────── */}
      <Suspense fallback={<AgendaSkeleton />}>
        <AgendaContent date={date} clinicId={clinicId} timezone={timezone} />
      </Suspense>
    </div>
  )
}
