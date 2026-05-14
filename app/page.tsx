import { redirect } from 'next/navigation'

// Root redirects to the admin dashboard.
// Each clinic's patient-facing booking page lives at /<clinicSlug>
export default function RootPage() {
  redirect('/admin')
}
