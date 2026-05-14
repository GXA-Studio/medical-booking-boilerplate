import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { createHash, randomInt } from 'crypto'
import { formatInTimeZone } from 'date-fns-tz'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// shadcn/ui standard cn helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------- OTP ----------

export function generateOTP(): string {
  // Cryptographically random 6-digit code
  return String(randomInt(100000, 999999))
}

export function hashOTP(otp: string): string {
  return createHash('sha256').update(otp).digest('hex')
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

// Format for SMS text (short and unambiguous)
export function formatSmsDateTime(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, "dd/MM/yyyy 'a las' HH:mm", {
    locale: es,
  })
}

// Build an ISO date string (YYYY-MM-DD) from a local date in a given timezone
export function toLocalDateString(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, 'yyyy-MM-dd')
}

// ---------- Phone ----------

// Validate E.164 format: +[country code][number], 8-15 digits total
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
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
