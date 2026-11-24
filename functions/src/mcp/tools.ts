// The Prime Capitol connector's tools (owner, Nov 24: creators live in ChatGPT/Claude; "make the raw data available so it
// can use its own intelligence"). Two kinds:
//   LOOK tools: raw, read-only data the assistant reasons over itself (the props closet with photos, the schedule, the rules,
//               the person's own shoots and requests). Only what this person could already see in the app: never other
//               people's emails, internal notes, costs or the owner's personal props.
//   DO tools:   every change runs the SAME server function the app uses, as this person (.run with their identity), so
//               every rule, limit and Maanik's approval applies exactly as in the app. The assistant can't skip anything.
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { db, OWNER_EMAIL, getCaller, type Caller } from '../auth.js'
import { collectionOf } from '../collections.js'
import { freeForRange, todayInStudio, addDays, isDay, weekday, isOpen, type BookingEntry } from '../booking.js'
import { fmtTime, nowStamp } from '../gearBooking.js'
import {
  HOUSES, hardBlocks, headsUps, priorityLocked, isPriorityDay, needsGuideline, isNoCrewDay, freeGaps, houseOpen, houseClose,
  houseBookings as dayBookings, maxMinutesFor, isLongBooker, TIME_STEP, MIN_BOOKING_MINUTES,
  type House, type ScheduleDay, type ScheduleSettings,
} from '../schedule.js'
import { loadScheduleSettings, filmingPeople, bookShoot, cancelShoot, moveShoot } from '../scheduling.js'
import { loadSettings, createReservation, editReservation } from '../reservations.js'
import { searchSimilar } from '../index.js'
import { rulesText } from '../assistant.js'

export interface McpUser { email: string; name: string; assistant: string }
type Json = Record<string, unknown>
export interface ToolResult { text: string; structured?: Json; images?: { url: string; caption: string }[]; widget?: boolean }

// Run one of the app's own server functions AS this person.
function asUser<T>(u: McpUser, data: T): CallableRequest<T> {
  return { data, auth: { uid: `mcp:${u.email}`, token: { email: u.email, email_verified: true, name: u.name } }, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<T>
}
async function callerOf(u: McpUser): Promise<Caller> {
  const c = await getCaller(asUser(u, {}))
  if (!c) throw new HttpsError('permission-denied', 'Your Prime Capitol access is turned off. Ask the owner or an admin.')
  return c
}

const s = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const firstName = (n: string) => String(n || '').split(/\s+/)[0]
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
// "13:15", "1:15 pm", "1315" → minutes after midnight (null if unreadable). After-midnight times may be given as 24:00–25:59.
export function parseClock(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  const t = s(v, 20).toLowerCase().replace(/\s+/g, '')
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] ?? 0)
  if (min > 59 || h > 25) return null
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h * 60 + min
}

// ─── The props closet (company props only; cached a few minutes per server copy) ─────────────────────────────────────
interface Prop { id: string; name: string; category: string; tags: string[]; description: string; words: string; quantity: number; missing: number; damaged: boolean; photo: string; photos: string[]; createdAt: string }
let closet: { at: number; props: Prop[] } | null = null
async function loadCloset(): Promise<Prop[]> {
  if (closet && Date.now() - closet.at < 5 * 60_000) return closet.props
  const [items, cats, tags] = await Promise.all([
    db.collection('items').where('collection', '==', 'company').get(), db.collection('categories').get(), db.collection('tags').get(),
  ])
  const catLabel = new Map(cats.docs.map(d => [d.id, String(d.get('label') ?? d.id)]))
  const tagLabel = new Map(tags.docs.map(d => [d.id, String(d.get('label') ?? d.id)]))
  const props: Prop[] = []
  for (const d of items.docs) {
    const x = d.data()
    if (x.archived || x.mergedInto || collectionOf(x) !== 'company') continue
    const photos: string[] = Array.isArray(x.photos) ? x.photos.filter((p: unknown) => typeof p === 'string') : []
    const thumbs = (x.thumbs ?? {}) as Record<string, string>
    props.push({
      id: d.id, name: String(x.name ?? 'Prop'), category: catLabel.get(x.categoryId ?? x.itemType) ?? '',
      tags: (Array.isArray(x.tags) ? x.tags : []).map((t: string) => tagLabel.get(t) ?? t).slice(0, 12),
      description: String(x.description ?? '').slice(0, 400), words: Array.isArray(x.searchWords) ? x.searchWords.join(', ').slice(0, 300) : '',
      quantity: Number(x.quantity ?? 1), missing: Number(x.missingQty ?? 0), damaged: x.condition === 'damaged',
      photo: photos[0] ? (thumbs[photos[0]] ?? photos[0]) : '', photos: photos.slice(0, 4), createdAt: String(x.createdAt ?? ''),
    })
  }
  closet = { at: Date.now(), props }
  return props
}
const short = (p: Prop) => ({ id: p.id, name: p.name, category: p.category, how_many: Math.max(0, p.quantity - p.missing), photo: p.photo || null })

// How many of each prop are free on a day (props are booked by the day; one shoot day each).
async function freeOn(day: string, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {}
  const settings = await loadSettings()
  const books = await db.getAll(...ids.map(id => db.doc(`item_bookings/${id}`)))
  const items = new Map((await loadCloset()).map(p => [p.id, p]))
  const today = todayInStudio(), out: Record<string, number> = {}
  ids.forEach((id, i) => {
    const p = items.get(id)
    if (!p) return
    out[id] = freeForRange({ quantity: p.quantity, missingQty: p.missing, legacyCheckedOut: false },
      (books[i].get('entries') ?? []) as BookingEntry[], day, day, today, settings.bufferDays, settings)
  })
  return out
}

function wordScore(p: Prop, words: string[]) {
  const hay = `${p.name} ${p.category} ${p.tags.join(' ')} ${p.description} ${p.words}`.toLowerCase()
  const name = p.name.toLowerCase()
  let score = 0
  for (const w of words) {
    const stem = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
    if (name.includes(stem)) score += 3
    else if (hay.includes(stem)) score += 1
    else return 0
  }
  return score
}

// Words first (names, tags, descriptions, hidden search words), then meaning ("president" → a Lincoln mask).
async function findProps(query: string, cat: string, limit: number, u: McpUser): Promise<{ found: Prop[]; byWords: Prop[] }> {
  const props = (await loadCloset()).filter(p => !cat || p.category.toLowerCase().includes(cat))
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1)
  const byWords = props.map(p => ({ p, score: wordScore(p, words) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.p)
  let similar: Prop[] = []
  if (query.length >= 3) {
    try {
      const r = await searchSimilar.run(asUser(u, { query })) as { results: { id: string; score: number }[] }
      const map = new Map(props.map(p => [p.id, p]))
      similar = r.results.filter(x => x.score >= 0.55).map(x => map.get(x.id)).filter((p): p is Prop => !!p && !byWords.includes(p))
    } catch { /* meaning search is a bonus; words still work */ }
  }
  return { found: [...byWords.slice(0, limit), ...similar].slice(0, limit), byWords }
}

// ─── The schedule as raw data ───────────────────────────────────────────────────────────────────────────────────────
function houseBookings(day: ScheduleDay | undefined, house: House, sch: ScheduleSettings, me: string, now: string) {
  return dayBookings(day, house, sch, now).map(b => {
    const e = b.entry, mine = e.email === me || (e.people ?? []).includes(me)
    return { start: hm(b.start), end: hm(b.end), who: e.email === me ? 'you' : firstName(e.name), with: (e.withNames ?? []).map(firstName), ...(mine && e.email !== me ? { you_are_collaborator: true } : {}),
      status: e.hold ? 'held' : e.pending ? (e.move ? 'move waiting for approval' : 'waiting for approval') : 'booked' }
  })
}

// ─── Tool definitions (shown to the assistant) ──────────────────────────────────────────────────────────────────────
const READ = { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
const WRITE = { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true }
const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const TOOLS = [
  { name: 'get_rules', title: 'Studio rules', annotations: READ,
    description: 'Read first. The live Prime Capitol rules (houses, booking hours, notice for props, priority days, approval, cancelling) and today\'s date in studio time (America/Toronto). Use these to reason about times and props yourself.',
    inputSchema: obj({}) },
  { name: 'whoami', title: 'Who am I', annotations: READ,
    description: 'The signed-in person: name, role and whether they can book (some creators can only browse props for now).',
    inputSchema: obj({}) },
  { name: 'search_props', title: 'Search the props closet', annotations: READ,
    description: 'Find props, costumes and set dressing in the company closet. Matches words in names, tags, descriptions and hidden search words, plus a meaning-based match (e.g. "president" finds a Lincoln mask). Give a `day` (YYYY-MM-DD) to get how many are free that day. Returns ids, names, how many, and a photo link. Then call show_props to show pictures.',
    inputSchema: obj({ query: { type: 'string', description: 'What to look for, e.g. "vintage phone" or "something for a seance"' },
      category: { type: 'string', description: 'Optional category name to narrow it, e.g. "Costumes"' },
      day: { type: 'string', description: 'Optional shoot day YYYY-MM-DD for availability' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20' } }, ['query']) },
  { name: 'props_for_idea', title: 'Check the closet for a video idea', annotations: READ,
    description: 'Use this proactively while the person is brainstorming or writing a video idea or script: as soon as scenes, characters or locations take shape, break the idea into concrete needs (props, costumes, set dressing per scene) and check what Prime Capitol already has for each. Returns the best matches per need (id, name, how many, photo, free on the day if given) and the needs with nothing in the closet (those can be asked for as custom props). Then offer to show_props, adjust the idea to what exists, or request them for a shoot. Props, costumes and set dressing only (no cameras, lights or batteries).',
    inputSchema: obj({ idea: { type: 'string', description: 'One line about the video' },
      needs: { type: 'array', maxItems: 15, items: obj({ need: { type: 'string', description: 'A concrete thing, e.g. "police uniform" or "old rotary phone"' }, scene: { type: 'string', description: 'Optional scene or character it is for' } }, ['need']) },
      day: { type: 'string', description: 'Optional shoot day YYYY-MM-DD for availability' } }, ['needs']) },
  { name: 'browse_props', title: 'List the whole closet', annotations: READ,
    description: 'The raw props list, page by page (names, categories, tags, how many; no photos), so you can scan it yourself for ideas. Optional category. 150 per page.',
    inputSchema: obj({ category: { type: 'string' }, page: { type: 'integer', minimum: 1, description: 'Page number, from 1' } }) },
  { name: 'list_categories', title: 'Prop categories', annotations: READ,
    description: 'Every prop category with how many props it has.', inputSchema: obj({}) },
  { name: 'show_props', title: 'Show props with photos', annotations: READ,
    description: 'Show up to 12 props as picture cards (photo, name, how many, free on the day if given). Use after search_props whenever the person wants to see them.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' }, maxItems: 12 }, day: { type: 'string', description: 'Optional YYYY-MM-DD for availability' } }, ['ids']) },
  { name: 'get_prop', title: 'One prop in detail', annotations: READ,
    description: 'Everything about one prop: all photos, description, tags, how many, and free count on a day.',
    inputSchema: obj({ id: { type: 'string' }, day: { type: 'string' } }, ['id']) },
  { name: 'get_schedule', title: 'The schedule, raw', annotations: READ,
    description: 'Who has each house when, day by day (up to 21 days): bookings with start/end, first names and collaborators (status booked / waiting for approval), blocked times, heads-ups, offsite shoots, priority days locked for this person, house opening hours, and the FREE stretches at each house (already worked out, from now on). Bookings are free-form: any start/end on the quarter hour (e.g. 13:15–15:15) inside a free stretch, at least 30 minutes, up to 2 h per person on the booking. Use your own judgement to suggest good times (e.g. next to a collaborator\'s shoot, the person\'s usual time of day), then book with book_shoot.',
    inputSchema: obj({ from: { type: 'string', description: 'YYYY-MM-DD, default today' }, days: { type: 'integer', minimum: 1, maximum: 21, description: 'Default 7' } }) },
  { name: 'list_people', title: 'People who film', annotations: READ,
    description: 'Names of everyone who films (to add collaborators). First names may repeat; use the email shown to pick the right one.',
    inputSchema: obj({ search: { type: 'string', description: 'Optional part of a name' } }) },
  { name: 'my_shoots', title: 'My shoots', annotations: READ,
    description: 'This person\'s upcoming and recent shoots, including ones a friend booked with them on it: id, place, day, hours, status (booked / waiting for approval / not approved), who booked it, collaborators, and props requests on each.',
    inputSchema: obj({}) },
  { name: 'my_props_requests', title: 'My props requests', annotations: READ,
    description: 'This person\'s props requests with status (requested, being prepared, packed & ready, picked up, returned) and items.',
    inputSchema: obj({}) },
  { name: 'book_shoot', title: 'Book a shoot', annotations: WRITE,
    description: 'Book time at Cliff 1 or Cliff 2 (or an offsite shoot). Confirm the details with the person first. A creator\'s booking is a REQUEST the schedule team approves; it holds the time meanwhile. Each person gets up to 2 hours; for longer, add one collaborator per extra 2 hours in `with` (names or emails; people not on the app can be added by name). Times are HH:MM (24 h).',
    inputSchema: obj({ place: { type: 'string', enum: ['cliff1', 'cliff2', 'offsite'] }, day: { type: 'string', description: 'YYYY-MM-DD' },
      start: { type: 'string', description: 'HH:MM' }, end: { type: 'string', description: 'HH:MM' },
      with: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Collaborators (names or emails), in the order they film' },
      where: { type: 'string', description: 'Offsite only: address or place' } }, ['place', 'day', 'start', 'end']) },
  { name: 'move_shoot', title: 'Move a shoot', annotations: WRITE,
    description: 'Move one of this person\'s shoots to another time (same rules as the app: notice period, approval). Confirm first.',
    inputSchema: obj({ shoot_id: { type: 'string' }, place: { type: 'string', enum: ['cliff1', 'cliff2', 'offsite'] }, day: { type: 'string' }, start: { type: 'string', description: 'HH:MM' },
      end: { type: 'string', description: 'Optional HH:MM; leave out to keep the same length' } }, ['shoot_id', 'day', 'start']) },
  { name: 'cancel_shoot', title: 'Cancel a shoot', annotations: DESTRUCTIVE,
    description: 'Cancel one of this person\'s shoots. If it\'s inside the notice period it counts as a no-show: the tool refuses and explains; only retry with accept_no_show true after the person clearly agrees. Always confirm first.',
    inputSchema: obj({ shoot_id: { type: 'string' }, accept_no_show: { type: 'boolean' } }, ['shoot_id']) },
  { name: 'request_props', title: 'Request props for a shoot', annotations: WRITE,
    description: 'Send a props request for one of this person\'s shoots (the arts department packs it). items = prop ids from search_props with how many; custom = things to make or find (no guaranteed date). If the shoot already has a request still waiting, the props are added to it. Confirm the list first.',
    inputSchema: obj({ shoot_id: { type: 'string' }, video_name: { type: 'string', description: 'Name of the video' },
      items: { type: 'array', items: obj({ id: { type: 'string' }, qty: { type: 'integer', minimum: 1 } }, ['id', 'qty']), maxItems: 60 },
      custom: { type: 'array', items: obj({ description: { type: 'string' }, qty: { type: 'integer', minimum: 1 } }, ['description']), maxItems: 10 },
      notes: { type: 'string' } }, ['shoot_id']) },
]
const BOOKING_TOOLS = new Set(['book_shoot', 'move_shoot', 'cancel_shoot', 'request_props', 'my_shoots', 'my_props_requests', 'get_schedule', 'list_people'])
export const toolsFor = (demo: boolean) => demo ? TOOLS.filter(t => !BOOKING_TOOLS.has(t.name)) : TOOLS

// ─── Running a tool ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function runTool(name: string, args: Json, u: McpUser): Promise<ToolResult> {
  const caller = await callerOf(u)
  const canBook = !caller.demo && (caller.role === 'creator' || caller.role === 'owner')
  if (BOOKING_TOOLS.has(name) && !canBook) {
    return { text: caller.demo ? 'Booking isn\'t open for you yet: for now you can search and look at props.' : 'Your role doesn\'t book shoots. Use the Prime Capitol app for team work.' }
  }
  switch (name) {
    case 'get_rules': {
      const [b, sch] = await Promise.all([loadSettings(), loadScheduleSettings()])
      const today = todayInStudio()
      return { text: `Today is ${today} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(today)]}), studio time America/Toronto. Houses: Cliff 1 = ${sch.houses.cliff1.address}, Cliff 2 = ${sch.houses.cliff2.address}. Rules: ${rulesText(b, sch)}`,
        structured: { today, houses: sch.houses, house_hours: { from: hm(houseOpen(sch)), until: hm(houseClose(sch)) }, booking_step_minutes: TIME_STEP, max_hours_per_person: sch.slotMinutes / 60, can_book_long_alone: isLongBooker(u.email, sch),
          props_notice_hours: b.leadTimeHours ?? 48, custom_props_notice_days: b.buildLeadDays ?? 4, priority_weekdays: sch.priorityWeekdays, closed_weekdays: b.closedWeekdays, closed_dates: b.closedDates } }
    }
    case 'whoami':
      return { text: `${caller.name} (${caller.email}), role ${caller.role}${caller.demo ? ', Props only for now (can search and look at props, not book)' : ''}.`, structured: { name: caller.name, role: caller.role, can_book: canBook } }

    case 'list_categories': {
      const counts = new Map<string, number>()
      for (const p of await loadCloset()) counts.set(p.category || 'Other', (counts.get(p.category || 'Other') ?? 0) + 1)
      const list = [...counts].sort((a, b) => b[1] - a[1]).map(([category, props]) => ({ category, props }))
      return { text: list.map(c => `${c.category}: ${c.props}`).join('\n'), structured: { categories: list } }
    }
    case 'browse_props': {
      const cat = s(args.category, 60).toLowerCase()
      const page = Number.isInteger(args.page) && (args.page as number) > 0 ? args.page as number : 1
      const all = (await loadCloset()).filter(p => !cat || p.category.toLowerCase().includes(cat)).sort((a, b) => a.name.localeCompare(b.name))
      const rows = all.slice((page - 1) * 150, page * 150)
      return { text: `${all.length} props${cat ? ` in "${args.category}"` : ''}, page ${page} of ${Math.max(1, Math.ceil(all.length / 150))}:\n` + rows.map(p => `${p.id} | ${p.name} | ${p.category} | ${p.tags.slice(0, 5).join(', ')} | x${Math.max(0, p.quantity - p.missing)}`).join('\n'),
        structured: { total: all.length, page, props: rows.map(p => ({ id: p.id, name: p.name, category: p.category, tags: p.tags, how_many: Math.max(0, p.quantity - p.missing) })) } }
    }
    case 'search_props': {
      const query = s(args.query, 200)
      if (query.length < 2) return { text: 'Say what you are looking for.' }
      const cat = s(args.category, 60).toLowerCase()
      const limit = Math.min(50, Number.isInteger(args.limit) ? args.limit as number : 20)
      const day = isDay(args.day) ? args.day as string : ''
      const { found, byWords } = await findProps(query, cat, limit, u)
      const free = day ? await freeOn(day, found.map(p => p.id)) : {}
      const rows = found.map(p => ({ ...short(p), tags: p.tags.slice(0, 6), description: p.description.slice(0, 160), ...(day ? { free_that_day: free[p.id] ?? 0 } : {}), damaged: p.damaged || undefined, match: byWords.includes(p) ? 'words' : 'similar meaning' }))
      return { text: rows.length ? rows.map(r => `${r.id} | ${r.name} | ${r.category} | x${r.how_many}${day ? ` | free ${r.free_that_day}` : ''} | ${r.match}`).join('\n') : `Nothing in the closet matches "${query}". Try other words, or ask for it as a custom prop.`,
        structured: { query, day: day || null, results: rows } }
    }
    case 'props_for_idea': {
      const needs = (Array.isArray(args.needs) ? args.needs : []).map(x => ({ need: s((x as Json).need, 120), scene: s((x as Json).scene, 80) })).filter(x => x.need.length >= 2).slice(0, 15)
      if (!needs.length) return { text: 'List the concrete things the idea needs (one per item), e.g. "police uniform", "old rotary phone".' }
      const day = isDay(args.day) ? args.day as string : ''
      const per = await Promise.all(needs.map(async n => ({ ...n, found: (await findProps(n.need, '', 4, u)).found })))
      const ids = [...new Set(per.flatMap(x => x.found.map(p => p.id)))]
      const free = day ? await freeOn(day, ids) : {}
      const groups = per.map(x => ({ scene: x.scene || undefined, need: x.need,
        matches: x.found.map(p => ({ ...short(p), ...(day ? { free_that_day: free[p.id] ?? 0 } : {}), damaged: p.damaged || undefined })) }))
      const missing = groups.filter(g => !g.matches.length).map(g => g.need)
      const top = per.flatMap(x => x.found.slice(0, 2)).filter((p, i, a) => a.findIndex(q => q.id === p.id) === i).slice(0, 12)
      const text = groups.map(g => `${g.scene ? `[${g.scene}] ` : ''}${g.need}: ${g.matches.length ? g.matches.map(m => `${m.name} (${m.id}, x${m.how_many}${day ? `, ${m.free_that_day} free` : ''})`).join('; ') : 'nothing in the closet (could be a custom prop)'}`).join('\n')
      return { text: `${text}\n\nOffer to show these with show_props, tweak the idea around what exists, or request them for one of their shoots.`,
        structured: { idea: s(args.idea, 300) || null, day: day || null, groups, missing, props: top.map(p => ({ ...short(p), ...(day ? { free_that_day: free[p.id] ?? 0 } : {}) })) },
        images: top.filter(p => p.photo).slice(0, 6).map(p => ({ url: p.photo, caption: p.name })), widget: true }
    }
    case 'show_props': {
      const ids = (Array.isArray(args.ids) ? args.ids : []).map(x => s(x, 128)).filter(Boolean).slice(0, 12)
      const day = isDay(args.day) ? args.day as string : ''
      const map = new Map((await loadCloset()).map(p => [p.id, p]))
      const list = ids.map(id => map.get(id)).filter((p): p is Prop => !!p)
      if (!list.length) return { text: 'None of those props were found. Search again to get their ids.' }
      const free = day ? await freeOn(day, list.map(p => p.id)) : {}
      const cards = list.map(p => ({ ...short(p), ...(day ? { free_that_day: free[p.id] ?? 0 } : {}) }))
      return { text: cards.map(c => `${c.name} (x${c.how_many}${day ? `, ${c.free_that_day} free ${day}` : ''})`).join('\n'),
        structured: { day: day || null, props: cards }, images: list.filter(p => p.photo).map(p => ({ url: p.photo, caption: p.name })), widget: true }
    }
    case 'get_prop': {
      const p = (await loadCloset()).find(x => x.id === s(args.id, 128))
      if (!p) return { text: 'That prop isn\'t in the closet (or was removed).' }
      const day = isDay(args.day) ? args.day as string : ''
      const free = day ? (await freeOn(day, [p.id]))[p.id] ?? 0 : undefined
      return { text: `${p.name} · ${p.category} · x${Math.max(0, p.quantity - p.missing)}${day ? ` · ${free} free on ${day}` : ''}${p.damaged ? ' · damaged' : ''}\n${p.description}\nTags: ${p.tags.join(', ')}`,
        structured: { ...short(p), description: p.description, tags: p.tags, photos: p.photos, damaged: p.damaged, ...(day ? { free_that_day: free } : {}) },
        images: p.photos.slice(0, 3).map(url => ({ url, caption: p.name })), widget: true }
    }

    case 'get_schedule': {
      const sch = await loadScheduleSettings()
      const b = await loadSettings()
      const from = isDay(args.from) && (args.from as string) >= todayInStudio() ? args.from as string : todayInStudio()
      const n = Math.min(21, Number.isInteger(args.days) ? args.days as number : 7)
      const dates = Array.from({ length: n }, (_, i) => addDays(from, i))
      const snaps = await db.getAll(...dates.map(d => db.doc(`schedule_days/${d}`)))
      const now = nowStamp()
      const days = dates.map((date, i) => {
        const day = snaps[i].data() as ScheduleDay | undefined
        return {
          date, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(date)],
          crew_off: isNoCrewDay(date) || undefined, studio_closed_for_props: !isOpen(date, b) || undefined,
          houses: Object.fromEntries(HOUSES.map(h => [h, {
            bookings: houseBookings(day, h, sch, u.email, now),
            free: priorityLocked(date, h, sch, u.email, now) ? [] : freeGaps(day, date, h, sch, now).map(g => ({ start: hm(g.start), end: hm(g.end), hours: (g.end - g.start) / 60 })),
            blocked: hardBlocks(day).filter(x => x.house === h).map(x => ({ start: hm(x.start), end: hm(x.end), why: x.note || x.type })),
            heads_ups: headsUps(day, h).map(x => ({ start: hm(x.start), end: hm(x.end), note: x.note || x.type })),
            priority_day_locked_for_you: priorityLocked(date, h, sch, u.email, now) || undefined,
            needs_guideline_pdf: (isPriorityDay(date, h, sch) && needsGuideline(date, h, u.email, sch)) || undefined,
          }])),
          offsite: (day?.offsite ?? []).map(o => ({ start: hm(o.start), end: hm(o.end), who: o.email === u.email ? 'you' : firstName(o.name) })),
        }
      })
      const lines = days.map(d => `${d.date} ${d.weekday}: ` + HOUSES.map(h => {
        const x = d.houses[h] as { bookings: Json[]; blocked: Json[]; free: Json[]; priority_day_locked_for_you?: boolean }
        return `${sch.houses[h].name} [${x.bookings.map(e => `${e.start}-${e.end} ${e.who}${(e.with as string[]).length ? `+${(e.with as string[]).join('+')}` : ''}${e.status !== 'booked' ? ` (${e.status})` : ''}`).join(', ') || 'nothing booked'}${x.blocked.length ? `; blocked ${x.blocked.map(e => `${e.start}-${e.end}`).join(', ')}` : ''}${x.priority_day_locked_for_you ? '; priority day, locked for you' : `; FREE ${x.free.map(e => `${e.start}-${e.end}`).join(', ') || 'none'}`}]`
      }).join(' · '))
      return { text: `House hours ${hm(houseOpen(sch))}–${hm(houseClose(sch))} (times past 24:00 are after midnight).\n` + lines.join('\n'),
        structured: { house_hours: { from: hm(houseOpen(sch)), until: hm(houseClose(sch)) }, step_minutes: TIME_STEP, min_minutes: MIN_BOOKING_MINUTES, max_hours_per_person: sch.slotMinutes / 60, days } }
    }
    case 'list_people': {
      const q = s(args.search, 60).toLowerCase()
      const people = (await filmingPeople({ includeDemo: true, offApp: true })).filter(p => p.email !== u.email && (!q || p.name.toLowerCase().includes(q)))
      return { text: people.slice(0, 40).map(p => `${p.name} <${p.email.startsWith('guest:') ? 'not on the app' : p.email}>`).join('\n') || 'Nobody by that name. You can still add them by name.',
        structured: { people: people.slice(0, 40).map(p => ({ name: p.name, email: p.email.startsWith('guest:') ? null : p.email })) } }
    }
    case 'my_shoots': {
      const since = addDays(todayInStudio(), -14)
      const [ownSnap, collab, withMe] = await Promise.all([
        db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', since).get(),
        db.collection('shoots').where('people', 'array-contains', u.email).get(),
        db.collection('reservations').where('creatorEmail', '==', u.email).get(),
      ])
      const own = { docs: [...ownSnap.docs, ...collab.docs.filter(d => String(d.get('date')) >= since && d.get('creatorEmail') !== u.email)] }
      const reqByShoot = new Map<string, Json[]>()
      for (const r of withMe.docs) {
        const sid = String(r.get('scheduleShootId') ?? r.get('shootId') ?? '')
        if (!sid || ['cancelled', 'declined'].includes(r.get('status'))) continue
        reqByShoot.set(sid, [...(reqByShoot.get(sid) ?? []), { id: r.id, title: r.get('title'), status: r.get('status') }])
      }
      const label = { booked: 'booked', requested: 'waiting for approval', denied: 'not approved', expired: 'ran out (not approved in time)', cancelled: 'cancelled' } as Record<string, string>
      const rows = own.docs.map(d => d.data()).map((x, i) => ({ id: own.docs[i].id, place: x.place, day: x.date, start: hm(x.start), end: hm(x.end), status: label[x.status] ?? x.status,
        booked_by: x.creatorEmail === u.email ? 'you' : firstName(x.creatorName), with: ((x.with ?? []) as { name: string }[]).map(w => firstName(w.name)),
        denied_reason: x.deniedReason || undefined, where: x.where || undefined, props_requests: reqByShoot.get(own.docs[i].id) ?? [] }))
        .filter(r => r.status !== 'cancelled').sort((a, b) => `${a.day}${a.start}`.localeCompare(`${b.day}${b.start}`))
      return { text: rows.length ? rows.map(r => `${r.id} | ${r.day} ${r.start}-${r.end} | ${r.place} | ${r.status}${r.props_requests.length ? ` | props: ${r.props_requests.map(p => p.status).join(', ')}` : ''}`).join('\n') : 'No shoots booked.', structured: { shoots: rows } }
    }
    case 'my_props_requests': {
      const snap = await db.collection('reservations').where('creatorEmail', '==', u.email).get()
      const label: Record<string, string> = { requested: 'requested', preparing: 'being prepared', packed: 'packed & ready to pick up', collected: 'picked up', return_pending: 'returned, being checked', returned: 'returned', cancelled: 'cancelled', declined: 'declined' }
      const rows = snap.docs.map(d => ({ id: d.id, video: d.get('title'), day: d.get('startDate'), status: label[d.get('status')] ?? d.get('status'),
        items: (d.get('lines') ?? []).map((l: Json) => `${l.itemName} x${l.qty}`) }))
        .filter(r => r.day >= addDays(todayInStudio(), -30)).sort((a, b) => String(a.day).localeCompare(String(b.day)))
      return { text: rows.map(r => `${r.id} | ${r.day} | "${r.video}" | ${r.status} | ${r.items.join(', ')}`).join('\n') || 'No props requests.', structured: { requests: rows } }
    }

    case 'book_shoot': return bookTool(args, u)
    case 'move_shoot': {
      const start = parseClock(args.start)
      if (start == null || !isDay(args.day)) return { text: 'Give the new day (YYYY-MM-DD) and start time (HH:MM).' }
      const sh = (await db.doc(`shoots/${s(args.shoot_id, 100)}`).get()).data()
      if (!sh || sh.creatorEmail !== u.email) return { text: (sh?.people ?? []).includes(u.email) ? `${firstName(sh!.creatorName)} booked that one; only they (or the schedule team) can move it.` : 'That isn\'t one of your shoots. Check my_shoots for the id.' }
      const endRaw = args.end != null ? parseClock(args.end) : null
      const end = endRaw == null ? undefined : endRaw <= start ? endRaw + 1440 : endRaw
      await moveShoot.run(asUser(u, { id: s(args.shoot_id, 100), place: args.place ?? sh.place, date: args.day, start, ...(end ? { end } : {}), where: sh.where ?? '' }))
      return { text: `Moved to ${args.day} at ${fmtTime(start)}${end ? `–${fmtTime(end % 1440)}` : ''}.${sh.status === 'requested' || sh.status === 'booked' ? ' The schedule team will approve the new time if needed.' : ''}` }
    }
    case 'cancel_shoot': {
      const id = s(args.shoot_id, 100)
      const sh = (await db.doc(`shoots/${id}`).get()).data()
      if (!sh || sh.creatorEmail !== u.email) return { text: 'That isn\'t one of your shoots. Check my_shoots for the id.' }
      try {
        await cancelShoot.run(asUser(u, { id, confirmNoShow: args.accept_no_show === true }))
        return { text: `Cancelled your ${sh.date} shoot.` }
      } catch (e) {
        const err = e as HttpsError
        if ((err.details as Json | undefined)?.problem === 'no-show' || /no-show/i.test(err.message)) return { text: `${err.message} Only cancel with accept_no_show: true if they clearly agree it counts as a no-show.` }
        throw e
      }
    }
    case 'request_props': return propsTool(args, u)
  }
  throw new HttpsError('not-found', `Unknown tool ${name}`)
}

// Book: free-form times are checked by the same server code the app uses.
async function bookTool(args: Json, u: McpUser): Promise<ToolResult> {
  const sch = await loadScheduleSettings()
  const place = s(args.place, 10), day = s(args.day, 10)
  const start = parseClock(args.start), end = parseClock(args.end)
  if (!['cliff1', 'cliff2', 'offsite'].includes(place) || !isDay(day) || start == null || end == null) return { text: 'Give the place (cliff1, cliff2 or offsite), the day (YYYY-MM-DD) and start/end (HH:MM).' }
  const realEnd = end <= start ? end + 1440 : end
  const names = (Array.isArray(args.with) ? args.with : []).map(x => s(x, 120)).filter(Boolean).slice(0, 4)
  // Collaborators: an email, a name of someone who films, or a name of someone not on the app yet.
  const people = await filmingPeople({ includeDemo: true, offApp: true })
  const friends: string[] = []
  for (const n of names) {
    if (n.includes('@')) { friends.push(n.toLowerCase()); continue }
    const hits = people.filter(p => p.email !== u.email && (p.name.toLowerCase() === n.toLowerCase() || firstName(p.name).toLowerCase() === n.toLowerCase()))
    if (hits.length > 1) return { text: `More than one person is called ${n}: ${hits.map(h => `${h.name} <${h.email}>`).join(', ')}. Ask which one and pass their email.` }
    friends.push(hits[0]?.email ?? `guest:${n}`)
  }
  let res: Json
  if (place === 'offsite') {
    const where = s(args.where, 200)
    if (!where) return { text: 'Where is the offsite shoot? Pass `where`.' }
    res = await bookShoot.run(asUser(u, { place, date: day, start, end: realEnd, where })) as Json
  } else {
    // Free time (Nov 24): any start/end on the quarter hour; 2 h per person on ONE booking listing everyone.
    if (start % TIME_STEP || realEnd % TIME_STEP) return { text: `Times go in ${TIME_STEP}-minute steps (e.g. 13:15, 13:30).` }
    if (realEnd - start < MIN_BOOKING_MINUTES) return { text: `A booking is at least ${MIN_BOOKING_MINUTES} minutes.` }
    const max = maxMinutesFor(1 + friends.length, sch)
    if (realEnd - start > max && !isLongBooker(u.email, sch)) {
      const need = Math.ceil((realEnd - start) / sch.slotMinutes) - 1 - friends.length
      return { text: `That's ${(realEnd - start) / 60} hours: each person on a booking gets up to ${sch.slotMinutes / 60} hours, so add ${need} more collaborator${need === 1 ? '' : 's'} in \`with\` (who films with them?), or shorten it to end by ${hm(start + max)}.` }
    }
    res = await bookShoot.run(asUser(u, { place, date: day, start, end: realEnd, ...(friends.length ? { with: friends } : {}) })) as Json
  }
  const requested = JSON.stringify(res).includes('"requested"') || res?.pending === true
  return { text: `${requested ? 'Requested' : 'Booked'}: ${place === 'offsite' ? 'offsite' : sch.houses[place as House].name}, ${day} ${hm(start)}–${hm(realEnd)}${friends.length ? ` with ${names.join(', ')}` : ''}.${requested ? ' The schedule team approves it; the time is held for them meanwhile.' : ''}`, structured: { result: res } }
}

async function propsTool(args: Json, u: McpUser): Promise<ToolResult> {
  const id = s(args.shoot_id, 100)
  const sh = (await db.doc(`shoots/${id}`).get()).data()
  if (!sh || sh.creatorEmail !== u.email || !['booked', 'requested'].includes(sh.status)) return { text: 'Pick one of your upcoming shoots (my_shoots) to add props to.' }
  const lines = (Array.isArray(args.items) ? args.items : []).map(x => ({ itemId: s((x as Json).id, 128), qty: Number((x as Json).qty) || 1 })).filter(l => l.itemId)
  const builds = (Array.isArray(args.custom) ? args.custom : []).map(x => ({ description: s((x as Json).description, 200), qty: Number((x as Json).qty) || 1 })).filter(b => b.description)
  if (!lines.length && !builds.length) return { text: 'Add at least one prop (ids from search_props) or a custom prop.' }
  // A request still waiting on this shoot gets the new props added; otherwise a new request.
  const open = (await db.collection('reservations').where('creatorEmail', '==', u.email).where('scheduleShootId', '==', id).get()).docs.find(d => d.get('status') === 'requested')
  if (open) {
    const old = (open.get('lines') ?? []) as { itemId: string; qty: number }[]
    const merged = new Map(old.map(l => [l.itemId, l.qty]))
    for (const l of lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty)
    await editReservation.run(asUser(u, { id: open.id, lines: [...merged].map(([itemId, qty]) => ({ itemId, qty })),
      builds: [...((open.get('builds') ?? []) as Json[]), ...builds] }))
    return { text: `Added to your request "${open.get('title')}" for ${sh.date}. The arts department will see it.` }
  }
  const title = s(args.video_name, 120) || s(sh.title, 120) || 'Video'
  const r = await createReservation.run(asUser(u, { startDate: sh.date, endDate: sh.date, scheduleShootId: id, title, notes: s(args.notes, 500), lines, builds })) as Json
  return { text: `Sent: props request "${title}" for your ${sh.date} shoot (${lines.length} prop${lines.length === 1 ? '' : 's'}${builds.length ? `, ${builds.length} custom` : ''}). The arts department packs it; you'll get a notification when it's ready.${builds.length ? ' Custom props have no guaranteed date: sort details with the arts department on Slack.' : ''}`, structured: { result: r } }
}

export const OWNER = OWNER_EMAIL
