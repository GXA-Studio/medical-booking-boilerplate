import { Suspense } from 'react'
import { createClient }   from '@/lib/supabase/server'
import { ServicesClient }  from '@/components/admin/services-client'
import { getAdminProfile } from '@/lib/admin/profile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

function ServicesSkeleton() {
  return (
    <Card className="border-slate-200/70">
      <CardContent className="p-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

async function ServicesSection() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })

  return <ServicesClient services={services ?? []} />
}

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Servicios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los servicios ofrecidos por la clínica. La duración define los huecos del calendario.
        </p>
      </div>
      <Suspense fallback={<ServicesSkeleton />}>
        <ServicesSection />
      </Suspense>
    </div>
  )
}
