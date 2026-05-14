import twilio from 'twilio'
import { formatSmsDateTime } from '@/lib/utils'

// Lazy singleton — throws at call-time (not import-time) if env vars are missing,
// so the build doesn't fail when env is incomplete.
let _client: ReturnType<typeof twilio> | null = null

function getClient() {
  if (!_client) {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !token) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set')
    }
    _client = twilio(sid, token)
  }
  return _client
}

const FROM = () => {
  const n = process.env.TWILIO_PHONE_NUMBER
  if (!n) throw new Error('TWILIO_PHONE_NUMBER must be set')
  return n
}

export interface SendOtpParams {
  to: string       // E.164 phone number
  otp: string      // Plaintext 6-digit code
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
  startsAt: string   // UTC ISO string
  timezone: string   // IANA timezone of the clinic
  doctorName: string
  serviceName: string
}

export async function sendConfirmationSms({
  to,
  patientName,
  clinicName,
  startsAt,
  timezone,
  doctorName,
  serviceName,
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
