import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

// Singleton browser client — safe to call multiple times (returns the same instance)
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
