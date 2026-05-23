import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { GUEST_COOKIE } from '@/lib/admin/guest-guard'

const DEMO_EMAIL    = 'admin@demo.com'
const DEMO_PASSWORD = 'demo1234'

export async function GET() {
  const jar = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            jar.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

  jar.set(GUEST_COOKIE, '1', {
    path:     '/admin',
    httpOnly: false,
    sameSite: 'lax',
    maxAge:   60 * 60 * 2, // 2 h
  })

  return NextResponse.redirect(new URL('/admin', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'))
}
