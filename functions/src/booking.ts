// Booking rules, shared word-for-word by the server (which enforces them) and
// the app (which shows availability). Pure functions: no database access here.
//
// Dates are plain calendar days, written 'YYYY-MM-DD', in the studio's time zone.

export const STUDIO_TIME_ZONE = 'America/Toronto'

export interface BookingSettings {
  leadTimeDays: number   // LEGACY (open days; no longer used for props since Nov 13, kept so old saved settings still read)
  leadTimeHours: number  // props from the closet: at least this many CLOCK hours before the shoot starts (owner, Nov 13: strict 48 hours, closed days count)
  buildLeadDays: number  // … and NEW props (things to make or find) this many (owner, Oct 16: 4)
  bufferDays: number     // days after a shoot before the same unit can go out again
  maxDays: number        // longest booking a creator can make (1 = single-day shoots only)
  closedWeekdays: number[]  // days the arts department is closed every week (0 = Sunday … 6 = Saturday)
  closedDates: string[]     // one-off closed days, e.g. holidays ('YYYY-MM-DD')
}

// Custom props (things to make or find) have NO guaranteed date (owner, Nov 13): at least buildLeadDays
// open days, then the creator sorts out details and timing with the arts department on Slack.
export const customPropNote = (days: number) =>
  `Needs at least ${days} open days' notice, and there's no guaranteed date. After you send it, message the arts department on Slack to sort out the details and when it can be ready.`
export const CUSTOM_PROP_SHORT = 'No guaranteed date · talk to the arts department on Slack'

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  leadTimeDays: 2, leadTimeHours: 48, buildLeadDays: 4, bufferDays: 1, maxDays: 1, closedWeekdays: [0], closedDates: [],
}

// The arts department's days off. Shoots can still happen on them, but nobody is
// there to pack, hand over, take back or wash props.
export type ClosedDays = Pick<BookingSettings, 'closedWeekdays' | 'closedDates'>
export const NO_CLOSED_DAYS: ClosedDays = { closedWeekdays: [], closedDates: [] }

// One reservation's hold on one prop. Lives in item_bookings/{itemId}.entries
// while the reservation is active; removed when it's returned, cancelled or declined.
export interface BookingEntry {
  reservationId: string
  start: string
  end: string
  qty: number
  out?: boolean   // the props are with the creator (picked up, not yet brought back)
  back?: boolean  // brought back, waiting for the arts department's check-in (still held until then)
}

// Turnaround for one prop: its category's own setting if it has one (e.g.
// costumes need washing), otherwise the default from Booking rules.
export function turnaroundFor(
  categoryId: string | undefined,
  categoryTurnaround: Record<string, number | undefined>,
  defaultDays: number,
): number {
  const own = categoryId ? categoryTurnaround[categoryId] : undefined
  return Number.isInteger(own) && (own as number) >= 0 ? own as number : defaultDays
}

// ─── Day arithmetic ──────────────────────────────────────────────────────────

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ─── Props notice in clock hours (owner, Nov 13: "a strict 24 hours") ────────
// Stamps are 'YYYY-MM-DDTHH:MM' in the studio's time zone and sort in time order.
const pad2 = (n: number) => String(n).padStart(2, '0')
/** When a shoot starts, as a stamp. `startMin` = minutes after midnight. */
export function shootStartStamp(day: string, startMin: number): string {
  const m = Math.max(0, Math.round(Number(startMin) || 0))
  return `${addDays(day, Math.floor(m / 1440))}T${pad2(Math.floor((m % 1440) / 60))}:${pad2(m % 60)}`
}
/** The last moment props from the closet can be asked for: `hours` before the shoot starts. */
export function propsDeadline(shootStart: string, hours: number): string {
  const total = Number(shootStart.slice(11, 13)) * 60 + Number(shootStart.slice(14, 16)) - Math.round(hours * 60)
  const dayShift = Math.floor(total / 1440), m = ((total % 1440) + 1440) % 1440
  return `${addDays(shootStart.slice(0, 10), dayShift)}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}
/** True while props can still be added for a shoot starting at `shootStart` (now = stamp). */
export const propsStillOpen = (shootStart: string, hours: number, now: string) => now <= propsDeadline(shootStart, hours)

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function todayInStudio(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

// ─── Open and closed days ────────────────────────────────────────────────────

export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

export function isOpen(day: string, closed: ClosedDays): boolean {
  return !closed.closedWeekdays.includes(weekday(day)) && !closed.closedDates.includes(day)
}

// Safety net: if every day were somehow closed, fall back to plain calendar days.
const LOOK_AHEAD = 400

// Step forward n open days from `day` (not counting `day` itself).
// addOpenDays(Saturday, 1) with Sundays closed is Monday.
export function addOpenDays(day: string, n: number, closed: ClosedDays): string {
  let d = day
  for (let counted = 0, steps = 0; counted < n; steps++) {
    if (steps > LOOK_AHEAD) return addDays(day, n)
    d = addDays(d, 1)
    if (isOpen(d, closed)) counted++
  }
  return d
}

// Props for a shoot are picked up on the shoot day, or on the last open day
// before it if the arts department is closed that day.
export function pickupDay(start: string, closed: ClosedDays): string {
  let d = start
  for (let steps = 0; !isOpen(d, closed); steps++) {
    if (steps > LOOK_AHEAD) return start
    d = addDays(d, -1)
  }
  return d
}

// Props are due back the night of the shoot; they count as late from
// RETURN_DEADLINE_HOUR on the next open day (e.g. Monday 10am after a Saturday shoot).
export const RETURN_DEADLINE_HOUR = 10
export function returnDueDay(end: string, closed: ClosedDays): string {
  return addOpenDays(end, 1, closed)
}

// The hour of the day (0–23) at the studio.
export function hourInStudio(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now))
}

// Is a booking that's out with the creator late? Only bookings whose props were
// picked up and not yet brought back can be late (status 'collected').
export function isLate(status: string, end: string, closed: ClosedDays, now = new Date()): boolean {
  if (status !== 'collected') return false
  const due = returnDueDay(end, closed)
  const today = todayInStudio(now)
  return today > due || (today === due && hourInStudio(now) >= RETURN_DEADLINE_HOUR)
}

// ─── Availability ────────────────────────────────────────────────────────────

// The last day an entry keeps its units tied up. Normally the shoot's end plus
// the turnaround days (counting only days the arts department is open). If the shoot is over and the props were picked up
// but not checked in yet (out with the creator, or brought back and waiting for check-in), they stay tied up until someone
// checks them in (open-ended). Props that never left the building (a request nobody picked up) free up after the turnaround.
export function holdUntil(entry: BookingEntry, today: string, bufferDays: number, closed: ClosedDays = NO_CLOSED_DAYS): string {
  if (entry.end < today && (entry.out || entry.back)) return '9999-12-31'
  return addOpenDays(entry.end, bufferDays, closed)
}

export interface ItemStock {
  quantity: number
  // Units reported missing at a return check-in; not bookable until found.
  missingQty?: number
  // Props checked out with the old Checkout screen: tied up until returned there.
  legacyCheckedOut?: boolean
}

// How many units are tied up on one day.
export function bookedOn(day: string, entries: BookingEntry[], today: string, bufferDays: number, closed: ClosedDays = NO_CLOSED_DAYS): number {
  let n = 0
  for (const e of entries) if (e.start <= day && day <= holdUntil(e, today, bufferDays, closed)) n += e.qty
  return n
}

// Fewest units free on any day of [start, end] — what a new booking could take.
export function freeForRange(
  stock: ItemStock, entries: BookingEntry[], start: string, end: string, today: string, bufferDays: number,
  closed: ClosedDays = NO_CLOSED_DAYS,
): number {
  if (stock.legacyCheckedOut) return 0
  const usable = Math.max(0, stock.quantity - (stock.missingQty ?? 0))
  // The new booking also needs its own turnaround days after `end`.
  let free = usable
  for (const day of eachDay(start, addOpenDays(end, bufferDays, closed))) {
    free = Math.min(free, usable - bookedOn(day, entries, today, bufferDays, closed))
    if (free <= 0) return 0
  }
  return Math.max(0, free)
}

// ─── Validating a new reservation ────────────────────────────────────────────

// Hard ceiling for anyone, including the arts department.
export const MAX_RESERVATION_DAYS = 60

export type DateProblem = 'bad-format' | 'end-before-start' | 'too-long' | 'in-past' | 'too-soon'

export function checkDates(
  start: unknown, end: unknown, today: string, settings: BookingSettings, isStaff: boolean,
): DateProblem | null {
  if (!isDay(start) || !isDay(end)) return 'bad-format'
  if (end < start) return 'end-before-start'
  // Creators are limited to the admin-set maximum; the arts department can go longer.
  const maxDays = isStaff ? MAX_RESERVATION_DAYS : Math.min(settings.maxDays, MAX_RESERVATION_DAYS)
  if (daysBetween(start, end) + 1 > maxDays) return 'too-long'
  if (start < today) return 'in-past'
  if (!isStaff && start < earliestStart(today, settings, false)) return 'too-soon'
  return null
}

// The last day something with `lead` open days' notice can still be booked for a shoot on `shootDay`.
export function lastDayToBook(shootDay: string, lead: number, closed: ClosedDays): string {
  let d = shootDay
  for (let i = 0; i < 60 && addOpenDays(d, lead, closed) > shootDay; i++) d = addDays(d, -1)
  return d
}

// Earliest shoot DAY creators can ask props for, when only the day is known (the exact check uses the shoot's start time:
// propsStillOpen). Props notice is in clock hours since Nov 13, so a 24-hour notice = tomorrow at the earliest.
export function earliestStart(today: string, settings: BookingSettings, skipLeadTime: boolean) {
  return skipLeadTime ? today : addDays(today, Math.ceil(Math.max(0, settings.leadTimeHours) / 24))
}

// Reads closed-day settings defensively (they come from the database).
export function cleanClosedDays(d: { closedWeekdays?: unknown; closedDates?: unknown }): ClosedDays {
  const weekdays = Array.isArray(d.closedWeekdays)
    ? [...new Set(d.closedWeekdays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))]
    : DEFAULT_BOOKING_SETTINGS.closedWeekdays
  return {
    // Never closed every day of the week.
    closedWeekdays: weekdays.length >= 7 ? [] : weekdays,
    closedDates: Array.isArray(d.closedDates) ? d.closedDates.filter(isDay) : [],
  }
}

// Was a booking brought back late? (Judged by when the creator returned it.)
export function wasReturnedLate(end: string, returnedAt: string, closed: ClosedDays): boolean {
  return isLate('collected', end, closed, new Date(returnedAt))
}

// ─── Upcoming bookings at risk ───────────────────────────────────────────────

// Why a prop in an upcoming booking might not be ready: someone else has it
// out late, it came back damaged, or units went missing.
export type Risk = 'late' | 'damaged' | 'missing'

export function lineRisk(a: {
  reservationId: string
  qty: number
  start: string
  end: string
  stock: ItemStock
  damaged: boolean
  entries: BookingEntry[]   // all holds on this prop
  today: string
  bufferDays: number
  closed: ClosedDays
  now?: Date
}): Risk | null {
  if (a.damaged) return 'damaged'
  const others = a.entries.filter(e => e.reservationId !== a.reservationId)
  const lateQty = others
    .filter(e => e.out && isLate('collected', e.end, a.closed, a.now))
    .reduce((n, e) => n + e.qty, 0)
  const usable = Math.max(0, a.stock.quantity - (a.stock.missingQty ?? 0))
  // Other bookings still within their planned dates (not ones that are already over).
  const current = others.filter(e => e.end >= a.today)
  let busiest = 0
  for (const day of eachDay(a.start, a.end)) busiest = Math.max(busiest, bookedOn(day, current, a.today, a.bufferDays, a.closed))
  if (usable - lateQty - busiest >= a.qty) return null
  if (lateQty > 0 && usable - busiest >= a.qty) return 'late'
  if ((a.stock.missingQty ?? 0) > 0) return 'missing'
  return lateQty > 0 ? 'late' : null
}
