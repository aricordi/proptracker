// House schedule rules (Cliff 1 / Cliff 2 / offsite), shared word-for-word by the
// server (which enforces them) and the app (which shows what's free). No database here.
//
// A day of the schedule is ONE document, schedule_days/{YYYY-MM-DD}: each house maps
// slot start → who booked it, plus offsite shoots and blocked time. Booking writes that
// document in a transaction, which is what makes double-booking a house impossible.
// Times are minutes after midnight (420 = 7 AM). The last slot may run past midnight.
import { weekday, addDays, isDay } from './booking.js'
import { stamp, addMinutes, fmtTime, nowStamp } from './gearBooking.js'

export type House = 'cliff1' | 'cliff2'
export type Place = House | 'offsite'
export const HOUSES: House[] = ['cliff1', 'cliff2']
export type ShootKind = 'monthly' | 'extra' | 'offsite'

// titleStyle (owner, Nov 16): how app bookings are titled when the app writes them into this old calendar ({name} = the creator).
export interface CalendarFeed { id: string; name: string; house: House | 'any'; titleStyle?: string }
export interface ScheduleSettings {
  houses: Record<House, { name: string; address: string }>
  slots: number[]          // start of each 2-hour slot, minutes after midnight, in order
  slotMinutes: number      // 120
  monthlySlots: number     // guaranteed Cliff 1 slots per creator per month
  priority: { email: string; name: string }[]   // priority group (Thursdays + Saturdays at Cliff 1)
  instantBookers: { email: string; name: string }[]   // book WITHOUT approval (owner, Nov 2: Kyle / Stromedy have priority)
  // Book several slots in a row on one day (owner, Nov 17: Danny / Stromedy Studios sometimes needs 6 hours). Still on the
  // 2-hour grid and still a request unless they're also in instantBookers; the one-slot-a-day limit doesn't apply to them.
  longBookers: { email: string; name: string }[]
  priorityWeekdays: number[]   // 0 = Sunday … 6 = Saturday
  releaseMinute: number    // unclaimed priority slots open to everyone at this time on the Sunday before
  noticeHours: number      // moving/cancelling with less notice than this counts as a no-show (unless it's a swap)
  slotsPerDay: number      // house slots a creator may book per day (Cliff 1 + Cliff 2 together); the team can add more
  googleCalendarId: string // the APP's own Google Calendar: every booking/block is copied there ('' = off)
  // Old calendars the team still uses (owner, Oct 30: Cliff 2, Stromedy Talent, Stromedy Studios, Stromedy…): READ ONLY,
  // their events wait on the import screen for a person. `house` = what that calendar is usually for ('any' = guess).
  calendarFeeds: CalendarFeed[]
  // Owner, Nov 16: until everyone is on the app, approved app bookings (and app blocks) are ALSO written into the old calendar
  // for that house, and a shoot that came from an old calendar is changed there too when it's moved or cancelled in the app.
  // Newest change anywhere wins. OFF until the owner turns it on (each old calendar must be shared "Make changes to events").
  writeOldCalendars: boolean
  // Words/phrases the team marked "not filming" (owner, Nov 23: team meetings in the old calendars showed as clashes).
  calendarIgnore: string[]
  checkinBefore: number    // check-in opens this many minutes before the start
  explainHours: number     // a missed check-in can be explained for this many hours after the end
  strikeCount: number      // this many strikes…
  strikeDays: number       // …within this many days…
  pauseDays: number        // …pause prop bookings for this many days
  gearReserveHours: number // creators can reserve gear this many hours before their shoot (grab-and-go, Nov 2)
  gearReserve: boolean     // owner, Nov 3: OFF = no booking gear ahead at all; it's taken first come, first served on the shoot day
  appOnlyFrom: string       // 'YYYY-MM-DD': from this day only bookings/requests made in the app count (banner; owner, Nov 3). '' = no banner
  gearOffsiteBackBy: number // OFFSITE shoots bring gear back by this time that day (minutes; 1440 = end of day). House shoots: end of the shoot (owner, Nov 3)
}

// Owner decisions, Oct 16: 9 slots from 7–9 AM to 11 PM–1 AM, 4 monthly Cliff 1 slots,
// Thursdays + Saturdays for the priority group until Sunday 6 PM.
export const DEFAULT_SCHEDULE: ScheduleSettings = {
  houses: {
    cliff1: { name: 'Cliff 1', address: '2375 Cliff Road' },
    cliff2: { name: 'Cliff 2', address: '2371 Cliff Road' },
  },
  slots: [420, 540, 660, 780, 900, 1020, 1140, 1260, 1380],
  slotMinutes: 120,
  monthlySlots: 4,
  priority: [],
  instantBookers: [],
  longBookers: [],
  priorityWeekdays: [4, 6],
  releaseMinute: 18 * 60,
  noticeHours: 48,
  slotsPerDay: 1,          // owner, Oct 18: one 2-hour house slot a day; more only when the team books it
  googleCalendarId: '',
  calendarFeeds: [],
  writeOldCalendars: false,
  calendarIgnore: [],
  checkinBefore: 15,
  explainHours: 12,
  strikeCount: 2,
  strikeDays: 30,
  pauseDays: 14,
  gearReserveHours: 24,
  gearReserve: false,
  gearOffsiteBackBy: 1440,
  appOnlyFrom: '',
}
export const MONTHLY_HOUSE: House = 'cliff1'
export const PRIORITY_HOUSE: House = 'cliff1'
export const NO_CREW_WEEKDAYS = [0]     // Sundays: open filming, crew is off
export const BOOK_AHEAD_DAYS = 120      // how far ahead anyone can book

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const int = (v: unknown, min: number, max: number, fallback: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : fallback
const emailOk = (v: unknown): v is string => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)

// Settings from the database, with anything missing or odd replaced by the defaults.
export function cleanScheduleSettings(d: Record<string, any> | undefined | null): ScheduleSettings {
  const x = d ?? {}
  const D = DEFAULT_SCHEDULE
  const slotMinutes = Number.isInteger(x.slotMinutes) && x.slotMinutes >= 30 && x.slotMinutes <= 480 ? x.slotMinutes : D.slotMinutes
  const slots = Array.isArray(x.slots)
    ? [...new Set<number>(x.slots.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1440 && (n as number) % 30 === 0))].sort((a, b) => a - b).slice(0, 24)
    : []
  const house = (h: House) => ({
    name: str(x.houses?.[h]?.name, 40) || D.houses[h].name,
    address: str(x.houses?.[h]?.address, 120) || D.houses[h].address,
  })
  const days = Array.isArray(x.priorityWeekdays) ? [...new Set<number>(x.priorityWeekdays.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6))].sort() : D.priorityWeekdays
  return {
    houses: { cliff1: house('cliff1'), cliff2: house('cliff2') },
    slots: slots.length ? slots : D.slots,
    slotMinutes,
    monthlySlots: Number.isInteger(x.monthlySlots) && x.monthlySlots >= 0 && x.monthlySlots <= 31 ? x.monthlySlots : D.monthlySlots,
    priority: Array.isArray(x.priority)
      ? x.priority.filter((p: any) => emailOk(p?.email)).map((p: any) => ({ email: p.email.toLowerCase(), name: str(p.name, 80) || p.email })).slice(0, 100)
      : [],
    instantBookers: Array.isArray(x.instantBookers)
      ? x.instantBookers.filter((p: any) => emailOk(p?.email)).map((p: any) => ({ email: p.email.toLowerCase(), name: str(p.name, 80) || p.email })).slice(0, 20)
      : [],
    longBookers: Array.isArray(x.longBookers)
      ? x.longBookers.filter((p: any) => emailOk(p?.email)).map((p: any) => ({ email: p.email.toLowerCase(), name: str(p.name, 80) || p.email })).slice(0, 20)
      : [],
    priorityWeekdays: days,
    releaseMinute: Number.isInteger(x.releaseMinute) && x.releaseMinute >= 0 && x.releaseMinute < 1440 && x.releaseMinute % 30 === 0 ? x.releaseMinute : D.releaseMinute,
    noticeHours: Number.isInteger(x.noticeHours) && x.noticeHours >= 0 && x.noticeHours <= 336 ? x.noticeHours : D.noticeHours,
    slotsPerDay: int(x.slotsPerDay, 1, 9, D.slotsPerDay),
    googleCalendarId: str(x.googleCalendarId, 200),
    calendarFeeds: Array.isArray(x.calendarFeeds)
      ? x.calendarFeeds.map((f: any) => ({ id: str(f?.id, 200), name: str(f?.name, 40), house: f?.house === 'cliff1' || f?.house === 'cliff2' ? f.house : 'any',
        ...(str(f?.titleStyle, 80).includes('{name}') ? { titleStyle: str(f?.titleStyle, 80) } : {}) }))
        .filter((f: CalendarFeed, i: number, all: CalendarFeed[]) => f.id && all.findIndex(o => o.id === f.id) === i).slice(0, 6)
      : [],
    writeOldCalendars: x.writeOldCalendars === true,
    calendarIgnore: cleanIgnoreList(x.calendarIgnore),
    checkinBefore: int(x.checkinBefore, 0, 240, D.checkinBefore),
    gearReserveHours: int(x.gearReserveHours, 1, 336, D.gearReserveHours),
    gearReserve: x.gearReserve === true,
    appOnlyFrom: isDay(x.appOnlyFrom) ? x.appOnlyFrom : '',
    gearOffsiteBackBy: Number.isInteger(x.gearOffsiteBackBy) && x.gearOffsiteBackBy >= 600 && x.gearOffsiteBackBy <= 1440 && x.gearOffsiteBackBy % 30 === 0 ? x.gearOffsiteBackBy : D.gearOffsiteBackBy,
    explainHours: int(x.explainHours, 0, 168, D.explainHours),
    strikeCount: int(x.strikeCount, 1, 20, D.strikeCount),
    strikeDays: int(x.strikeDays, 1, 365, D.strikeDays),
    pauseDays: int(x.pauseDays, 0, 365, D.pauseDays),
  }
}

// ─── What one day of the schedule holds ──────────────────────────────────────
// A slot can also be HELD for a friend someone invited to film back to back: `hold` is set, shootId is ''.
// The hold lasts INVITE_HOLD_MINUTES (owner, Oct 17: 20 min); after that the slot is free again for everyone.
// `time` = the real hours of a shoot imported from Google Calendar that doesn't match the 2-hour grid (e.g. 2:30–5 PM);
// it then fills every slot it touches.
// `pending` = a creator's REQUEST waiting for the equipment team (owner, Nov 2: no instant bookings): it holds the slot so nobody
// else can request it. `move` = the NEW spot of an approved shoot whose move is waiting for approval (the old spot stays theirs).
export interface SlotEntry { shootId: string; name: string; kind: ShootKind; email?: string; people?: string[]; withNames?: string[]; hold?: { until: string; inviteId: string; fromName: string }; time?: { start: number; end: number }; both?: boolean; pending?: boolean; move?: boolean }
// Old calendar events that overlap at the same house are imported anyway and listed here (owner, Oct 19: old events only).
// shared = NOT a clash (owner, Nov 8: "they're all false alarms"): two old calendar events back to back that only share a 2-hour
// slot without overlapping (e.g. 1:15–3:15 PM and 3:15–5:15 PM both touch the 3–5 slot). The one filling more of the slot
// shows on it; the other waits here and takes the slot if the first one goes. Never shown as a clash.
export interface ClashEntry { house: House; slot: string; shootId: string; name: string; email?: string; start: number; end: number; blockId?: string; shared?: boolean }
// The real hours an entry fills inside its slot: an imported off-grid shoot keeps its own, everything else fills the slot.
export const entryHours = (e: { time?: { start: number; end: number } }, slot: number, minutes: number) => e.time ?? { start: slot, end: slot + minutes }
export const overlapMinutes = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
export const isRealClash = (c: ClashEntry) => !c.blockId && !c.shared
// Repair for clashes saved before the back-to-back rule (owner, Nov 8). Edits `day` in place: a listed clash that doesn't really
// overlap the shoot holding its slot becomes shared (the one filling more of the slot holds it); a clash on an empty slot takes
// the slot. Returns the shoots whose clash listing changed.
export function sortSharedClashes(day: ScheduleDay, minutes: number): string[] {
  const touched = new Set<string>()
  for (const c of [...(day.clashes ?? [])]) {
    if (!isRealClash(c) || !c.shootId) continue
    const map = { ...(day[c.house] ?? {}) }
    const there = map[c.slot]
    const slot = { start: Number(c.slot), end: Number(c.slot) + minutes }
    const asEntry = (x: ClashEntry): SlotEntry => ({ shootId: x.shootId, name: x.name, email: x.email ?? '', kind: 'extra',
      ...(x.start === slot.start && x.end === slot.end ? {} : { time: { start: x.start, end: x.end } }) })
    if (there?.shootId === c.shootId) { day.clashes = (day.clashes ?? []).filter(x => x !== c); touched.add(c.shootId); continue }
    if (!there || !there.shootId) {
      if (there?.hold) continue
      map[c.slot] = asEntry(c); day[c.house] = map
      day.clashes = (day.clashes ?? []).filter(x => x !== c); touched.add(c.shootId); continue
    }
    const theirs = entryHours(there, slot.start, minutes)
    if (overlapMinutes(theirs, c) > 0) continue   // a real clash: stays
    touched.add(c.shootId)
    if (overlapMinutes(slot, c) > overlapMinutes(slot, theirs)) {
      map[c.slot] = asEntry(c); day[c.house] = map
      day.clashes = [...(day.clashes ?? []).filter(x => x !== c),
        { house: c.house, slot: c.slot, shootId: there.shootId, name: there.name, email: there.email ?? '', start: theirs.start, end: theirs.end, shared: true }]
    } else day.clashes = (day.clashes ?? []).map(x => x === c ? { ...c, shared: true } : x)
  }
  return [...touched]
}
export const INVITE_HOLD_MINUTES = 20
export const holdActive = (e: SlotEntry | undefined, now: string) => !!e?.hold && e.hold.until > now
export interface OffsiteEntry { shootId: string; name: string; start: number; end: number; where: string; email?: string; pending?: boolean; move?: boolean }
export type BlockType = 'cleaners' | 'maintenance' | 'event' | 'rental' | 'other'
export const BLOCK_TYPES: Record<BlockType, string> = {
  cleaners: 'Cleaners', maintenance: 'Maintenance', event: 'Event', rental: 'External rental', other: 'Blocked',
}
// soft = a HEADS-UP (owner, Nov 4: "Tesla chargers being installed at Cliff 2… you could still technically film around it"):
// shown on the calendar so people know, but it never stops anyone booking.
export interface Block { id: string; house: House; start: number; end: number; type: BlockType; note?: string; soft?: boolean }
export const hardBlocks = (day: ScheduleDay | undefined) => (day?.blocks ?? []).filter(b => !b.soft)
export const headsUps = (day: ScheduleDay | undefined, house?: House) => (day?.blocks ?? []).filter(b => b.soft && (!house || b.house === house))
export interface ScheduleDay {
  date: string
  cliff1?: Record<string, SlotEntry>   // key = slot start, e.g. '780'
  cliff2?: Record<string, SlotEntry>
  offsite?: OffsiteEntry[]
  blocks?: Block[]
  clashes?: ClashEntry[]
}

export const slotKey = (start: number) => String(start)
export const isNoCrewDay = (date: string) => NO_CREW_WEEKDAYS.includes(weekday(date))
export const monthOf = (date: string) => date.slice(0, 7)
export const fmtSlot = (start: number, minutes: number) => `${fmtTime(start)}–${fmtTime(start + minutes)}`

// When a slot starts and ends, as text stamps ('YYYY-MM-DDTHH:MM'); the last slot of the day ends after midnight.
export function slotWindow(date: string, start: number, minutes: number) {
  const from = stamp(date, start)
  return { from, to: addMinutes(from, minutes) }
}

// Priority days: Thursdays and Saturdays at Cliff 1 belong to the priority group until
// the Sunday before that week at the release time (6 PM). Then they open to everyone.
export const releaseStamp = (date: string, s: ScheduleSettings) => stamp(addDays(date, -weekday(date)), s.releaseMinute)
export const isPriorityDay = (date: string, house: Place, s: ScheduleSettings) => house === PRIORITY_HOUSE && s.priorityWeekdays.includes(weekday(date))
export const inPriorityGroup = (email: string, s: ScheduleSettings) => s.priority.some(p => p.email === email.toLowerCase())
export function priorityLocked(date: string, house: Place, s: ScheduleSettings, email: string, now: string) {
  return isPriorityDay(date, house, s) && !inPriorityGroup(email, s) && now < releaseStamp(date, s)
}

// FREE-TIME BOOKING (owner, Nov 24): there are no fixed slots any more, so "the house is free early" is just a free gap.
// Kept so older screens compile; always null.
export function houseFreeFrom(_day: ScheduleDay | undefined, _house: House, _start: number, _s: ScheduleSettings): { at: number; what: string } | null {
  return null
}

// A filming guideline (PDF) is needed to book a priority day at the priority house when you're not in the priority group
// (owner, Nov 3: Cliff 1 Thursdays + Saturdays). People who book without approval (Kyle) don't need one.
export function needsGuideline(date: string, house: Place, email: string, s: ScheduleSettings) {
  return isPriorityDay(date, house, s) && !inPriorityGroup(email, s) && !s.instantBookers.some(p => p.email === email.toLowerCase())
}

// ─── FREE-TIME BOOKING (owner, Nov 24) ──────────────────────────────────────────────────────────────────────────────
// Any start and end in 15-minute steps, inside the house hours (first slot start → last slot end, e.g. 7 AM → 1 AM).
// Up to `slotMinutes` (2 h) per person on a booking; longer needs one more person per extra 2 hours, all on ONE booking.
// Day docs keep the same shape: house maps keyed by the booking's START minute; every new entry carries its real `time`.
// Older entries without `time` fill their 2-hour grid slot; old imports that filled several grid slots are read once.
export const TIME_STEP = 15
export const MIN_BOOKING_MINUTES = 30
export const houseOpen = (s: ScheduleSettings) => s.slots[0]
export const houseClose = (s: ScheduleSettings) => s.slots[s.slots.length - 1] + s.slotMinutes
export const personMinutes = (s: ScheduleSettings) => s.slotMinutes
export const maxMinutesFor = (people: number, s: ScheduleSettings) => personMinutes(s) * Math.max(1, people)
export interface DayBooking { key: string; shootId: string; start: number; end: number; entry: SlotEntry }
// Every booking (and active hold) at a house that day, once each, in time order.
export function houseBookings(day: ScheduleDay | undefined, house: House, s: ScheduleSettings, now?: string): DayBooking[] {
  const seen = new Set<string>(), out: DayBooking[] = []
  for (const [k, e] of Object.entries(day?.[house] ?? {})) {
    if (!e) continue
    if (e.hold) { if (now && !holdActive(e, now)) continue }
    // A shoot with a move waiting holds two places (its time + the asked one): both count.
    const id = e.shootId ? `${e.shootId}${e.move ? ':move' : ''}` : `hold:${k}`
    if (seen.has(id)) continue
    seen.add(id)
    const h = entryHours(e, Number(k), s.slotMinutes)
    out.push({ key: k, shootId: e.shootId, start: h.start, end: h.end, entry: e })
  }
  return out.sort((a, b) => a.start - b.start)
}
export type Conflict = { t: 'booking'; b: DayBooking } | { t: 'held'; b: DayBooking } | { t: 'block'; block: Block }
// What (if anything) is in the way of [start, end) at a house. `except` = shoots being moved; `forEmail` may use their own hold.
export function conflictAt(day: ScheduleDay | undefined, house: House, start: number, end: number, s: ScheduleSettings, now: string,
  opts: { except?: string[]; forEmail?: string } = {}): Conflict | null {
  const block = hardBlocks(day).find(b => b.house === house && b.start < end && start < b.end)
  if (block) return { t: 'block', block }
  for (const b of houseBookings(day, house, s, now)) {
    if (b.start >= end || start >= b.end) continue
    if (b.shootId && opts.except?.includes(b.shootId)) continue
    if (b.entry.hold) { if (b.entry.email && b.entry.email === opts.forEmail) continue; return { t: 'held', b } }
    return { t: 'booking', b }
  }
  return null
}
// Free stretches at a house that day (inside house hours, after now, around bookings and hard blocks), at least `min` long.
export function freeGaps(day: ScheduleDay | undefined, date: string, house: House, s: ScheduleSettings, now: string, min = MIN_BOOKING_MINUTES, except: string[] = []) {
  const busy = [
    ...houseBookings(day, house, s, now).filter(b => !(b.shootId && except.includes(b.shootId))).map(b => ({ start: b.start, end: b.end })),
    ...hardBlocks(day).filter(b => b.house === house).map(b => ({ start: b.start, end: b.end })),
  ].sort((a, b) => a.start - b.start)
  // Not before "now" (rounded up to the next step) on today's date.
  const nowDay = now.slice(0, 10), nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
  let cur = houseOpen(s)
  if (date === nowDay) cur = Math.max(cur, Math.ceil((nowMin + 1) / TIME_STEP) * TIME_STEP)
  else if (date < nowDay) return []
  const close = houseClose(s), out: { start: number; end: number }[] = []
  for (const b of busy) {
    if (b.end <= cur) continue
    if (b.start - cur >= min) out.push({ start: cur, end: Math.min(b.start, close) })
    cur = Math.max(cur, b.end)
    if (cur >= close) break
  }
  if (close - cur >= min) out.push({ start: cur, end: close })
  return out.filter(g => g.end - g.start >= min)
}
export const freeMinutesOn = (day: ScheduleDay | undefined, date: string, house: House, s: ScheduleSettings, now: string) =>
  freeGaps(day, date, house, s, now).reduce((n, g) => n + g.end - g.start, 0)
// One-time tidy of a day doc written under the 2-hour grid (done inside every booking transaction): an imported shoot that
// filled several grid slots is kept ONCE, keyed by its real start; a "shared" back-to-back event that was waiting in
// clashes (it didn't overlap) gets its own place. Real overlaps stay in clashes. Edits `day` in place.
export function normalizeDay(day: ScheduleDay, s: ScheduleSettings) {
  for (const h of ['cliff1', 'cliff2'] as const) {
    const map = day[h]
    if (!map) continue
    const next: Record<string, SlotEntry> = {}
    const seen = new Set<string>()
    for (const [k, e] of Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (!e) continue
      if (!e.shootId) { next[k] = e; continue }   // a hold
      const id = `${e.shootId}${e.move ? ':move' : ''}`   // a waiting move is its own place
      if (seen.has(id)) continue
      seen.add(id)
      const hrs = entryHours(e, Number(k), s.slotMinutes)
      const key = slotKey(hrs.start)
      if (next[key] && next[key].shootId !== e.shootId) { next[k] = e; continue }   // never lose one; leave it where it was
      next[key] = { ...e, time: hrs }
    }
    day[h] = next
  }
  const keep: ClashEntry[] = []
  for (const c of day.clashes ?? []) {
    if (!c.shared || !c.shootId || c.blockId) { keep.push(c); continue }
    const busy = houseBookings(day, c.house, s).some(b => b.shootId !== c.shootId && b.start < c.end && c.start < b.end)
    const key = slotKey(c.start)
    if (busy || day[c.house]?.[key]) { keep.push({ ...c, shared: false }); continue }
    day[c.house] = { ...(day[c.house] ?? {}), [key]: { shootId: c.shootId, name: c.name, email: c.email ?? '', kind: 'extra', time: { start: c.start, end: c.end } } }
  }
  if (day.clashes) day.clashes = keep
}
// Checks on the times alone (the rest happen in the transaction).
export function checkTimes(place: unknown, date: unknown, start: unknown, end: unknown, s: ScheduleSettings, today: string, now: string): ScheduleProblem | null {
  if (!isDay(date)) return 'bad-date'
  if (place !== 'cliff1' && place !== 'cliff2' && place !== 'offsite') return 'bad-slot'
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'bad-hours'
  const a = start as number, b = end as number
  if (place === 'offsite') { if (a < 0 || a >= 1440 || a % 15 || !offsiteHoursOk(a, b)) return 'bad-hours' }
  else if (a % TIME_STEP || b % TIME_STEP || b - a < MIN_BOOKING_MINUTES || a < houseOpen(s) || b > houseClose(s)) return 'bad-hours'
  if (stamp(date, a) <= now) return 'in-past'
  if (date > addDays(today, BOOK_AHEAD_DAYS)) return 'too-far'
  return null
}

// House slots someone has on a day (both houses, plus slots held for them by a friend's invite).
// Offsite shoots don't count (owner, Oct 18). `except` leaves out a shoot that is being moved or swapped.
// How many house slots this person may book on one day: everyone gets slotsPerDay, long bookers the whole grid.
export const isLongBooker = (email: string, s: ScheduleSettings) => (s.longBookers ?? []).some(p => p.email === email.toLowerCase())
export const slotsPerDayFor = (email: string, s: ScheduleSettings) => isLongBooker(email, s) ? s.slots.length : s.slotsPerDay

export function houseSlotsOn(day: ScheduleDay | undefined, email: string, now: string, except: string[] = []) {
  const e = email.toLowerCase()
  let n = 0
  const seen = new Set<string>()   // a both-houses booking sits in both houses but counts once
  for (const house of ['cliff1', 'cliff2'] as const) {
    for (const entry of Object.values(day?.[house] ?? {})) {
      const onIt = entry.email?.toLowerCase() === e || (entry.people ?? []).includes(e)
      if (!onIt) continue
      if (entry.hold) { if (holdActive(entry, now)) n++; continue }
      if (entry.shootId && !except.includes(entry.shootId) && !seen.has(entry.shootId)) { seen.add(entry.shootId); n++ }
    }
  }
  return n
}

export const blockAt = (day: ScheduleDay | undefined, house: House, start: number, minutes: number) =>
  hardBlocks(day).find(b => b.house === house && b.start < start + minutes && start < b.end)

export type SlotState =
  | { t: 'free' }
  | { t: 'booked'; entry: SlotEntry }
  | { t: 'block'; block: Block }
  | { t: 'past' }
  | { t: 'locked'; opens: string }
  | { t: 'held'; entry: SlotEntry; until: string }

// What a time at a house looks like to this person right now: [start, end) (default: one person's 2 hours).
// The schedule team (owner, equipment) is never locked out of priority days.
export function slotState(day: ScheduleDay | undefined, date: string, house: House, start: number, s: ScheduleSettings, email: string, now: string, isTeam: boolean, end = start + s.slotMinutes): SlotState {
  const c = conflictAt(day, house, start, end, s, now, { forEmail: email })
  const atKey = day?.[house]?.[slotKey(start)]
  if (c?.t === 'block' && !(atKey && !atKey.hold)) return { t: 'block', block: c.block }
  if (c?.t === 'held') return { t: 'held', entry: c.b.entry, until: c.b.entry.hold!.until }
  if (c?.t === 'booking') return { t: 'booked', entry: c.b.entry }
  if (atKey && !atKey.hold) return { t: 'booked', entry: atKey }
  if (stamp(date, start) <= now) return { t: 'past' }
  if (!isTeam && priorityLocked(date, house, s, email, now)) return { t: 'locked', opens: releaseStamp(date, s) }
  return { t: 'free' }
}

// The next free times for `count` people (count × 2 h): the start of each free stretch long enough (and, in a long stretch,
// the following back-to-back starts too). Creators skip days where they already have their booking.
export function findFree(days: Record<string, ScheduleDay>, fromDate: string, dayCount: number, count: number, houses: House[], s: ScheduleSettings, email: string, now: string, isTeam: boolean, max = 8, except: string[] = []) {
  const need = maxMinutesFor(count, s)
  const out: { date: string; house: House; start: number; end: number }[] = []
  for (let k = 0; k < dayCount && out.length < max; k++) {
    const date = addDays(fromDate, k)
    if (!isTeam && houseSlotsOn(days[date], email, now, except) >= s.slotsPerDay) continue
    for (const house of houses) {
      if (!isTeam && priorityLocked(date, house, s, email, now)) continue
      for (const g of freeGaps(days[date], date, house, s, now, need, except)) {
        for (let st = g.start; st + need <= g.end && out.length < max; st += need) out.push({ date, house, start: st, end: st + need })
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).slice(0, max)
}

export type ScheduleProblem = 'bad-date' | 'bad-slot' | 'bad-hours' | 'in-past' | 'too-far' | 'locked' | 'no-monthly-left' | 'taken' | 'blocked' | 'no-where' | 'short-notice' | 'held' | 'day-limit'
export const SCHEDULE_MESSAGES: Record<ScheduleProblem, string> = {
  'bad-date': 'Pick a day.',
  'bad-slot': 'Pick one of the 2-hour slots.',
  'bad-hours': 'Pick a start and end time in 15-minute steps, at least 30 minutes long, inside the house hours.',
  'in-past': 'That slot has already started.',
  'too-far': `Bookings can be made up to ${BOOK_AHEAD_DAYS} days ahead.`,
  locked: 'This priority-day slot opens to everyone on the Sunday before, at the release time.',
  'no-monthly-left': 'You have used all your monthly slots for that month. Book it as an extra slot instead.',
  taken: 'Someone already has part of that time. Pick a free time.',
  blocked: 'That time is blocked at the house.',
  'no-where': 'Say where the offsite shoot is.',
  'short-notice': 'Less than 48 hours to go. Swap with someone instead, or cancel (it counts as a no-show).',
  held: `That slot is held for someone's collab (up to ${INVITE_HOLD_MINUTES} minutes). Check back soon.`,
  'day-limit': "You already have a house booking that day. Creators can be on one house booking a day; ask the schedule team if you need more time.",
}

// Checks that don't need the database (the rest happen in the transaction).
export function checkSlot(place: unknown, date: unknown, start: unknown, s: ScheduleSettings, today: string, now: string): ScheduleProblem | null {
  if (!isDay(date)) return 'bad-date'
  if (place !== 'cliff1' && place !== 'cliff2' && place !== 'offsite') return 'bad-slot'
  if (place === 'offsite') { if (!Number.isInteger(start) || (start as number) < 0 || (start as number) >= 1440 || (start as number) % 30) return 'bad-hours' }
  else if (!Number.isInteger(start) || !s.slots.includes(start as number)) return 'bad-slot'
  if (stamp(date, start as number) <= now) return 'in-past'
  if (date > addDays(today, BOOK_AHEAD_DAYS)) return 'too-far'
  return null
}

// Offsite shoots take any start/end in half hours; up to 18 hours long, may run past midnight.
export const offsiteHoursOk = (start: number, end: unknown): end is number =>
  Number.isInteger(end) && (end as number) > start && (end as number) % 30 === 0 && (end as number) <= start + 18 * 60

// Less than the notice period (48 h) before the shoot starts? Moving or cancelling now counts as a no-show.
export const isShortNotice = (from: string, now: string, s: ScheduleSettings) => from <= addMinutes(now, s.noticeHours * 60)

// Just booked it by mistake? Cancelling within 10 minutes of booking is always free.
export const UNDO_MINUTES = 10
export const withinUndo = (createdAt: string | undefined, nowMs = Date.now()) => !!createdAt && nowMs - Date.parse(createdAt) < UNDO_MINUTES * 60_000

// Booked (or asked for) less than 24 hours before it starts? Then cancelling is always free (owner, Nov 6): the creator
// never had the full notice period to begin with.
export const LATE_BOOKING_FREE_HOURS = 24
export function bookedLate(sh: { from: string; createdAt?: string; requestedAt?: string }): boolean {
  const asked = sh.requestedAt || sh.createdAt
  if (!asked || !sh.from) return false
  const t = Date.parse(asked)
  if (Number.isNaN(t)) return false
  return nowStamp(new Date(t)) >= addMinutes(sh.from, -LATE_BOOKING_FREE_HOURS * 60)
}

/** Was the shoot's current time set by someone else (moved for a priority booking, or moved by the schedule team)? Then the
 *  creator didn't choose it: they may still move it inside the notice period, and cancelling it is free (owner: team moves
 *  never count; audit Nov 7). Cleared again once the creator picks a new time themselves. */
export const timeSetByTeam = (sh: { bumped?: unknown; teamMovedAt?: string | null }) => !!sh.bumped || !!sh.teamMovedAt

/** Does a CREATOR cancelling this shoot right now count as a no-show? Only an approved shoot, inside the notice period,
 *  not within the 10-minute undo, not one that was booked less than 24 h before it starts, and not one the team moved.
 *  (The team never gets one.) */
export function cancelCountsAsNoShow(sh: { status: string; from: string; createdAt?: string; requestedAt?: string; bumped?: unknown; teamMovedAt?: string | null },
  now: string, s: ScheduleSettings): boolean {
  return sh.status === 'booked' && isShortNotice(sh.from, now, s) && !withinUndo(sh.createdAt) && !bookedLate(sh) && !timeSetByTeam(sh)
}

// ─── On the day: check in, wrap, missed check-ins (step 4) ───────────────────
export interface AttendanceShoot { status: string; from: string; to: string; checkin?: { at: string } | null; outcome?: string | null
  place?: string; creatorEmail?: string; toCheck?: boolean; checksIn?: boolean; importedFrom?: string }
/** Whether a shoot expects a check-in with the app (audit, Nov 5). Not offsite shoots, not calendar imports nobody confirmed yet,
 *  not people on Props only. `checksIn` is stamped on the shoot when its check-in opens (push.ts), from the person's access AT
 *  THAT TIME, so switching someone to the Full app later never turns their past shoots into missed check-ins. Before the
 *  stamp: shoots made in the app expect one (unless `canCheckIn` says the person can't); imported ones don't. */
// CHECK-IN OFF (owner, Nov 24: "remove the check in selfie and the whole check in mechanism"): nobody is asked to check in
// or wrap, nothing is ever a missed check-in; a shoot counts as filmed unless the team marks a no-show. Flip to bring it back.
export let CHECKIN_ON = false
/** Tests only: turn the old check-in rules back on to keep testing them. */
export function setCheckinOn(on: boolean) { CHECKIN_ON = on }
export const expectsCheckIn = (sh: AttendanceShoot, canCheckIn?: (email: string) => boolean) => CHECKIN_ON &&
  sh.place !== 'offsite' && !sh.toCheck && (sh.checksIn ?? (!sh.importedFrom && (canCheckIn && sh.creatorEmail ? canCheckIn(sh.creatorEmail) : true)))
// Check-in opens a little before the start and stays open until the end.
export function checkinWindow(sh: { from: string; to: string }, now: string, s: ScheduleSettings): 'early' | 'open' | 'over' {
  if (now < addMinutes(sh.from, -s.checkinBefore)) return 'early'
  return now < sh.to ? 'open' : 'over'
}
// Booked, over, never checked in, and the team hasn't decided yet.
export const isMissed = (sh: AttendanceShoot, now: string, canCheckIn?: (email: string) => boolean) =>
  sh.status === 'booked' && !sh.checkin && !sh.outcome && now >= sh.to && expectsCheckIn(sh, canCheckIn)
export const explainUntil = (sh: { to: string }, s: ScheduleSettings) => addMinutes(sh.to, s.explainHours * 60)

// ---- Writing app bookings into the OLD calendars (owner, Nov 16) ----
// Which old calendar gets an app booking for this place: the first calendar for that house; offsite → the first mixed one.
export function oldCalendarFor(s: Pick<ScheduleSettings, 'calendarFeeds' | 'googleCalendarId'>, place: string): CalendarFeed | null {
  const feeds = s.calendarFeeds.filter(f => f.id && f.id !== s.googleCalendarId)
  if (place === 'cliff1' || place === 'cliff2') return feeds.find(f => f.house === place) ?? null
  // Offsite (owner, Nov 23): the team's own habit = the Cliff 1 (Stromedy Talent) calendar, "<name> - Offsite Filming".
  return feeds.find(f => f.house === 'cliff1') ?? null
}
// Their own style, so app bookings look like the events people add by hand (owner's pick). Editable per calendar.
export function defaultTitleStyle(house: House | 'any'): string {
  return house === 'cliff1' ? '{name} - Stromedy Talent Filming' : house === 'cliff2' ? '{name} - Cliff 2 Filming' : '{name} - Offsite Filming'
}
export function oldTitle(feed: CalendarFeed, name: string, place = ''): string {
  const style = place === 'offsite' ? defaultTitleStyle('any') : feed.titleStyle && feed.titleStyle.includes('{name}') ? feed.titleStyle : defaultTitleStyle(feed.house)
  return style.split('{name}').join(name).slice(0, 200)
}

// The "not filming" list: short phrases, lowercase, no repeats, at most 60.
export function cleanIgnoreList(v: unknown): string[] {
  const out: string[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const p = String(x ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
    if (p.length >= 3 && !out.includes(p)) out.push(p)
    if (out.length >= 60) break
  }
  return out
}
