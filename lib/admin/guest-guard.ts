import { cookies } from 'next/headers'

export const GUEST_COOKIE = 'mbb_guest'

export async function isGuestMode(): Promise<boolean> {
  const jar = await cookies()
  return jar.get(GUEST_COOKIE)?.value === '1'
}

export const DEMO_RESULT = { demo: true } as const
