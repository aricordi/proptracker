// The Prime Capitol connector for ChatGPT / Claude (owner, Nov 24): OAuth sign-in with PKCE, then MCP tools that act as the
// signed-in person through the app's own server functions.
import { beforeEach, describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const BASE = 'http://127.0.0.1:5001/demo-proptracker/northamerica-northeast1/mcp'
const ANA = 'ana@example.com', DEE = 'dee@example.com', MAANIK = 'maanik@example.com'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const today = todayInStudio()
let FRI = addDays(today, 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana Lopez', access: 'full' })
  await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put('items/phone', { name: 'Red rotary phone', quantity: 2, condition: 'good', collection: 'company', archived: false, description: 'Vintage desk phone', photos: ['https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fp.jpg?alt=media'] })
  await put('items/mine', { name: 'Grandma lamp', quantity: 1, condition: 'good', collection: 'personal', archived: false })
})

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function connect(email: string) {
  const reg = await (await json('/oauth/register', { client_name: 'claude', redirect_uris: [REDIRECT] })).json()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256' })
  const auth = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' })
  const req = new URL(auth.headers.get('location')!).searchParams.get('req')!
  const ok = await call('approveConnector', { req }, email)
  const back = new URL(ok.result.redirect)
  expect(back.searchParams.get('state')).toBe('xyz')
  const tok = await (await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }) })).json()
  return { ...tok, client_id: reg.client_id }
}
let n = 1
const rpc = async (token: string, method: string, params: unknown = {}) =>
  (await json('/mcp', { jsonrpc: '2.0', id: n++, method, params }, { Authorization: `Bearer ${token}` })).json()
const tool = async (token: string, name: string, args: unknown = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).result

describe('connector sign-in', () => {
  it('publishes OAuth discovery and refuses strange return addresses', async () => {
    const meta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
    expect((await json('/oauth/register', { redirect_uris: ['https://evil.example.com/cb'] })).status).toBe(400)
    const noToken = await json('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(noToken.status).toBe(401)
    expect(noToken.headers.get('www-authenticate')).toContain('oauth-protected-resource')
  })

  it('signs in with PKCE, a code works once, refresh rotates', async () => {
    const t = await connect(ANA)
    expect(t.access_token).toBeTruthy()
    const init = await rpc(t.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.result.serverInfo.name).toBe('prime-capitol')
    const r1 = await (await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id }) })).json()
    expect(r1.access_token).toBeTruthy()
    const again = await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id }) })
    expect(again.status).toBe(400)   // the old refresh token was replaced
  })

  it('a turned-off person loses access at once; disconnect removes the tokens', async () => {
    const t = await connect(ANA)
    expect((await rpc(t.access_token, 'tools/list')).result.tools.length).toBeGreaterThan(5)
    const list = await call('myConnectors', {}, ANA)
    expect(list.result.connections[0].assistant).toBe('Claude')
    await call('disconnectConnector', { id: list.result.connections[0].id }, ANA)
    expect((await json('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: `Bearer ${t.access_token}` })).status).toBe(401)
  })
})

describe('connector tools', () => {
  it('searches company props only, with photos; never personal props', async () => {
    const t = await connect(ANA)
    const r = await tool(t.access_token, 'search_props', { query: 'phone', day: FRI })
    expect(r.structuredContent.results[0]).toMatchObject({ id: 'phone', free_that_day: 2 })
    const lamp = await tool(t.access_token, 'search_props', { query: 'lamp' })
    expect(JSON.stringify(lamp)).not.toContain('mine')
    const shown = await tool(t.access_token, 'show_props', { ids: ['phone', 'mine'] })
    expect(shown.structuredContent.props.map((p: { id: string }) => p.id)).toEqual(['phone'])
  })

  it('books through the same rules (a request), lists it, and sends props for it', async () => {
    const t = await connect(ANA)
    const sch = await tool(t.access_token, 'get_schedule', { from: FRI, days: 1 })
    expect(sch.structuredContent.days[0].date).toBe(FRI)
    const bad = await tool(t.access_token, 'book_shoot', { place: 'cliff1', day: FRI, start: '13:00', end: '17:00' })
    expect(bad.content[0].text).toMatch(/collaborator/)
    const ok = await tool(t.access_token, 'book_shoot', { place: 'cliff1', day: FRI, start: '13:00', end: '15:00' })
    expect(ok.isError).toBe(false)
    expect(ok.content[0].text).toMatch(/^Requested/)
    const mine = await tool(t.access_token, 'my_shoots')
    const shoot = mine.structuredContent.shoots[0]
    expect(shoot).toMatchObject({ day: FRI, start: '13:00', status: 'waiting for approval' })
    const props = await tool(t.access_token, 'request_props', { shoot_id: shoot.id, video_name: 'Phone prank', items: [{ id: 'phone', qty: 1 }] })
    expect(props.isError).toBe(false)
    const res = await tool(t.access_token, 'my_props_requests')
    expect(res.structuredContent.requests[0]).toMatchObject({ video: 'Phone prank', status: 'requested' })
    // A second ask adds to the same waiting request.
    await tool(t.access_token, 'request_props', { shoot_id: shoot.id, items: [{ id: 'phone', qty: 1 }] })
    const again = await tool(t.access_token, 'my_props_requests')
    expect(again.structuredContent.requests).toHaveLength(1)
    expect(again.structuredContent.requests[0].items).toEqual(['Red rotary phone x2'])
  })

  it('cannot touch someone else\'s shoot', async () => {
    const t = await connect(ANA)
    await put('shoots/other', { creatorEmail: MAANIK, status: 'booked', date: FRI, place: 'cliff2', start: 780, end: 900 })
    const r = await tool(t.access_token, 'cancel_shoot', { shoot_id: 'other' })
    expect(r.content[0].text).toMatch(/isn't one of your shoots/)
    expect((await getDoc('shoots/other'))!.status).toBe('booked')
  })

  it('a Props-only creator only gets the props tools', async () => {
    const t = await connect(DEE)
    const names = (await rpc(t.access_token, 'tools/list')).result.tools.map((x: { name: string }) => x.name)
    expect(names).toContain('search_props')
    expect(names).not.toContain('book_shoot')
    const r = await tool(t.access_token, 'book_shoot', { place: 'cliff1', day: FRI, start: '13:00', end: '15:00' })
    expect(r.content[0].text).toMatch(/isn't open for you yet/)
  })
})
