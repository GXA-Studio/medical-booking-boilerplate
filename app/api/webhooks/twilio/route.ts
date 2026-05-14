import { type NextRequest } from 'next/server'
import { validateRequest } from 'twilio'

// POST /api/webhooks/twilio
//
// Handles Twilio status callback webhooks (MessageStatus updates: sent, delivered, failed).
// Configure this URL in the Twilio console as the "Status Callback URL" for your messaging service.
//
// Security: validates the X-Twilio-Signature header using HMAC-SHA1 with TWILIO_AUTH_TOKEN.
// Any request that fails validation is rejected with 403.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL

  if (!authToken || !appUrl) {
    console.error('[webhooks/twilio] Missing TWILIO_AUTH_TOKEN or NEXT_PUBLIC_APP_URL')
    return new Response('Misconfigured', { status: 500 })
  }

  const signature  = req.headers.get('x-twilio-signature') ?? ''
  const webhookUrl = `${appUrl}/api/webhooks/twilio`

  // Twilio sends application/x-www-form-urlencoded
  let params: Record<string, string> = {}
  try {
    const formData = await req.formData()
    formData.forEach((value, key) => {
      params[key] = String(value)
    })
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // Validate signature — prevents spoofed webhook calls
  const isValid = validateRequest(authToken, signature, webhookUrl, params)
  if (!isValid) {
    console.warn('[webhooks/twilio] Invalid signature — request rejected')
    return new Response('Forbidden', { status: 403 })
  }

  const messageSid = params['MessageSid']    ?? 'unknown'
  const status     = params['MessageStatus'] ?? 'unknown'
  const to         = params['To']            ?? 'unknown'

  // Log delivery status for observability — extend to store in DB if needed
  console.info(`[webhooks/twilio] ${messageSid} → ${status} (to: ${to})`)

  if (status === 'failed' || status === 'undelivered') {
    // TODO (Step 4): optionally mark the appointment's SMS status in the DB
    // and surface it in the admin dashboard
    console.warn(`[webhooks/twilio] Delivery failure for ${messageSid} to ${to}`)
  }

  // Twilio expects a 200 response, otherwise it retries
  return new Response('OK', { status: 200 })
}
