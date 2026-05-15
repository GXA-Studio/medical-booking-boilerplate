import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Lazily constructed — prevents build errors when env vars are absent during static analysis
let _redis: Redis | null = null

function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv()  // reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  }
  return _redis
}

// C-01 FIX: 3 OTP send requests per phone number per 10-minute sliding window
// Prevents SMS flooding and Twilio budget exhaustion
export const otpSendLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(3, '10 m'),
  analytics: true,
  prefix: '@mbb/otp:send',
})

// C-01 FIX: 5 verify attempts per appointmentId per 10-minute fixed window
// On the 6th+ attempt, the route handler cancels the appointment (invalidates OTP)
export const otpVerifyLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.fixedWindow(5, '10 m'),
  analytics: true,
  prefix: '@mbb/otp:verify',
})

// Anti-spam: max 10 instant bookings per IP per hour
export const bookingIpLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: true,
  prefix: '@mbb/booking:ip',
})

// S-01 PATCH: 60 slot lookups per IP per minute — prevents enumeration/scraping
export const slotsLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  analytics: true,
  prefix: '@mbb/slots:ip',
})
