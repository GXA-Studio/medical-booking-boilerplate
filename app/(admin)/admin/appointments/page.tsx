import { createClient } from '@/lib/supabase/server'
import { AppointmentsTable } from '@/components/admin/appointments-table'

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string }>
}) {
  const { status, date } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles').select('clinic_id, clinics(timezone)').eq('id', user!.id).single()

  const clinicId = profile?.clinic_id ?? ''
  const timezone = (profile?.clinics as { timezone: string } | null)?.timezone
    ?? process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE
    ?? 'UTC'

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
    // Filter by UTC day boundaries using starts_at
    const dayStart = new Date(date + 'T00:00:00.000Z').toISOString()
    const dayEnd   = new Date(date + 'T23:59:59.999Z').toISOString()
    query = query.gte('starts_at', dayStart).lte('starts_at', dayEnd)
  }

  const { data: appointments } = await query

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Citas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historial y gestión de todas las citas de la clínica.
        </p>
      </div>
      <AppointmentsTable appointments={appointments ?? []} timezone={timezone} />
    </div>
  )
}
