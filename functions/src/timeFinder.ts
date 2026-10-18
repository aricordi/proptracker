// "Ask for a time": turn a request into a search, then find real open slots on the schedule.
// Pure functions (no database), shared by the server and the tests. The AI only fills in a
// TimeAsk; the slots themselves always come from findOptions, so a time is never invented.
import { addDays, weekday, isDay } from './booking.js'
import { stamp, addMinutes } from './gearBooking.js'
import { slotState, slotKey, type ScheduleDay, type ScheduleSettings, type House } from './schedule.js'

export type TimeOfDay = 'any' | 'morning' | 'afternoon' | 'evening' | 'late'
export interface TimeAsk {
  from: string; to: string           // days to look at ('YYYY-MM-DD')
  people: string[]                   // friends filming right after you (names, as in the people list)
  mySlots: number                    // your own 2-hour slots in a row (1–3); always worked out by slotsFor()
  hours?: number                     // what they asked for IN TOTAL ("4 hours with Ariel" = 4 for the whole block)
  myHours?: number                   // only when they said their OWN length ("I need 4 hours, Kyle 2")
  houses: House[]
  timeOfDay: TimeOfDay
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
  t === 'any' || (t === 'morning' ? start < 720 : t === 'afternoon' ? start >= 720 && start < 1020 : t === 'evening' ? start >= 1020 && start < 1260 : start >= 1260)

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

// A simple reading of the request without AI (test mode, or if the AI doesn't answer).
export function roughParse(text: string, today: string, people: Person[]): TimeAsk {
  const t = ` ${text.toLowerCase()} `
  const names = people.filter(p => new RegExp(`\\b${p.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '')}\\b`).test(t)).map(p => p.name)
  const hm = t.match(/(\d+|one|two|three|four|five|six)\s*(h\b|hrs?\b|hours?)/)
  const said = hm ? (NUMBERS[hm[1]] ?? Number(hm[1])) : 0
  const hours = said || 2
  // "4 hours each" / "I need 4 hours myself": that length is the creator's own.
  const own = !!said && (/\beach\b/.test(t) || /\b(i|me) (need|want|have)\b[^.]*\b(myself|for me|on my own)\b/.test(t) || /\bmyself\b/.test(t))
  const toSunday = (7 - weekday(today)) % 7
  let from = today, to = addDays(today, 14)
  if (/\btoday\b/.test(t)) { to = today }
  else if (/\btomorrow\b/.test(t)) { from = to = addDays(today, 1) }
  else if (/next week/.test(t)) { from = addDays(today, toSunday + 1); to = addDays(from, 6) }
  else if (/this week/.test(t)) { to = addDays(today, toSunday) }
  else if (/weekend/.test(t)) { from = addDays(today, (6 - weekday(today) + 7) % 7); to = addDays(from, 1) }
  else {
    const wd = WEEKDAYS.findIndex(w => t.includes(w))
    if (wd >= 0) { from = to = addDays(today, ((wd - weekday(today) + 7) % 7) || 7) }
  }
  const houses: House[] = /cliff ?2|2371/.test(t) ? ['cliff2'] : /cliff ?1|2375/.test(t) ? ['cliff1'] : ['cliff1', 'cliff2']
  const timeOfDay: TimeOfDay = /morning/.test(t) ? 'morning' : /afternoon/.test(t) ? 'afternoon' : /evening/.test(t) ? 'evening' : /late|night/.test(t) ? 'late' : 'any'
  const base = { ...(said && !own ? { hours: said } : {}), ...(own ? { myHours: said } : {}) }
  const mySlots = slotsFor({ ...base, mySlots: Math.round(hours / 2) }, names.length, 120)
  return { from, to, people: names, mySlots, houses, timeOfDay, ...base }
}

// A follow-up without AI ("only Cliff 2", "anything on the weekend?", "just me"): change only what was mentioned.
export function roughAdjust(prev: TimeAsk, text: string, today: string, people: Person[]): TimeAsk {
  const t = text.toLowerCase(), r = roughParse(text, today, people)
  const next = { ...prev }
  if (/today|tomorrow|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(t)) { next.from = r.from; next.to = r.to }
  if (/cliff|2371|2375/.test(t)) next.houses = r.houses
  if (/morning|afternoon|evening|night|late/.test(t)) next.timeOfDay = r.timeOfDay
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
  const tod = ['any', 'morning', 'afternoon', 'evening', 'late'].includes(String(v.timeOfDay)) ? v.timeOfDay as TimeOfDay : fallback.timeOfDay
  const people = Array.isArray(v.people) ? v.people.filter((p): p is string => typeof p === 'string').slice(0, 4) : fallback.people
  const num = (x: unknown) => typeof x === 'number' && x > 0 && x <= 18 ? x : undefined
  // Lengths: what the AI heard, else what the simple reading heard. The slot count itself is never taken from the AI.
  const said = 'totalHours' in v || 'myHours' in v || 'hours' in v
  const hours = said ? num(v.totalHours ?? v.hours) : fallback.hours
  const myHours = said ? num(v.myHours) : fallback.myHours
  const mySlots = slotsFor({ hours, myHours, mySlots: fallback.mySlots }, people.length, 120)
  return { from, to, people, mySlots, houses: houses.length ? [...new Set(houses)] : fallback.houses, timeOfDay: tod,
    ...(hours ? { hours } : {}), ...(myHours ? { myHours } : {}) }
}

// Real open slots: you first (mySlots in a row), then each friend's slot right after, same house.
// Every slot must be free for you right now (priority days count for you; your invite covers your
// friends), and each friend must not already be filming somewhere else at that time.
export function findOptions(
  ask: TimeAsk, me: Person, friends: Person[], days: Record<string, ScheduleDay>, friendBusy: Record<string, { from: string; to: string }[]>,
  s: ScheduleSettings, now: string, isTeam: boolean, max = 5,
): TimeOption[] {
  const out: TimeOption[] = []
  const k = ask.mySlots + friends.length
  for (let date = ask.from; date <= ask.to && out.length < max; date = addDays(date, 1)) {
    let perDay = 0
    for (const house of ask.houses) {
      for (let i = 0; i + k <= s.slots.length && out.length < max && perDay < 2; i++) {
        const starts = s.slots.slice(i, i + k)
        if (!inTime(starts[0], ask.timeOfDay)) continue
        if (starts.some((st, j) => j > 0 && st !== starts[j - 1] + s.slotMinutes)) continue
        if (starts.some(st => slotState(days[date], date, house, st, s, me.email, now, isTeam).t !== 'free')) continue
        const busy = friends.some((f, j) => {
          const from = stamp(date, starts[ask.mySlots + j]), to = addMinutes(from, s.slotMinutes)
          return (friendBusy[f.email] ?? []).some(b => b.from < to && from < b.to)
        })
        if (busy) continue
        out.push({ date, place: house, start: starts[0], slots: starts.map((st, j) => j < ask.mySlots
          ? { email: me.email, name: me.name, start: st, me: true }
          : { email: friends[j - ask.mySlots].email, name: friends[j - ask.mySlots].name, start: st, me: false }) })
        perDay++
        i += k - 1
      }
    }
  }
  return out
}

export const slotTaken = (day: ScheduleDay | undefined, house: House, start: number) => !!day?.[house]?.[slotKey(start)]
