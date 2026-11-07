// The creator dashboard (owner, Oct 20): how much each creator films, and every flag on their record
// (late props/gear, missed check-ins, no-shows, late cancels, late starts, running over, mess, strikes).
// Pure, so it's unit-tested; the screens feed it what the security rules let owner + admins read.
import { isLate, wasReturnedLate, type ClosedDays } from '../../functions/src/booking'
import { isGearLate, nowStamp } from '../../functions/src/gearBooking'
import { expectsCheckIn } from '../../functions/src/schedule'

export const LATE_START_MINUTES = 15   // checked in more than 15 min after the slot started = started late

export interface StatShoot {
  id: string; creatorEmail: string; creatorName: string; date: string; from: string; to: string; place: string; where?: string
  status: string; checkin?: { at: string } | null; outcome?: string | null; noShow?: string | null; lateCancel?: boolean; toCheck?: boolean
}
export interface StatProps { id: string; creatorEmail: string; creatorName?: string; title: string; status: string; endDate: string; returnInfo?: { at: string } | null; checkedInAt?: string }
export interface StatGear { id: string; creatorEmail: string; creatorName?: string; title: string; status: string; to: string; date: string; returnedLate?: boolean; usedBy?: string[]; crewEmails?: string[]; pickup?: { by: string } | null; late?: { by: string } | null }
export interface StatReport { id: string; onEmail: string; onName: string; date: string; overMinutes: number; mess: boolean; status: string; note?: string; onShootId: string }
export interface StatStrike { id?: string; email: string; reason: string; at: string; shootId?: string; note?: string; about?: string; removedAt?: string; flagId?: string }

export type FlagKind = 'no-show' | 'missed-checkin' | 'late-cancel' | 'late-start' | 'ran-over' | 'mess' | 'late-props' | 'late-gear' | 'strike'
// id = the same flag id Analytics uses (e.g. 'no-show:<shootId>'), so an excuse given there applies here too.
export interface Flag { id?: string; kind: FlagKind; date: string; text: string; to?: string; open?: boolean; strikeId?: string }

export const FLAG_LABEL: Record<FlagKind, string> = {
  'no-show': 'No-shows', 'missed-checkin': 'No check-in', 'late-cancel': 'Late cancels', 'late-start': 'Started late',
  'ran-over': 'Ran over', mess: 'Left a mess', 'late-props': 'Late props', 'late-gear': 'Late gear', strike: 'Strikes',
}
// The serious ones show red, the rest amber. Same list as Analytics (SERIOUS_KINDS), for the kinds this screen tracks.
export const SERIOUS: FlagKind[] = ['no-show', 'late-cancel', 'strike']

export interface CreatorStats {
  email: string; name: string
  booked: number      // shoots in the period that have happened (free cancels don't count)
  filmed: number      // checked in or marked filmed
  upcoming: number    // booked, still to come
  flags: Flag[]
  counts: Partial<Record<FlagKind, number>>
}

const minutesBetween = (a: string, b: string) => (new Date(b + ':00').getTime() - new Date(a + ':00').getTime()) / 60000

export function creatorStats(opts: {
  from: string; now: string; closed: ClosedDays
  shoots: StatShoot[]; props: StatProps[]; gear: StatGear[]; reports: StatReport[]; strikes: StatStrike[]
  people?: { email: string; name: string }[]
  checksIn?: (email: string) => boolean   // who can check in with the app (see analytics.ts)
  excused?: Set<string>                   // flag ids excused in Analytics (flag_reviews): they don't count here either
}): CreatorStats[] {
  const { from, now, closed } = opts
  const nowDate = new Date(now + ':00')
  const m = new Map<string, CreatorStats>()
  const get = (email: string, name?: string) => {
    let c = m.get(email)
    if (!c) { c = { email, name: name || email, booked: 0, filmed: 0, upcoming: 0, flags: [], counts: {} }; m.set(email, c) }
    else if (name && c.name === email) c.name = name
    return c
  }
  // The strike that came with a flag (same matching as analytics.ts): automatic ones by shoot + reason, by-hand ones by flag id.
  const live = opts.strikes.filter(st => !st.removedAt && st.id)
  const strikeFor = (reason: string, shootId: string) => live.find(st => st.reason === reason && st.shootId === shootId)?.id
  const byFlag = new Map(live.filter(st => st.flagId).map(st => [st.flagId!, st.id!]))
  const attached = new Set<string>()
  const flag = (c: CreatorStats, f: Flag) => {
    if (f.id && opts.excused?.has(f.id)) return
    if (f.id && !f.strikeId) f.strikeId = byFlag.get(f.id)
    if (f.strikeId) attached.add(f.strikeId)
    c.flags.push(f); c.counts[f.kind] = (c.counts[f.kind] ?? 0) + 1
  }
  for (const p of opts.people ?? []) get(p.email, p.name)

  const place = (x: StatShoot) => x.place === 'offsite' ? (x.where || 'offsite') : x.place === 'cliff1' ? 'Cliff 1' : 'Cliff 2'
  for (const x of opts.shoots) {
    if (x.date < from) continue
    const c = get(x.creatorEmail, x.creatorName)
    const to = `/schedule?shoot=${x.id}`
    if (x.status === 'cancelled') {
      if (x.noShow === 'late-cancel' || x.lateCancel) { c.booked++; flag(c, { id: `late-cancel:${x.id}`, strikeId: strikeFor('late-cancel', x.id), kind: 'late-cancel', date: x.date, text: `Cancelled ${place(x)} too close to the shoot`, to }) }
      continue
    }
    // Only approved shoots count (same rules as Analytics, audit Nov 5): not requests, denied/ran-out ones or unconfirmed imports.
    if (x.status !== 'booked' || x.toCheck) continue
    if (x.to > now) { c.upcoming++; continue }
    c.booked++
    const decidedNo = !!x.noShow || x.outcome === 'noshow'
    const trusted = !expectsCheckIn(x as never, opts.checksIn)   // same rule as Analytics (schedule.ts)
    if (x.checkin || x.outcome === 'filmed' || (trusted && !decidedNo)) {
      c.filmed++
      // Check-ins are saved in UTC; shoot times are studio (Toronto) time.
      const late = x.checkin ? minutesBetween(x.from, nowStamp(new Date(x.checkin.at))) : 0
      if (late > LATE_START_MINUTES) flag(c, { id: `late-start:${x.id}`, kind: 'late-start', date: x.date, text: `Checked in ${Math.round(late)} min after the start at ${place(x)}`, to })
    } else if (x.noShow || x.outcome === 'noshow') flag(c, { id: `no-show:${x.id}`, strikeId: strikeFor('no-show', x.id), kind: 'no-show', date: x.date, text: `No-show at ${place(x)}`, to })
    else flag(c, { id: `missed-checkin:${x.id}`, kind: 'missed-checkin', date: x.date, text: `No check-in at ${place(x)} (waiting for a decision)`, to, open: true })
  }

  for (const r of opts.reports) {
    if (r.date < from || r.status === 'dismissed') continue
    const c = get(r.onEmail, r.onName)
    const to = `/schedule?shoot=${r.onShootId}`
    const tail = r.status === 'open' ? ' (reported, not reviewed yet)' : ''
    const strikeId = r.status === 'upheld' ? strikeFor('report', r.onShootId) : undefined
    if (r.overMinutes) flag(c, { id: `ran-over:${r.id}`, strikeId, kind: 'ran-over', date: r.date, text: `Ran over ${r.overMinutes} min into the next slot${tail}`, to, open: r.status === 'open' })
    if (r.mess) flag(c, { id: `mess:${r.id}`, strikeId, kind: 'mess', date: r.date, text: `Left the house a mess${tail}`, to, open: r.status === 'open' })
  }

  for (const r of opts.props) {
    if (r.endDate < from) continue
    const at = r.returnInfo?.at ?? r.checkedInAt
    const c = get(r.creatorEmail, r.creatorName)
    const to = `/reservations/${r.id}`
    if (isLate(r.status, r.endDate, closed, nowDate)) flag(c, { id: `late-props:${r.id}`, kind: 'late-props', date: r.endDate, text: `"${r.title}" props are late right now`, to, open: true })
    else if ((r.status === 'return_pending' || r.status === 'returned') && at && wasReturnedLate(r.endDate, at, closed)) flag(c, { id: `late-props:${r.id}`, kind: 'late-props', date: r.endDate, text: `"${r.title}" props came back late`, to })
  }

  for (const g of opts.gear) {
    if (g.date < from) continue
    const to = `/gear/bookings/${g.id}`
    // Late gear goes on the LAST person to have it (owner, Oct 27): saved at the return / hand-over, else whoever signed for it.
    const who = [g.late?.by ?? (g.pickup?.by && [g.creatorEmail, ...(g.crewEmails ?? [])].includes(g.pickup.by) ? g.pickup.by : g.creatorEmail)]
    const lateNow = isGearLate(g, now), lateBack = !!g.returnedLate
    if (!lateNow && !lateBack) continue
    for (const email of who) {
      flag(get(email, email === g.creatorEmail ? g.creatorName : undefined), {
        id: `late-gear:${g.id}:${email.replace(/[^\w-]/g, '-')}`, kind: 'late-gear', date: g.date, text: lateNow ? `"${g.title}" gear is late right now` : `"${g.title}" gear came back late`, to, open: lateNow,
      })
    }
  }

  for (const s of opts.strikes) {
    if (s.at.slice(0, 10) < from || s.removedAt) continue   // removed strikes don't count
    // A strike that came with a no-show, late cancel or upheld report on a shoot is already that flag (audit, Nov 5).
    // Those strikes show (with Remove) on their flag instead.
    if ((s.id && attached.has(s.id)) || s.flagId || (s.reason !== 'manual' && s.shootId)) continue
    const c = get(s.email)
    const why = s.reason === 'manual' ? `${s.about && s.about !== 'other' ? `${s.about}: ` : ''}${s.note ?? 'given by an admin'}`
      : s.reason === 'late-cancel' ? 'late cancel' : s.reason === 'report' ? 'upheld report' : 'no-show'
    flag(c, { id: s.id ? `strike:${s.id}` : undefined, kind: 'strike', date: s.at.slice(0, 10), text: `Strike: ${why}`, to: s.shootId ? `/schedule?shoot=${s.shootId}` : undefined, strikeId: s.id })
  }

  for (const c of m.values()) c.flags.sort((a, b) => b.date.localeCompare(a.date))
  return [...m.values()].sort((a, b) => (b.filmed - a.filmed) || (b.booked - a.booked) || a.name.localeCompare(b.name))
}

// Every live strike on their record in the period: stand-alone ones and the ones that came with a flag.
export const strikeTotal = (c: CreatorStats) => c.flags.filter(f => f.strikeId).length
export const flagTotal = (c: CreatorStats, kinds?: FlagKind[]) => Object.entries(c.counts).filter(([k]) => !kinds || kinds.includes(k as FlagKind)).reduce((n, [, v]) => n + (v ?? 0), 0)

// Filming per week for the dashboard chart: the last `weeks` weeks (Monday to Sunday), oldest first.
// booked = shoots that have happened (late cancels count, free cancels don't); filmed = checked in or marked filmed.
export function weeklyFilming(shoots: StatShoot[], today: string, now: string, weeks = 8) {
  const d = new Date(today + 'T12:00:00Z')
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  const out = Array.from({ length: weeks }, (_, i) => {
    const s = new Date(monday); s.setUTCDate(monday.getUTCDate() - 7 * (weeks - 1 - i))
    const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6)
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), booked: 0, filmed: 0 }
  })
  for (const x of shoots) {
    const w = out.find(w => x.date >= w.start && x.date <= w.end)
    if (!w) continue
    if (x.status === 'cancelled') { if (x.noShow === 'late-cancel' || x.lateCancel) w.booked++; continue }
    if (x.to > now) continue
    w.booked++
    if (x.checkin || x.outcome === 'filmed') w.filmed++
  }
  return out
}
