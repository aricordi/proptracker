// House schedule rules (Cliff 1 / Cliff 2 / offsite), shared word-for-word by the
// server (which enforces them) and the app (which shows what's free). No database here.
//
// A day of the schedule is ONE document, schedule_days/{YYYY-MM-DD}: each house maps
// slot start → who booked it, plus offsite shoots and blocked time. Booking writes that
// document in a transaction, which is what makes double-booking a house impossible.
// Times are minutes after midnight (420 = 7 AM). The last slot may run past midnight.
import { weekday, addDays, isDay } from './booking.js'
import { stamp, addMinutes, fmtTime } from './gearBooking.js'

export type House = 'cliff1' | 'cliff2'
export type Place = House | 'offsite'
export const HOUSES: House[] = ['cliff1', 'cliff2']
export type ShootKind = 'monthly' | 'extra' | 'offsite'

export interface ScheduleSettings {
  houses: Record<House, { name: string; address: string }>
  slots: number[]          // start of each 2-hour slot, minutes after midnight, in order
  slotMinutes: number      // 120
  monthlySlots: number     // guaranteed Cliff 1 slots per creator per month
  priority: { email: string; name: string }[]   // priority group (Thursdays + Saturdays at Cliff 1)
  priorityWeekdays: number[]   // 0 = Sunday … 6 = Saturday
  releaseMinute: number    // unclaimed priority slots open to everyone at this time on the Sunday before
  noticeHours: number      // moving/cancelling with less notice than this counts as a no-show (unless it's a swap)
  slotsPerDay: number      // house slots a creator may book per day (Cliff 1 + Cliff 2 together); the team can add more
  googleCalendarId: string // shared Google Calendar the app copies bookings to ('' = off)
  checkinBefore: number    // check-in opens this many minutes before the start
  explainHours: number     // a missed check-in can be explained for this many hours after the end
  strikeCount: number      // this many strikes…
  strikeDays: number       // …within this many days…
  pauseDays: number        // …pause prop + gear booking for this many days
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
  priorityWeekdays: [4, 6],
  releaseMinute: 18 * 60,
  noticeHours: 48,
  slotsPerDay: 1,          // owner, Oct 18: one 2-hour house slot a day; more only when the team books it
  googleCalendarId: '',
  checkinBefore: 15,
  explainHours: 12,
  strikeCount: 2,
  strikeDays: 30,
  pauseDays: 14,
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
    priorityWeekdays: days,
    releaseMinute: Number.isInteger(x.releaseMinute) && x.releaseMinute >= 0 && x.releaseMinute < 1440 && x.releaseMinute % 30 === 0 ? x.releaseMinute : D.releaseMinute,
    noticeHours: Number.isInteger(x.noticeHours) && x.noticeHours >= 0 && x.noticeHours <= 336 ? x.noticeHours : D.noticeHours,
    slotsPerDay: int(x.slotsPerDay, 1, 9, D.slotsPerDay),
    googleCalendarId: str(x.googleCalendarId, 200),
    checkinBefore: int(x.checkinBefore, 0, 240, D.checkinBefore),
    explainHours: int(x.explainHours, 0, 168, D.explainHours),
    strikeCount: int(x.strikeCount, 1, 20, D.strikeCount),
    strikeDays: int(x.strikeDays, 1, 365, D.strikeDays),
    pauseDays: int(x.pauseDays, 0, 365, D.pauseDays),
  }
}

// ─── What one day of the schedule holds ──────────────────────────────────────
// A slot can also be HELD for a friend someone invited to film back to back: `hold` is set, shootId is ''.
// The hold lasts INVITE_HOLD_MINUTES (owner, Oct 17: 20 min); after that the slot is free again for everyone.
export interface SlotEntry { shootId: string; name: string; kind: ShootKind; email?: string; hold?: { until: string; inviteId: string; fromName: string } }
export const INVITE_HOLD_MINUTES = 20
export const holdActive = (e: SlotEntry | undefined, now: string) => !!e?.hold && e.hold.until > now
export interface OffsiteEntry { shootId: string; name: string; start: number; end: number; where: string; email?: string }
export type BlockType = 'cleaners' | 'maintenance' | 'event' | 'rental' | 'other'
export const BLOCK_TYPES: Record<BlockType, string> = {
  cleaners: 'Cleaners', maintenance: 'Maintenance', event: 'Event', rental: 'External rental', other: 'Blocked',
}
export interface Block { id: string; house: House; start: number; end: number; type: BlockType; note?: string }
export interface ScheduleDay {
  date: string
  cliff1?: Record<string, SlotEntry>   // key = slot start, e.g. '780'
  cliff2?: Record<string, SlotEntry>
  offsite?: OffsiteEntry[]
  blocks?: Block[]
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

// House slots someone has on a day (both houses, plus slots held for them by a friend's invite).
// Offsite shoots don't count (owner, Oct 18). `except` leaves out a shoot that is being moved or swapped.
export function houseSlotsOn(day: ScheduleDay | undefined, email: string, now: string, except: string[] = []) {
  const e = email.toLowerCase()
  let n = 0
  for (const house of ['cliff1', 'cliff2'] as const) {
    for (const entry of Object.values(day?.[house] ?? {})) {
      if (entry.email?.toLowerCase() !== e) continue
      if (entry.hold ? holdActive(entry, now) : entry.shootId && !except.includes(entry.shootId)) n++
    }
  }
  return n
}

export const blockAt = (day: ScheduleDay | undefined, house: House, start: number, minutes: number) =>
  (day?.blocks ?? []).find(b => b.house === house && b.start < start + minutes && start < b.end)

export type SlotState =
  | { t: 'free' }
  | { t: 'booked'; entry: SlotEntry }
  | { t: 'block'; block: Block }
  | { t: 'past' }
  | { t: 'locked'; opens: string }
  | { t: 'held'; entry: SlotEntry; until: string }

// What one slot looks like to this person right now. The schedule team (owner,
// equipment) is never locked out of priority days.
export function slotState(day: ScheduleDay | undefined, date: string, house: House, start: number, s: ScheduleSettings, email: string, now: string, isTeam: boolean): SlotState {
  const block = blockAt(day, house, start, s.slotMinutes)
  if (block) return { t: 'block', block }
  const entry = day?.[house]?.[slotKey(start)]
  if (entry?.hold) { if (entry.hold.until > now) return { t: 'held', entry, until: entry.hold.until } }   // an ended hold counts as free
  else if (entry) return { t: 'booked', entry }
  if (stamp(date, start) <= now) return { t: 'past' }
  if (!isTeam && priorityLocked(date, house, s, email, now)) return { t: 'locked', opens: releaseStamp(date, s) }
  return { t: 'free' }
}

// The next free times that fit `count` back-to-back slots (e.g. 2 = 4 hours for two
// creators filming together). Only slots that touch (one ends as the next starts) count.
export function findFree(days: Record<string, ScheduleDay>, fromDate: string, dayCount: number, count: number, houses: House[], s: ScheduleSettings, email: string, now: string, isTeam: boolean, max = 8) {
  const out: { date: string; house: House; start: number }[] = []
  for (let k = 0; k < dayCount && out.length < max; k++) {
    const date = addDays(fromDate, k)
    // Creators: skip days where they already have their house slot(s).
    if (!isTeam && houseSlotsOn(days[date], email, now) >= s.slotsPerDay) continue
    for (const house of houses) {
      for (let i = 0; i + count <= s.slots.length && out.length < max; i++) {
        let ok = true
        for (let j = 0; j < count; j++) {
          const st = s.slots[i + j]
          if (j > 0 && st !== s.slots[i + j - 1] + s.slotMinutes) { ok = false; break }
          if (slotState(days[date], date, house, st, s, email, now, isTeam).t !== 'free') { ok = false; break }
        }
        if (ok) { out.push({ date, house, start: s.slots[i] }); i += count - 1 }
      }
    }
  }
  return out
}

export type ScheduleProblem = 'bad-date' | 'bad-slot' | 'bad-hours' | 'in-past' | 'too-far' | 'locked' | 'no-monthly-left' | 'taken' | 'blocked' | 'no-where' | 'short-notice' | 'held' | 'day-limit'
export const SCHEDULE_MESSAGES: Record<ScheduleProblem, string> = {
  'bad-date': 'Pick a day.',
  'bad-slot': 'Pick one of the 2-hour slots.',
  'bad-hours': 'Pick a start and end time, in half hours, ending after it starts.',
  'in-past': 'That slot has already started.',
  'too-far': `Bookings can be made up to ${BOOK_AHEAD_DAYS} days ahead.`,
  locked: 'This priority-day slot opens to everyone on the Sunday before, at the release time.',
  'no-monthly-left': 'You have used all your monthly slots for that month. Book it as an extra slot instead.',
  taken: 'Someone just booked that slot. Pick another one.',
  blocked: 'That time is blocked at the house.',
  'no-where': 'Say where the offsite shoot is.',
  'short-notice': 'Less than 48 hours to go. Swap with someone instead, or cancel (it counts as a no-show).',
  held: `That slot is held for someone's collab (up to ${INVITE_HOLD_MINUTES} minutes). Check back soon.`,
  'day-limit': "You already have your house slot that day. Creators can book one 2-hour slot a day; ask the schedule team if you need more time.",
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

// ─── On the day: check in, wrap, missed check-ins (step 4) ───────────────────
export interface AttendanceShoot { status: string; from: string; to: string; checkin?: { at: string } | null; outcome?: string | null }
// Check-in opens a little before the start and stays open until the end.
export function checkinWindow(sh: { from: string; to: string }, now: string, s: ScheduleSettings): 'early' | 'open' | 'over' {
  if (now < addMinutes(sh.from, -s.checkinBefore)) return 'early'
  return now < sh.to ? 'open' : 'over'
}
// Booked, over, never checked in, and the team hasn't decided yet.
export const isMissed = (sh: AttendanceShoot, now: string) => sh.status === 'booked' && !sh.checkin && !sh.outcome && now >= sh.to
export const explainUntil = (sh: { to: string }, s: ScheduleSettings) => addMinutes(sh.to, s.explainHours * 60)
