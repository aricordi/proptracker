// Gear booking rules (by the hour), shared word-for-word by the server (which
// enforces them) and the app (which shows what's free). No database access here.
//
// Times are minutes after midnight in the studio's time zone (600 = 10:00 AM).
// A hold is stored as two text stamps 'YYYY-MM-DDTHH:MM', which sort in time order.
import { addOpenDays, isOpen, pickupDay, returnDueDay, isDay, type ClosedDays } from './booking.js'

export const GEAR_LEAD_TIME_DAYS = 1      // creators book at least 1 open day ahead (owner, Oct 13)
export const GEAR_LATE_MINUTES = 30       // gear is late 30 min after the booked end (step 3)
export const GEAR_DAY_START = 6 * 60      // earliest start: 6 AM
export const GEAR_DAY_END = 24 * 60       // latest end: midnight
export const GEAR_STEP = 30               // times move in half hours
export const GEAR_RETURN_HOUR = 10        // closed-day shoots: back by 10 AM next open day

// One booking's hold on one bundle or extra. Lives in gear_holds/{offerId}.entries.
export interface GearHold { bookingId: string; from: string; to: string; qty: number }

const pad = (n: number) => String(n).padStart(2, '0')
export const stamp = (day: string, min: number) => `${day}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`

// When the gear is tied up. Normally the booked hours on the shoot day. If the
// shoot is on a closed day (e.g. Sunday), it's picked up on the last open day
// before at the same time and is due back at 10 AM on the next open day.
export function holdWindow(date: string, start: number, end: number, closed: ClosedDays) {
  if (isOpen(date, closed)) return { from: stamp(date, start), to: stamp(date, end), pickup: date, closedDay: false }
  const pickup = pickupDay(date, closed)
  return { from: stamp(pickup, start), to: stamp(returnDueDay(date, closed), GEAR_RETURN_HOUR * 60), pickup, closedDay: true }
}

export const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from < b.to && b.from < a.to

// How many of a bundle (always 1) or extra are still free between from and to.
export function freeQty(offered: number, holds: GearHold[], from: string, to: string, exceptBookingId?: string): number {
  const used = holds.filter(h => h.bookingId !== exceptBookingId && overlaps(h, { from, to })).reduce((n, h) => n + h.qty, 0)
  return Math.max(0, offered - used)
}

// The first start time later the same day that fits the same length, or null.
export function nextFreeStart(offered: number, qty: number, holds: GearHold[], date: string, start: number, end: number, closed: ClosedDays): number | null {
  const len = end - start
  for (let t = start + GEAR_STEP; t + len <= GEAR_DAY_END; t += GEAR_STEP) {
    const w = holdWindow(date, t, t + len, closed)
    if (freeQty(offered, holds, w.from, w.to) >= qty) return t
  }
  return null
}

// Holds that ended more than a week before `today` are tidied away when the doc is next written.
export function pruneHolds(holds: GearHold[], today: string): GearHold[] {
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7)
  const cut = d.toISOString().slice(0, 10)
  return holds.filter(h => h.to.slice(0, 10) >= cut)
}

export type GearTimeProblem = 'bad-format' | 'bad-hours' | 'in-past' | 'too-soon'
export const GEAR_TIME_MESSAGES: Record<GearTimeProblem, string> = {
  'bad-format': 'Pick a shoot day and hours.',
  'bad-hours': 'Pick hours between 6 AM and midnight, in half hours, ending after they start.',
  'in-past': 'That time has already passed.',
  'too-soon': 'Gear has to be booked at least 1 open day ahead.',
}

// Is this day + hours bookable? Staff (owner, equipment team, arts) skip the notice rule.
export function checkGearTimes(date: unknown, start: unknown, end: unknown, today: string, nowMin: number, closed: ClosedDays, skipNotice: boolean): GearTimeProblem | null {
  if (!isDay(date) || !Number.isInteger(start) || !Number.isInteger(end)) return 'bad-format'
  const s = start as number, e = end as number
  if (s % GEAR_STEP || e % GEAR_STEP || s < GEAR_DAY_START || e > GEAR_DAY_END || e <= s) return 'bad-hours'
  const { pickup } = holdWindow(date, s, e, closed)
  if (pickup < today || (pickup === today && s <= nowMin)) return 'in-past'
  if (!skipNotice && pickup < addOpenDays(today, GEAR_LEAD_TIME_DAYS, closed)) return 'too-soon'
  return null
}

// The first day creators can book gear for.
export const earliestGearDay = (today: string, closed: ClosedDays) => addOpenDays(today, GEAR_LEAD_TIME_DAYS, closed)

// "4 PM", "4:30 PM", "12 AM" (midnight).
export function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60
  const ap = h >= 12 ? 'PM' : 'AM', h12 = ((h + 11) % 12) + 1
  return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`
}
export const fmtHours = (start: number, end: number) => `${fmtTime(start)}–${fmtTime(end)}`

// ─── Pickup, return, late (step 3) ───────────────────────────────────────────

// "Now" as a stamp in the studio's time zone, e.g. '2026-10-16T09:41'.
export function nowStamp(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

// A stamp moved by some minutes ('…T24:00' counts as midnight at the end of that day).
export function addMinutes(s: string, minutes: number): string {
  const total = Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) + minutes
  const dayShift = Math.floor(total / 1440), m = ((total % 1440) + 1440) % 1440
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dayShift)
  return stamp(d.toISOString().slice(0, 10), m)
}

export const PICKUP_OPENS_MINUTES = 30   // the pickup check opens 30 min before the start (owner, Oct 13)

// When the creator can do the pickup check: from 30 min before the start until the end.
export const pickupOpensAt = (from: string) => addMinutes(from, -PICKUP_OPENS_MINUTES)
export function pickupWindow(b: { from: string; to: string }, now: string): 'early' | 'open' | 'over' {
  if (now < pickupOpensAt(b.from)) return 'early'
  return now < b.to ? 'open' : 'over'
}

// Late from 30 minutes after it was due back, while still out.
export const gearDueBy = (to: string) => addMinutes(to, GEAR_LATE_MINUTES)
export const isGearLate = (b: { status: string; to: string }, now: string) => b.status === 'out' && now >= gearDueBy(b.to)
export const wasGearReturnedLate = (b: { to: string; returnedAt?: string | null }) => !!b.returnedAt && b.returnedAt >= gearDueBy(b.to)

// Every single piece to tick, one line per unit ("NP-FZ100 battery 1 of 2").
export interface CheckLine { key: string; offerId: string; itemId: string; name: string; unit: number; of: number }
export function checkLines(lines: { offerId: string; kind: string; qty: number; name: string; pieces: { itemId: string; qty: number; name: string }[] }[]): CheckLine[] {
  const out: CheckLine[] = []
  for (const l of lines) {
    const pieces = l.kind === 'extra' ? [{ itemId: l.pieces[0]?.itemId ?? l.offerId, qty: l.qty, name: l.name }] : l.pieces
    for (const p of pieces) for (let u = 1; u <= p.qty; u++) {
      out.push({ key: `${l.offerId}|${p.itemId}|${u}`, offerId: l.offerId, itemId: p.itemId, name: p.name || l.name, unit: u, of: p.qty })
    }
  }
  return out
}

// Turn ticked-as-missing keys into counts per piece: [{offerId, itemId, name, qty}].
export function countMissing(lines: CheckLine[], missingKeys: string[]) {
  const m = new Map<string, { offerId: string; itemId: string; name: string; qty: number }>()
  for (const l of lines) if (missingKeys.includes(l.key)) {
    const k = `${l.offerId}|${l.itemId}`
    const e = m.get(k) ?? { offerId: l.offerId, itemId: l.itemId, name: l.name, qty: 0 }
    e.qty++; m.set(k, e)
  }
  return [...m.values()]
}
