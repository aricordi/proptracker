// How creators actually talk (owner, Nov 24: "they're going to be speaking extremely casually… the app needs to decipher what they
// want"). Pure helpers, unit-tested (tests/unit/casual.test.ts), used in front of EVERY connector tool so the assistant can pass
// the person's own words instead of exact ids and formats:
//   places "c2", "cliff two", "house 2", "2371", "on location" · times "5", "5ish", "noon", "half past 5", "5:30pm" ·
//   shoots "my saturday shoot", "the one with kyle", "next one" · props requests "the ring ring one" · props "the red phone" ·
//   invites / swaps / waitlist spots "jordan's invite", "sam's swap".
// Anything that could mean two things comes back as `many` with the options, so the assistant asks instead of guessing.
import { resolveWhen } from './understand.js'

export type House = 'cliff1' | 'cliff2'
export type Place = House | 'offsite'
const plain = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

/** "c2", "Cliff two", "house 2", "2371", "second house", "maison 1" → cliff2 / cliff1; "offsite", "on location" → offsite. */
export function normPlace(v: unknown): Place | null {
  const t = plain(String(v ?? ''))
  if (!t) return null
  if (/^(cliff ?1|cliff1)$/.test(t)) return 'cliff1'
  if (/^(cliff ?2|cliff2)$/.test(t)) return 'cliff2'
  if (/\b(off ?-?site|on location|outside|somewhere else|elsewhere|location shoot|out of house|not at (a|the) house)\b/.test(t)) return 'offsite'
  const two = /\b(c ?2|cliff ?(2|two|ii)|house ?(2|two)|second house|2nd house|2371|maison ?(2|deux)|the other house)\b/.test(t)
  const one = /\b(c ?1|cliff ?(1|one|i)|house ?(1|one)|first house|1st house|2375|maison ?(1|un|une)|main house)\b/.test(t)
  if (two && !one) return 'cliff2'
  if (one && !two) return 'cliff1'
  return null
}
/** A list of houses from words ("either", "any", "both" = both). */
export function normHouses(v: unknown): House[] | null {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/,|\bor\b|\band\b|\//) : []
  const t = plain(list.join(' '))
  if (!t || /\b(either|any|both|whichever|doesn'?t matter|dont care)\b/.test(t)) return null
  const out = new Set<House>()
  for (const x of list) { const p = normPlace(x); if (p && p !== 'offsite') out.add(p) }
  return out.size ? [...out] : null
}

// ─── Times ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One clock time as said. `explicit` = am/pm, a leading zero or a 24-hour hour (13+), so no guessing is needed. */
export function parseLooseClock(v: unknown): { m: number; explicit: boolean } | null {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return null
    if (v <= 25) return { m: v * 60, explicit: v >= 13 || v === 0 }
    const h = Math.floor(v / 100), mm = v % 100
    return v >= 100 && mm <= 59 && h <= 25 ? { m: h * 60 + mm, explicit: h >= 13 || h === 0 } : null
  }
  let t = plain(String(v ?? '')).replace(/\b(at|around|about|ish|o'?clock|oclock|-ish|like|maybe|roughly|approx)\b/g, ' ').replace(/ish\b/g, '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^(noon|midday|12 ?noon|lunch(time)?)$/.test(t)) return { m: 720, explicit: true }
  if (/^midnight$/.test(t)) return { m: 1440, explicit: true }
  let off = 0
  const rel = /^(half|quarter) (past|after|to|before) (\d{1,2})(.*)$/.exec(t)
  if (rel) { off = rel[1] === 'half' ? 30 : (rel[2] === 'to' || rel[2] === 'before' ? -15 : 15); t = `${rel[3]}${rel[4]}`.trim() }
  t = t.replace(/\s+/g, '').replace(/\./g, '').replace(/h(?=\d|$)/, ':')
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] ?? 0)
  if (min > 59 || h > 25) return null
  const ap = m[3]?.[0]
  if (ap === 'p' && h < 12) h += 12
  if (ap === 'a' && h === 12) h = 0
  const explicit = !!ap || h >= 13 || /^0\d/.test(m[1]) || h === 0
  return { m: h * 60 + min + off, explicit }
}
/** Start and end as people say them. A bare 1–6 is the afternoon/evening (houses open in the morning; "5" = 5 PM); a bare 7–11 is
 *  the morning. The end is the first reading after the start (within 18 h), so "11 to 1" = 11 PM–1 AM after an evening start. */
export function clockPair(startRaw: unknown, endRaw: unknown): { start: number | null; end: number | null } {
  const s = parseLooseClock(startRaw)
  let start: number | null = null
  if (s) start = s.explicit ? s.m : (s.m >= 60 && s.m < 7 * 60 ? s.m + 720 : s.m)
  const e = parseLooseClock(endRaw)
  if (!e || start == null) return { start, end: e ? e.m : null }
  const cands = e.explicit ? [e.m, e.m + 1440] : [e.m, e.m + 720, e.m + 1440, e.m + 2160]
  const end = cands.find(c => c > start! && c - start! <= 18 * 60) ?? null
  return { start, end }
}
/** "2 hours", "an hour and a half", "90 min", "2h30" → minutes (null if no length said). */
export function parseLength(v: unknown): number | null {
  if (typeof v === 'number' && v > 0) return Math.round(v * 60)
  const t = plain(String(v ?? ''))
  if (!t) return null
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2 }
  let m = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|couple)(?: of)? ?(?:hours|hour|hrs|hr|h)(?![a-z])(?: ?(?:and )?(?:a half|(\d{1,2}) ?(?:m|min|mins|minutes)?))?/.exec(t)
  if (m) {
    const base = words[m[1]] ?? Number(m[1])
    return Math.round(base * 60 + (/a half/.test(m[0]) ? 30 : Number(m[2] ?? 0)))
  }
  m = /(\d+) ?(?:m|min|mins|minutes)\b/.exec(t)
  if (m) return Number(m[1])
  m = /\b(half an hour|half hour)\b/.exec(t)
  return m ? 30 : null
}

// ─── Things the person has (shoots, requests, invites…) referred to casually ─────────────────────────────────────────
export interface ShootRef { id: string; place: string; date: string; start: number; end: number; status: string; with: string[]; titles: string[]; host?: string }
export interface RefMatch<T> { status: 'one' | 'many' | 'none'; hits: T[] }
const WORDS_IGNORED = new Set(['my', 'the', 'a', 'an', 'one', 'shoot', 'shoots', 'booking', 'bookings', 'that', 'this', 'for', 'on', 'at', 'with', 'in', 'of',
  'props', 'prop', 'request', 'requests', 'video', 'thing', 'stuff', 'please', 'pls', 'plz', 'it', 'our', 'we', 'i', 'me', 'to', 'and', 'from', 'cancel', 'move',
  'change', 'invite', 'swap', 'time', 'slot', 'is', 'was', 'about', 'like', 'just', 'which', 'next', 'upcoming', 'coming', 'up', 'soonest', 'first', 'last', 'latest',
  'second', '2nd', 'third', '3rd', 'today', 'tonight', 'tomorrow', 'tmrw', 'house', 'cliff', 'offsite', 'pm', 'am'])
const tokens = (t: string) => plain(t).replace(/[^a-z0-9' ]/g, ' ').split(' ').filter(w => w.length > 1 && !WORDS_IGNORED.has(w))
const ordinal = (t: string) => /\b(second|2nd)\b/.test(t) ? 1 : /\b(third|3rd)\b/.test(t) ? 2 : /\b(first|1st|next|soonest|upcoming|coming up)\b/.test(t) ? 0 : null

/** "saturday", "my next shoot", "the cliff 2 one", "the one with kyle", "ring ring", "5pm one", "last one" → which shoot.
 *  An exact id always wins. Words that pick nothing are ignored only when something else already narrowed it down. */
export function resolveShootRef(said: unknown, shoots: ShootRef[], today: string): RefMatch<ShootRef> {
  const raw = String(said ?? '').trim()
  if (!raw) return { status: shoots.length === 1 ? 'one' : shoots.length ? 'many' : 'none', hits: shoots.slice(0, 6) }
  const exact = shoots.find(x => x.id === raw)
  if (exact) return { status: 'one', hits: [exact] }
  const t = plain(raw)
  const past = /\b(last|latest|previous|yesterday|earlier|ago|already)\b/.test(t) && !/\blast (one|time)\b.*\bnext\b/.test(t)
  let list = shoots.filter(x => past ? x.date < today || x.date === today : x.date >= today)
    .sort((a, b) => past ? `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`) : `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
  if (!list.length) list = [...shoots].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
  let narrowed = false
  const when = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? { days: [raw] } : resolveWhen(t, today)
  // A day was named and no shoot is on it: say so (the assistant lists what they do have) instead of picking another day.
  if (when) { const d = list.filter(x => when.days.includes(x.date)); if (!d.length) return { status: 'none', hits: list.slice(0, 6) }; list = d; narrowed = true }
  const place = normPlace(t)
  if (place) { const p = list.filter(x => x.place === place); if (p.length) { list = p; narrowed = true } }
  const clockM = /\b(\d{1,2}(?::\d{2})? ?(?:am|pm|a|p)?)\b(?: (?:one|shoot))?/.exec(t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ''))
  if (clockM && !when?.days.length) {
    const c = clockPair(clockM[1], null).start
    if (c != null) { const s = list.filter(x => x.start === c || x.start === c + 1440); if (s.length) { list = s; narrowed = true } }
  }
  const words = tokens(t)
  if (words.length) {
    const scored = list.map(x => ({ x, n: words.filter(w => [...x.with, ...x.titles, x.host ?? ''].some(v => plain(v).split(/\s+/).some(p => p.startsWith(w) || w.startsWith(p) && p.length > 2))).length }))
    const best = Math.max(0, ...scored.map(s => s.n))
    if (best > 0) { list = scored.filter(s => s.n === best).map(s => s.x); narrowed = true }
  }
  const ord = ordinal(t)
  if (past && list.length && !narrowed) return { status: 'one', hits: [list[0]] }   // "last one" = the most recent
  if (ord != null && list.length > ord && (list.length > 1)) return { status: 'one', hits: [list[ord]] }
  if (list.length === 1 && (narrowed || ord != null)) return { status: 'one', hits: list }
  if (list.length === 1 && shoots.filter(x => x.date >= today).length === 1) return { status: 'one', hits: list }
  return { status: list.length ? 'many' : 'none', hits: list.slice(0, 6) }
}

export interface RequestRef { id: string; date: string; title: string; status: string; items: string[] }
/** "the ring ring one", "my friday props", "the one with the phone", "the packed one", "next" → which props request. */
export function resolveRequestRef(said: unknown, reqs: RequestRef[], today: string): RefMatch<RequestRef> {
  const raw = String(said ?? '').trim()
  const live = reqs.filter(r => !['cancelled', 'declined', 'returned'].includes(r.status))
  if (!raw) return { status: live.length === 1 ? 'one' : live.length ? 'many' : 'none', hits: live.slice(0, 6) }
  const exact = reqs.find(r => r.id === raw)
  if (exact) return { status: 'one', hits: [exact] }
  const t = plain(raw)
  let list = live.length ? live : reqs
  let narrowed = false
  const when = resolveWhen(t, today)
  if (when) { const d = list.filter(r => when.days.includes(r.date)); if (d.length) { list = d; narrowed = true } }
  const st: [RegExp, string[]][] = [[/\bpacked|ready\b/, ['packed']], [/\bpicked up|collected|have it|out\b/, ['collected']], [/\bwaiting|requested|pending\b/, ['requested']], [/\bpreparing|being (picked|packed)\b/, ['preparing']]]
  for (const [re, sts] of st) if (re.test(t)) { const s = list.filter(r => sts.includes(r.status)); if (s.length) { list = s; narrowed = true } }
  const words = tokens(t)
  if (words.length) {
    const scored = list.map(r => ({ r, n: words.filter(w => [r.title, ...r.items].some(v => plain(v).replace(/ x\d+$/, '').split(/\s+/).some(p => p.startsWith(w) || (w.startsWith(p) && p.length > 2)))).length }))
    const best = Math.max(0, ...scored.map(s => s.n))
    if (best > 0) { list = scored.filter(s => s.n === best).map(s => s.r); narrowed = true }
  }
  list = [...list].sort((a, b) => a.date.localeCompare(b.date))
  const ord = ordinal(t)
  if (ord != null && list.length > ord) return { status: 'one', hits: [list.filter(r => r.date >= today)[ord] ?? list[ord]] }
  if (list.length === 1 && (narrowed || live.length === 1)) return { status: 'one', hits: list }
  return { status: list.length ? 'many' : 'none', hits: list.slice(0, 6) }
}

export interface Named { id: string; who: string; date?: string }
/** An invite, swap or waitlist spot by the other person's name or the day ("jordan's", "the one on friday"). */
export function resolveNamedRef<T extends Named>(said: unknown, items: T[], today: string): RefMatch<T> {
  const raw = String(said ?? '').trim()
  if (!raw) return { status: items.length === 1 ? 'one' : items.length ? 'many' : 'none', hits: items.slice(0, 6) }
  const exact = items.find(x => x.id === raw)
  if (exact) return { status: 'one', hits: [exact] }
  const t = plain(raw).replace(/'s\b/g, '')
  let list = items
  const when = resolveWhen(t, today)
  if (when) { const d = list.filter(x => x.date && when.days.includes(x.date)); if (d.length) list = d }
  const words = tokens(t)
  if (words.length) { const w = list.filter(x => words.some(v => plain(x.who).split(/\s+/).some(p => p.startsWith(v) || v.startsWith(p)))); if (w.length) list = w }
  if (list.length === 1) return { status: 'one', hits: list }
  return { status: list.length ? 'many' : 'none', hits: list.slice(0, 6) }
}

// ─── Props by name ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface PropLite { id: string; name: string; tags?: string[]; category?: string }
const singular = (w: string) => w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /(ches|shes|xes|ses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
const propWords = (v: string) => plain(v).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 1 && !['the', 'a', 'an', 'of', 'with', 'and', 'some', 'that', 'those', 'these', 'one', 'ones'].includes(w)).map(singular)
/** "the red phone", "rotary phones", "2 cop hats" (count dropped) → a prop. Exact id/name wins; else every word must appear in the
 *  name (or tags); several with different names = `many` (the assistant asks or shows them). */
export function resolvePropRef<T extends PropLite>(said: unknown, props: T[]): RefMatch<T> {
  const raw = String(said ?? '').trim().slice(0, 120)
  if (!raw) return { status: 'none', hits: [] }
  const byId = props.find(p => p.id === raw)
  if (byId) return { status: 'one', hits: [byId] }
  const t = plain(raw).replace(/^(\d+|a|an|one|two|three|four|five|a couple of|a few|some) (x )?/, '').replace(/ x ?\d+$/, '')
  const exact = props.filter(p => plain(p.name) === t || singular(plain(p.name)) === singular(t))
  if (exact.length === 1) return { status: 'one', hits: exact }
  if (exact.length > 1) return { status: 'many', hits: exact.slice(0, 6) }
  const want = propWords(t)
  if (!want.length) return { status: 'none', hits: [] }
  const inName = props.filter(p => { const n = propWords(p.name); return want.every(w => n.some(x => x === w || x.startsWith(w) || w.startsWith(x) && x.length > 3)) })
  const pool = inName.length ? inName : props.filter(p => { const n = [...propWords(p.name), ...(p.tags ?? []).flatMap(propWords)]; return want.every(w => n.some(x => x === w || x.startsWith(w))) })
  if (pool.length === 1) return { status: 'one', hits: pool }
  const names = new Set(pool.map(p => plain(p.name)))
  if (pool.length > 1 && names.size === 1) return { status: 'one', hits: [pool[0]] }
  return { status: pool.length ? 'many' : 'none', hits: pool.slice(0, 6) }
}
/** "2 rotary phones" / "a couple of cop hats" / "phone x3" → how many (default 1). */
export function qtyFrom(said: unknown): number | null {
  const t = plain(String(said ?? ''))
  const m = /^(\d+)\b|\bx ?(\d+)$/.exec(t)
  if (m) return Math.min(99, Number(m[1] ?? m[2]))
  const w: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, 'a couple of': 2, 'a pair of': 2, 'a few': 3 }
  for (const [k, n] of Object.entries(w).sort((a, b) => b[0].length - a[0].length)) if (t.startsWith(`${k} `)) return n
  return null
}

// ─── Guiding them from what we know (owner, Nov 24: "maybe guide them based on what we know") ────────────────────────
export interface Situation {
  next?: { day: string; label: string; status: string; hasProps: boolean; propsOpen: boolean; propsDeadline: string; withPeople: number } | null
  upcoming: number; invites: string[]; swaps: string[]; toPickUp?: { what: string; day: string }[]; toConfirm?: string[]; rebook?: string[]; friends?: string[]; toReturn: { what: string; due: string }[]; gearOut: { what: string; due: string }[]
  waitlistOffered: number; pausedUntil?: string | null; today: string
}
/** The few things worth doing next, most urgent first, in plain words (the assistant offers them; it never acts on its own). */
export function suggestNext(x: Situation): { do: string; why: string; tool?: string }[] {
  const out: { do: string; why: string; tool?: string }[] = []
  const soon = (stamp: string) => stamp.slice(0, 10) <= x.today
  for (const r of x.rebook ?? []) out.push({ do: `Their ${r.split(' (')[0]} booking didn't go through`, why: `${r.slice(r.indexOf('(') + 1, -1)}; explain kindly and offer other times (plan_shoot / find_free_times)`, tool: 'plan_shoot' })
  for (const c of x.toConfirm ?? []) out.push({ do: `Ask how the ${c} shoot went`, why: 'did they film? one word is enough; it tells the team they showed up', tool: 'shoot_done' })
  for (const r of x.toReturn) out.push({ do: `Bring back "${r.what}"`, why: `due ${r.due}${soon(r.due) ? ' (today or late: late returns can mean a strike)' : ''}; at drop-off take one photo of everything and return it here or in the app`, tool: 'return_props' })
  for (const r of x.toPickUp ?? []) out.push({ do: `Pick up "${r.what}"`, why: `packed & ready for ${r.day}; at the pick-up spot check the bag and sign for it here or in the app`, tool: 'pick_up_props' })
  for (const g of x.gearOut) out.push({ do: `Return the gear (${g.what})`, why: `due ${g.due}; one photo of everything in the case with batteries charging, here or in the app`, tool: 'return_gear' })
  if (x.waitlistOffered) out.push({ do: 'A time they waited for opened up', why: 'it is held for them for 20 minutes: book it in the app', tool: 'app_link' })
  for (const w of x.invites) out.push({ do: `Answer ${w}'s video invite`, why: 'they are waiting for a yes or no', tool: 'answer_video_invite' })
  for (const w of x.swaps) out.push({ do: `Answer ${w}'s swap request`, why: 'they asked to trade times', tool: 'answer_swap' })
  if (x.next) {
    if (x.next.status === 'requested') out.push({ do: `Their ${x.next.label} booking is waiting for approval`, why: 'the schedule team approves it; nothing to do but they can add props meanwhile' })
    if (!x.next.hasProps && x.next.propsOpen) out.push({ do: `Props for the ${x.next.label} shoot?`, why: `nothing requested yet; closet props close ${x.next.propsDeadline}`, tool: 'props_for_idea' })
    if (!x.next.hasProps && !x.next.propsOpen) out.push({ do: `The props deadline for ${x.next.label} has passed`, why: 'they can still ask the arts department directly on Slack' })
  } else if (!x.upcoming) out.push({ do: 'Book a shoot?', why: 'nothing is booked; say who they film with and when', tool: 'plan_shoot' })
  if (x.friends?.length && (!x.next || x.upcoming < 2)) out.push({ do: x.friends[0], why: 'they could film right next to a friend; only suggest it, never book without a yes', tool: 'book_shoot' })
  if (x.pausedUntil) out.push({ do: `Props requests are paused until ${x.pausedUntil}`, why: 'because of strikes; filming time can still be booked' })
  return out.slice(0, 5)
}
