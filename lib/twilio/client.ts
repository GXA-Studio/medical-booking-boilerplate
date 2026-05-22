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
  serviceName: string       // e.g. "Consulta General"
  startsAt: string          // UTC ISO
  timezone: string
  cancellationToken: string
  baseUrl: string
}

export async function sendWhatsAppConfirmation({
  to, patientName, clinicName, doctorName, serviceName, startsAt, timezone, cancellationToken, baseUrl,
}: SendWhatsAppConfirmationParams): Promise<void> {
  const dateStr  = formatSmsDateTime(startsAt, timezone)
  const toWa     = `whatsapp:${to}`
  const msgBody  =
    `¡Hola ${patientName}! Tu cita para *${serviceName}* ha sido confirmada en ${clinicName}.\n` +
    `👨‍⚕️ Profesional: ${doctorName}\n` +
    `📅 Fecha: ${dateStr}\n\n` +
    `⚙️ Gestionar cita (Modificar o Cancelar): ${baseUrl}/manage/${cancellationToken}\n\n` +
    `Nota legal (AEPD): Tratamos tus datos según el RGPD. Responde INFO para más detalles.`

  const payload = { to: toWa, from: WHATSAPP_FROM, body: msgBody }

  try {
    await getClient().messages.create(payload)
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

export interface SendCancellationWhatsAppParams {
  to: string
  patientName: string
  clinicName: string
  startsAt: string
  timezone: string
  /** Doctor's full name — when provided, triggers the empathetic exception-cancel message */
  doctorName?: string
  /** Direct link to rebook — shown when doctorName is also provided */
  rescheduleUrl?: string
}

export async function sendCancellationWhatsApp({
  to, patientName, clinicName, startsAt, timezone, doctorName, rescheduleUrl,
}: SendCancellationWhatsAppParams): Promise<void> {
  const dateStr = formatSmsDateTime(startsAt, timezone)

  const body = doctorName
    ? `Hola ${patientName},\n\n` +
      `Lamentamos comunicarte que el/la Dr./Dra. ${doctorName} ha tenido un imprevisto y no podrá atenderte ` +
      `el ${dateStr}. Tu cita en ${clinicName} ha sido cancelada.\n\n` +
      `Para elegir una nueva fecha y hora con total comodidad, haz clic aquí:\n` +
      `🔗 ${rescheduleUrl ?? clinicName}\n\n` +
      `Disculpa las molestias. Estamos a tu disposición para cualquier consulta.`
    : `Hola ${patientName}, tu cita en ${clinicName} para el día ${dateStr} ha sido cancelada correctamente. ` +
      `Esperamos verte pronto.`

  await getClient().messages.create({
    to:   `whatsapp:${to}`,
    from: WHATSAPP_FROM,
    body,
  })
}

export interface SendRescheduleWhatsAppParams {
  to: string
  patientName: string
  clinicName: string
  startsAt: string
  timezone: string
  cancellationToken: string
  baseUrl: string
}

export async function sendRescheduleWhatsApp({
  to, patientName, clinicName, startsAt, timezone, cancellationToken, baseUrl,
}: SendRescheduleWhatsAppParams): Promise<void> {
  const dateStr  = formatSmsDateTime(startsAt, timezone)
  const manageUrl = `${baseUrl}/manage/${cancellationToken}`
  await getClient().messages.create({
    to:   `whatsapp:${to}`,
    from: WHATSAPP_FROM,
    body:
      `¡Cita actualizada! Tu nueva reserva en ${clinicName} es el ${dateStr}.\n\n` +
      `⚙️ Gestionar cita (Modificar o Cancelar): ${manageUrl}`,
  })
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
      `⚙️ Gestiona tu cita (modificar o cancelar): ${baseUrl}/manage/${cancellationToken}`,
  })
}

