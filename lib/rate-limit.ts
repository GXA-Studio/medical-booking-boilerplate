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

// Marketing landing form: max 5 lead submissions per IP per hour.
// Generous enough for legitimate retries; tight enough to deter scripted spam.
export const leadsIpLimiter = new Ratelimit({
  redis: getRedis(),
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  analytics: true,
  prefix: '@mbb/leads:ip',
})
