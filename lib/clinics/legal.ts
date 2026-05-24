import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

export interface ClinicLegalData {
  name: string
  legal_name: string | null
  cif: string | null
  address: string | null
}

// Loads the legal identification data of a clinic for the privacy policy page.
// Returns null when the slug is missing or the clinic doesn't exist —
// callers should render the generic fallback in that case.
export async function getClinicLegalData(slug: string | null | undefined): Promise<ClinicLegalData | null> {
  if (!slug) return null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('clinics')
    .select('name, legal_name, cif, address')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.warn('[getClinicLegalData] supabase error for slug', slug, '→', error.message)
    return null
  }
  return data
}
