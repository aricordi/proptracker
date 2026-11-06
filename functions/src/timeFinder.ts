// "Ask for a time": turn a request into a search, then find real open slots on the schedule.
// Pure functions (no database), shared by the server and the tests. The AI only fills in a
// TimeAsk; the slots themselves always come from findOptions, so a time is never invented.
import { addDays, weekday, isDay } from './booking.js'
import { stamp, addMinutes } from './gearBooking.js'
import { slotState, slotKey, houseSlotsOn, type ScheduleDay, type ScheduleSettings, type House } from './schedule.js'

export type TimeOfDay = 'any' | 'morning' | 'afternoon' | 'evening' | 'night' | 'late'   // night = 'tonight' (5 PM on)
export interface TimeAsk {
  from: string; to: string           // days to look at ('YYYY-MM-DD')
  people: string[]                   // friends filming right after you (names, as in the people list)
  mySlots: number                    // your own 2-hour slots in a row (1–3); always worked out by slotsFor()
  hours?: number                     // what they asked for IN TOTAL ("4 hours with Ariel" = 4 for the whole block)
  myHours?: number                   // only when they said their OWN length ("I need 4 hours, Kyle 2")
  houses: House[]
  timeOfDay: TimeOfDay
  at?: number                        // a start time they asked for ("at 5pm" = 1020); closest free times first (chat, Nov 2)
}
export interface Person { email: string; name: string }
export interface TimeOption {
  date: string; place: House; start: number
  slots: { email: string; name: string; start: number; me: boolean }[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
export const MAX_SPAN_DAYS = 21

const inTime = (start: number, t: TimeOfDay) =>
  t === 'any' || (t === 'morning' ? start < 720 : t === 'afternoon' ? start >= 720 && start < 1020 : t === 'evening' ? start >= 1020 && start < 1260 : t === 'night' ? start >= 1020 : start >= 1260)

// How people actually type (chat QA, Nov 6): "tmrw", "thurs", "@ 7", "c2", "cliff two", "tonite". Turned into plain words first.
const WD_ABBR: [RegExp, string][] = [[/\bmon\b/g, 'monday'], [/\btues?\b/g, 'tuesday'], [/\bweds?\b/g, 'wednesday'], [/\bthu(rs?)?\b/g, 'thursday'],
  [/\bfri\b/g, 'friday'], [/\bsat\b/g, 'saturday'], [/\bsun\b/g, 'sunday']]
export function normalizeWhen(text: string): string {
  let t = ` ${text.toLowerCase()} `
    .replace(/\b(tmrw|tmrow|tmr|tmw|tmro|tmmrw|2moro|2morrow|2mrw|2mro|tomoro|tomorow|tommorow|tommorrow|tomorrw|tmorrow)\b/g, 'tomorrow')
    .replace(/\b(tonite|2nite|tnite|tonigh)\b/g, 'tonight')
    .replace(/\btdy\b/g, 'today')
    // French (Montréal creators, chat QA Nov 6: "je veux filmer samedi à 17h"): days, today/tomorrow/tonight, "17h30".
    .replace(/\bapr[eè]s[- ]demain\b/g, 'in 2 days')
    .replace(/\bdemain\b/g, 'tomorrow').replace(/\baujourd'?hui\b/g, 'today').replace(/\bce soir\b/g, 'tonight')
    .replace(/\blundi\b/g, 'monday').replace(/\bmardi\b/g, 'tuesday').replace(/\bmercredi\b/g, 'wednesday').replace(/\bjeudi\b/g, 'thursday')
    .replace(/\bvendredi\b/g, 'friday').replace(/\bsamedi\b/g, 'saturday').replace(/\bdimanche\b/g, 'sunday')
    .replace(/\bmaison\s*(1|un|une)\b/g, 'cliff 1').replace(/\bmaison\s*(2|deux)\b/g, 'cliff 2')
    .replace(/(^|[\s(])(\d{1,2})\s?h\s?(\d{2})\b/g, '$1$2:$3')
    .replace(/(^|[\s(])(\d{1,2})\s?h\b/g, (_m, a, h) => `${a}${Number(h) > 12 ? `${Number(h) - 12}pm` : Number(h) === 12 ? '12pm' : `${h}`}`)
    .replace(/(\s)[àa](\s+\d)/g, '$1at$2')
    .replace(/@\s*(\d)/g, ' at $1')
    .replace(/\b(c|cliff|house)\s*(1|one)\b|\bfirst house\b/g, 'cliff 1')
    .replace(/\b(c|cliff|house)\s*(2|two)\b|\bsecond house\b/g, 'cliff 2')
  for (const [re, w] of WD_ABBR) t = t.replace(re, w)
  return t.replace(/\s+/g, ' ')
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()   // m = 1..12
/** A date the person named ("nov 14", "14 november", "the 14th", "11/14", "14/11"), the next time it comes round.
 *  'bad' = a date that doesn't exist (the 31st of a 30-day month, Feb 30); null = none named. */
export function namedDate(text: string, today: string): string | 'bad' | null {
  const t = normalizeWhen(text)
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)), d0 = Number(today.slice(8, 10))
  const make = (mon: number | null, day: number): string | 'bad' => {
    if (!(day >= 1 && day <= 31)) return 'bad'
    if (mon) {
      let yr = y
      if (mon < m0 || (mon === m0 && day < d0)) yr++
      if (day > daysIn(yr, mon)) return 'bad'
      return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    // Just a day of the month: this month if it hasn't passed, else the next month that has that day
    // ("the 31st" said in November = December 31).
    let yr = y, mon2 = m0
    if (day < d0) { mon2++; if (mon2 > 12) { mon2 = 1; yr++ } }
    if (day > daysIn(yr, mon2)) { mon2++; if (mon2 > 12) { mon2 = 1; yr++ } }
    if (day > daysIn(yr, mon2)) return 'bad'
    return `${yr}-${String(mon2).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const mi = (w: string) => MONTH_NAMES.indexOf(w.slice(0, 3)) + 1
  let r = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(st|nd|rd|th)?\b/)
  if (r && !/\b(\d{1,2})\s*(h|hrs?|hours?)\b/.test(`${r[2]}${t.slice(t.indexOf(r[0]) + r[0].length, t.indexOf(r[0]) + r[0].length + 6)}`)) return make(mi(r[1]), Number(r[2]))
  r = t.match(/\b(\d{1,2})(st|nd|rd|th)? (of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/)
  if (r) return make(mi(r[4]), Number(r[1]))
  r = t.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (r) {
    const a = Number(r[1]), b = Number(r[2])
    // 14/11 = day/month; 11/14 = month/day; 11/12 = month/day (how phones in North America write it).
    return a > 12 ? make(b, a) : make(a, b)
  }
  r = t.match(/\b(the )?(\d{1,2})(st|nd|rd|th)\b/)
  if (r) return make(null, Number(r[2]))
  return null
}

// Match a name the creator said to a person ("Kyle" or "Kyle Smith"); unique first names only.
export function matchPeople(names: string[], people: Person[], me: string): Person[] {
  const out: Person[] = []
  for (const n of names) {
    const want = n.trim().toLowerCase()
    if (!want) continue
    const exact = people.filter(p => p.name.toLowerCase() === want)
    const first = people.filter(p => p.name.toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0])
    const hit = exact.length === 1 ? exact[0] : first.length === 1 ? first[0] : null
    if (hit && hit.email !== me && !out.some(o => o.email === hit.email)) out.push(hit)
  }
  return out.slice(0, 4)
}

// HOW MANY SLOTS ARE YOURS (owner rule, Oct 18). Each friend always gets ONE slot of their own.
// A length said together with friends is the WHOLE back-to-back block: "4 hours with Ariel" = you 2 h + Ariel 2 h,
// not 4 h for you. Only an explicit "I need N hours (myself)" / "N hours each" changes your own share.
// Never fewer than 1 slot for you, never more than 3.
export function slotsFor(ask: Pick<TimeAsk, 'hours' | 'myHours' | 'mySlots'>, friendCount: number, slotMinutes: number): number {
  const per = slotMinutes / 60
  const clamp = (n: number) => Math.min(3, Math.max(1, Math.round(n)))
  if (ask.myHours && ask.myHours > 0) return clamp(ask.myHours / per)
  if (ask.hours && ask.hours > 0) return clamp(ask.hours / per - friendCount)
  return friendCount ? 1 : clamp(ask.mySlots || 1)
}

// "at 5pm", "5 pm", "5:30pm", "17:00", "noon", "5am" → minutes after midnight (null if no time was said).
// A bare number with no am/pm counts as afternoon/evening for 1–6 ("at 5" = 5 PM), morning for 7–11.
export function parseAt(text: string): number | null {
  const t = normalizeWhen(text)
  if (/\bnoon\b|\bmidday\b/.test(t)) return 720
  if (/\bmidnight\b/.test(t)) return 1380   // the 11 PM–1 AM slot
  // Evening words make a bare hour PM ("tonight at 11", "9 tonight").
  const pm = /\b(tonight|night|evening|pm)\b/.test(t), am = /\b(morning|am)\b/.test(t)
  const bare = (h: number, min = 0) => {
    if (h === 0 || h > 23 || min > 59) return null
    if (h >= 13) return h * 60 + min
    if (h === 12) return 12 * 60 + min
    if (pm && !am) return (h + 12) * 60 + min
    if (am) return h * 60 + min
    return (h <= 6 ? h + 12 : h) * 60 + min      // "at 5" = 5 PM; "at 9" = 9 AM
  }
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/)
  if (m) {
    let h = Number(m[1]) % 12; const min = Number(m[2] ?? 0)
    if (m[3].startsWith('p')) h += 12
    return h < 24 && min < 60 ? h * 60 + min : null
  }
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (m) return bare(Number(m[1]), Number(m[2]))
  // "at 5", "around 5", "5ish", "after 6", "tomorrow 5", "saturday 7" (not "5 hours", "5 people", the date "the 5th").
  m = t.match(/\b(at|around|about|after|by|for|from)\s+(\d{1,2})\b(?!\s*(h\b|hrs?\b|hours?|min|people|ppl|persons?|of\b|st\b|nd\b|rd\b|th\b|\/))/)
    ?? t.match(/\b(\d{1,2})\s*ish\b/)
    ?? t.match(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})\b(?!\s*(h\b|hrs?\b|hours?|min|people|ppl|st\b|nd\b|rd\b|th\b|\/))/)
  if (m) { const h = Number(m[2] ?? m[1]); return bare(h) }
  // Just a time on its own ("5", "7?").
  m = t.match(/^\s*(\d{1,2})\s*\??\s*$/)
  if (m) return bare(Number(m[1]))
  return null
}
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
export { hhmm as atLabel }

// A simple reading of the request without AI (test mode, or if the AI doesn't answer).
export function roughParse(text: string, today: string, people: Person[]): TimeAsk {
  const t = normalizeWhen(text)
  const { names } = namesIn(text, people)
  const hm = t.match(/(\d+|one|two|three|four|five|six)\s*(h\b|hrs?\b|hours?)/)
  const said = hm ? (NUMBERS[hm[1]] ?? Number(hm[1])) : /\b(an|one) hour\b/.test(t) ? 1 : 0
  const hours = said || 2
  // "4 hours each" / "I need 4 hours myself": that length is the creator's own.
  const own = !!said && (/\beach\b/.test(t) || /\b(i|me) (need|want|have)\b[^.]*\b(myself|for me|on my own)\b/.test(t) || /\bmyself\b/.test(t))
  const toSunday = (7 - weekday(today)) % 7
  let from = today, to = addDays(today, 14)
  const date = namedDate(text, today)
  const wd = WEEKDAYS.findIndex(w => t.includes(w))
  if (date && date !== 'bad') { from = to = date }
  else if (/\b(today|tonight|now|right now|rn)\b/.test(t)) { to = today }
  else if (/\btomorrow\b/.test(t)) { from = to = addDays(today, 1) }
  else if (wd >= 0 && /\bnext (week )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)) {
    // "next saturday" = the Saturday of next week (Monday to Sunday).
    from = to = addDays(addDays(today, toSunday + 1), (wd + 6) % 7)
  }
  else if (wd >= 0) { from = to = addDays(today, ((wd - weekday(today) + 7) % 7) || 7) }
  else if (/next week/.test(t)) { from = addDays(today, toSunday + 1); to = addDays(from, 6) }
  else if (/this week/.test(t)) { to = addDays(today, toSunday) }
  else if (/weekend/.test(t)) { from = addDays(today, (6 - weekday(today) + 7) % 7); to = addDays(from, 1) }
  const houses: House[] = /cliff ?2|2371/.test(t) ? ['cliff2'] : /cliff ?1|2375/.test(t) ? ['cliff1'] : ['cliff1', 'cliff2']
  const timeOfDay: TimeOfDay = /morning|before noon/.test(t) ? 'morning' : /afternoon/.test(t) ? 'afternoon' : /\btonight\b/.test(t) ? 'night'
    : /evening/.test(t) ? 'evening' : /\blate\b|\bnight\b/.test(t) && !/last night/.test(t) ? 'late' : 'any'
  const base = { ...(said && !own ? { hours: said } : {}), ...(own ? { myHours: said } : {}) }
  const mySlots = slotsFor({ ...base, mySlots: Math.round(hours / 2) }, names.length, 120)
  const at = /before noon/.test(t) ? null : parseAt(text)
  return { from, to, people: names, mySlots, houses, timeOfDay: at === null ? timeOfDay : 'any', ...base, ...(at === null ? {} : { at }) }
}

/** Friends named in a message: a first name that fits exactly one person ("kyle"), a full name, or the start of one right after
 *  "with"/"and"/"w/" ("with ari" = Ariel). A first name that fits several people ("justin") is NOT guessed: it's in `unclear`
 *  with everyone it could be, so the chat asks which one (chat QA, Nov 6). */
export function namesIn(text: string, people: Person[]): { names: string[]; unclear: { said: string; options: string[] }[] } {
  const t = ` ${text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')} `
  const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '')
  const names: string[] = [], unclear: { said: string; options: string[] }[] = []
  const firsts = new Map<string, Person[]>()
  for (const p of people) { const f = plain(p.name).split(/\s+/)[0]; if (f) firsts.set(f, [...(firsts.get(f) ?? []), p]) }
  for (const [first, list] of firsts) {
    if (first.length < 2 || !new RegExp(`\\b${first}\\b`).test(t)) continue
    const full = list.filter(p => new RegExp(`\\b${plain(p.name).replace(/\s+/g, '\\s+')}\\b`).test(t))
    if (list.length === 1) names.push(list[0].name)
    else if (full.length) names.push(...full.map(p => p.name))
    else unclear.push({ said: first, options: list.map(p => p.name) })
  }
  // "with ari" / "me and jus": the start of exactly one first name (3+ letters), right after with / and / w/ / &.
  for (const m of t.matchAll(/\b(?:with|w\/|and|&|\+)\s+([a-z]{3,})\b/g)) {
    const w = m[1]
    if (firsts.has(w)) continue
    const hits = [...firsts.entries()].filter(([f]) => f.startsWith(w)).flatMap(([, l]) => l)
    if (hits.length === 1 && !names.includes(hits[0].name)) names.push(hits[0].name)
  }
  return { names: [...new Set(names)], unclear }
}

// A follow-up without AI ("only Cliff 2", "anything on the weekend?", "just me"): change only what was mentioned.
export function roughAdjust(prev: TimeAsk, text: string, today: string, people: Person[]): TimeAsk {
  const t = text.toLowerCase(), r = roughParse(text, today, people)
  const next = { ...prev }
  const n = normalizeWhen(text)
  if (/today|tonight|tomorrow|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(n) || namedDate(text, today)) { next.from = r.from; next.to = r.to }
  if (/cliff|2371|2375/.test(n)) next.houses = r.houses
  if (/morning|afternoon|evening|night|late/.test(n)) { next.timeOfDay = r.timeOfDay; delete next.at }
  if (r.at !== undefined) { next.at = r.at; next.timeOfDay = 'any' }
  if (/just me|only me|alone|solo/.test(t)) next.people = []
  else if (r.people.length) next.people = r.people
  if (r.hours || r.myHours) { delete next.hours; delete next.myHours; Object.assign(next, r.hours ? { hours: r.hours } : { myHours: r.myHours }) }
  next.mySlots = slotsFor(next, next.people.length, 120)
  return next
}

// Tidy whatever the AI returned into a safe search.
export function cleanAsk(v: Record<string, unknown>, today: string, fallback: TimeAsk): TimeAsk {
  const from = isDay(v.from) && v.from >= today ? v.from : fallback.from
  let to = isDay(v.to) && v.to >= from ? v.to : (fallback.to >= from ? fallback.to : from)
  if (to > addDays(from, MAX_SPAN_DAYS)) to = addDays(from, MAX_SPAN_DAYS)
  const houses = (Array.isArray(v.houses) ? v.houses : []).filter((h): h is House => h === 'cliff1' || h === 'cliff2')
  const tod = ['any', 'morning', 'afternoon', 'evening', 'night', 'late'].includes(String(v.timeOfDay)) ? v.timeOfDay as TimeOfDay : fallback.timeOfDay
  const people = Array.isArray(v.people) ? v.people.filter((p): p is string => typeof p === 'string').slice(0, 4) : fallback.people
  const num = (x: unknown) => typeof x === 'number' && x > 0 && x <= 18 ? x : undefined
  // Lengths: what the AI heard, else what the simple reading heard. The slot count itself is never taken from the AI.
  const said = 'totalHours' in v || 'myHours' in v || 'hours' in v
  const hours = said ? num(v.totalHours ?? v.hours) : fallback.hours
  const myHours = said ? num(v.myHours) : fallback.myHours
  const mySlots = slotsFor({ hours, myHours, mySlots: fallback.mySlots }, people.length, 120)
  // A start time: "HH:MM" from the AI, a number from the phone's previous search, else what the simple reading heard.
  const atRaw = v.at
  const at = typeof atRaw === 'string' && /^\d{1,2}:\d{2}$/.test(atRaw) ? Number(atRaw.split(':')[0]) * 60 + Number(atRaw.split(':')[1])
    : typeof atRaw === 'number' && atRaw >= 0 && atRaw < 1440 ? atRaw : 'at' in v ? undefined : fallback.at
  return { from, to, people, mySlots, houses: houses.length ? [...new Set(houses)] : fallback.houses, timeOfDay: at !== undefined && at < 1440 ? 'any' : tod,
    ...(hours ? { hours } : {}), ...(myHours ? { myHours } : {}), ...(at !== undefined && at >= 0 && at < 1440 ? { at } : {}) }
}

// Real open slots: you first (mySlots in a row), then each friend's slot right after, same house.
// Every slot must be free for you right now (priority days count for you; your invite covers your
// friends), and each friend must not already be filming somewhere else at that time.
export function findOptions(
  ask: TimeAsk, me: Person, friends: Person[], days: Record<string, ScheduleDay>, friendBusy: Record<string, { from: string; to: string }[]>,
  s: ScheduleSettings, now: string, isTeam: boolean, max = 5,
  skipLock = isTeam,   // the owner skips the day limit but not the priority lock (owner, Oct 27)
): TimeOption[] {
  const out: TimeOption[] = []
  const k = ask.mySlots + friends.length
  for (let date = ask.from; date <= ask.to && out.length < max; date = addDays(date, 1)) {
    // One house slot a day each (settings.slotsPerDay): skip days you or a friend already have theirs. The team isn't limited.
    if (!isTeam && (houseSlotsOn(days[date], me.email, now) + ask.mySlots > s.slotsPerDay
      || friends.some(f => houseSlotsOn(days[date], f.email, now) >= s.slotsPerDay))) continue
    let perDay = 0
    // Asked for a time ("at 5pm"): try the grid slots closest to it first (both houses), so the exact time leads.
    const order = s.slots.map((_, i) => i)
    if (ask.at !== undefined) order.sort((a, b) => Math.abs(s.slots[a] - ask.at!) - Math.abs(s.slots[b] - ask.at!) || a - b)
    const tries = ask.at !== undefined
      ? order.flatMap(i => ask.houses.map(house => ({ house, i })))
      : ask.houses.flatMap(house => order.map(i => ({ house, i })))
    const used = new Set<string>()
    for (const { house, i } of tries) {
      {
        if (out.length >= max || perDay >= 2 || i + k > s.slots.length) continue
        if ([...Array(k).keys()].some(j => used.has(`${house}${i + j}`))) continue
        const starts = s.slots.slice(i, i + k)
        if (!inTime(starts[0], ask.timeOfDay)) continue
        if (starts.some((st, j) => j > 0 && st !== starts[j - 1] + s.slotMinutes)) continue
        if (starts.some(st => slotState(days[date], date, house, st, s, me.email, now, skipLock).t !== 'free')) continue
        const busy = friends.some((f, j) => {
          const from = stamp(date, starts[ask.mySlots + j]), to = addMinutes(from, s.slotMinutes)
          return (friendBusy[f.email] ?? []).some(b => b.from < to && from < b.to)
        })
        if (busy) continue
        out.push({ date, place: house, start: starts[0], slots: starts.map((st, j) => j < ask.mySlots
          ? { email: me.email, name: me.name, start: st, me: true }
          : { email: friends[j - ask.mySlots].email, name: friends[j - ask.mySlots].name, start: st, me: false }) })
        perDay++
        for (let j = 0; j < k; j++) used.add(`${house}${i + j}`)
      }
    }
  }
  return out
}

export const slotTaken = (day: ScheduleDay | undefined, house: House, start: number) => !!day?.[house]?.[slotKey(start)]
