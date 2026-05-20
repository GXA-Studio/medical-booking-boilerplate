import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { ScheduleEditor } from '@/components/admin/schedule-editor'
import { getAdminProfile } from '@/lib/admin/profile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

interface ScheduleRow {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

interface ExceptionRow {
  id: string
  doctor_id: string
  exception_date: string
  is_working: boolean
  start_time: string | null
  end_time: string | null
}

interface DoctorWithSchedules {
  id: string
  name: string
  specialty: string | null
  is_active: boolean
  schedules: ScheduleRow[]
  exceptions: ExceptionRow[]
}

function SchedulesSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="border-slate-200/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-36" />
            </div>
            <div className="grid grid-cols-7 gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <Skeleton key={d} className="h-20 rounded-md" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

async function SchedulesSection() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  // Cutoff for fetching exceptions: today (local YYYY-MM-DD)
  const now = new Date()
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  const { data: doctorsRaw } = await supabase
    .from('doctors')
    .select(`
      id, name, specialty, is_active,
      schedules(id, doctor_id, day_of_week, start_time, end_time, is_active),
      exceptions:doctor_schedule_exceptions(id, doctor_id, exception_date, is_working, start_time, end_time)
    `)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  // Filter exceptions to today onwards (PostgREST nested filter would also work,
  // but keeping it client-side keeps the query simple and the doctor list intact)
  const doctors: DoctorWithSchedules[] = (doctorsRaw ?? []).map((d) => ({
    id:         d.id,
    name:       d.name,
    specialty:  d.specialty,
    is_active:  d.is_active,
    schedules:  (d.schedules ?? []) as ScheduleRow[],
    exceptions: ((d.exceptions ?? []) as ExceptionRow[])
      .filter((e) => e.exception_date >= todayStr)
      .sort((a, b) => a.exception_date.localeCompare(b.exception_date)),
  }))

  return <ScheduleEditor doctors={doctors} />
}

export default function SchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Horarios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define los bloques de atención semanales y añade excepciones para días específicos
          (vacaciones, festivos u horarios modificados).
        </p>
      </div>
      <Suspense fallback={<SchedulesSkeleton />}>
        <SchedulesSection />
      </Suspense>
    </div>
  )
}
