'use server'
import { createServiceClient } from '@/lib/supabase/server'

export async function cancelByToken(token: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('cancellation_token', token)
    .eq('status', 'confirmed')
    .gt('starts_at', new Date().toISOString())
    .select('id')
    .single()

  if (error || !data) {
    return { success: false, error: 'No se pudo cancelar la cita. Es posible que ya esté cancelada o haya pasado.' }
  }

  return { success: true }
}
