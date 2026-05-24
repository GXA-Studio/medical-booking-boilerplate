import 'server-only'
import nodemailer from 'nodemailer'

// Free / personal email providers that MUST NOT be used as the SMTP identity
// for outbound clinic notifications. Enforcing a corporate domain prevents the
// service from quietly degrading to a personal Gmail (or similar) account if
// an operator copy-pastes the wrong credentials into the deployment env.
const FORBIDDEN_PROVIDER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
])

interface CorporateMailerConfig {
  readonly host:              string
  readonly port:              number
  readonly secure:            boolean
  readonly user:              string
  readonly password:          string
  readonly notificationInbox: string
  readonly fromName:          string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[email/notifier] Missing required env var ${name}. Corporate SMTP credentials must be configured explicitly — no fallback is allowed.`,
    )
  }
  return value.trim()
}

function assertCorporateAddress(address: string, varName: string): void {
  const at = address.lastIndexOf('@')
  if (at < 1 || at === address.length - 1) {
    throw new Error(`[email/notifier] ${varName}="${address}" is not a valid email address`)
  }
  const domain = address.slice(at + 1).toLowerCase()
  if (FORBIDDEN_PROVIDER_DOMAINS.has(domain)) {
    throw new Error(
      `[email/notifier] ${varName} domain "${domain}" is a free/personal provider; ` +
      'a corporate domain is required for clinic notifications.',
    )
  }
}

function loadConfig(): CorporateMailerConfig {
  const host              = requireEnv('CORPORATE_SMTP_HOST')
  const portRaw           = requireEnv('CORPORATE_SMTP_PORT')
  const user              = requireEnv('CORPORATE_SMTP_USER')
  const password          = requireEnv('CORPORATE_SMTP_PASSWORD')
  const notificationInbox = requireEnv('CORPORATE_NOTIFICATION_INBOX')
  const fromName          = requireEnv('CORPORATE_SMTP_FROM_NAME')

  const port = Number.parseInt(portRaw, 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`[email/notifier] CORPORATE_SMTP_PORT="${portRaw}" is not a valid TCP port`)
  }

  assertCorporateAddress(user, 'CORPORATE_SMTP_USER')
  assertCorporateAddress(notificationInbox, 'CORPORATE_NOTIFICATION_INBOX')

  return {
    host,
    port,
    secure: port === 465,
    user,
    password,
    notificationInbox,
    fromName,
  }
}

let _config: CorporateMailerConfig | null = null
let _transporter: nodemailer.Transporter | null = null

function getMailer(): { transporter: nodemailer.Transporter; config: CorporateMailerConfig } {
  if (!_config) _config = loadConfig()
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:   _config.host,
      port:   _config.port,
      secure: _config.secure,
      auth:   { user: _config.user, pass: _config.password },
    })
  }
  return { transporter: _transporter, config: _config }
}

export interface LeadNotificationPayload {
  name: string
  email: string
  clinic: string
  message?: string
}

// Sends both an internal notification to the corporate inbox and a courtesy
// confirmation to the lead. Throws if the corporate SMTP env vars are missing
// or point at a free provider — the caller is expected to wrap this in a
// try/catch so a misconfigured mailer doesn't drop the underlying lead row.
export async function sendLeadNotificationEmail(payload: LeadNotificationPayload): Promise<void> {
  const { transporter, config } = getMailer()

  const { name, email, clinic, message } = payload
  const safeMessage = message
    ? message.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    : ''

  const fromAddress = `"${config.fromName}" <${config.user}>`
  const subject = `Nuevo lead — ${name} (${clinic})`
  const text =
    `Nuevo lead capturado desde la landing.\n\n` +
    `Nombre:  ${name}\n` +
    `Email:   ${email}\n` +
    `Clínica: ${clinic}\n` +
    (message ? `\nNota:\n${message}\n` : '') +
    `\n---\nResponde directamente para contactar con ${email}.`

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;color:#111;">` +
    `<h2 style="margin:0 0 16px;font-size:20px;">🦷 Nuevo lead</h2>` +
    `<table cellpadding="6" style="border-collapse:collapse;font-size:14px;">` +
    `<tr><td style="color:#666;width:80px;">Nombre</td><td><strong>${name}</strong></td></tr>` +
    `<tr><td style="color:#666;">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>` +
    `<tr><td style="color:#666;">Clínica</td><td>${clinic}</td></tr>` +
    `</table>` +
    (safeMessage
      ? `<div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:4px;font-size:14px;line-height:1.5;"><strong>Nota:</strong><br/>${safeMessage.replace(/\n/g, '<br/>')}</div>`
      : '') +
    `<p style="margin-top:20px;font-size:12px;color:#999;">Captura automática desde la landing de ${config.fromName}.</p>` +
    `</div>`

  const confirmationHtml =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;color:#111;">` +
    `<h2 style="margin:0 0 16px;font-size:20px;">Hemos recibido tu consulta</h2>` +
    `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">Hola ${name},</p>` +
    `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">Gracias por tu interés. Nos pondremos en contacto contigo en menos de 24 horas laborables para agendar tu consulta inicial gratuita.</p>` +
    `<p style="margin-top:32px;font-size:13px;color:#666;">Un saludo,<br/>El equipo de ${config.fromName}</p>` +
    `</div>`

  await Promise.all([
    transporter.sendMail({
      from:    fromAddress,
      to:      config.notificationInbox,
      replyTo: email,
      subject,
      text,
      html,
    }),
    transporter.sendMail({
      from:    fromAddress,
      to:      email,
      replyTo: config.notificationInbox,
      subject: `Hemos recibido tu consulta — ${config.fromName}`,
      text:
        `Hola ${name},\n\n` +
        `Gracias por tu interés. Nos pondremos en contacto contigo en menos de 24 horas laborables para agendar tu consulta inicial gratuita.\n\n` +
        `Un saludo,\nEl equipo de ${config.fromName}`,
      html: confirmationHtml,
    }),
  ])
}
