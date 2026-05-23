import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { AdminShell } from '@/components/admin/admin-shell'
import { getAdminProfile } from '@/lib/admin/profile'
import { GUEST_COOKIE } from '@/lib/admin/guest-guard'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, clinicName, userEmail } = await getAdminProfile()
  if (!user) redirect('/auth/login')

  const jar = await cookies()
  const isGuest = jar.get(GUEST_COOKIE)?.value === '1'

  return (
    <AdminShell clinicName={clinicName} userEmail={userEmail} isGuest={isGuest}>
      {children}
    </AdminShell>
  )
}
