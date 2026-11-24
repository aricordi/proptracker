// The Prime Capitol connector server (MCP over HTTP + OAuth sign-in) for ChatGPT and Claude (owner, Nov 24).
// Reached through the website's own address (firebase.json rewrites /mcp, /oauth/**, /.well-known/oauth-* to this function),
// so the sign-in discovery lives at the root of https://proptracker.arbcreative.co as the assistants require.
// Stateless: every POST /mcp is one JSON-RPC message answered with JSON (Streamable HTTP without sessions).
// Collections (no security rules = server only): mcp_clients, mcp_auth_requests, mcp_codes, mcp_tokens, mcp_rate.
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import type { Request } from 'express'
import { db, CALLABLE, requireRole, getCaller } from '../auth.js'
import { GEMINI_API_KEY } from '../gemini.js'
import {
  redirectAllowed, assistantName, randomToken, hashToken, pkceOk, metadata, resourceMetadata,
  ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, CODE_TTL_SECONDS, REQUEST_TTL_SECONDS,
} from './oauth.js'
import { toolsFor, runTool, type McpUser } from './tools.js'
import { WIDGET_URI, WIDGET_HTML } from './widget.js'

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
  'Prime Capitol is a film studio for YouTube creators: two houses to film at (Cliff 1, Cliff 2), a company props closet (props, costumes, set dressing) and a schedule team that approves bookings. You act as the signed-in creator, with exactly their permissions.',
  'Start with get_rules (today\'s date, studio time, the live rules).',
  'BRAINSTORMING: when the person is coming up with or writing a video idea, sketch or script, be a creative partner AND keep the closet in mind. As soon as scenes, characters or locations take shape, offer to check the props closet (props_for_idea with concrete needs per scene), show matches with show_props, and suggest ways to use what already exists. Mention the custom-prop option for things the closet lacks. Do this naturally, without derailing their writing.',
  'TIMES: get_schedule gives the raw schedule with free stretches. Bookings are free-form (any quarter hour, e.g. 13:15–15:15), up to 2 hours per person; longer needs collaborators on the same booking. Use judgement: suggest times next to a collaborator\'s shoot, at the time of day they asked for, on non-priority days if a day is locked for them.',
  'CHANGES: always confirm details with the person before book_shoot, move_shoot, cancel_shoot or request_props. Creator bookings are requests the schedule team approves; never say a booking is confirmed until the tool says "Booked". Props from the closet need about 48 hours notice; custom props 4+ days with no guaranteed date.',
  'Never invent props, times or rules: use the tools. People\'s emails, internal notes and costs are not available.',
].join(' ')

export const mcp = onRequest({ secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB', cors: true, invoker: 'public' }, async (req, res) => {
  const base = baseOf(req)
  const path = req.path.replace(/^\/mcp(?=\/(oauth|\.well-known|mcp)\b)/, '') || '/'   // emulator URLs keep the function name in front
  res.set('Cache-Control', 'no-store')
  try {
    if (path.startsWith('/.well-known/oauth-protected-resource')) { res.json(resourceMetadata(base)); return }
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) { res.json(metadata(base)); return }
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
// What the /connect page shows before Allow.
export const connectorRequestInfo = onCall(CALLABLE, async req => {
  const id = String(req.data?.req ?? '')
  const r = /^[\w-]{10,40}$/.test(id) ? (await db.doc(`mcp_auth_requests/${id}`).get()).data() : undefined
  if (!r || expired(r.expiresAt)) return { ok: false }
  return { ok: true, assistant: r.assistant }
})

async function issueTokens(email: string, name: string, clientId: string, assistant: string) {
  const access = randomToken(32), refresh = randomToken(32)
  const now = new Date().toISOString()
  const batch = db.batch()
  batch.set(db.doc(`mcp_tokens/${hashToken(access)}`), { kind: 'access', email, name, clientId, assistant, expiresAt: later(ACCESS_TTL_SECONDS), createdAt: now })
  batch.set(db.doc(`mcp_tokens/${hashToken(refresh)}`), { kind: 'refresh', email, name, clientId, assistant, expiresAt: later(REFRESH_TTL_DAYS * 86400), createdAt: now })
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
    res.json(await issueTokens(c.email, c.name, c.clientId, c.assistant)); return
  }
  if (b.grant_type === 'refresh_token') {
    const ref = db.doc(`mcp_tokens/${hashToken(String(b.refresh_token ?? ''))}`)
    const t = await db.runTransaction(async tx => { const s = await tx.get(ref); if (s.exists) tx.delete(ref); return s.data() })   // rotated
    if (!t || t.kind !== 'refresh' || expired(t.expiresAt) || (b.client_id && b.client_id !== t.clientId)) { bad('invalid_grant'); return }
    if (!(await stillAllowed(t.email))) { bad('invalid_grant', 'Prime Capitol access was turned off'); return }
    res.json(await issueTokens(t.email, t.name, t.clientId, t.assistant)); return
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
  if (!t || t.kind !== 'access' || expired(t.expiresAt) || !(await stillAllowed(t.email))) {
    res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`).json({ error: 'invalid_token' }); return
  }
  const user: McpUser = { email: t.email, name: t.name, assistant: t.assistant }
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
        serverInfo: { name: 'prime-capitol', title: 'Prime Capitol', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })); return
    }
    case 'ping': res.json(ok(id, {})); return
    case 'tools/list': {
      const c = await getCaller({ data: {}, auth: { uid: 'mcp', token: { email: user.email, email_verified: true } }, rawRequest: {}, acceptsStreaming: false } as never)
      res.json(ok(id, { tools: toolsFor(!!c?.demo).map(tl => ({ ...tl,
        ...(tl.name === 'show_props' || tl.name === 'get_prop' ? { _meta: { 'openai/outputTemplate': WIDGET_URI, 'openai/toolInvocation/invoking': 'Getting the props…', 'openai/toolInvocation/invoked': 'Here they are' } } : {}) })) })); return
    }
    case 'resources/list':
      res.json(ok(id, { resources: [{ uri: WIDGET_URI, name: 'Prop cards', mimeType: 'text/html+skybridge' }] })); return
    case 'resources/read':
      if (msg.params?.uri !== WIDGET_URI) { res.json(rpcError(id, -32002, 'Resource not found')); return }
      res.json(ok(id, { contents: [{ uri: WIDGET_URI, mimeType: 'text/html+skybridge', text: WIDGET_HTML,
        _meta: { 'openai/widgetCSP': { connect_domains: [], resource_domains: ['https://firebasestorage.googleapis.com'] }, 'openai/widgetDescription': 'Prime Capitol prop cards with photos and availability.' } }] })); return
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
