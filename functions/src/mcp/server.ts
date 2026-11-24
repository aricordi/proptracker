// The Prime Capitol connector server (MCP over HTTP + OAuth sign-in) for ChatGPT and Claude (owner, Nov 24).
// Reached through the website's own address (firebase.json rewrites /mcp, /oauth/**, /.well-known/oauth-* to this function),
// so the sign-in discovery lives at the root of https://proptracker.arbcreative.co as the assistants require.
// Stateless: every POST /mcp is one JSON-RPC message answered with JSON (Streamable HTTP without sessions).
// Collections (no security rules = server only): mcp_clients, mcp_auth_requests, mcp_codes, mcp_tokens, mcp_rate.
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import type { Request } from 'express'
import { db, CALLABLE, requireRole, getCaller } from '../auth.js'
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'
import { REVIEWER_EMAIL } from './common.js'
import { resetSandbox } from './reviewer.js'
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
// The app page where people sign in and press Allow (same website).
const appBase = (base: string) => emulator() ? 'http://localhost:5173' : base

function bodyOf(req: Request): Record<string, unknown> {
  const b = req.body
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b as Record<string, unknown>
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : ''
  try { return Object.fromEntries(new URLSearchParams(raw)) } catch { return {} }
}
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
const expired = (at: unknown) => typeof at !== 'string' || at < new Date().toISOString()

// ─── HTTP entry point ───────────────────────────────────────────────────────────────────────────────────────────────
// What the assistant is told about Prime Capitol (owner, Nov 24: "be part of their writing and brainstorming").
const INSTRUCTIONS = [
  'Prime Capitol is a film studio for YouTube creators: two houses to film at (Cliff 1, Cliff 2), a company props closet (props, costumes, set dressing) and a schedule team that approves bookings. You act as the signed-in creator, with exactly their permissions. Be a warm, sharp production assistant: short answers, the person\'s own language.',
  'START: get_rules once per conversation (today\'s date in studio time, the live rules). For "what do I have going on?" use my_status; for one shoot use get_shoot.',
  'BRAINSTORMING: when the person is coming up with or writing a video idea, sketch or script, be a creative partner AND keep the closet in mind. As soon as scenes, characters or locations take shape, offer to check the closet (props_for_idea with concrete needs per scene) and show matches (show_props). Suggest how to use what exists; things the closet lacks can be custom props (4+ days notice, no guaranteed date). Do this naturally, without derailing their writing.',
  'TIMES: find_free_times returns ready-to-book options that already respect their locks and limits; get_schedule is the raw picture (who films when, free stretches). Bookings are free-form (any quarter hour, e.g. 13:15-15:15), up to 2 hours per person; longer needs the people filming with them on the SAME booking (book_shoot `with`). Use judgement: next to a collaborator\'s shoot, the time of day they like, other house or day if one is locked. A taken time can be waited for (join_waitlist).',
  'PROPS: request_props for a shoot (adds to a waiting request), change_props_request / cancel_props_request while still requested; prop_calendar shows which days a key prop is free. Closet props close about 48 hours before the shoot (get_shoot has the exact time).',
  'PHONE-ONLY STEPS: picking up and returning props or gear (photos) and taking gear on the shoot day happen in the app: give the app_link. There is no check-in on the shoot day.',
  'CHANGES: summarise and confirm with the person before any change (book, move, cancel, swap, props, invites). Creator bookings are requests the schedule team approves; never say a booking is confirmed unless the tool says "Booked". If a tool refuses, explain its reason simply and offer the next best option.',
  'Never invent props, times, people or rules: use the tools. Other people\'s emails, internal notes and costs are never available.',
].join(' ')

export const mcp = onRequest({ secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB', cors: true, invoker: 'public' }, async (req, res) => {
  const base = baseOf(req)
  const path = req.path.replace(/^\/mcp(?=\/(oauth|\.well-known|mcp)\b)/, '') || '/'   // emulator URLs keep the function name in front
  res.set('Cache-Control', 'no-store')
  try {
    if (path.startsWith('/.well-known/oauth-protected-resource')) { res.json(resourceMetadata(base)); return }
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) { res.json(metadata(base)); return }
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
      if (req.method === 'POST') { await rpc(req, res, base); return }
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
  const uris = (Array.isArray(b.redirect_uris) ? b.redirect_uris : []) as unknown[]
  if (!uris.length || !uris.every(u => redirectAllowed(u, emulator()))) {
    res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Only ChatGPT and Claude can connect to Prime Capitol.' }); return
  }
  const clientId = `pc_${randomToken(16)}`
  const name = String(b.client_name ?? '').slice(0, 80)
  await db.doc(`mcp_clients/${clientId}`).set({ redirectUris: uris, name, createdAt: new Date().toISOString() })
  res.status(201).json({ client_id: clientId, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) })
}

async function authorize(req: Request, res: import('express').Response, base: string) {
  const q = req.query as Record<string, string>
  const client = q.client_id ? (await db.doc(`mcp_clients/${q.client_id}`).get()).data() : undefined
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
    assistant: assistantName(redirect, client.name), expiresAt: later(REQUEST_TTL_SECONDS), createdAt: new Date().toISOString() })
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
    name: caller.name, assistant: r.assistant, expiresAt: later(CODE_TTL_SECONDS) })
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
    await resetSandbox()
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
  const tries = Number(r.reviewerTries ?? 0)
  if (tries >= 5) { await ref.delete(); throw new HttpsError('resource-exhausted', 'Too many tries. Start again from ChatGPT or Claude.') }
  await ref.update({ reviewerTries: tries + 1 })
  const acc = (await db.doc('mcp_settings/reviewer').get()).data()
  const email = String(req.data?.email ?? '').trim().toLowerCase(), password = String(req.data?.password ?? '').slice(0, 200)
  const good = !!acc?.enabled && email === acc.email && password.length > 0 &&
    timingSafeEqual(Buffer.from(hashPassword(password, String(acc.salt)), 'hex'), Buffer.from(String(acc.hash), 'hex'))
  if (!good) throw new HttpsError('permission-denied', 'That email and password don\'t match the demo account.')
  const code = randomToken(32)
  await db.doc(`mcp_codes/${hashToken(code)}`).set({ clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, email: REVIEWER_EMAIL,
    name: 'App Reviewer', assistant: r.assistant, reviewer: true, expiresAt: later(CODE_TTL_SECONDS) })
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

async function issueTokens(email: string, name: string, clientId: string, assistant: string, reviewer = false) {
  const access = randomToken(32), refresh = randomToken(32)
  const now = new Date().toISOString()
  const batch = db.batch()
  const extra = reviewer ? { reviewer: true } : {}
  batch.set(db.doc(`mcp_tokens/${hashToken(access)}`), { kind: 'access', email, name, clientId, assistant, ...extra, expiresAt: later(ACCESS_TTL_SECONDS), createdAt: now })
  batch.set(db.doc(`mcp_tokens/${hashToken(refresh)}`), { kind: 'refresh', email, name, clientId, assistant, ...extra, expiresAt: later(REFRESH_TTL_DAYS * 86400), createdAt: now })
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
    if (!c || expired(c.expiresAt) || c.clientId !== b.client_id || (b.redirect_uri && b.redirect_uri !== c.redirect)) { bad('invalid_grant'); return }
    if (!pkceOk(b.code_verifier, c.challenge)) { bad('invalid_grant', 'PKCE check failed'); return }
    if (c.reviewer) await resetSandbox()   // every new reviewer connection starts from the same practice data
    res.json(await issueTokens(c.email, c.name, c.clientId, c.assistant, c.reviewer === true)); return
  }
  if (b.grant_type === 'refresh_token') {
    const ref = db.doc(`mcp_tokens/${hashToken(String(b.refresh_token ?? ''))}`)
    const t = await db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists) tx.delete(ref); return s.data() })   // rotated
    if (!t || t.kind !== 'refresh' || expired(t.expiresAt) || (b.client_id && b.client_id !== t.clientId)) { bad('invalid_grant'); return }
    if (!(t.reviewer ? await reviewerEnabled() : await stillAllowed(t.email))) { bad('invalid_grant', 'Prime Capitol access was turned off'); return }
    res.json(await issueTokens(t.email, t.name, t.clientId, t.assistant, t.reviewer === true)); return
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
  const t = tok ? (await db.doc(`mcp_tokens/${hashToken(tok)}`).get()).data() : undefined
  if (!t || t.kind !== 'access' || expired(t.expiresAt) || !(t.reviewer ? await reviewerEnabled() : await stillAllowed(t.email))) {
    res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`).json({ error: 'invalid_token' }); return
  }
  const user: McpUser = { email: t.email, name: t.name, assistant: t.assistant, ...(t.reviewer ? { reviewer: true } : {}) }
  const msg = bodyOf(req) as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> }
  if (Array.isArray(msg)) { res.status(400).json(rpcError(null, -32600, 'Batches are not supported')); return }
  const id = msg.id ?? null
  if (msg.id === undefined) { res.status(202).end(); return }   // a notification (e.g. notifications/initialized)
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      res.json(ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'prime-capitol', title: 'Prime Capitol', version: '1.2.0', websiteUrl: CANONICAL,
          icons: [{ src: `${CANONICAL}/icons/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }] },
        instructions: INSTRUCTIONS,
      })); return
    }
    case 'ping': res.json(ok(id, {})); return
    case 'tools/list': {
      const c = user.reviewer ? null : await getCaller({ data: {}, auth: { uid: 'mcp', token: { email: user.email, email_verified: true } }, rawRequest: {}, acceptsStreaming: false } as never)
      res.json(ok(id, { tools: toolsFor(!!c?.demo).map(tl => describeTool(tl)) })); return
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
      if (!(await underLimit(user.email))) { res.json(ok(id, toolError('Too many requests this hour. Try again a bit later.'))); return }
      try {
        const r = await runTool(name, args, user)
        const content: unknown[] = [{ type: 'text', text: r.text }]
        // Claude shows images inside the chat; ChatGPT shows the picture cards (widget) instead.
        if (r.images?.length && user.assistant !== 'ChatGPT') content.push(...await imageBlocks(r.images.slice(0, 6)))
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
  ui: { csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains: [] }, prefersBorder: false },
  'openai/widgetCSP': { connect_domains: [], resource_domains: RESOURCE_DOMAINS },
  'openai/widgetDescription': 'Prime Capitol cards: prop photos with availability, free filming times, and shoot details. Display only.',
  'openai/widgetPrefersBorder': false,
}
function describeTool(tl: { name: string; annotations: Record<string, boolean> } & Record<string, unknown>) {
  const w = WIDGET_TOOLS[tl.name]
  return { ...tl,
    securitySchemes: [{ type: 'oauth2', scopes: ['primecapitol'] }],
    _meta: {
      securitySchemes: [{ type: 'oauth2', scopes: ['primecapitol'] }],
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
    tx.set(ref, { n: n + 1, email }, { merge: true })
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
