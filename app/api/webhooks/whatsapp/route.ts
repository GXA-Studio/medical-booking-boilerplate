import { NextRequest } from 'next/server'
import { validateRequest } from 'twilio'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'

const CANCEL_KEYWORDS = ['cancelar', 'anular', 'baja', 'cancel']

function stripWhatsappPrefix(from: string): string {
  return from.replace(/^whatsapp:/, '')
}

// POST /api/webhooks/whatsapp
//
// Handles inbound WhatsApp messages from Twilio Sandbox.
// Configure this URL in Twilio console → Messaging → Sandbox → "When a message comes in".
//
// Security: HMAC-SHA1 signature validation via X-Twilio-Signature header.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL

  if (!authToken || !appUrl) {
    console.error('[webhooks/whatsapp] Missing TWILIO_AUTH_TOKEN or NEXT_PUBLIC_APP_URL')
    return new Response('Misconfigured', { status: 500 })
  }

  const signature  = req.headers.get('x-twilio-signature') ?? ''
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`

  let params: Record<string, string> = {}
  try {
    const formData = await req.formData()
    formData.forEach((value, key) => { params[key] = String(value) })
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const isValid = validateRequest(authToken, signature, webhookUrl, params)
  if (!isValid) {
    console.warn('[webhooks/whatsapp] Invalid Twilio signature — rejected')
    return new Response('Forbidden', { status: 403 })
  }

  const fromRaw  = params['From'] ?? ''
  const bodyText = (params['Body'] ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  const phone    = stripWhatsappPrefix(fromRaw)

  const twiml = new twilio.twiml.MessagingResponse()

  const hasCancel = CANCEL_KEYWORDS.some((kw) => bodyText.includes(kw))

  if (hasCancel) {
    const supabase = createServiceClient()

    const { data: appt } = await supabase
      .from('appointments')
      .select('id, starts_at')
      .eq('patient_phone', phone)
      .eq('status', 'confirmed')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!appt) {
      twiml.message(
        'No encontramos ninguna cita próxima asociada a este número. ' +
        'Si crees que es un error, contacta directamente con tu clínica.'
      )
    } else {
      const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appt.id)

      if (error) {
        console.error('[webhooks/whatsapp] Cancel error:', error)
        twiml.message('Ha ocurrido un error al cancelar tu cita. Por favor, inténtalo de nuevo o contacta con la clínica.')
      } else {
        twiml.message('✅ Cita anulada correctamente. El hueco ya está libre. ¡Hasta pronto!')
      }
    }
  } else {
    twiml.message(
      '👋 Hola. ¿En qué puedo ayudarte?\n\n' +
      'Para *cancelar tu cita* escribe "cancelar".\n' +
      'También puedes cancelar usando el enlace que te enviamos al confirmar.\n\n' +
      'Para cualquier otra consulta, contacta directamente con tu clínica.'
    )
  }

  return new Response(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
