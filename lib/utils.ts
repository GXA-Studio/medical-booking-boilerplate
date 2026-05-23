import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'

// shadcn/ui standard cn helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------- Date / Timezone ----------

// Format a UTC timestamp for display in a given IANA timezone
export function formatLocalDateTime(
  utcDate: string | Date,
  timezone: string,
  fmt = "EEEE d 'de' MMMM, HH:mm"
): string {
  return formatInTimeZone(new Date(utcDate), timezone, fmt, { locale: es })
}

// Format for SMS text
export function formatSmsDateTime(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, "dd/MM/yyyy 'a las' HH:mm", {
    locale: es,
  })
}

export function toLocalDateString(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, 'yyyy-MM-dd')
}

// ---------- Phone ----------

// E.164: + followed by 1-9 (no leading zero country code) + 7-14 more digits = 8-15 total digits
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

// M-04 FIX: strip control characters (incl. newlines) to prevent SMS injection
export function sanitizeName(name: string): string {
  return name.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim()
}

// ---------- Base URL (server-side) ----------

// Single source of truth for the public app URL.
// Priority: NEXT_PUBLIC_APP_URL → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL → localhost.
// VERCEL_* vars arrive WITHOUT a protocol prefix — we always prepend "https://".
// Anti-Localhost guard: if running on Vercel (VERCEL=1) and the resolved URL still contains
// "localhost", we override with the hardcoded prod domain. This prevents broken cancel links
// caused by NEXT_PUBLIC_APP_URL being accidentally set to localhost in the dashboard.
const PROD_FALLBACK = 'https://medical-booking-boilerplate.vercel.app'

export function getBaseUrl(): string {
  const onVercel = process.env.VERCEL === '1'

  if (process.env.NEXT_PUBLIC_APP_URL) {
    const url = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
    if (onVercel && url.includes('localhost')) {
      console.warn('[getBaseUrl] NEXT_PUBLIC_APP_URL contains localhost on Vercel — overriding with prod fallback:', PROD_FALLBACK)
      return PROD_FALLBACK
    }
    return url
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    const url = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    if (onVercel && url.includes('localhost')) {
      console.warn('[getBaseUrl] VERCEL_PROJECT_PRODUCTION_URL contains localhost on Vercel — overriding with prod fallback:', PROD_FALLBACK)
      return PROD_FALLBACK
    }
    return url
  }
  if (process.env.VERCEL_URL) {
    const url = `https://${process.env.VERCEL_URL}`
    if (onVercel && url.includes('localhost')) {
      console.warn('[getBaseUrl] VERCEL_URL contains localhost on Vercel — overriding with prod fallback:', PROD_FALLBACK)
      return PROD_FALLBACK
    }
    return url
  }
  if (onVercel) {
    console.warn('[getBaseUrl] Running on Vercel but no URL env var resolved — forcing prod fallback:', PROD_FALLBACK)
    return PROD_FALLBACK
  }
  console.warn('[getBaseUrl] source=localhost fallback — set NEXT_PUBLIC_APP_URL in Vercel Dashboard')
  return 'http://localhost:3000'
}

// ---------- Misc ----------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
