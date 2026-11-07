// Which shoot a props request or a gear booking is for, as one line (owner, Nov 7):
//   "Cliff 1 · Sat, Nov 8 · 1–3 PM · Riley"
// Read from the schedule's day doc (schedule_days/{date}), which every team can read; the arts team can't read shoots/.
import type { ScheduleDay, House } from '../../functions/src/schedule'
import { fmtTime } from '../../functions/src/gearBooking'
import { formatDay } from './dates'

export interface ShootSpot { place: House | 'offsite'; where?: string; date: string; start: number; end: number; name: string; email?: string }

// "1–3 PM", "11 AM–1 PM", "11 PM–1 AM" (the first AM/PM is dropped only when both ends share it and it's under 12 hours).
export function compactHours(start: number, end: number): string {
  const a = fmtTime(start), b = fmtTime(end)
  return end > start && end - start < 720 && a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`
}

// Where and when the shoot is on that day: a house slot (or several slots in a row, or an imported shoot's real hours),
// an offsite shoot, or an imported shoot listed as a clash. A move still waiting for approval isn't the shoot's spot yet.
export function findShootOnDay(day: ScheduleDay | null | undefined, shootId: string | undefined, slotMinutes: number): ShootSpot | null {
  if (!day || !shootId) return null
  for (const h of ['cliff1', 'cliff2'] as const) {
    const hits = Object.entries(day[h] ?? {}).filter(([, e]) => e.shootId === shootId && !e.move)
    if (!hits.length) continue
    const e = hits[0][1], starts = hits.map(([k]) => Number(k))
    return { place: h, date: day.date, start: e.time?.start ?? Math.min(...starts), end: e.time?.end ?? Math.max(...starts) + slotMinutes, name: e.name, email: e.email }
  }
  const o = (day.offsite ?? []).find(x => x.shootId === shootId && !x.move)
  if (o) return { place: 'offsite', where: o.where, date: day.date, start: o.start, end: o.end, name: o.name, email: o.email }
  const c = (day.clashes ?? []).find(x => x.shootId === shootId && !x.blockId)
  if (c) return { place: c.house, date: day.date, start: c.start, end: c.end, name: c.name, email: c.email }
  return null
}

// Cards: an offsite address can be up to 200 characters, which would push the day, hours and name off the card.
// Keep what's before the first comma ("123 Rue Saint-Paul Ouest, Montréal" → "123 Rue Saint-Paul Ouest"), at most 24 characters.
export const SHORT_PLACE_MAX = 24
export function shortPlace(where: string): string {
  const first = (where.split(',')[0] ?? '').replace(/\s+/g, ' ').trim() || where.trim()
  return first.length > SHORT_PLACE_MAX ? `${first.slice(0, SHORT_PLACE_MAX - 1).trimEnd()}…` : first
}

// "Cliff 1", or where an offsite shoot is ("Offsite" when that's only a map link). `short` = cut for a card (shortPlace).
export function placeName(spot: ShootSpot, houses: Record<House, { name: string }>, short = false): string {
  const where = (spot.where ?? '').trim()
  if (spot.place !== 'offsite') return houses[spot.place]?.name ?? spot.place
  if (!where || /^https?:\/\//i.test(where)) return 'Offsite'
  return short ? shortPlace(where) : where
}

// The one line. The name is left out when it's the person looking (their own request). `short` = for a card.
export function shootLineText(spot: ShootSpot, houses: Record<House, { name: string }>, viewer?: string, short = false): string {
  const name = spot.email && viewer && spot.email === viewer ? '' : spot.name
  return [placeName(spot, houses, short), formatDay(spot.date), compactHours(spot.start, spot.end), name].filter(Boolean).join(' · ')
}
