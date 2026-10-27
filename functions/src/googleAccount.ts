// The Prime Capitol Google account (owner, Oct 27). Prime Capitol's IT didn't want the shared calendar shared outside
// the company (our server's own robot address is "outside"). So: IT makes ONE dedicated company account (e.g.
// bookings@primecapitol.ca) and shares the shooting calendar with it inside the company. The owner connects it once
// with "Sign in with Google" on Admin → Google account. The app may then ONLY:
//   - add/change/remove events in calendars shared with that account (calendar.events), and
//   - send the app's emails as that account (gmail.send; it can't read the inbox).
// The sign-in setup (an OAuth "client") lives in the owner's own Google Cloud project (owner's choice). Its ID and secret
// are pasted once on that screen. Secrets stay server-only in `private_google/*` (no security rule lets a phone read
// them). IT can cut it off any time: unshare the calendar, suspend the account, or remove the app in the Admin console.
// Until it's connected, the calendar keeps using the server's robot address (the old way).
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { GoogleAuth } from 'google-auth-library'
import { randomBytes } from 'node:crypto'
import { db, requireRole, CALLABLE } from './auth.js'
import { authUrl, grantedOf, isClientId, redirectUriFor, safeOrigin, secretEnd, SCOPES } from './googleLink.js'

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
const project = () => process.env.GCLOUD_PROJECT ?? 'proptracker-9732e'
const redirectUri = () => redirectUriFor(project(), isEmulator())
const clientDoc = () => db.doc('private_google/client')
const linkDoc = () => db.doc('private_google/link')
const STATE_MINUTES = 15

interface Client { clientId: string; clientSecret: string }
interface Link { email: string; refreshToken: string; scope: string; connectedAt: string; connectedBy: string; broken?: string; fake?: boolean }

const serverAuth = new GoogleAuth({ scopes: [SCOPES.calendar] })

// ─── Tokens ─────────────────────────────────────────────────────────────────

let cached: { token: string; until: number; refresh: string } | null = null

async function loadLink(): Promise<Link | null> {
  const d = (await linkDoc().get()).data() as Link | undefined
  return d?.refreshToken ? d : null
}

async function accountToken(link: Link): Promise<string> {
  if (cached && cached.refresh === link.refreshToken && cached.until > Date.now() + 60_000) return cached.token
  const c = (await clientDoc().get()).data() as Client | undefined
  if (!c?.clientId || !c.clientSecret) throw new Error('The Google sign-in setup is missing (Admin → Google account).')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: link.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }),
  })
  const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!r.ok || !j.access_token) {
    // invalid_grant = the connection was removed (by IT, the account, a password change) or ran out → connect again.
    if (j.error === 'invalid_grant') await linkDoc().update({ broken: `Google ended the connection (${j.error_description ?? 'invalid_grant'}). Connect the account again.` }).catch(() => {})
    throw new Error(`Google refused the Prime Capitol account (${j.error ?? r.status}). Connect it again on Admin → Google account.`)
  }
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000, refresh: link.refreshToken }
  return j.access_token
}

// For the calendar: the connected company account if it allowed calendars, else the server's robot address (old way).
export async function calendarAccess(): Promise<{ token: string; account: string; via: 'account' | 'server' }> {
  const link = await loadLink()
  if (link && grantedOf(link.scope).calendar && !link.fake) return { token: await accountToken(link), account: link.email, via: 'account' }
  const token = (await (await serverAuth.getClient()).getAccessToken()).token ?? ''
  return { token, account: (await serverAuth.getCredentials()).client_email ?? '', via: 'server' }
}

// The address to share the calendar with (no token needed).
export async function calendarAccount(): Promise<{ account: string; via: 'account' | 'server' }> {
  const link = await loadLink()
  if (link && grantedOf(link.scope).calendar) return { account: link.email, via: 'account' }
  if (isEmulator()) return { account: 'test-calendar@example.iam.gserviceaccount.com', via: 'server' }
  return { account: (await serverAuth.getCredentials()).client_email ?? '', via: 'server' }
}

// For email: only the connected account (with "send email" allowed). null = not connected.
export async function gmailAccess(): Promise<{ token: string; account: string; fake: boolean } | null> {
  const link = await loadLink()
  if (!link || !grantedOf(link.scope).gmail) return null
  if (link.fake) return { token: '', account: link.email, fake: true }
  return { token: await accountToken(link), account: link.email, fake: false }
}

// ─── Owner screen ───────────────────────────────────────────────────────────

export const googleAccountStatus = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner'])
  const c = (await clientDoc().get()).data() as Client | undefined
  const link = (await linkDoc().get()).data() as Link | undefined
  const g = grantedOf(link?.scope)
  return {
    redirectUri: redirectUri(),
    clientId: c?.clientId ?? '',
    secret: secretEnd(c?.clientSecret ?? ''),
    connected: link?.refreshToken ? { email: link.email, calendar: g.calendar, gmail: g.gmail, connectedAt: link.connectedAt, connectedBy: link.connectedBy, broken: link.broken ?? '' } : null,
    server: (await calendarAccount()).via === 'server' ? (isEmulator() ? 'test-calendar@example.iam.gserviceaccount.com' : (await serverAuth.getCredentials()).client_email ?? '') : '',
  }
})

// Paste the sign-in setup from Google Cloud (Credentials → OAuth client). The secret is never sent back to a phone.
export const saveGoogleClient = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner'])
  const { clientId, clientSecret } = (req.data ?? {}) as { clientId?: unknown; clientSecret?: unknown }
  const id = typeof clientId === 'string' ? clientId.trim() : ''
  if (!isClientId(id)) throw new HttpsError('invalid-argument', 'That doesn\'t look like a client ID. It ends with .apps.googleusercontent.com.')
  const secret = typeof clientSecret === 'string' ? clientSecret.trim() : ''
  const old = (await clientDoc().get()).data() as Client | undefined
  if (!secret && !old?.clientSecret) throw new HttpsError('invalid-argument', 'Paste the client secret too.')
  if (secret && !/^[A-Za-z0-9_-]{10,100}$/.test(secret)) throw new HttpsError('invalid-argument', 'That doesn\'t look like a client secret.')
  await clientDoc().set({ clientId: id, clientSecret: secret || old!.clientSecret, savedAt: new Date().toISOString(), savedBy: caller.email })
  cached = null
  return { ok: true }
})

// Step 1 of connecting: a one-time link to Google's sign-in page. `origin` = which app address to come back to.
export const googleConnectStart = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner'])
  const { origin, loginHint } = (req.data ?? {}) as { origin?: unknown; loginHint?: unknown }
  const back = safeOrigin(origin)
  if (isEmulator()) {
    // No real Google here: pretend the test account connected with both permissions.
    await linkDoc().set({ email: 'bookings@example.com', refreshToken: 'fake', scope: `${SCOPES.calendar} ${SCOPES.gmail}`, connectedAt: new Date().toISOString(), connectedBy: caller.email, fake: true })
    return { url: `${back}/google?connected=1` }
  }
  const c = (await clientDoc().get()).data() as Client | undefined
  if (!c?.clientId || !c.clientSecret) throw new HttpsError('failed-precondition', 'Paste the sign-in setup (client ID + secret) first.')
  const state = randomBytes(24).toString('hex')
  await db.doc(`private_google_states/${state}`).set({ email: caller.email, origin: back, at: Date.now() })
  const hint = typeof loginHint === 'string' && /^[^\s@]+@[^\s@]+$/.test(loginHint) ? loginHint : undefined
  return { url: authUrl({ clientId: c.clientId, redirectUri: redirectUri(), state, loginHint: hint }) }
})

// Step 2: Google sends the browser back here with a one-time code; we swap it for the lasting connection.
export const googleConnectDone = onRequest({ invoker: 'public' }, async (req, res) => {
  const state = String(req.query.state ?? '')
  const ref = /^[0-9a-f]{48}$/.test(state) ? db.doc(`private_google_states/${state}`) : null
  const st = ref ? (await ref.get()).data() as { email: string; origin: string; at: number } | undefined : undefined
  if (ref && st) await ref.delete()   // single use
  const back = (q: string) => res.redirect(302, `${safeOrigin(st?.origin)}/google?${q}`)
  if (!st || Date.now() - st.at > STATE_MINUTES * 60_000) return back('error=expired')
  if (req.query.error) return back(`error=${encodeURIComponent(String(req.query.error).slice(0, 40))}`)
  const code = String(req.query.code ?? '')
  const c = (await clientDoc().get()).data() as Client | undefined
  if (!code || !c) return back('error=missing')
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri() }),
    })
    const j = await r.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string }
    if (!r.ok || !j.access_token) return back(`error=${encodeURIComponent(j.error ?? 'token')}`)
    if (!j.refresh_token) return back('error=no_refresh')
    const who = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${j.access_token}` } })).json() as { email?: string; email_verified?: boolean }
    if (!who.email) return back('error=no_email')
    const old = await loadLink()
    await linkDoc().set({ email: who.email.toLowerCase(), refreshToken: j.refresh_token, scope: j.scope ?? '', connectedAt: new Date().toISOString(), connectedBy: st.email })
    cached = null
    if (old && old.refreshToken !== j.refresh_token && !old.fake) await revoke(old.refreshToken)
    logger.info('Google account connected', { email: who.email, by: st.email, scope: j.scope })
    return back('connected=1')
  } catch (e) {
    logger.warn('Google connect failed', { error: String(e) })
    return back('error=failed')
  }
})

async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

// Disconnect: tells Google to end the connection and forgets it. The calendar falls back to the server's robot address.
export const googleDisconnect = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner'])
  const link = await loadLink()
  if (link && !link.fake && !isEmulator()) await revoke(link.refreshToken)
  await linkDoc().delete()
  cached = null
  return { ok: true }
})
