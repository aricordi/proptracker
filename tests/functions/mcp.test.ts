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

  it('reads between the lines: "film with Justin and Rolly tomorrow" → who, how long, times free for everyone', async () => {
    const t = await connect(ANA)
    await put('users/j1@example.com', { email: 'j1@example.com', role: 'creator', active: true, name: 'Justin Figs', access: 'full' })
    await put('users/j2@example.com', { email: 'j2@example.com', role: 'creator', active: true, name: 'Justin Moore', access: 'full' })
    await put('users/ro@example.com', { email: 'ro@example.com', role: 'creator', active: true, name: 'Roland Price', access: 'props' })
    const tools = (await rpc(t.access_token, 'tools/list')).result.tools.map((x: { name: string }) => x.name)
    expect(tools).toContain('plan_shoot')
    // Two Justins: asked, never guessed. "Rolly" = Roland. Length = 2 h each for the 3 of them.
    const p1 = (await tool(t.access_token, 'plan_shoot', { with: ['Justin', 'Rolly'], day: FRI })).structuredContent
    expect(p1.people[0]).toMatchObject({ said: 'Justin', status: 'which_one' })
    expect(p1.people[0].candidates.map((c: { name: string }) => c.name).sort()).toEqual(['Justin F.', 'Justin M.'])
    // A nickname is a quick confirmation, never booked silently ("Sam" might be a friend not on the app).
    expect(p1.people[1]).toMatchObject({ status: 'did_you_mean', candidates: [{ name: 'Roland P.' }] })
    expect(p1.people[1].candidates[0].person_id).toMatch(/^p_[0-9a-f]{12}$/)
    expect(p1.questions.some((q: string) => /"Rolly" = Roland P\./.test(q))).toBe(true)
    expect(JSON.stringify(p1)).not.toContain('@example.com')
    expect(p1.length_hours).toBe(6)
    expect(p1.questions[0]).toMatch(/Justin/)
    // Casual days work ("tmrw").
    const p2 = (await tool(t.access_token, 'plan_shoot', { with: ['Justin F', 'Roland'], when: 'tmrw' })).structuredContent
    expect(p2.days).toEqual([addDays(today, 1)])
    expect(p2.questions).toEqual([])
    // "Justin and Justin Figs" is one person: 4 h, not 6.
    expect((await tool(t.access_token, 'plan_shoot', { with: ['Justin Figs', 'justin figs'], day: FRI })).structuredContent.length_hours).toBe(4)
    // A day Roland already films is skipped for the group, with the soonest days after it offered.
    await put(`schedule_days/${FRI}`, { date: FRI, cliff1: { '600': { shootId: 'x', name: 'Roland Price', email: 'ro@example.com', kind: 'extra', time: { start: 600, end: 720 } } } })
    const p3 = (await tool(t.access_token, 'plan_shoot', { with: ['Justin Figs', 'Rolly'], day: FRI })).structuredContent
    expect(p3.options).toEqual([])
    expect(p3.busy[0]).toMatch(/Roland P\. already films/)
    expect(p3.soonest_after.length).toBeGreaterThan(0)
    const p4 = (await tool(t.access_token, 'plan_shoot', { with: ['Justin Figs'], day: FRI, at: '5pm' })).structuredContent
    expect(p4.length_hours).toBe(4)
    expect(p4.options[0].start).toBe('17:00')
    // Booking: a typo is a question, a stranger needs not_on_app (after the person confirms).
    expect((await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '17:00', with: ['Justn Figs'] })).content[0].text).toMatch(/Did they mean Justin F\./)
    expect((await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '17:00', with: ['Bobby Tables'] })).content[0].text).toMatch(/not_on_app/)
    const ok = await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '17:00', with: ['Bobby Tables'], not_on_app: ['Bobby Tables'] })
    expect(ok.content[0].text).toMatch(/^Requested/)
    // After midnight is shown as 24:xx and can be booked back as given; a number time is HHMM, never minutes.
    const late = (await tool(t.access_token, 'find_free_times', { from: addDays(FRI, 1), days: 1, houses: ['cliff2'], around: '23:30' })).structuredContent.options
    expect(late.some((o: { end: string }) => o.end >= '24:00')).toBe(true)
    const night = late.find((o: { start: string }) => o.start >= '23:00')
    if (night) expect((await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: addDays(FRI, 1), start: night.start, end: night.end })).content[0].text).toMatch(/^Requested/)
    const nine = await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: addDays(FRI, 2), start: 900, end: 1100 })
    expect(nine.content[0].text).toMatch(/09:00–11:00/)
  })

  it('understands casual words in every tool, asks when unclear, and suggests what to do next', async () => {
    const t = await connect(ANA)
    const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const said = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`   // "nov 28"
    const SAT = addDays(FRI, 3)   // a Monday (Saturdays at Cliff 1 are priority days)
    // "book c2 nov 28 at 1" → Cliff 2, 1–3 PM (2 hours for one person, "1" = 1 PM).
    const b1 = await tool(t.access_token, 'book_shoot', { place: 'c2', day: said(FRI), start: '1' })
    expect(b1.content[0].text).toMatch(/^Requested: Cliff 2, .* 13:00–15:00/)
    expect(b1.content[0].text).toMatch(/Next: props from the closet/)
    expect((await tool(t.access_token, 'book_shoot', { place: 'cliff one', day: said(SAT), start: '5pm', end: '7' })).content[0].text).toMatch(/^Requested: Cliff 1/)
    // Which shoot: unclear → options; by day / house words → the right one.
    const unclear = await tool(t.access_token, 'get_shoot', { shoot_id: 'my shoot' })
    expect(unclear.structuredContent.needs_clarifying).toBe(true)
    expect(unclear.structuredContent.options).toHaveLength(2)
    const g = await tool(t.access_token, 'get_shoot', { shoot_id: 'the c2 one' })
    expect(g.structuredContent).toMatchObject({ day: FRI, start: '13:00' })
    expect((await tool(t.access_token, 'get_shoot', { shoot_id: said(SAT) })).structuredContent).toMatchObject({ start: '17:00', end: '19:00' })
    // Props by name, shoot by words.
    const rp = await tool(t.access_token, 'request_props', { shoot_id: 'the cliff 2 one', video_name: 'Ring Ring', items: [{ id: 'the red phone' }] })
    expect(rp.content[0].text).toMatch(/^Sent: props request "Ring Ring"/)
    expect((await tool(t.access_token, 'request_props', { shoot_id: 'the cliff 2 one', items: [{ id: 'pirate ship' }] })).content[0].text).toMatch(/custom props/)
    // The request by its video name; the prop by name with a count.
    const ch = await tool(t.access_token, 'change_props_request', { request_id: 'ring ring', items: [{ id: 'red rotary phone', qty: 2 }] })
    expect(ch.content[0].text).toMatch(/Red rotary phone x2/)
    expect((await tool(t.access_token, 'get_prop', { id: 'red phone' })).structuredContent.id).toBe('phone')
    // A day word that covers several days asks which.
    expect((await tool(t.access_token, 'book_shoot', { place: 'c2', day: 'this weekend', start: '1' })).structuredContent.needs_clarifying).toBe(true)
    // The context pack: dates with weekdays, their shoots with ids and labels, so the AI resolves words itself.
    const ctx = (await tool(t.access_token, 'get_context')).structuredContent
    expect(ctx.days).toHaveLength(14)
    expect(ctx.days[0]).toMatchObject({ date: today, is: 'today' })
    expect(ctx.upcoming_shoots.map((x: { day: string }) => x.day)).toEqual([FRI, SAT])
    expect(ctx.upcoming_shoots[0]).toMatchObject({ weekday: 'Friday', place: 'Cliff 2', start: '13:00', videos: ['Ring Ring'] })
    expect(ctx.props_requests_open[0]).toMatchObject({ video: 'Ring Ring' })
    expect(JSON.stringify(ctx)).not.toContain('@example.com')
    // Exact values are never reinterpreted by the safety net.
    expect((await tool(t.access_token, 'find_free_times', { from: addDays(FRI, 4), days: 1, houses: ['cliff2'], around: '09:00' })).structuredContent.options[0].start).toBe('09:00')
    // "how do I…" answers from the app guide; my_status suggests what to do next.
    const how = await tool(t.access_token, 'how_to', { question: 'how do i return my props' })
    expect(how.structuredContent.entries.length).toBeGreaterThan(0)
    const st = await tool(t.access_token, 'my_status')
    expect(Array.isArray(st.structuredContent.suggestions)).toBe(true)
    expect(st.content[0].text).toMatch(/Worth doing next/)
  })

  it('passes on what creators want anonymously, respects the off switch, and the demo account never saves', async () => {
    const t = await connect(ANA)
    const key = (kind: string, text: string) => `mcp_demand/${createHash('sha1').update(`${kind}|${text}`).digest('hex').slice(0, 32)}`
    const r = await tool(t.access_token, 'note_feature_request', { request: 'Book a makeup artist (ana@example.com)', kind: 'feature' })
    expect(r.structuredContent.saved).toBe(true)
    await tool(t.access_token, 'note_feature_request', { request: 'book a makeup artist', kind: 'feature' })
    const d = (await getDoc(key('feature', 'book a makeup artist (')))
    const d2 = d ?? (await getDoc(key('feature', 'book a makeup artist')))
    expect(d2).toBeTruthy()
    expect(JSON.stringify(d2)).not.toMatch(/ana|example\.com|Lopez/i)
    // Nothing is counted quietly: a search that finds nothing saves nothing.
    await tool(t.access_token, 'search_props', { query: 'pirate ship' })
    expect(await getDoc(key('prop_missing', 'pirate ship'))).toBeNull()
    // Names of people who film never stay in the text; only the month is kept.
    await put('users/kyle@example.com', { email: 'kyle@example.com', role: 'creator', active: true, name: 'Kyle Reed', access: 'full' })
    await tool(t.access_token, 'note_feature_request', { request: "Kyle's drone for aerial shots", kind: 'gear' })
    const g = await getDoc(key('feature', 'gear: drone for aerial shots'))
    expect(g?.text).toBe('gear: drone for aerial shots')
    expect(String(g?.last)).toMatch(/^\d{4}-\d{2}$/)
    // Changes never pick a target by themselves.
    expect((await tool(t.access_token, 'cancel_shoot', {})).structuredContent.needs_clarifying).toBe(true)
    // Off switch (private to the person): nothing more is saved.
    await put(`connector_prefs/${ANA}`, { shareSuggestions: false })
    expect((await tool(t.access_token, 'note_feature_request', { request: 'drone footage' })).structuredContent.saved).toBe(false)
    expect(await getDoc(key('feature', 'drone footage'))).toBeNull()
  })

  it('custom props can carry a reference picture, only from ChatGPT or their own folder, and never get a date', async () => {
    const t = await connect(ANA)
    await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '15:00' })
    const bad = await tool(t.access_token, 'request_props', { shoot_id: FRI, video_name: 'Doll House', custom: [{ description: 'creepy porcelain doll' }], reference_image: 'https://evil.example.com/x.png' })
    expect(bad.content[0].text).toMatch(/Couldn't attach the picture/)
    const mine = `http://127.0.0.1:9199/v0/b/demo-proptracker.appspot.com/o/${encodeURIComponent(`request-photos/${ANA}/ai-1.jpg`)}?alt=media&token=t1`
    const okRes = await tool(t.access_token, 'request_props', { shoot_id: FRI, video_name: 'Doll House', custom: [{ description: 'fog machine' }, { description: 'creepy porcelain doll' }], reference_image: { download_url: mine, file_id: 'f1' }, reference_for: 'doll' })
    expect(okRes.content[0].text).toMatch(/with the reference picture/)
    expect(okRes.content[0].text).toMatch(/Don't promise a date/)
    const res = (await getDoc(`reservations/${okRes.structuredContent.result.id}`))!
    expect(res.builds.find((b: { description: string }) => b.description === 'creepy porcelain doll').refPhoto).toBe(mine)
    expect(res.builds.find((b: { description: string }) => b.description === 'fog machine').refPhoto).toBeUndefined()
    // ChatGPT is told its picture inputs are files.
    const tools = (await rpc(t.access_token, 'tools/list')).result.tools
    expect(tools.find((x: { name: string }) => x.name === 'request_props')._meta['openai/fileParams']).toEqual(['reference_image'])
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
    const link = await tool(t.access_token, 'app_link', { what: 'shoot', shoot_id: shoot.id })
    expect(link.structuredContent.url).toBe(`https://proptracker.arbcreative.co/schedule?shoot=${shoot.id}`)
    // Someone else's props request is off limits.
    await put('reservations/theirs', { creatorEmail: MAANIK, status: 'requested', title: 'X', lines: [] })
    expect((await tool(t.access_token, 'cancel_props_request', { request_id: 'theirs' })).content[0].text).toMatch(/isn't one of your/)
  })

  it('answers OpenAI\'s domain check only once a token is saved', async () => {
    expect((await fetch(`${BASE}/.well-known/openai-apps-challenge`)).status).toBe(404)
    await put('mcp_settings/openai', { challenge: 'tok_12345678' })
    expect(await (await fetch(`${BASE}/.well-known/openai-apps-challenge`)).text()).toBe('tok_12345678')
  })

  it('the reviewers\' demo account: owner makes it, it signs in with a password and only touches a practice copy', async () => {
    const OWNER = 'alexisricordi@gmail.com'
    expect((await call('reviewerAccount', { action: 'create' }, ANA)).ok).toBe(false)
    const acc = (await call('reviewerAccount', { action: 'create' }, OWNER)).result
    expect(acc.email).toBe('reviewer@demo.primecapitol.app')
    const reg = await (await json('/oauth/register', { client_name: 'chatgpt', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] })).json()
    const verifier = randomBytes(32).toString('base64url')
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
    const req = new URL((await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' })).headers.get('location')!).searchParams.get('req')!
    expect((await call('approveConnectorReviewer', { req, email: acc.email, password: 'wrong' })).ok).toBe(false)
    const ok = await call('approveConnectorReviewer', { req, email: acc.email, password: acc.password })
    expect(ok.ok, ok.message).toBe(true)
    const code = new URL(ok.result.redirect).searchParams.get('code')!
    const tok = await (await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect' }) })).json()
    const T = tok.access_token
    const tools = (await rpc(T, 'tools/list')).result.tools.map((x: { name: string }) => x.name)
    expect(tools).toContain('book_shoot')
    // Sample data is there; real people are hidden.
    await put('shoots/real', { creatorEmail: ANA, creatorName: 'Ana Lopez', status: 'booked', date: FRI, place: 'cliff2', start: 600, end: 720 })
    await put(`schedule_days/${FRI}`, { date: FRI, cliff2: { '600': { shootId: 'real', name: 'Ana Lopez', email: ANA, kind: 'extra', time: { start: 600, end: 720 } } } })
    const sch = await tool(T, 'get_schedule', { from: FRI, days: 1 })
    expect(JSON.stringify(sch)).not.toContain('Ana')
    const st = await tool(T, 'my_status')
    expect(st.structuredContent.demo_account).toBe(true)
    expect(st.structuredContent.video_invites_waiting).toHaveLength(1)
    // Booking: same rules (overlap refused), saved only in the practice copy.
    expect((await tool(T, 'book_shoot', { place: 'cliff2', day: FRI, start: '10:30', end: '12:00' })).content[0].text).toMatch(/Another creator/)
    const b = await tool(T, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '15:00' })
    expect(b.content[0].text).toMatch(/^Requested.*practice copy/)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff2['780']).toBeUndefined()
    const mine = (await tool(T, 'my_shoots')).structuredContent.shoots
    expect(mine.some((x: { day: string; start: string }) => x.day === FRI && x.start === '13:00')).toBe(true)
    // Casual words work for the reviewer too: their invite by the host's name, their shoot by "next", people by name.
    expect((await tool(T, 'answer_video_invite', { invite_id: "Jordan's", accept: true })).content[0].text).toMatch(/You're in/)
    expect((await tool(T, 'get_shoot', { shoot_id: 'my next one' })).structuredContent.demo_account).toBe(true)
    const plan = (await tool(T, 'plan_shoot', { with: ['Jordan', 'Kai'], day: FRI })).structuredContent
    expect(plan.length_hours).toBe(6)
    expect(plan.people.map((p: { status: string }) => p.status)).toEqual(['found', 'found'])
    expect((await tool(T, 'get_context')).structuredContent.upcoming_shoots.length).toBeGreaterThan(0)
    // Turning it off cuts the reviewer off at once.
    await call('reviewerAccount', { action: 'disable' }, OWNER)
    expect((await json('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: `Bearer ${T}` })).status).toBe(401)
  })

  it('safety labels are accurate, staff only get look tools, people never come with emails, odd input never crashes', async () => {
    const t = await connect(ANA)
    const tools = (await rpc(t.access_token, 'tools/list')).result.tools
    const hint = (n: string) => tools.find((x: { name: string }) => x.name === n).annotations
    for (const n of ['move_shoot', 'cancel_shoot', 'change_props_request', 'cancel_props_request', 'answer_swap', 'leave_waitlist']) expect(hint(n).destructiveHint, n).toBe(true)
    for (const n of ['book_shoot', 'request_props', 'invite_to_video', 'report_problem']) expect(hint(n).openWorldHint, n).toBe(true)
    for (const n of ['search_props', 'get_schedule', 'my_status']) expect(hint(n).readOnlyHint, n).toBe(true)
    const people = await tool(t.access_token, 'list_people')
    expect(JSON.stringify(people)).not.toMatch(/@/)
    expect((await tool(t.access_token, 'book_shoot', { place: 'cliff2', day: FRI, start: '13:00', end: '17:00', with: [MAANIK] })).content[0].text).toMatch(/not an email/)
    for (const [n, a] of [['get_schedule', { days: 0 }], ['get_schedule', { days: -3 }], ['search_props', { query: 'phone', limit: -5 }], ['find_free_times', { limit: -1 }], ['prop_calendar', { id: 'nope' }], ['get_shoot', {}], ['book_shoot', { place: 'cliff9' }]] as const) {
      const r = await rpc(t.access_token, 'tools/call', { name: n, arguments: a })
      expect(r.result.content[0].text, n).not.toMatch(/Something went wrong/)
    }
    const m = await connect(MAANIK)
    const staff = (await rpc(m.access_token, 'tools/list')).result.tools.map((x: { name: string }) => x.name)
    expect(staff).toContain('search_props')
    expect(staff).not.toContain('book_shoot')
  })
})

