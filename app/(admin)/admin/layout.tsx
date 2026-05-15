import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminShell } from '@/components/admin/admin-shell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, full_name, clinics(name, timezone)')
    .eq('id', user.id)
    .single()

  const clinicName = (profile?.clinics as { name: string } | null)?.name ?? 'Mi Clínica'

  return (
    <AdminShell clinicName={clinicName} userEmail={user.email ?? ''}>
      {children}
    </AdminShell>
  )
}
