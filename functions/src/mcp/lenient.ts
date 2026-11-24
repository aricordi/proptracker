// The understanding layer in front of EVERY connector tool (owner, Nov 24: "build that out to maximum robustness… with regards to
// every single possible function"). Before a tool runs, the person's own words in its arguments are turned into what the tool
// needs, using the pure helpers in casual.ts / understand.ts and what we know about this person:
//   days ("sat", "tmrw", "the 28th") · houses ("c2", "2371", "on location") · times ("5", "5ish", "noon", "11 to 1") ·
//   a booking with no end = 2 hours per person · shoots ("my saturday one", "the one with kyle", "next") · props requests
//   ("ring ring", "the packed one") · props by name ("the red phone", "2 cop hats", as plain strings too) · invites, swaps and
//   waitlist spots by the other person or the day · problem reports by what's out.
// When the words fit more than one thing (or nothing), the tool doesn't run: the assistant gets a short question with the options.
import { db } from '../auth.js'
import { todayInStudio, addDays, isDay } from '../booking.js'
import { loadScheduleSettings } from '../scheduling.js'
import { resolveWhen } from './understand.js'
import { normPlace, normHouses, clockPair, parseLength, resolveShootRef, resolveRequestRef, resolveNamedRef, resolvePropRef, qtyFrom,
  type ShootRef, type RequestRef, type Named } from './casual.js'
import { hm, s, loadCloset, firstName, type Json, type McpUser, type ToolResult } from './common.js'
import { sandboxContext } from './reviewer.js'

const PLACE: Record<string, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }
const ask = (text: string, field: string, options: Json[] = []): { ask: ToolResult } =>
  ({ ask: { text, structured: { needs_clarifying: true, field, ...(options.length ? { options } : {}) } } })

export interface Known { shoots: ShootRef[]; requests: RequestRef[]; invites: Named[]; swaps: Named[]; waitlist: Named[]; out: (Named & { kind: 'props' | 'gear' })[] }
/** What the person has, to make sense of "my saturday shoot" (real data, or the reviewer's practice copy). */
export async function knownFor(u: McpUser): Promise<Known> {
  if (u.reviewer) return sandboxContext(u.sandboxKey ?? 'default')
  const since = addDays(todayInStudio(), -30)
  const [own, crew, res, casts, swaps, waits, gear] = await Promise.all([
    db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', since).get(),
    db.collection('shoots').where('people', 'array-contains', u.email).get(),
    db.collection('reservations').where('creatorEmail', '==', u.email).get(),
    db.collection('cast_invites').where('toEmail', '==', u.email).where('status', '==', 'pending').get(),
    db.collection('swap_requests').where('toEmail', '==', u.email).where('status', '==', 'pending').get(),
    db.collection('waitlist').where('email', '==', u.email).get(),
    db.collection('gear_bookings').where('creatorEmail', '==', u.email).get(),
  ])
  const titles = new Map<string, string[]>()
  for (const r of res.docs) { const sid = String(r.get('scheduleShootId') ?? r.get('shootId') ?? ''); if (sid) titles.set(sid, [...(titles.get(sid) ?? []), String(r.get('title') ?? '')]) }
  const shootDocs = [...own.docs, ...crew.docs.filter(d => d.get('creatorEmail') !== u.email && String(d.get('date')) >= since)]
  return {
    shoots: shootDocs.filter(d => ['booked', 'requested'].includes(String(d.get('status')))).map(d => ({
      id: d.id, place: String(d.get('place')), date: String(d.get('date')), start: Number(d.get('start')), end: Number(d.get('end')), status: String(d.get('status')),
      with: [...((d.get('with') ?? []) as Json[]).map(w => String(w.name ?? '')), ...(d.get('creatorEmail') !== u.email ? [String(d.get('creatorName') ?? '')] : [])],
      titles: [...(titles.get(d.id) ?? []), String(d.get('title') ?? '')].filter(Boolean),
    })),
    requests: res.docs.map(d => ({ id: d.id, date: String(d.get('startDate')), title: String(d.get('title') ?? ''), status: String(d.get('status')),
      items: ((d.get('lines') ?? []) as Json[]).map(l => `${l.itemName} x${l.qty}`) })),
    invites: casts.docs.map(d => ({ id: d.id, who: String(d.get('hostName') ?? ''), date: String(d.get('date') ?? '') })),
    swaps: swaps.docs.map(d => ({ id: d.id, who: String(d.get('fromName') ?? ''), date: String((d.get('from') as Json | undefined)?.date ?? '') })),
    waitlist: waits.docs.filter(d => ['waiting', 'offered'].includes(String(d.get('status')))).map(d => ({ id: d.id, who: PLACE[String(d.get('house'))] ?? '', date: String(d.get('date') ?? '') })),
    out: [
      ...res.docs.filter(d => d.get('status') === 'collected').map(d => ({ id: d.id, kind: 'props' as const, who: [String(d.get('title') ?? ''), ...((d.get('lines') ?? []) as Json[]).map(l => String(l.itemName))].join(' '), date: String(d.get('startDate')) })),
      ...gear.docs.filter(d => d.get('status') === 'out').map(d => ({ id: d.id, kind: 'gear' as const, who: ((d.get('lines') ?? []) as Json[]).map(l => String(l.name)).join(' '), date: String(d.get('date') ?? '') })),
    ],
  }
}

/** An exact id of something that exists but isn't theirs ("isn't one of your shoots", never a guess at another of theirs). */
async function someoneElses(col: string, v: unknown, u: McpUser) {
  if (u.reviewer || typeof v !== 'string' || !/^[\w-]{3,100}$/.test(v)) return false
  return (await db.doc(`${col}/${v}`).get()).exists
}
const shootLine = (x: ShootRef) => ({ id: x.id, label: `${x.date} ${hm(x.start)}–${hm(x.end)} ${PLACE[x.place] ?? x.place}${x.with.length ? ` with ${x.with.map(firstName).join(', ')}` : ''}${x.titles[0] ? ` ("${x.titles[0]}")` : ''}${x.status === 'requested' ? ' (waiting for approval)' : ''}` })

// Which fields of which tools carry what (anything not listed passes through untouched).
const DAY_FIELDS = ['day', 'from', 'their_day']
const SHOOT_FIELDS: Record<string, string> = { get_shoot: 'shoot_id', move_shoot: 'shoot_id', cancel_shoot: 'shoot_id', request_props: 'shoot_id', invite_to_video: 'shoot_id', app_link: 'shoot_id', request_swap: 'my_shoot_id' }
const MUST_NAME = new Set(['move_shoot', 'cancel_shoot', 'request_swap', 'invite_to_video', 'request_props'])
const ONE_DAY_TOOLS = new Set(['book_shoot', 'move_shoot', 'join_waitlist', 'request_swap', 'search_props', 'props_for_idea', 'show_props', 'get_prop'])

export async function understandArgs(name: string, input: Json, u: McpUser): Promise<{ args: Json } | { ask: ToolResult }> {

  const a: Json = { ...input }
  const today = todayInStudio()
  let known: Known | null = null
  const k = async () => known ??= await knownFor(u)

  // ── Days ──
  for (const f of DAY_FIELDS) {
    const v = a[f]
    if (v == null || v === '') continue
    if (typeof v !== 'string') { delete a[f]; continue }
    if (isDay(v)) continue
    const w = resolveWhen(v, today)
    if (!w) return ask(`Which day is "${v}"? Give a date (e.g. ${addDays(today, 3)}).`, f)
    if (w.days.length > 1 && ONE_DAY_TOOLS.has(name)) return ask(`"${v}" covers ${w.days.length} days (${w.days[0]} to ${w.days[w.days.length - 1]}). Which day?`, f, w.days.map(d => ({ day: d })))
    a[f] = w.days[0]
    if (f === 'from' && w.days.length > 1 && a.days == null) a.days = w.days.length
  }
  // ── Houses ──
  for (const f of ['place', 'their_place']) {
    if (a[f] == null || a[f] === '') continue
    const p = normPlace(a[f])
    if (!p || (f === 'their_place' && p === 'offsite')) return ask(`Which house: Cliff 1 or Cliff 2${f === 'place' ? ' (or offsite)' : ''}?`, f)
    a[f] = p
  }
  if (a.houses != null) { const h = normHouses(a.houses); if (h) a.houses = h; else delete a.houses }

  // ── Times ──
  if (name === 'book_shoot' || name === 'move_shoot') {
    const { start, end } = clockPair(a.start, a.end)
    if (a.start != null && start == null) return ask(`What time does it start? ("${a.start}" isn't a time I can read.)`, 'start')
    if (start != null) a.start = hm(start)
    if (end != null) a.end = hm(end)
    else if (a.end != null && a.end !== '') return ask(`What time does it end? ("${a.end}" isn't a time I can read, or it's before the start.)`, 'end')
    // No end said: the length they gave, else 2 hours per person on the booking (offsite: 2 hours).
    if (name === 'book_shoot' && start != null && end == null) {
      const people = 1 + (Array.isArray(a.with) ? a.with.filter(Boolean).length : 0)
      const sch = await loadScheduleSettings()
      const len = parseLength(a.hours) ?? (a.place === 'offsite' ? 120 : Math.min(people * sch.slotMinutes, 5 * sch.slotMinutes))
      a.end = hm(start + len)
    }
  }
  if (name === 'book_shoot') delete a.hours   // used above for the length; book_shoot itself takes start + end
  for (const f of ['around', 'at', 'their_start', 'start']) {
    if ((name === 'book_shoot' || name === 'move_shoot') && f === 'start') continue
    if (a[f] == null || a[f] === '') continue
    const { start } = clockPair(a[f], null)
    if (start == null) return ask(`What time is "${a[f]}"?`, f)
    a[f] = hm(start)
  }

  // ── Shoots ──
  const sf = SHOOT_FIELDS[name]
  if (sf && (a[sf] != null || name !== 'app_link')) {
    const list = (await k()).shoots
    // Changes never pick a shoot by themselves (final review, Nov 24): an empty reference is a question, even with one shoot.
    if (MUST_NAME.has(name) && !String(a[sf] ?? '').trim()) return ask('Which shoot?', sf, list.filter(x => x.date >= today).slice(0, 6).map(shootLine))
    const r = resolveShootRef(a[sf], list, today)
    if (r.status === 'one') a[sf] = r.hits[0].id
    else if (await someoneElses('shoots', a[sf], u)) return ask('That isn\'t one of your shoots (my_shoots has them).', sf, list.slice(0, 6).map(shootLine))
    else if (name === 'app_link' && !a[sf]) { /* app link without a shoot is fine */ }
    else if (r.status === 'none' && !list.length) return ask('They have no upcoming shoots. Book one first (plan_shoot / book_shoot).', sf)
    else return ask(r.status === 'none' ? `No shoot matches "${a[sf]}". Their shoots:` : `Which shoot${a[sf] ? ` ("${a[sf]}")` : ''}?`, sf, (r.hits.length ? r.hits : list.slice(0, 6)).map(shootLine))
  }

  // ── Props requests ──
  if (name === 'change_props_request' || name === 'cancel_props_request' || name === 'pick_up_props' || name === 'return_props') {
    // Pick-up only looks at packed requests, returns only at picked-up ones, so "my props" is usually clear on its own.
    const want = name === 'pick_up_props' ? 'packed' : name === 'return_props' ? 'collected' : ''
    const all = (await k()).requests
    const list = want ? all.filter(x => x.status === want) : all
    if (want && !String(a.request_id ?? '').trim() && list.length === 1) a.request_id = list[0].id
    if (want && all.some(x => x.id === String(a.request_id ?? ''))) { /* an exact id of theirs: the tool says if its status doesn't fit */ }
    else if (want && String(a.request_id ?? '').trim() && await someoneElses('reservations', a.request_id, u)) return ask('That isn\'t one of your props requests (my_props_requests has them).', 'request_id')
    else if (want && !list.length) return ask(want === 'packed' ? 'Nothing is packed and ready to pick up right now (my_props_requests has the statuses).' : 'They have no props out to bring back.', 'request_id')
    const r = want && all.some(x => x.id === String(a.request_id ?? '')) ? { status: 'one' as const, hits: all.filter(x => x.id === String(a.request_id)) } : resolveRequestRef(a.request_id, list, today)
    if (r.status === 'one') a.request_id = r.hits[0].id
    else if (await someoneElses('reservations', a.request_id, u)) return ask('That isn\'t one of your props requests (my_props_requests has them).', 'request_id')
    else return ask(r.status === 'none' && !list.length ? 'They have no props requests.' : 'Which props request?', 'request_id',
      (r.hits.length ? r.hits : list.slice(0, 6)).map(x => ({ id: x.id, label: `"${x.title}" for ${x.date} (${x.status}): ${x.items.slice(0, 4).join(', ')}` })))
  }

  // ── Props by name ──
  const closet = name === 'show_props' || name === 'get_prop' || name === 'prop_calendar' || name === 'request_props' || name === 'change_props_request'
    ? await loadCloset() : []
  const findProp = (said: string) => resolvePropRef(said, closet)
  const propOptions = (hits: { id: string; name: string }[]) => hits.map(p => ({ id: p.id, name: p.name }))
  if ((name === 'get_prop' || name === 'prop_calendar') && a.id) {
    const r = findProp(String(a.id))
    if (r.status === 'one') a.id = r.hits[0].id
    else return ask(r.status === 'none' ? `"${a.id}" isn't in the closet by that name. Try search_props.` : `Which "${a.id}"?`, 'id', propOptions(r.hits))
  }
  if (name === 'show_props' && Array.isArray(a.ids)) {
    const out: string[] = []
    for (const v of a.ids.map(x => s(x, 120)).filter(Boolean)) { const r = findProp(v); if (r.status === 'none') continue; out.push(...r.hits.slice(0, r.status === 'one' ? 1 : 4).map(p => p.id)) }
    a.ids = [...new Set(out)].slice(0, 12)
  }
  if (name === 'request_props' || name === 'change_props_request') {
    const items: Json[] = []
    const unclear: Json[] = [], unknown: string[] = []
    for (const x of Array.isArray(a.items) ? a.items : []) {
      const said = typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Json).id ?? (x as Json).name ?? '') : ''
      if (!said.trim()) continue
      const qty = typeof x === 'object' && x && Number.isFinite(Number((x as Json).qty)) ? Number((x as Json).qty) : (qtyFrom(said) ?? 1)
      const r = findProp(said)
      if (r.status === 'one') items.push({ id: r.hits[0].id, qty })
      else if (r.status === 'many') unclear.push({ said, options: propOptions(r.hits) })
      else unknown.push(said)
    }
    if (unclear.length) return ask(`Which one did they mean? ${unclear.map(u2 => `"${u2.said}": ${(u2.options as Json[]).map(o => o.name).join(' / ')}`).join('; ')}. Show them (show_props) if it helps.`, 'items', unclear)
    if (unknown.length) return ask(`Not in the closet by those names: ${unknown.join(', ')}. Search for them (search_props), or ask for them as custom props (\`custom\`/\`add_custom\`, 4+ days notice, no guaranteed date).`, 'items', unknown.map(x => ({ said: x })))
    if (Array.isArray(a.items)) a.items = items
  }

  // ── Invites, swaps, waitlist spots, things out ──
  const named: [string, string, keyof Known, string][] = [['answer_video_invite', 'invite_id', 'invites', 'video invite'], ['answer_swap', 'swap_id', 'swaps', 'swap request'], ['leave_waitlist', 'waitlist_id', 'waitlist', 'waitlist spot']]
  for (const [tool, field, key, what] of named) {
    if (name !== tool) continue
    const list = (await k())[key] as Named[]
    if (!String(a[field] ?? '').trim()) return ask(list.length ? `Which ${what}?` : `They have no ${what}s waiting.`, field, list.map(x => ({ id: x.id, label: `${x.who}${x.date ? ` · ${x.date}` : ''}` })))
    const r = resolveNamedRef(a[field], list, today)
    if (r.status === 'one') a[field] = r.hits[0].id
    else return ask(list.length ? `Which ${what}?` : `They have no ${what}s waiting.`, field, (r.hits.length ? r.hits : list).map(x => ({ id: x.id, label: `${x.who}${x.date ? ` · ${x.date}` : ''}` })))
  }
  if (name === 'report_problem') {
    const list = (await k()).out.filter(x => !a.kind || x.kind === a.kind)
    const r = resolveNamedRef(a.id ?? a.what, list, today)
    if (r.status === 'one') { a.id = r.hits[0].id; a.kind = (r.hits[0] as Known['out'][number]).kind }
    else return ask(list.length ? 'Which props or gear is it about?' : 'They have no props or gear out right now: if something at the house is broken, tell the schedule team in the app (More → Report a problem).', 'id', (r.hits.length ? r.hits : list).map(x => ({ id: x.id, label: `${(x as Known['out'][number]).kind}: ${x.who.slice(0, 80)}` })))
  }
  return { args: a }
}

