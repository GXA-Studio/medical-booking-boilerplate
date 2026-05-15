import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { AppointmentsTable } from '@/components/admin/appointments-table'
import { NewAppointmentDialog } from '@/components/admin/new-appointment-dialog'
import { getAdminProfile } from '@/lib/admin/profile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

// ─── Inner skeleton (table area only) ────────────────────────────────────────
// Shown by the Suspense boundary while appointments stream in.
// The page shell (header + dialog button) is already visible at this point.
function AppointmentsTableSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-slate-200/70">
            <CardContent className="p-4">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-8 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      <Card className="border-slate-200/70">
        <CardContent className="p-0">
          <div className="flex gap-4 border-b border-slate-100 px-4 py-3">
            {[24, 32, 28, 16].map((w, i) => (
              <Skeleton key={i} className={`h-4 w-${w}`} />
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-8 w-8 shrink-0 rounded" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Async data component (inside Suspense) ───────────────────────────────────
// This is the only thing that blocks on the slow appointments query.
async function AppointmentsSection({
  clinicId,
  timezone,
  status,
  date,
}: {
  clinicId: string
  timezone: string
  status?: string
  date?: string
}) {
  const supabase = await createClient()

  let query = supabase
    .from('appointments')
    .select(`
      id, patient_name, patient_phone, starts_at, ends_at, status, created_at, notes,
      doctors(id, name, specialty),
      services(id, name, duration_minutes)
    `)
    .eq('clinic_id', clinicId)
    .order('starts_at', { ascending: false })
    .limit(200)

  if (status && status !== 'all') {
    query = query.eq('status', status as 'pending' | 'confirmed' | 'cancelled')
  }
  if (date) {
    const dayStart = new Date(date + 'T00:00:00.000Z').toISOString()
    const dayEnd   = new Date(date + 'T23:59:59.999Z').toISOString()
    query = query.gte('starts_at', dayStart).lte('starts_at', dayEnd)
  }

  const { data: appointments } = await query
  return <AppointmentsTable appointments={appointments ?? []} timezone={timezone} />
}

// ─── Page shell (renders immediately) ────────────────────────────────────────
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string }>
}) {
  const { status, date } = await searchParams
  // React.cache() deduplication: getAdminProfile() already resolved by layout — 0 extra roundtrip
  const { clinicId, timezone } = await getAdminProfile()
  const supabase = await createClient()

  // Fast parallel fetch for the "Nueva cita" dialog (~50 ms, runs while layout still streaming)
  const [{ data: doctors }, { data: services }] = await Promise.all([
    supabase
      .from('doctors')
      .select('id, name, specialty, doctor_services(service_id)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <div className="space-y-6">
      {/* Header — visible as soon as doctors+services resolve (~50 ms) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Citas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Historial y gestión de todas las citas de la clínica.
          </p>
        </div>
        <NewAppointmentDialog
          doctors={doctors ?? []}
          services={services ?? []}
        />
      </div>

      {/* Table — streams in independently once appointments query resolves (~200 ms) */}
      <Suspense fallback={<AppointmentsTableSkeleton />}>
        <AppointmentsSection
          clinicId={clinicId}
          timezone={timezone}
          status={status}
          date={date}
        />
      </Suspense>
    </div>
  )
}
