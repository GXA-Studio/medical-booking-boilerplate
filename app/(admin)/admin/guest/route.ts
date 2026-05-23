import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { GUEST_COOKIE } from '@/lib/admin/guest-guard'

const DEMO_EMAIL    = 'admin@demo.com'
const DEMO_PASSWORD = 'demo1234'

export async function GET(request: NextRequest) {
  const redirectUrl = new URL('/admin', request.nextUrl.origin)
  const response    = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

  response.cookies.set(GUEST_COOKIE, '1', {
    path:     '/admin',
    httpOnly: false,
    sameSite: 'lax',
    maxAge:   60 * 60 * 2,
  })

  return response
}
