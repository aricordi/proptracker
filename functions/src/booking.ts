// Booking rules, shared word-for-word by the server (which enforces them) and
// the app (which shows availability). Pure functions: no database access here.
//
// Dates are plain calendar days, written 'YYYY-MM-DD', in the studio's time zone.

export const STUDIO_TIME_ZONE = 'America/Toronto'

export interface BookingSettings {
  leadTimeDays: number   // creators must book at least this many days ahead
  bufferDays: number     // days after a shoot before the same unit can go out again
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = { leadTimeDays: 3, bufferDays: 1 }

// One reservation's hold on one prop. Lives in item_bookings/{itemId}.entries
// while the reservation is active; removed when it's returned, cancelled or declined.
export interface BookingEntry {
  reservationId: string
  start: string
  end: string
  qty: number
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

// ─── Availability ────────────────────────────────────────────────────────────

// The last day an entry keeps its units tied up. Normally the shoot's end plus
// the turnaround buffer. If the shoot is over but nobody has marked the props
// returned yet, they stay tied up until someone does (open-ended).
export function holdUntil(entry: BookingEntry, today: string, bufferDays: number): string {
  if (entry.end < today) return '9999-12-31'
  return addDays(entry.end, bufferDays)
}

export interface ItemStock {
  quantity: number
  // Units reported missing at a return check-in; not bookable until found.
  missingQty?: number
  // Props checked out with the old Checkout screen: tied up until returned there.
  legacyCheckedOut?: boolean
}

// How many units are tied up on one day.
export function bookedOn(day: string, entries: BookingEntry[], today: string, bufferDays: number): number {
  let n = 0
  for (const e of entries) if (e.start <= day && day <= holdUntil(e, today, bufferDays)) n += e.qty
  return n
}

// Fewest units free on any day of [start, end] — what a new booking could take.
export function freeForRange(
  stock: ItemStock, entries: BookingEntry[], start: string, end: string, today: string, bufferDays: number,
): number {
  if (stock.legacyCheckedOut) return 0
  const usable = Math.max(0, stock.quantity - (stock.missingQty ?? 0))
  // The new booking also needs its own turnaround days after `end`.
  let free = usable
  for (const day of eachDay(start, addDays(end, bufferDays))) {
    free = Math.min(free, usable - bookedOn(day, entries, today, bufferDays))
    if (free <= 0) return 0
  }
  return Math.max(0, free)
}

// ─── Validating a new reservation ────────────────────────────────────────────

export const MAX_RESERVATION_DAYS = 60

export type DateProblem = 'bad-format' | 'end-before-start' | 'too-long' | 'in-past' | 'too-soon'

export function checkDates(
  start: unknown, end: unknown, today: string, settings: BookingSettings, skipLeadTime: boolean,
): DateProblem | null {
  if (!isDay(start) || !isDay(end)) return 'bad-format'
  if (end < start) return 'end-before-start'
  if (daysBetween(start, end) + 1 > MAX_RESERVATION_DAYS) return 'too-long'
  if (start < today) return 'in-past'
  if (!skipLeadTime && start < addDays(today, settings.leadTimeDays)) return 'too-soon'
  return null
}

export function earliestStart(today: string, settings: BookingSettings, skipLeadTime: boolean) {
  return skipLeadTime ? today : addDays(today, settings.leadTimeDays)
}
