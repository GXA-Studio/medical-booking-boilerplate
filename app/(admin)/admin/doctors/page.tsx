import { Suspense } from 'react'
import { createClient }  from '@/lib/supabase/server'
import { DoctorsClient } from '@/components/admin/doctors-client'
import { getAdminProfile } from '@/lib/admin/profile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

function DoctorsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="border-slate-200/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

async function DoctorsSection() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  const [{ data: doctors }, { data: services }] = await Promise.all([
    supabase.from('doctors')
      .select('*, doctor_services(service_id)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false }),
    supabase.from('services')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true),
  ])

  return <DoctorsClient doctors={doctors ?? []} services={services ?? []} />
}

export default function DoctorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Médicos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los médicos y sus servicios asociados.
        </p>
      </div>
      <Suspense fallback={<DoctorsSkeleton />}>
        <DoctorsSection />
      </Suspense>
    </div>
  )
}
