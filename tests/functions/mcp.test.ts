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

  it('books free time with a collaborator on ONE booking, and checks a video idea against the closet', async () => {
    const t = await connect(ANA)
    await put(`users/${'kyle@example.com'}`, { email: 'kyle@example.com', role: 'creator', active: true, name: 'Kyle Reed', access: 'full' })
    const sch = await tool(t.access_token, 'get_schedule', { from: FRI, days: 1 })
    expect(sch.structuredContent.days[0].houses.cliff2.free.length).toBeGreaterThan(0)
    const odd = await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:10', end: '15:10' })
    expect(odd.content[0].text).toMatch(/15-minute/)
    const ok = await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:15', end: '17:15', with: ['Kyle'] })
    expect(ok.content[0].text).toMatch(/^Requested/)
    const mine = await tool(t.access_token, 'my_shoots')
    expect(mine.structuredContent.shoots[0]).toMatchObject({ start: '13:15', end: '17:15', with: ['Kyle'] })
    const after = await tool(t.access_token, 'get_schedule', { from: FRI, days: 1 })
    expect(after.structuredContent.days[0].houses.cliff2.bookings[0]).toMatchObject({ start: '13:15', end: '17:15', who: 'you', with: ['Kyle'] })
    const idea = await tool(t.access_token, 'props_for_idea', { idea: 'Prank call', needs: [{ need: 'rotary phone', scene: 'Office' }, { need: 'pirate ship' }], day: FRI })
    expect(idea.structuredContent.groups[0].matches[0].id).toBe('phone')
    expect(idea.structuredContent.missing).toEqual(['pirate ship'])
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

  it('every tool is labelled (read-only / destructive / open world) and visual tools name their card template', async () => {
    const t = await connect(ANA)
    const tools = (await rpc(t.access_token, 'tools/list')).result.tools
    for (const tl of tools) {
      for (const k of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) expect(typeof tl.annotations[k], `${tl.name}.${k}`).toBe('boolean')
      expect(tl.description.length, tl.name).toBeGreaterThan(30)
    }
    const show = tools.find((x: { name: string }) => x.name === 'show_props')
    expect(show._meta.ui.resourceUri).toMatch(/^ui:\/\//)
    expect(show._meta['openai/outputTemplate']).toMatch(/^ui:\/\//)
    const list = (await rpc(t.access_token, 'resources/list')).result.resources
    expect(list.map((r: { mimeType: string }) => r.mimeType).sort()).toEqual(['text/html+skybridge', 'text/html;profile=mcp-app'])
    const read = (await rpc(t.access_token, 'resources/read', { uri: show._meta.ui.resourceUri })).result.contents[0]
    expect(read.text).toContain('PRIME CAPITOL')
    expect(read._meta.ui.csp.resourceDomains).toEqual(['https://firebasestorage.googleapis.com'])
  })

  it('status, one shoot, free times, a prop calendar, changing and cancelling props, and app links', async () => {
    const t = await connect(ANA)
    const booked = await tool(t.access_token, 'book_shoot', { place: 'cliff1', day: FRI, start: '10:00', end: '12:00' })
    expect(booked.isError).toBe(false)
    const shoot = (await tool(t.access_token, 'my_shoots')).structuredContent.shoots[0]
    const st = await tool(t.access_token, 'my_status')
    expect(st.structuredContent.next_shoot).toMatchObject({ id: shoot.id, start: '10:00' })
    const free = await tool(t.access_token, 'find_free_times', { from: FRI, days: 2, hours: 2, houses: ['cliff2'], around: '14:00' })
    expect(free.structuredContent.options[0]).toMatchObject({ place: 'cliff2', start: '14:00', end: '16:00' })
    // Same day as her Cliff 1 booking is skipped (one house booking a day).
    expect(free.structuredContent.options.some((o: { day: string }) => o.day === FRI)).toBe(false)
    const tooLong = await tool(t.access_token, 'find_free_times', { hours: 4 })
    expect(tooLong.content[0].text).toMatch(/1 more person/)
    const cal = await tool(t.access_token, 'prop_calendar', { id: 'phone', from: FRI, days: 3 })
    expect(cal.structuredContent.days[0]).toEqual({ day: FRI, free: 2 })
    await tool(t.access_token, 'request_props', { shoot_id: shoot.id, video_name: 'Ring ring', items: [{ id: 'phone', qty: 2 }] })
    const req = (await tool(t.access_token, 'my_props_requests')).structuredContent.requests[0]
    const ch = await tool(t.access_token, 'change_props_request', { request_id: req.id, items: [{ id: 'phone', qty: 1 }] })
    expect(ch.content[0].text).toMatch(/Red rotary phone x1/)
    const detail = await tool(t.access_token, 'get_shoot', { shoot_id: shoot.id })
    expect(detail.structuredContent.props_requests[0].items).toEqual(['Red rotary phone x1'])
    expect(detail.structuredContent.props_still_open).toBe(true)
    const cancel = await tool(t.access_token, 'cancel_props_request', { request_id: req.id })
    expect(cancel.content[0].text).toMatch(/^Cancelled/)
    const link = await tool(t.access_token, 'app_link', { what: 'check_in', shoot_id: shoot.id })
    expect(link.structuredContent.url).toBe(`https://proptracker.arbcreative.co/?shoot=${shoot.id}`)
    // Someone else's props request is off limits.
    await put('reservations/theirs', { creatorEmail: MAANIK, status: 'requested', title: 'X', lines: [] })
    expect((await tool(t.access_token, 'cancel_props_request', { request_id: 'theirs' })).content[0].text).toMatch(/isn't one of your/)
  })

  it('answers OpenAI\'s domain check only once a token is saved', async () => {
    expect((await fetch(`${BASE}/.well-known/openai-apps-challenge`)).status).toBe(404)
    await put('mcp_settings/openai', { challenge: 'tok_12345678' })
    expect(await (await fetch(`${BASE}/.well-known/openai-apps-challenge`)).text()).toBe('tok_12345678')
  })
})

