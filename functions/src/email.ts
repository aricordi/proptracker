// Sends the emails queued in `outbox` (status updates, late notices, warnings).
//
// Works with any email service that offers SMTP (Gmail / Google Workspace now,
// Resend or Brevo later): the server name, login and "from" address live in
// app_settings/email (owner edits them on Admin → Email); only the password is
// secret, in Google Secret Manager as SMTP_PASSWORD.
// OR (owner, Oct 27) service 'google': sent as the connected Prime Capitol Google account (Admin → Google account,
// googleAccount.ts) through Gmail's "send only" permission. No password needed.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import nodemailer, { type SendMailOptions } from 'nodemailer'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { gmailAccess } from './googleAccount.js'

// Flip to true once SMTP_PASSWORD exists in Secret Manager: a deploy fails if the
// code even mentions a secret that doesn't exist. Until then, emails are only
// logged as "skipped" (the local emulator always uses practice sending).
const SMTP_SECRET_READY = false
const SMTP_PASSWORD = SMTP_SECRET_READY || process.env.FUNCTIONS_EMULATOR === 'true' ? defineSecret('SMTP_PASSWORD') : null
const smtpSecrets = SMTP_PASSWORD ? [SMTP_PASSWORD] : []

export interface EmailSettings {
  enabled: boolean
  service: 'smtp' | 'google'
  host: string        // e.g. smtp.gmail.com
  port: number        // 465 (secure) or 587
  user: string        // login, e.g. the Gmail address
  fromName: string    // e.g. "Prop Tracker"
  fromAddress: string // usually the same as user for Gmail
  appUrl: string      // link added to each email, e.g. https://….web.app
}

const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s)
const oneLine = (s: unknown, max: number) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, max)

async function loadEmailSettings(): Promise<EmailSettings | null> {
  const d = (await db.doc('app_settings/email').get()).data()
  if (!d) return null
  const port = Number(d.port)
  return {
    enabled: d.enabled === true,
    service: d.service === 'google' ? 'google' : 'smtp',
    host: oneLine(d.host, 200),
    port: port === 465 || port === 587 ? port : 465,
    user: oneLine(d.user, 200),
    fromName: oneLine(d.fromName || 'Prime Capitol', 80).replace(/"/g, ''),
    fromAddress: isEmail(d.fromAddress) ? d.fromAddress : isEmail(d.user) ? d.user : '',
    appUrl: typeof d.appUrl === 'string' && /^https:\/\/[^\s]+$/.test(d.appUrl) ? d.appUrl.replace(/\/+$/, '') : '',
  }
}

// 'arts-team' means everyone in the arts department plus the owner.
async function recipientsFor(to: string): Promise<string[]> {
  if (to !== 'arts-team') return isEmail(to) ? [to] : []
  const snap = await db.collection('users').where('active', '==', true).where('role', 'in', ['arts', 'owner']).get()
  return [...new Set([OWNER_EMAIL, ...snap.docs.map(d => d.id)])].filter(isEmail)
}

function password(): string {
  try { return SMTP_PASSWORD?.value() ?? '' } catch { return '' }
}

export const sendQueuedEmail = onDocumentCreated({ document: 'outbox/{id}', secrets: smtpSecrets }, async event => {
  const created = event.data
  if (!created) return
  // Record the outcome; ignore it if the email record has since disappeared.
  const snap = { id: created.id, ref: { update: (d: Record<string, unknown>) => created.ref.update(d).catch(err => {
    if ((err as { code?: number }).code !== 5) throw err
  }) } }
  const mail = created.data()
  if (mail.sent || mail.status) return

  const settings = await loadEmailSettings()
  if (!settings?.enabled) {
    await snap.ref.update({ status: 'skipped', note: 'Email sending is turned off' })
    return
  }
  const to = await recipientsFor(mail.to)
  if (!to.length) {
    await snap.ref.update({ status: 'skipped', note: 'Nobody to send to' })
    return
  }
  const link = mail.reservationId && settings.appUrl ? `\n\nOpen it in Prime Capitol: ${settings.appUrl}/reservations/${mail.reservationId}` : ''
  const message = {
    from: `"${settings.fromName}" <${settings.fromAddress}>`,
    to,
    subject: oneLine(mail.subject, 200),
    text: `${String(mail.body ?? '').slice(0, 5000)}${link}\n\n— ${settings.fromName}`,
  }

  if (settings.service === 'google') {
    try {
      const g = await gmailAccess()
      if (!g) { await snap.ref.update({ status: 'failed', error: 'The Prime Capitol Google account isn\'t connected (Admin → Google account)' }); return }
      if (g.fake || process.env.FUNCTIONS_EMULATOR === 'true') {
        await snap.ref.update({ status: 'sent', sent: true, sentTo: to, sentAt: new Date().toISOString(), fake: true, via: g.account })
        return
      }
      await sendWithGmail(g.token, { ...message, from: `"${settings.fromName}" <${settings.fromAddress || g.account}>` })
      await snap.ref.update({ status: 'sent', sent: true, sentTo: to, sentAt: new Date().toISOString(), via: g.account })
    } catch (err) {
      logger.warn('Email failed', { id: snap.id, error: String(err) })
      await snap.ref.update({ status: 'failed', error: oneLine(err instanceof Error ? err.message : err, 300) })
    }
    return
  }

  // Practice mode: the local emulator (no password) or host "fake" pretends to send.
  const pass = password()
  if (settings.host === 'fake' || (!pass && process.env.FUNCTIONS_EMULATOR === 'true')) {
    await snap.ref.update({ status: 'sent', sent: true, sentTo: to, sentAt: new Date().toISOString(), fake: true })
    return
  }
  if (!pass || !settings.host || !settings.user || !settings.fromAddress) {
    await snap.ref.update({ status: 'failed', error: 'Email settings are incomplete' })
    return
  }
  try {
    const transport = nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.port === 465,
      auth: { user: settings.user, pass },
    })
    await transport.sendMail(message)
    await snap.ref.update({ status: 'sent', sent: true, sentTo: to, sentAt: new Date().toISOString() })
  } catch (err) {
    logger.warn('Email failed', { id: snap.id, error: String(err) })
    await snap.ref.update({ status: 'failed', error: oneLine(err instanceof Error ? err.message : err, 300) })
  }
})

// Gmail "send only": nodemailer builds the email, Gmail sends it. The "from" must be the account itself or an
// address set up in its Gmail → Settings → Accounts → "Send mail as" (else Gmail quietly uses the account's own).
async function sendWithGmail(token: string, message: SendMailOptions) {
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message)
  const raw = (built.message as Buffer).toString('base64url')
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  })
  if (!r.ok) throw new Error(`Gmail said ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

// Owner: send a test email to yourself to check the settings work.
export const sendTestEmail = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner'])
  const ref = await db.collection('outbox').add({
    to: caller.email,
    subject: 'Prime Capitol test email',
    body: 'If you can read this, Prime Capitol can send emails. 🎬',
    createdAt: new Date().toISOString(),
    sent: false,
  })
  return { id: ref.id }
})
