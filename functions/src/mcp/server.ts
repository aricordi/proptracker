// The Prime Capitol connector server (MCP over HTTP + OAuth sign-in) for ChatGPT and Claude (owner, Nov 24).
// Reached through the website's own address (firebase.json rewrites /mcp, /oauth/**, /.well-known/oauth-* to this function),
// so the sign-in discovery lives at the root of https://proptracker.arbcreative.co as the assistants require.
// Stateless: every POST /mcp is one JSON-RPC message answered with JSON (Streamable HTTP without sessions).
// Collections (no security rules = server only): mcp_clients, mcp_auth_requests, mcp_codes, mcp_tokens, mcp_rate.
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import type { Request } from 'express'
import { db, CALLABLE, requireRole, getCaller, requestMemo } from '../auth.js'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'
import { REVIEWER_EMAIL, loadCloset } from './common.js'
import { studioBasicsText } from '../studioBasics.js'
import { resetSandbox, resetPractice, practiceKey } from './reviewer.js'
import { GEMINI_API_KEY } from '../gemini.js'
import {
  redirectAllowed, assistantName, randomToken, hashToken, pkceOk, metadata, resourceMetadata,
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, CODE_TTL_SECONDS, REQUEST_TTL_SECONDS,
} from './oauth.js'
import { toolsFor, runTool, type McpUser } from './tools.js'
import { WIDGET_URI, WIDGET_URI_SKYBRIDGE, WIDGET_MIME, WIDGET_MIME_SKYBRIDGE, WIDGET_HTML, WIDGET_TOOLS } from './widget.js'

const CANONICAL = 'https://proptracker.arbcreative.co'
const OUR_HOSTS = ['proptracker.arbcreative.co', 'proptracker-9732e.web.app', 'proptracker-9732e.firebaseapp.com']
const emulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
const RATE_PER_HOUR = 400
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

function baseOf(req: Request) {
  if (emulator()) return `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/northamerica-northeast1/mcp`
  const host = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  return OUR_HOSTS.includes(host) ? `https://${host}` : CANONICAL
}
// The app page where people sign in and press Allow. Owner, Nov 24 (screen recording, iPhone ChatGPT app): Safari still had
// an OLD saved copy of the app (from October) on proptracker.arbcreative.co, which answered /connect with the old home page,
// and an old saved copy can't be fixed from our side. So the sign-in (authorize + Allow) happens on our Firebase address,
// proptracker-9732e.firebaseapp.com: same app, same database, but no browser has ever kept a copy there.
const CONNECT_BASE = 'https://proptracker-9732e.firebaseapp.com'
const connectBase = (base: string) => emulator() ? base : CONNECT_BASE
const appBase = (base: string) => emulator() ? 'http://localhost:5173' : CONNECT_BASE

function bodyOf(req: Request): Record<string, unknown> {
  const b = req.body
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b as Record<string, unknown>
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : ''
  try { return Object.fromEntries(new URLSearchParams(raw)) } catch { return {} }
}
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
// Firestore deletes these docs by itself once this moment passes (TTL policy on `ttl`, firestore.indexes.json).
const ttlIn = (seconds: number) => Timestamp.fromMillis(Date.now() + seconds * 1000)
// Sign-up and sign-in pages: a few per minute per address is plenty for a real person (stops anyone filling the database).
async function ipLimit(req: Request, kind: string, perMinute: number) {
  // The LAST addresses in X-Forwarded-For are added by Google's front end; the first ones can be made up by the caller
  // (review, Nov 24), so they're ignored. A cap across all addresses stops a flood that rotates through many.
  const hops = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',').map(x => x.trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45)).filter(Boolean)
  const ip = hops.slice(-2).join('_') || 'unknown'
  const minute = new Date().toISOString().slice(0, 16)
  const ref = db.doc(`mcp_rate/${kind}_${ip.replace(/[:.]/g, '-')}_${minute}`), all = db.doc(`mcp_rate/${kind}_all_${minute}`)
  return db.runTransaction(async tx => {
    const [mine, every] = await Promise.all([tx.get(ref), tx.get(all)])
    const n = Number(mine.get('n') ?? 0), total = Number(every.get('n') ?? 0)
    if (n >= perMinute || total >= perMinute * 15) return false
    tx.set(ref, { n: n + 1, ttl: ttlIn(600) }, { merge: true })
    tx.set(all, { n: total + 1, ttl: ttlIn(600) }, { merge: true })
    return true
  })
}
const expired = (at: unknown) => typeof at !== 'string' || at < new Date().toISOString()

// ─── HTTP entry point ───────────────────────────────────────────────────────────────────────────────────────────────
// What the assistant is told about Prime Capitol (owner, Nov 24: "be part of their writing and brainstorming").
const INSTRUCTIONS = [
  'Prime Capitol is a film studio for YouTube creators: two houses to film at (Cliff 1, Cliff 2), a company props closet (props, costumes, set dressing) and a schedule team that approves bookings. These tools act as the signed-in person, with exactly their permissions in the Prime Capitol app.',
  // Owner's practice test (Nov 24): "too verbose… too professional… walks me through the app instead of talking to me and doing it in the background".
  'HOW TO TALK (most important): you are the person\'s friendly production assistant, talking to a creator, often by VOICE. Sound like a chill friend texting back: casual, simple everyday words, contractions, a bit of warmth or humour. Keep it SHORT: one to three sentences, one question at a time. No lists, headings, tables or "here\'s an overview" readouts; never read out ids, field names or every detail. Only mention what they actually have or asked about: never say "you have no invites, swaps, waitlists…". Don\'t explain how the app works unless asked, don\'t troubleshoot out loud, and don\'t repeat rules they didn\'t ask about.',
  'DO IT FOR THEM: you handle things yourself with these tools, in the background. Don\'t send them to the app or give links when a tool can do it (booking, moving, cancelling, props requests, props pick-up and return all happen right here). Times: say two or three options in plain words ("Thursday 3 to 5 at Cliff 2, or Friday morning?") and ask which; once they pick, confirm in one short line and do it. Pictures only for props (the photo cards); everything else is just talk. After you send something, say it in plain words ("Sent! Maanik\'s team will approve it and you\'ll get a ping."). Prop photos come back as images: look at them yourself to check colour, style or condition before answering.',
  `HOW THE STUDIO WORKS (always apply):\n${studioBasicsText()}`,
  'SPEED: answers should feel instant, especially in voice. Call get_context ONCE at the start of a conversation and reuse it (don\'t call it again, or whoami/my_status, unless something changed); then go straight to the one tool that does the job. Never chain look-up calls you don\'t need.',
  'get_context returns the person\'s situation (today and the next 14 days with weekday names, their upcoming shoots, open requests, invites and swaps waiting, people they filmed with lately, short rules): use it to resolve which day, shoot or person they mean and pass exact values to the other tools. If a tool still gets plain words it tries to understand them; when they fit several things or nothing it returns needs_clarifying with the options instead of acting, so ask the person.',
  'get_rules has the full live rules; my_status summarises what the person has going on with suggestions; get_shoot gives one shoot in detail.',
  'Filming with other people: plan_shoot matches the names they used to people on the app, sets the length (2 hours each) and finds BACK-TO-BACK times free for everyone (that is what most people want). "A slot for me, Ariel and Pedro" = 6 hours back to back. Before booking, confirm any name it lists under questions; it never guesses a person and books nothing itself. Be a problem solver: if the day they want has no full block, offer what plan_shoot found that day (a shorter house block plus offsite for the rest, booked as two book_shoot calls; or separate times if they don\'t mind not being back to back, mentioning that option), and the soonest day with the full block. People\'s needs are flexible; work with them.',
  'Booking: one shoot at a time is normal (most people book a few days out). If they want several at once (e.g. a few days next week), that is fine as an option: confirm once, then book each with its own book_shoot call; each is a separate request the schedule team approves one by one. Creators can book up to about 2 weeks ahead. A repeating ask like "every Tuesday at 3" can be sent, but mention kindly that the same time every week may not be approved and mixing it up helps everyone get good times.',
  'When a time is taken, book_shoot returns options instead of a dead end: the closest free time, the other house, the waitlist (with a reminder to turn on notifications in the app), Offer the closest time, the other house and the waitlist; do NOT suggest swapping (it feels pushy, and people book back to back with friends): use request_swap only when they say they already agreed with the other creator. Act on their yes. When get_context/my_status lists did_not_go_through, tell them why (the schedule team\'s reason) and offer new times right away. friends_filming_soon = people they usually film with who have a shoot soon, with free time right before/after: you may suggest filming next to them (only a suggestion).',
  'Prop smarts: closet_list gives you the whole closet in compact form; read it yourself to find substitutes and creative stand-ins the keyword search misses, then show_props for photos. For a script or guideline they paste, break it down scene by scene, match each prop against the closet for their shoot day, and offer custom props for what is missing. For a picture they share ("make it look like this"), describe what you see and find the closest props; if nothing is close, offer a custom prop request with their picture (reference_image), or make a picture with them to send. When a prop is taken that day, the tools return free alternatives: offer them. Problem reports can carry a photo of the damage (ask for one).',
  'After a shoot: the studio has no check-in, so whether people filmed matters to the team. When they mention a shoot happened or didn\'t ("we wrapped", "Ariel bailed"), record it with shoot_done; when my_status lists shoots_to_confirm, ask how it went in passing.',
  'my_status gives suggestions for what is worth doing next (things due back, answers people are waiting for, props not yet requested before the deadline). how_to answers how-do-I questions from the app\'s own guide, with a link.',
  'Times: find_free_times returns bookable options for this person; get_schedule is the raw schedule. Bookings take any quarter-hour start and end, up to 2 hours per person; longer bookings list everyone filming in book_shoot `with`. Times after midnight are written 24:xx/25:xx. Cliff 1 on priority days needs a filming guideline PDF, which can only be attached in the app. A taken time can be waited for with join_waitlist.',
  'Props: search_props, browse_props and show_props find closet props (with photos); props_for_idea checks the closet against the props a video idea needs; prop_calendar shows which days a prop is free. request_props adds props to one of the person\'s shoots; change_props_request and cancel_props_request work while a request is still "requested". Closet props close about 48 hours before the shoot (get_shoot has the exact time). Custom props (things to make or find) need 4+ days\' notice and have no guaranteed date: if the person wants, help them describe it and, where the assistant can make images, create a reference picture with them and send it with the request (reference_image). Never give or suggest a date for a custom prop; the arts department contacts the person separately (e.g. on Slack) about details and timing.',
  'Gear: cameras, lights and sound aren\'t handled here yet: they\'re taken from the gear room on the shoot day. Props pick-up and return happen here: at pick-up, read them the list and ask if it\'s all there, then pick_up_props. At drop-off, ask them to snap ONE photo of everything and send it in the chat (in voice mode they can tap the camera or switch to typing for that one step), ask if anything broke, then return_props. Follow up on props: my_status and get_context say what is ready and what is due back; offer the next step (never act without a yes). There is no check-in on the shoot day.',
  'Before any change (book, move, cancel, swap, props, invites, waitlist), summarise it and get the person\'s confirmation. A creator\'s booking is a request until the schedule team approves it: only say "booked" when the tool result says "Booked". When a tool refuses, pass on its reason.',
  'When the person wants something Prime Capitol doesn\'t offer, say so plainly; you may offer to pass it on as an anonymous suggestion (note_feature_request) and call it only if they agree.',
  'Props, times, people and rules come only from these tools. Other people\'s email addresses, internal notes and costs are not available.',
].join(' ')

// Faster server (owner, Nov 24: "taking so long… even in voice mode"; picked the faster machine, not an always-awake one, "with
// budget constraints"): 2 vCPU + 2 GiB makes each step 2-3x quicker and wake-ups shorter. Billed only while answering.
// BUDGET LIMITS: at most 3 copies at once (caps the worst-case spend), each answering up to 40 requests together; no copy is
// kept awake (minInstances 0 = $0 while idle). Per-person 400 requests/hour, the $50/month AI cap and the $30 Google Cloud
// bill limit (killSwitch.ts) still apply on top.
export const mcp = onRequest({ secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: '2GiB', cpu: 2, concurrency: 40, minInstances: 0, maxInstances: 3, cors: true, invoker: 'public' }, async (req, res) => {
  const base = baseOf(req)
  const path = req.path.replace(/^\/mcp(?=\/(oauth|\.well-known|mcp)\b)/, '') || '/'   // emulator URLs keep the function name in front
  res.set('Cache-Control', 'no-store')
  res.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
  try {
    if (path.startsWith('/.well-known/oauth-protected-resource')) { res.json(resourceMetadata(base)); return }
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) { res.json(metadata(base, connectBase(base))); return }
    if (path.startsWith('/.well-known/openai-apps-challenge')) {
      // OpenAI's domain check when submitting the app: the owner saves the token they're given (admin task openaiChallenge).
      const t = String((await db.doc('mcp_settings/openai').get()).get('challenge') ?? '')
      if (!t) { res.status(404).send('not set'); return }
      res.type('text/plain').send(t); return
    }
    if (path === '/oauth/register' && req.method === 'POST') { await register(req, res); return }
    if (path === '/oauth/authorize' && req.method === 'GET') { await authorize(req, res, base); return }
    if (path === '/oauth/token' && req.method === 'POST') { await token(req, res); return }
    if (path === '/oauth/revoke' && req.method === 'POST') { await revoke(req, res); return }
    if (path === '/mcp' || path === '/') {
      if (req.method === 'GET') { res.status(405).set('Allow', 'POST').send('Use POST'); return }
      if (req.method === 'DELETE') { res.status(204).end(); return }
      if (req.method === 'POST') { await requestMemo.run(new Map(), () => rpc(req, res, base)); return }
    }
    res.status(404).json({ error: 'not_found' })
  } catch (e) {
    logger.error('mcp request failed', path, String(e))
    if (!res.headersSent) res.status(500).json({ error: 'server_error' })
  }
})

// ─── OAuth ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function register(req: Request, res: import('express').Response) {
  const b = bodyOf(req)
  if (!(await ipLimit(req, 'reg', 20))) { res.status(429).json({ error: 'slow_down' }); return }
  const uris = (Array.isArray(b.redirect_uris) ? b.redirect_uris : []) as unknown[]
  if (!uris.length || uris.length > 5 || !uris.every(u => redirectAllowed(u, emulator()))) {
    res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Only ChatGPT and Claude can connect to Prime Capitol.' }); return
  }
  const clientId = `pc_${randomToken(16)}`
  const name = String(b.client_name ?? '').slice(0, 80)
  // Registrations that never finish a sign-in are deleted after 30 days (the TTL is removed once one connects).
  await db.doc(`mcp_clients/${clientId}`).set({ redirectUris: uris, name, createdAt: new Date().toISOString(), ttl: ttlIn(30 * 86400) })
  res.status(201).json({ client_id: clientId, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) })
}

async function authorize(req: Request, res: import('express').Response, base: string) {
  const q = req.query as Record<string, string>
  if (!(await ipLimit(req, 'auth', 30))) { res.status(429).send('Too many sign-in attempts. Wait a minute and try again.'); return }
  const client = /^pc_[\w-]{10,40}$/.test(String(q.client_id ?? '')) ? (await db.doc(`mcp_clients/${q.client_id}`).get()).data() : undefined
  const redirect = q.redirect_uri
  if (!client || !redirectAllowed(redirect, emulator()) || !(client.redirectUris as string[]).includes(redirect)) {
    res.status(400).send('This sign-in link is not valid. Start again from ChatGPT or Claude.'); return
  }
  const back = (params: Record<string, string>) => { const u = new URL(redirect); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v)); return u.toString() }
  if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) {
    res.redirect(back({ error: 'invalid_request', error_description: 'PKCE (S256) is required', ...(q.state ? { state: q.state } : {}) })); return
  }
  const id = randomToken(18)
  await db.doc(`mcp_auth_requests/${id}`).set({ clientId: q.client_id, redirect, state: q.state ?? '', challenge: q.code_challenge,
    assistant: assistantName(redirect, client.name), expiresAt: later(REQUEST_TTL_SECONDS), ttl: ttlIn(REQUEST_TTL_SECONDS + 3600), createdAt: new Date().toISOString() })
  res.redirect(`${appBase(base)}/connect?req=${id}`)
}

// Called by the /connect page after the person signs in with Google and presses Allow.
export const approveConnector = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'admin', 'arts', 'equipment', 'creator'], { demoOk: true })
  const id = String(req.data?.req ?? '')
  const ref = db.doc(`mcp_auth_requests/${/^[\w-]{10,40}$/.test(id) ? id : 'x'}`)
  const r = (await ref.get()).data()
  if (!r || expired(r.expiresAt)) throw new HttpsError('not-found', 'This sign-in link ran out. Start again from ChatGPT or Claude.')
  if (req.data?.deny === true) {
    await ref.delete()
    const u = new URL(r.redirect); u.searchParams.set('error', 'access_denied'); if (r.state) u.searchParams.set('state', r.state)
    return { redirect: u.toString() }
  }
  const code = randomToken(32)
  await db.doc(`mcp_codes/${hashToken(code)}`).set({ clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, email: caller.email,
    name: caller.name, assistant: r.assistant, expiresAt: later(CODE_TTL_SECONDS), ttl: ttlIn(CODE_TTL_SECONDS + 3600) })
  await ref.delete()
  const u = new URL(r.redirect); u.searchParams.set('code', code); if (r.state) u.searchParams.set('state', r.state)
  return { redirect: u.toString(), assistant: r.assistant }
})
// ─── The reviewers' demo account (owner, Nov 24: OpenAI needs a login and password to review the app) ────────────────
// One account, made by the owner (More → ChatGPT & Claude → Demo account), stored as a salted scrypt hash in
// mcp_settings/reviewer (server only). It signs in on the /connect page without Google and only ever sees the practice copy
// of the studio (reviewer.ts): real props, made-up people and bookings. Nothing it does reaches the team or the calendars.
const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 32).toString('hex')
async function reviewerEnabled() { return (await db.doc('mcp_settings/reviewer').get()).get('enabled') === true }
export const reviewerAccount = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner'])
  const ref = db.doc('mcp_settings/reviewer')
  const action = String(req.data?.action ?? 'status')
  if (action === 'create') {
    const password = randomToken(9).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 12) + '-' + randomBytes(2).toString('hex')
    const salt = randomBytes(16).toString('hex')
    await ref.set({ email: REVIEWER_EMAIL, salt, hash: hashPassword(password, salt), enabled: true, createdAt: new Date().toISOString(), createdBy: caller.email, failures: 0 })
    // A new password signs out everyone using the old one.
    const old = await db.collection('mcp_tokens').where('email', '==', REVIEWER_EMAIL).get()
    await Promise.all(old.docs.map(d => d.ref.delete()))
    return { enabled: true, email: REVIEWER_EMAIL, password }
  }
  if (action === 'disable') {
    await ref.set({ enabled: false, disabledAt: new Date().toISOString() }, { merge: true })
    const toks = await db.collection('mcp_tokens').where('email', '==', REVIEWER_EMAIL).get()
    await Promise.all(toks.docs.map(d => d.ref.delete()))
    return { enabled: false }
  }
  const d = (await ref.get()).data()
  return { enabled: d?.enabled === true, email: d?.enabled ? REVIEWER_EMAIL : undefined, createdAt: d?.createdAt }
})
export const approveConnectorReviewer = onCall(CALLABLE, async req => {
  const id = String(req.data?.req ?? '')
  const ref = db.doc(`mcp_auth_requests/${/^[\w-]{10,40}$/.test(id) ? id : 'x'}`)
  const r = (await ref.get()).data()
  if (!r || expired(r.expiresAt)) throw new HttpsError('not-found', 'This sign-in link ran out. Start again from ChatGPT or Claude.')
  // A few tries per sign-in link, then it closes (no guessing the password).
  const allowed = await db.runTransaction(async tx => {   // counted in a transaction, so parallel tries can't go past 5
    const cur = (await tx.get(ref)).data()
    const tries = Number(cur?.reviewerTries ?? 0)
    if (!cur || tries >= 5) { if (cur) tx.delete(ref); return false }
    tx.update(ref, { reviewerTries: tries + 1 })
    return true
  })
  if (!allowed) throw new HttpsError('resource-exhausted', 'Too many tries. Start again from ChatGPT or Claude.')
  const acc = (await db.doc('mcp_settings/reviewer').get()).data()
  const email = String(req.data?.email ?? '').trim().toLowerCase(), password = String(req.data?.password ?? '').slice(0, 200)
  const good = !!acc?.enabled && email === acc.email && password.length > 0 &&
    timingSafeEqual(Buffer.from(hashPassword(password, String(acc.salt)), 'hex'), Buffer.from(String(acc.hash), 'hex'))
  if (!good) throw new HttpsError('permission-denied', 'That email and password don\'t match the demo account.')
  const code = randomToken(32)
  await db.doc(`mcp_codes/${hashToken(code)}`).set({ clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, email: REVIEWER_EMAIL,
    name: 'App Reviewer', assistant: r.assistant, reviewer: true, expiresAt: later(CODE_TTL_SECONDS), ttl: ttlIn(CODE_TTL_SECONDS + 3600) })
  await ref.delete()
  const u = new URL(r.redirect); u.searchParams.set('code', code); if (r.state) u.searchParams.set('state', r.state)
  return { redirect: u.toString() }
})

// What the /connect page shows before Allow.
export const connectorRequestInfo = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'admin', 'arts', 'equipment', 'creator'], { demoOk: true })
  const id = String(req.data?.req ?? '')
  const r = /^[\w-]{10,40}$/.test(id) ? (await db.doc(`mcp_auth_requests/${id}`).get()).data() : undefined
  if (!r || expired(r.expiresAt)) return { ok: false }
  return { ok: true, assistant: r.assistant }
})

async function issueTokens(email: string, name: string, clientId: string, assistant: string, reviewer = false, sandbox = '') {
  const access = randomToken(32), refresh = randomToken(32)
  const now = new Date().toISOString()
  const batch = db.batch()
  const extra = reviewer ? { reviewer: true, sandbox: sandbox || clientId } : {}
  batch.set(db.doc(`mcp_tokens/${hashToken(access)}`), { kind: 'access', email, name, clientId, assistant, ...extra, expiresAt: later(ACCESS_TTL_SECONDS), ttl: ttlIn(ACCESS_TTL_SECONDS + 3600), createdAt: now })
  batch.set(db.doc(`mcp_tokens/${hashToken(refresh)}`), { kind: 'refresh', email, name, clientId, assistant, ...extra, expiresAt: later(REFRESH_TTL_DAYS * 86400), ttl: ttlIn(REFRESH_TTL_DAYS * 86400 + 3600), createdAt: now })
  batch.set(db.doc(`mcp_connections/${email}__${clientId}`), { email, clientId, assistant, lastUsed: now, connectedAt: now }, { merge: true })
  await batch.commit()
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: 'primecapitol' }
}

async function token(req: Request, res: import('express').Response) {
  const b = bodyOf(req)
  const bad = (error: string, d = '') => res.status(400).json({ error, ...(d ? { error_description: d } : {}) })
  if (b.grant_type === 'authorization_code') {
    const ref = db.doc(`mcp_codes/${hashToken(String(b.code ?? ''))}`)
    const c = await db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists) tx.delete(ref); return s.data() })   // one use only
    if (!c || expired(c.expiresAt) || c.clientId !== b.client_id || b.redirect_uri !== c.redirect) { bad('invalid_grant'); return }
    if (!pkceOk(b.code_verifier, c.challenge)) { bad('invalid_grant', 'PKCE check failed'); return }
    await db.doc(`mcp_clients/${c.clientId}`).update({ ttl: FieldValue.delete(), connectedAt: new Date().toISOString() }).catch(() => 0)
    // Each reviewer SIGN-IN gets its own fresh practice copy (two reviewers on the same ChatGPT app don't share or wipe one).
    const sandbox = c.reviewer ? `r_${randomToken(12)}` : ''
    if (sandbox) await resetSandbox(sandbox)
    res.json(await issueTokens(c.email, c.name, c.clientId, c.assistant, c.reviewer === true, sandbox)); return
  }
  if (b.grant_type === 'refresh_token') {
    const ref = db.doc(`mcp_tokens/${hashToken(String(b.refresh_token ?? ''))}`)
    const t = await db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists) tx.delete(ref); return s.data() })   // rotated
    if (!t || t.kind !== 'refresh' || expired(t.expiresAt) || (b.client_id && b.client_id !== t.clientId)) { bad('invalid_grant'); return }
    if (!(t.reviewer ? await reviewerEnabled() : await stillAllowed(t.email))) { bad('invalid_grant', 'Prime Capitol access was turned off'); return }
    res.json(await issueTokens(t.email, t.name, t.clientId, t.assistant, t.reviewer === true, String(t.sandbox ?? ''))); return
  }
  bad('unsupported_grant_type')
}

async function revoke(req: Request, res: import('express').Response) {
  const t = String(bodyOf(req).token ?? '')
  if (t) await db.doc(`mcp_tokens/${hashToken(t)}`).delete().catch(() => 0)
  res.status(200).json({})
}

// Still an active person in the app (turned-off people lose the connector straight away).
async function stillAllowed(email: string) {
  const req = { data: {}, auth: { uid: 'mcp', token: { email, email_verified: true } }, rawRequest: {}, acceptsStreaming: false }
  return !!(await getCaller(req as never))
}

// ─── MCP (JSON-RPC) ─────────────────────────────────────────────────────────────────────────────────────────────────
async function rpc(req: Request, res: import('express').Response, base: string) {
  const auth = String(req.headers.authorization ?? '')
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  // Warm the closet while the token is checked (speed: a cold server otherwise reads 1,200+ props after the checks).
  if (tok) void loadCloset().catch(() => undefined)
  const t = tok ? (await db.doc(`mcp_tokens/${hashToken(tok)}`).get()).data() : undefined
  // The access check and the hourly limit run together (they used to run one after the other on every message).
  const isCall = (bodyOf(req) as { method?: string })?.method === 'tools/call'
  const [allowed, limitOk] = t && t.kind === 'access' && !expired(t.expiresAt)
    ? await Promise.all([t.reviewer ? reviewerEnabled() : stillAllowed(t.email), isCall ? underLimit(t.email) : Promise.resolve(true)])
    : [false, true]
  if (!t || !allowed) {
    res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`).json({ error: 'invalid_token' }); return
  }
  // Practice mode (owner, Nov 24): the person's own connection, with their changes kept in a private practice copy.
  const practice = !t.reviewer && (await db.doc(`mcp_practice/${t.email}`).get()).get('practice') === true
  const user: McpUser = { email: t.email, name: t.name, assistant: t.assistant,
    ...(t.reviewer ? { reviewer: true, sandboxKey: String(t.sandbox ?? t.clientId) } : practice ? { practice: true, sandboxKey: practiceKey(t.email) } : {}) }
  const raw = req.body
  if (raw === undefined || raw === null || raw === '' || (typeof raw === 'object' && !Array.isArray(raw) && !Buffer.isBuffer(raw) && !Object.keys(raw).length)) { res.status(400).json(rpcError(null, -32700, 'Parse error')); return }
  const msg = bodyOf(req) as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> }
  if (Array.isArray(msg)) { res.status(400).json(rpcError(null, -32600, 'Batches are not supported')); return }
  const id = msg.id ?? null
  // A reply from the client to something we asked (we never ask, but it's valid JSON-RPC): acknowledged, nothing to do.
  if (msg.jsonrpc === '2.0' && msg.method === undefined && msg.id !== undefined && ('result' in msg || 'error' in msg)) { res.status(202).end(); return }
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') { res.status(400).json(rpcError(msg.id ?? null, -32600, 'Invalid request')); return }
  if (msg.id === undefined) { res.status(202).end(); return }   // a notification (e.g. notifications/initialized)
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      res.json(ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'prime-capitol', title: 'Prime Capitol', version: '1.2.0', websiteUrl: CANONICAL,
          icons: [{ src: `${CANONICAL}/icons/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }, { src: `${CANONICAL}/icons/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }, { src: `${CANONICAL}/favicon.png`, mimeType: 'image/png', sizes: ['192x192'] }] },
        instructions: INSTRUCTIONS,
      })); return
    }
    case 'ping': res.json(ok(id, {})); return
    case 'tools/list': {
      const c = user.reviewer ? null : await getCaller({ data: {}, auth: { uid: 'mcp', token: { email: user.email, email_verified: true } }, rawRequest: {}, acceptsStreaming: false } as never)
      // Only what this person can actually use: Props-only creators and the team (arts, equipment, admins) get the look tools.
      const lookOnly = !user.reviewer && (!!c?.demo || !(c?.role === 'creator' || c?.role === 'owner'))
      res.json(ok(id, { tools: toolsFor(lookOnly).map(tl => describeTool(tl)) })); return
    }
    case 'resources/list':
      res.json(ok(id, { resources: [
        { uri: WIDGET_URI, name: 'prime-capitol-cards', title: 'Prime Capitol cards', mimeType: WIDGET_MIME },
        { uri: WIDGET_URI_SKYBRIDGE, name: 'prime-capitol-cards-chatgpt', title: 'Prime Capitol cards (ChatGPT)', mimeType: WIDGET_MIME_SKYBRIDGE },
      ] })); return
    case 'resources/templates/list': res.json(ok(id, { resourceTemplates: [] })); return
    case 'prompts/list': res.json(ok(id, { prompts: [] })); return
    case 'resources/read': {
      const uri = String(msg.params?.uri ?? '')
      if (uri !== WIDGET_URI && uri !== WIDGET_URI_SKYBRIDGE) { res.json(rpcError(id, -32002, 'Resource not found')); return }
      res.json(ok(id, { contents: [{ uri, mimeType: uri === WIDGET_URI ? WIDGET_MIME : WIDGET_MIME_SKYBRIDGE, text: WIDGET_HTML, _meta: WIDGET_RESOURCE_META }] })); return
    }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      if (!limitOk) { res.json(ok(id, toolError('Too many requests this hour. Try again a bit later.'))); return }
      try {
        const r = await runTool(name, args, user)
        const content: unknown[] = [{ type: 'text', text: r.text }]
        // Claude shows images inside the chat; ChatGPT shows the picture cards (widget) and gets a few small photos too, so it can
        // actually look at them (owner, Nov 24: "it can't confirm the colour from the photo, which is dumb").
        if (r.images?.length) content.push(...await imageBlocks(r.images.slice(0, user.assistant === 'ChatGPT' ? 3 : 6)))
        db.doc(`mcp_connections/${user.email}__${t.clientId}`).set({ lastUsed: new Date().toISOString() }, { merge: true }).catch(() => 0)
        res.json(ok(id, { content, ...(r.structured ? { structuredContent: r.structured } : {}), isError: false }))
      } catch (e) {
        const err = e as HttpsError
        const text = err instanceof HttpsError ? err.message : 'Something went wrong. Try again.'
        if (!(err instanceof HttpsError)) logger.error('mcp tool failed', name, String(e))
        res.json(ok(id, toolError(text)))
      }
      return
    }
  }
  res.json(rpcError(id, -32601, `Unknown method ${msg.method}`))
}
// Every tool says plainly what it does (annotations), that it needs the person signed in, and, for the visual ones, which
// card template to draw (both the MCP Apps standard key and ChatGPT's older keys, so it works everywhere).
const RESOURCE_DOMAINS = ['https://firebasestorage.googleapis.com']
const WIDGET_RESOURCE_META = {
  ui: { csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains: [] }, prefersBorder: false, domain: 'https://proptracker.arbcreative.co' },
  'openai/widgetCSP': { connect_domains: [], resource_domains: RESOURCE_DOMAINS },
  'openai/widgetDomain': 'https://proptracker.arbcreative.co',
  'openai/widgetDescription': 'Prime Capitol cards: prop photos with availability, free filming times, and shoot details. Buttons only send a message in the chat (the assistant still confirms before anything is booked).',
  'openai/widgetPrefersBorder': false,
}
const FILE_PARAMS: Record<string, string[]> = { request_props: ['reference_image'], change_props_request: ['reference_image'], return_props: ['photo'], take_gear: ['photo'], return_gear: ['photo'], report_problem: ['photo'] }
function describeTool(tl: { name: string; annotations: Record<string, boolean> } & Record<string, unknown>) {
  const w = WIDGET_TOOLS[tl.name]
  return { ...tl,
    securitySchemes: [{ type: 'oauth2', scopes: ['primecapitol'] }],
    _meta: {
      securitySchemes: [{ type: 'oauth2', scopes: ['primecapitol'] }],
      // ChatGPT passes these inputs as files it already has (e.g. a picture it just made), instead of text.
      ...(FILE_PARAMS[tl.name] ? { 'openai/fileParams': FILE_PARAMS[tl.name] } : {}),
      ...(w ? { ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI_SKYBRIDGE, 'openai/toolInvocation/invoking': w.invoking, 'openai/toolInvocation/invoked': w.invoked, 'openai/widgetAccessible': false } : {}),
    } }
}
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

async function underLimit(email: string) {
  const ref = db.doc(`mcp_rate/${email}_${new Date().toISOString().slice(0, 13)}`)
  return db.runTransaction(async tx => {
    const n = Number((await tx.get(ref)).get('n') ?? 0)
    if (n >= RATE_PER_HOUR) return false
    tx.set(ref, { n: n + 1, email, ttl: ttlIn(7200) }, { merge: true })
    return true
  })
}

// Photos as image blocks (only our own Storage links; small thumbnails).
async function imageBlocks(images: { url: string; caption: string }[]) {
  const out: unknown[] = []
  await Promise.all(images.map(async (im, i) => {
    if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(im.url)) return
    try {
      const r = await fetch(im.url, { signal: AbortSignal.timeout(4000) })
      const type = r.headers.get('content-type') ?? ''
      if (!r.ok || !type.startsWith('image/')) return
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 400_000) return
      out[i] = { type: 'image', data: buf.toString('base64'), mimeType: type.split(';')[0] }
    } catch { /* skip that photo */ }
  }))
  return out.filter(Boolean)
}

// ─── The person's connections (Me → ChatGPT & Claude) ───────────────────────────────────────────────────────────────
export const myConnectors = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'admin', 'arts', 'equipment', 'creator'], { demoOk: true })
  const snap = await db.collection('mcp_connections').where('email', '==', caller.email).get()
  return { connections: snap.docs.map(d => ({ id: d.id, assistant: d.get('assistant'), connectedAt: d.get('connectedAt'), lastUsed: d.get('lastUsed') })) }
})
/** Practice mode for your own ChatGPT/Claude connection (owner, Nov 24): {on} turns it on/off; turning it on (or {reset})
 *  starts the practice copy from your real upcoming shoots and props requests. Nothing real is ever changed by practice. */
export const connectorPractice = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])
  const ref = db.doc(`mcp_practice/${caller.email}`)
  const d = req.data ?? {}
  let copied: { shoots: number; requests: number } | undefined
  if (typeof d.on === 'boolean') {
    await ref.set({ practice: d.on, practiceAt: new Date().toISOString() }, { merge: true })
    if (d.on) copied = await resetPractice(caller.email)
  } else if (d.reset === true) copied = await resetPractice(caller.email)
  const on = (await ref.get()).get('practice') === true
  const sb = on ? (await db.doc(`mcp_sandbox/${practiceKey(caller.email)}`).get()).data() : undefined
  return { on, copied, practice: sb ? { shoots: ((sb.shoots ?? []) as unknown[]).length, requests: ((sb.requests ?? []) as unknown[]).length, resetAt: sb.resetAt ?? null } : null }
})
export const disconnectConnector = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'admin', 'arts', 'equipment', 'creator'], { demoOk: true })
  const id = String(req.data?.id ?? '')
  const conn = (await db.doc(`mcp_connections/${id.replace(/\//g, '')}`).get()).data()
  if (!conn || conn.email !== caller.email) throw new HttpsError('not-found', 'Not found')
  const toks = await db.collection('mcp_tokens').where('email', '==', caller.email).where('clientId', '==', conn.clientId).get()
  const batch = db.batch()
  toks.docs.forEach(d => batch.delete(d.ref))
  batch.delete(db.doc(`mcp_connections/${id}`))
  await batch.commit()
  return { ok: true }
})
