'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DoctorSchema = z.object({
  name:      z.string().min(2).max(100).trim(),
  specialty: z.string().max(100).optional().nullable(),
  email:     z.string().email().optional().nullable().or(z.literal('')),
})

async function getClinicContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, clinics(slug)')
    .eq('id', user.id)
    .single()
  if (!profile?.clinic_id) throw new Error('No clinic')
  return {
    clinicId:   profile.clinic_id as string,
    clinicSlug: (profile.clinics as { slug: string } | null)?.slug ?? null,
  }
}

export async function createDoctor(formData: FormData) {
  if (await isGuestMode()) return DEMO_RESULT
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { data: doctor, error } = await supabase
    .from('doctors')
    .insert({ clinic_id: clinicId, ...parsed.data, email: parsed.data.email || null })
    .select('id')
    .single()
  if (error) {
    console.error('[createDoctor] DB error:', error)
    return { error: 'Error al guardar el médico.' }
  }

  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: doctor.id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function updateDoctor(id: string, formData: FormData) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return { error: 'ID no válido.' }

  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { error } = await supabase.from('doctors')
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) {
    console.error('[updateDoctor] DB error:', error)
    return { error: 'Error al guardar el médico.' }
  }

  await supabase.from('doctor_services').delete().eq('doctor_id', id)
  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function toggleDoctor(id: string, isActive: boolean) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)
  await supabase.from('doctors').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
}
