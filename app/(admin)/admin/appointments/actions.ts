'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!data?.clinic_id) throw new Error('No clinic')
  return data.clinic_id as string
}

export async function cancelAppointment(id: string) {
  if (!UUID_RE.test(id)) return { error: 'Invalid appointment ID format' }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .in('status', ['pending', 'confirmed'])

  if (error) return { error: error.message }

  revalidatePath('/admin/appointments')
  return { success: true }
}
