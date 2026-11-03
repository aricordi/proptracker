// What the team needs to decide on a booking request, worked out once for the phone card and the laptop board:
// who's asking (last 30 days, what's coming up, strikes, other requests), what's around that time, and who they usually film
// with (owner, Nov 2: "establish a pattern of who they like to film with").
import { addDays } from '../../functions/src/booking'
import { addMinutes } from '../../functions/src/gearBooking'
import { slotKey, blockAt, fmtSlot, BLOCK_TYPES, HOUSES, type House, type Place, type Shoot, type ScheduleDay, type ScheduleSettings, type UserStatus } from '../services/schedule'
import { collabPairs, partnersOf, neighboursOf, usual, type Partner, type Pair } from '../lib/collabs'

export interface Req { shoot: Shoot; move: boolean; place: Place; date: string; start: number; end: number; from: string; where: string; since: string }

/** Requests waiting: new bookings + moves of approved shoots, that haven't started yet. */
export function waitingRequests(shoots: Shoot[], now: string): Req[] {
  return shoots.flatMap((sh): Req[] => {
    if (sh.status === 'requested' && sh.from > now) return [{ shoot: sh, move: false, place: sh.place, date: sh.date, start: sh.start, end: sh.end, from: sh.from, where: sh.where ?? '', since: sh.requestedAt ?? sh.createdAt }]
    const m = sh.moveRequest
    if (sh.status === 'booked' && m && m.from > now) return [{ shoot: sh, move: true, place: m.place, date: m.date, start: m.start, end: m.end, from: m.from, where: m.where, since: m.at }]
    return []
  })
}
/** Soonest first, but people who lost a slot to someone with priority go first (their next request). */
export function sortReqs(reqs: Req[], statuses: Record<string, UserStatus>) {
  const first = (r: Req) => statuses[r.shoot.creatorEmail]?.firstInLine && !r.move ? 0 : 1
  return [...reqs].sort((a, b) => first(a) - first(b) || a.date.localeCompare(b.date) || a.start - b.start)
}
export const reqKey = (r: Req) => `${r.shoot.id}${r.move ? '-m' : ''}`
export const placeName = (p: Place, where: string, s: ScheduleSettings) => p === 'offsite' ? (where || 'Offsite') : s.houses[p].name
export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
export const hoursWaiting = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000
export const REASONS = ['The house is busy then', 'Too many bookings this week', 'Please pick another time']

export type Tone = 'red' | 'amber' | 'green' | 'gold' | 'muted'
export interface Facts {
  flags: { tone: Tone; text: string }[]
  filmed: number; past30: number; upcoming: number; thisMonth: number; sameWeek: number; noShows: number; otherReqs: number; paused: boolean
  weekly: number[]          // shoots per week, last 8 weeks (oldest first)
  around: { label: string; value: string }[]
  partners: Partner[]       // usual partners first
  nextTo: { name: string; usual: boolean }[]   // who they'd be back to back with
}

const weekOf = (d: string) => Math.floor(new Date(`${d}T12:00:00Z`).getTime() / (7 * 86400000))

export function factsFor(r: Req, shoots: Shoot[], status: UserStatus | undefined, days: Record<string, ScheduleDay> | null, s: ScheduleSettings,
  today: string, now: string, pairs: Pair[] = collabPairs(shoots)): Facts {
  const sh = r.shoot, email = sh.creatorEmail
  const theirs = shoots.filter(x => x.creatorEmail === email)
  const past30s = theirs.filter(x => x.status === 'booked' && x.date >= addDays(today, -30) && x.to <= now)
  const filmed = past30s.filter(x => x.checkin || x.outcome === 'filmed').length
  const noShows = theirs.filter(x => x.noShow && x.date >= addDays(today, -30)).length
  const upcomingL = theirs.filter(x => x.status === 'booked' && x.from > now)
  const sameWeek = upcomingL.filter(x => x.id !== sh.id && Math.abs(new Date(`${x.date}T12:00:00Z`).getTime() - new Date(`${r.date}T12:00:00Z`).getTime()) < 4 * 86400000).length
  const otherReqs = theirs.filter(x => x.id !== sh.id && x.status === 'requested' && x.from > now).length
  const thisMonth = theirs.filter(x => (x.status === 'booked' || x.status === 'requested') && x.date.slice(0, 7) === r.date.slice(0, 7) && x.id !== sh.id).length
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const w0 = weekOf(today)
  const weekly = Array.from({ length: 8 }, (_, i) => theirs.filter(x => x.status === 'booked' && x.to <= now && weekOf(x.date) === w0 - 7 + i).length)

  const around: Facts['around'] = []
  const day = days?.[r.date]
  if (r.place !== 'offsite') {
    const h = r.place as House, other = HOUSES.find(x => x !== h)!
    const who = (house: House, st: number) => { const e = day?.[house]?.[slotKey(st)]; return e && !e.hold && e.shootId !== sh.id ? `${e.name}${e.pending ? ' (requested)' : ''}` : '' }
    if (blockAt(day, h, r.start, s.slotMinutes)) around.push({ label: '⚠ At that time', value: 'Blocked' })
    around.push({ label: 'Before (same house)', value: who(h, r.start - s.slotMinutes) || 'Free' })
    around.push({ label: 'After (same house)', value: who(h, r.start + s.slotMinutes) || 'Free' })
    around.push({ label: `${s.houses[other].name}, same time`, value: who(other, r.start) || 'Free' })
    const blocks = (day?.blocks ?? []).filter(b => b.house === h)
    if (blocks.length) around.push({ label: 'Blocked that day', value: blocks.map(b => `${b.note || BLOCK_TYPES[b.type]} ${fmtSlot(b.start, b.end - b.start)}`).join(', ') })
  }

  const partners = partnersOf(email, shoots, pairs)
  const usualSet = new Set(usual(partners).map(p => p.email))
  const probe = { ...sh, place: r.place, date: r.date, from: r.from, to: addMinutes(r.from, r.end - r.start) }
  const nextTo = neighboursOf(probe, shoots).map(x => ({ name: x.creatorName, usual: usualSet.has(x.creatorEmail) }))

  const flags: Facts['flags'] = []
  if (status?.firstInLine && !r.move) flags.push({ tone: 'gold', text: `Goes first · lost a slot to ${status.firstInLine.forName.split(' ')[0]}` })
  if (paused) flags.push({ tone: 'red', text: 'Paused' })
  if (status?.strikes) flags.push({ tone: 'red', text: `${status.strikes} strike${status.strikes === 1 ? '' : 's'}` })
  if (noShows) flags.push({ tone: 'red', text: `${noShows} no-show${noShows === 1 ? '' : 's'} (30 days)` })
  if (sameWeek >= 2) flags.push({ tone: 'amber', text: `${sameWeek} already that week` })
  if (otherReqs) flags.push({ tone: 'amber', text: `${otherReqs} other request${otherReqs === 1 ? '' : 's'} waiting` })
  for (const n of nextTo) flags.push({ tone: n.usual ? 'gold' : 'muted', text: `Back to back with ${n.name.split(' ')[0]}${n.usual ? ' · usual partner' : ''}` })
  if (!noShows && past30s.length >= 2 && filmed === past30s.length) flags.push({ tone: 'green', text: 'Shows up every time' })
  return { flags, filmed, past30: past30s.length, upcoming: upcomingL.length, thisMonth, sameWeek, noShows, otherReqs, paused, weekly, around,
    partners: [...usual(partners), ...partners.filter(p => !usualSet.has(p.email))], nextTo }
}

export const partnerLine = (ps: Partner[], max = 3) => ps.slice(0, max).map(p => `${p.name.split(' ')[0]} ×${p.times}`).join(' · ')
