'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ServiceSchema = z.object({
  name:             z.string().min(2).max(100).trim(),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  price:            z.coerce.number().min(0).optional().nullable(),
  description:      z.string().max(500).optional().nullable(),
  color:            z.enum(['blue', 'emerald', 'purple', 'amber', 'rose']).default('blue'),
})

async function getClinicContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, clinics(slug)')
    .eq('id', user.id)
    .single()
  if (!profile?.clinic_id) throw new Error('No clinic associated')
  return {
    clinicId:   profile.clinic_id as string,
    clinicSlug: (profile.clinics as { slug: string } | null)?.slug ?? null,
  }
}

export async function createService(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ServiceSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { error } = await supabase.from('services').insert({ clinic_id: clinicId, ...parsed.data })
  if (error) {
    console.error('[createService] DB error:', error)
    return { error: 'Error al guardar el servicio.' }
  }

  revalidatePath('/admin/services')
  revalidatePath('/admin/agenda')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function updateService(id: string, formData: FormData) {
  if (!UUID_RE.test(id)) return { error: 'ID no válido.' }

  const raw = Object.fromEntries(formData)
  const parsed = ServiceSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { error } = await supabase.from('services').update(parsed.data)
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) {
    console.error('[updateService] DB error:', error)
    return { error: 'Error al guardar el servicio.' }
  }

  // Color inheritance: appointments without an explicit color inherit
  // services.color → revalidate agenda so the cards repaint instantly.
  revalidatePath('/admin/services')
  revalidatePath('/admin/agenda')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function toggleService(id: string, isActive: boolean) {
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)
  await supabase.from('services').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/services')
  revalidatePath('/admin/agenda')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
}
