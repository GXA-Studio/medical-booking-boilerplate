import 'server-only'
import twilio from 'twilio'
import { formatSmsDateTime } from '@/lib/utils'

let _client: ReturnType<typeof twilio> | null = null

function getClient() {
  if (!_client) {
    const sid   = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set')
    _client = twilio(sid, token)
  }
  return _client
}

const FROM = () => {
  const n = process.env.TWILIO_PHONE_NUMBER
  if (!n) throw new Error('TWILIO_PHONE_NUMBER must be set')
  return n
}

// WhatsApp Sandbox sender — replace with approved number in production
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886'

// ─── SMS (legacy OTP flow, kept for backward compatibility) ───────────────────

export interface SendOtpParams {
  to: string
  otp: string
  clinicName: string
}

export async function sendOtpSms({ to, otp, clinicName }: SendOtpParams): Promise<void> {
  await getClient().messages.create({
    to,
    from: FROM(),
    body: `${clinicName}: tu código de verificación es *${otp}*. Válido por 5 minutos. No lo compartas.`,
  })
}

export interface SendConfirmationParams {
  to: string
  patientName: string
  clinicName: string
  startsAt: string
  timezone: string
  doctorName: string
  serviceName: string
}

export async function sendConfirmationSms({
  to, patientName, clinicName, startsAt, timezone, doctorName, serviceName,
}: SendConfirmationParams): Promise<void> {
  const dateStr = formatSmsDateTime(startsAt, timezone)
  await getClient().messages.create({
    to,
    from: FROM(),
    body:
      `✅ ${clinicName}: cita confirmada para ${patientName}.\n` +
      `📅 ${dateStr}\n` +
      `👨‍⚕️ ${doctorName} — ${serviceName}`,
  })
}

// ─── WhatsApp (instant booking flow) ─────────────────────────────────────────

export interface SendWhatsAppConfirmationParams {
  to: string                // E.164, e.g. "+34612345678"
  patientName: string
  clinicName: string
  doctorName: string
  startsAt: string          // UTC ISO
  timezone: string
  cancellationToken: string
  baseUrl: string
}

export async function sendWhatsAppConfirmation({
  to, patientName, clinicName, doctorName, startsAt, timezone, cancellationToken, baseUrl,
}: SendWhatsAppConfirmationParams): Promise<void> {
  const dateStr  = formatSmsDateTime(startsAt, timezone)
  const toWa     = `whatsapp:${to}`
  const msgBody  =
    `¡Hola ${patientName}! Cita confirmada en ${clinicName}.\n` +
    `Especialista: ${doctorName}. Fecha: ${dateStr}.\n\n` +
    `🔗 Cancelar con un clic: ${baseUrl}/cancel/${cancellationToken}\n\n` +
    `Nota legal (AEPD): Tratamos tus datos según el RGPD. +info en nuestra web o responde a este chat.`

  const payload = { to: toWa, from: WHATSAPP_FROM, body: msgBody }
  console.log('[Twilio WA] sendWhatsAppConfirmation → payload:', JSON.stringify(payload))

  try {
    const msg = await getClient().messages.create(payload)
    console.log('[Twilio WA] Message queued → SID:', msg.sid, '| Status:', msg.status, '| ErrorCode:', msg.errorCode)
  } catch (err: unknown) {
    const e = err as { status?: number; code?: number; message?: string; moreInfo?: string }
    console.error('[Twilio WA] API error →', JSON.stringify({
      httpStatus: e.status,
      twilioCode: e.code,
      message:    e.message,
      moreInfo:   e.moreInfo,
    }))
    throw err
  }
}

export interface SendWhatsAppReminderParams {
  to: string
  patientName: string
  clinicName: string
  doctorName: string
  startsAt: string
  timezone: string
  cancellationToken: string
  baseUrl: string
}

export async function sendWhatsAppReminder({
  to, patientName, clinicName, doctorName, startsAt, timezone, cancellationToken, baseUrl,
}: SendWhatsAppReminderParams): Promise<void> {
  const dateStr = formatSmsDateTime(startsAt, timezone)
  await getClient().messages.create({
    to:   `whatsapp:${to}`,
    from: WHATSAPP_FROM,
    body:
      `⏰ Recordatorio: ${patientName}, mañana tienes cita en ${clinicName}.\n` +
      `Especialista: ${doctorName}. Fecha: ${dateStr}.\n\n` +
      `¿No puedes venir? Cancela aquí: ${baseUrl}/cancel/${cancellationToken}`,
  })
}
