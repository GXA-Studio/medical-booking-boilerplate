import 'server-only'
import nodemailer from 'nodemailer'

const NOTIFICATION_INBOX = 'studiogxa@gmail.com'

let _transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_APP_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  }
  return _transporter
}

export interface LeadNotificationPayload {
  name: string
  email: string
  clinic: string
  message?: string
}

// Sends an email to NOTIFICATION_INBOX with the lead details.
// If GMAIL credentials are missing, logs a warning and silently no-ops —
// lead capture (DB insert) must not break because of a notification failure.
export async function sendLeadNotificationEmail(payload: LeadNotificationPayload): Promise<void> {
  const transporter = getTransporter()
  if (!transporter) {
    console.warn('[sendLeadNotificationEmail] GMAIL_APP_USER/GMAIL_APP_PASSWORD missing — skipping email notification')
    return
  }

  const { name, email, clinic, message } = payload
  const safeMessage = message
    ? message.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    : ''

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
    `<p style="margin-top:20px;font-size:12px;color:#999;">Captura automática desde la landing del medical-booking-boilerplate.</p>` +
    `</div>`

  await transporter.sendMail({
    from: `"Medical Booking — Leads" <${process.env.GMAIL_APP_USER}>`,
    to: NOTIFICATION_INBOX,
    replyTo: email,
    subject,
    text,
    html,
  })
}
