// Analytics (owner, Oct 20: "a robust analytics framework… track what each creator is producing, weekly and monthly,
// averages over time, creators with flags and what kind, drill down like Power BI, and the props + equipment teams'
// work, since admins manage them as employees"). Pure: the screen feeds it what owner + admins may read.
// Everything becomes FACTS (one per shoot that happened), INCIDENTS (one per flag) and JOBS (one per team task), each
// with a date, so any of them can be grouped by week or month, creator, house, flag type or staff member.
import { pickupDay, type ClosedDays } from '../../functions/src/booking'
import { isGearLate, nowStamp } from '../../functions/src/gearBooking'
import { isLate, wasReturnedLate, returnDueDay, RETURN_DEADLINE_HOUR } from '../../functions/src/booking'

export type Grain = 'week' | 'month'
export type House = 'cliff1' | 'cliff2' | 'offsite'
export const LATE_START_MIN = 15

// ── Flags, grouped into the themes the owner asked about ──
export type Kind = 'no-show' | 'late-cancel' | 'late-start' | 'ran-over' | 'mess' | 'missed-checkin' | 'no-wrap'
  | 'late-props' | 'late-gear' | 'props-damaged' | 'gear-missing' | 'invite-lapsed' | 'strike'
export const KIND: Record<Kind, { label: string; means: string }> = {
  'no-show': { label: 'No-show', means: 'Booked the house and never came (decided by the team).' },
  'late-cancel': { label: 'Late cancel', means: 'Cancelled inside the notice period.' },
  'late-start': { label: 'Started late', means: `Checked in more than ${LATE_START_MIN} minutes after the slot began.` },
  'ran-over': { label: 'Ran over', means: 'The next creator reported they went past their slot.' },
  mess: { label: 'Left a mess', means: 'The next creator reported the house was left a mess.' },
  'missed-checkin': { label: 'No check-in', means: 'Never checked in with a set photo (still waiting for a decision).' },
  'no-wrap': { label: 'No wrap', means: "Checked in but never wrapped (didn't say what they filmed)." },
  'late-props': { label: 'Late props', means: 'Props came back after the deadline, or are still out.' },
  'late-gear': { label: 'Late gear', means: 'Gear came back more than 30 minutes after its end time, or is still out. Late return fee: 10% of its value (on whoever had it last).' },
  'props-damaged': { label: 'Props damaged or missing', means: 'Checked in by the arts department as damaged or missing.' },
  'gear-missing': { label: 'Gear pieces missing', means: 'A piece was missing at check-in or at the next pickup, on their watch.' },
  'invite-lapsed': { label: "Didn't confirm", means: 'A friend held a slot for them and they let the hold run out.' },
  strike: { label: 'Strike', means: 'A strike on their record (automatic or given by an admin), not removed.' },
}
export const THEMES: { key: string; label: string; kinds: Kind[] }[] = [
  { key: 'abandoned', label: 'Abandoning shoots', kinds: ['no-show', 'late-cancel'] },
  { key: 'time', label: 'Not finishing on time', kinds: ['late-start', 'ran-over'] },
  { key: 'house', label: 'Leaving the house a mess', kinds: ['mess'] },
  { key: 'proof', label: 'Skipping check-in photos and wraps', kinds: ['missed-checkin', 'no-wrap'] },
  { key: 'returns', label: 'Late or broken returns', kinds: ['late-props', 'late-gear', 'props-damaged', 'gear-missing'] },
  { key: 'confirm', label: 'Not confirming in time', kinds: ['invite-lapsed'] },
  { key: 'strikes', label: 'Strikes', kinds: ['strike'] },
]
export const SERIOUS_KINDS: Kind[] = ['no-show', 'late-cancel', 'strike', 'props-damaged', 'gear-missing']

// ── Inputs (only the fields used) ──
export interface AShoot { id: string; creatorEmail: string; creatorName: string; date: string; from: string; to: string; place: string; where?: string
  status: string; checkin?: { at: string } | null; wrap?: { at: string; title: string } | null; outcome?: string | null; noShow?: string | null; lateCancel?: boolean }
interface Hist { at: string; by?: string; status?: string; action?: string }
export interface AProps { id: string; creatorEmail: string; creatorName?: string; title: string; status: string; startDate: string; endDate: string
  history?: Hist[]; lines?: { itemName: string; checkIn?: { result: string } }[]; returnInfo?: { at: string } | null; scheduleShootId?: string }
export interface AGear { id: string; creatorEmail: string; creatorName?: string; title: string; status: string; date: string; to: string
  returnedLate?: boolean; usedBy?: string[]; crewEmails?: string[]; pickup?: { by: string } | null; history?: Hist[]
  value?: number; valueMissing?: number; late?: { minutes: number; dueAt: string; backAt: string; by: string; byName?: string; value: number; valueMissing: number } | null
  problems?: { kind: string; name?: string; usedBy?: string[] }[]; returnedAt?: string }
export interface AReport { id: string; onEmail: string; onName: string; date: string; overMinutes: number; mess: boolean; status: string; onShootId: string; byName?: string }
export interface AStrike { id: string; email: string; reason: string; at: string; note?: string; about?: string; removedAt?: string; shootId?: string; flagId?: string }
export interface AInvite { id: string; toEmail: string; toName: string; fromName: string; date: string; until: string; status: string; place: string }

// ── Outputs ──
export interface Fact { id: string; email: string; name: string; date: string; house: House; filmed: boolean; title?: string; to: string }
// id = stable flag id ('<kind>:<source id>…'), used to remember what an admin did about it (flag_reviews).
// src = where it came from (for the evidence on the flag sheet); strikeId = the strike that came with it, if any.
export interface Incident { id: string; kind: Kind; email: string; name: string; date: string; house?: House; text: string; to?: string; open?: boolean
  src: { type: 'shoot' | 'report' | 'props' | 'gear' | 'strike' | 'invite'; id: string }; shootId?: string; strikeId?: string; late?: LateInfo }
// LATE RETURNS (owner, Oct 27): how late, and what it was worth, for the late return fee (gear only for now: 10% of the
// value; props are logged too, with no fee). dueAt/backAt are studio times 'YYYY-MM-DDTHH:MM'; minutes = past the end
// time for gear (late from 30 min), past the 10 AM deadline for props. value null = not recorded (older bookings).
export interface LateInfo { minutes: number; dueAt: string; backAt?: string; still: boolean; fee: boolean; value: number | null; valueMissing: number }
export interface Job { team: 'props' | 'gear'; kind: 'packed' | 'checked-in'; by: string; date: string; hours: number; onTime?: boolean; to: string; title: string }
export interface Backlog { propsToPack: number; propsPackLate: number; propsToCheckIn: number; gearToCheckIn: number; gearOutLate: number; propsOutLate: number }

const houseOf = (place: string): House => place === 'cliff1' || place === 'cliff2' ? place : 'offsite'
const local = (iso: string) => nowStamp(new Date(iso))            // UTC ISO → studio 'YYYY-MM-DDTHH:MM'
const hoursBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000)
const minutesLocal = (a: string, b: string) => (new Date(b + ':00').getTime() - new Date(a + ':00').getTime()) / 60000

const slug = (e: string) => e.replace(/[^\w-]/g, '-')
export function analyze(o: { now: string; closed: ClosedDays; shoots: AShoot[]; props: AProps[]; gear: AGear[]; reports: AReport[]
  strikes: AStrike[]; invites: AInvite[]; excused?: Set<string> }) {
  const { now, closed } = o
  const nowDate = new Date(now + ':00'), today = now.slice(0, 10)
  const facts: Fact[] = [], incidents: Incident[] = [], jobs: Job[] = [], upcoming: { email: string; date: string; id: string }[] = []
  const names = new Map<string, string>()
  const name = (email: string, n?: string) => { if (n && !names.has(email)) names.set(email, n); return names.get(email) ?? n ?? email.split('@')[0] }
  const excused: Incident[] = []
  const add = (i: Omit<Incident, 'name'> & { name?: string }) => (o.excused?.has(i.id) ? excused : incidents).push({ ...i, name: name(i.email, i.name) })
  // The strike that came with a flag: automatic ones by shoot + reason, by-hand ones by flag id.
  const live = o.strikes.filter(s => !s.removedAt)
  const strikeFor = (reason: string, shootId: string) => live.find(s => s.reason === reason && s.shootId === shootId)?.id
  const byFlag = new Map(live.filter(s => s.flagId).map(s => [s.flagId!, s.id]))
  const sh = (kind: Kind, id: string) => ({ id: `${kind}:${id}`, src: { type: 'shoot' as const, id }, shootId: id })
  const houseOfShoot = new Map(o.shoots.map(x => [x.id, houseOf(x.place)]))

  for (const x of o.shoots) {
    const house = houseOf(x.place), to = `/schedule?shoot=${x.id}`
    name(x.creatorEmail, x.creatorName)
    if (x.status === 'cancelled') {
      if (x.noShow === 'late-cancel' || x.lateCancel) {
        facts.push({ id: x.id, email: x.creatorEmail, name: name(x.creatorEmail), date: x.date, house, filmed: false, to })
        add({ ...sh('late-cancel', x.id), strikeId: strikeFor('late-cancel', x.id), kind: 'late-cancel', email: x.creatorEmail, date: x.date, house, text: 'Cancelled too close to the shoot', to })
      }
      continue
    }
    if (x.to > now) { upcoming.push({ email: x.creatorEmail, date: x.date, id: x.id }); continue }
    const filmed = !!x.checkin || x.outcome === 'filmed'
    facts.push({ id: x.id, email: x.creatorEmail, name: name(x.creatorEmail), date: x.date, house, filmed, title: x.wrap?.title, to })
    if (filmed) {
      if (x.checkin) {
        const late = minutesLocal(x.from, local(x.checkin.at))
        if (late > LATE_START_MIN) add({ ...sh('late-start', x.id), kind: 'late-start', email: x.creatorEmail, date: x.date, house, text: `Checked in ${Math.round(late)} min late`, to })
        if (!x.wrap && house !== 'offsite') add({ ...sh('no-wrap', x.id), kind: 'no-wrap', email: x.creatorEmail, date: x.date, house, text: "Checked in, never wrapped (didn't say what they filmed)", to })
      }
    } else if (x.noShow || x.outcome === 'noshow') add({ ...sh('no-show', x.id), strikeId: strikeFor('no-show', x.id), kind: 'no-show', email: x.creatorEmail, date: x.date, house, text: 'No-show', to })
    else if (house !== 'offsite') add({ ...sh('missed-checkin', x.id), kind: 'missed-checkin', email: x.creatorEmail, date: x.date, house, text: 'No check-in, waiting for a decision', to, open: true })
  }

  for (const r of o.reports) {
    if (r.status === 'dismissed') continue
    const to = `/schedule?shoot=${r.onShootId}`, tail = r.status === 'open' ? ' (not reviewed yet)' : ''
    const rs = (kind: Kind) => ({ id: `${kind}:${r.id}`, src: { type: 'report' as const, id: r.id }, shootId: r.onShootId, strikeId: r.status === 'upheld' ? strikeFor('report', r.onShootId) : undefined })
    if (r.overMinutes) add({ ...rs('ran-over'), kind: 'ran-over', email: r.onEmail, name: r.onName, date: r.date, house: houseOfShoot.get(r.onShootId), text: `Ran over ${r.overMinutes} min${tail}`, to, open: r.status === 'open' })
    if (r.mess) add({ ...rs('mess'), kind: 'mess', email: r.onEmail, name: r.onName, date: r.date, house: houseOfShoot.get(r.onShootId), text: `Left the house a mess${tail}`, to, open: r.status === 'open' })
  }

  const backlog: Backlog = { propsToPack: 0, propsPackLate: 0, propsToCheckIn: 0, gearToCheckIn: 0, gearOutLate: 0, propsOutLate: 0 }
  for (const r of o.props) {
    const to = `/reservations/${r.id}`, h = r.history ?? []
    name(r.creatorEmail, r.creatorName)
    const pr = (kind: Kind) => ({ id: `${kind}:${r.id}`, src: { type: 'props' as const, id: r.id }, shootId: r.scheduleShootId })
    // Creator side
    const propsDue = `${returnDueDay(r.endDate, closed)}T${String(RETURN_DEADLINE_HOUR).padStart(2, '0')}:00`
    const propsLate = (backAt: string | undefined): LateInfo => ({ minutes: Math.max(0, Math.round(minutesLocal(propsDue, backAt ?? now))), dueAt: propsDue, backAt, still: !backAt, fee: false, value: null, valueMissing: 0 })
    if (isLate(r.status, r.endDate, closed, nowDate)) { backlog.propsOutLate++; add({ ...pr('late-props'), kind: 'late-props', email: r.creatorEmail, date: r.endDate, text: `"${r.title}" props still out, late`, to, open: true, late: propsLate(undefined) }) }
    else {
      const back = h.find(e => e.status === 'return_pending')?.at ?? r.returnInfo?.at
      if (back && wasReturnedLate(r.endDate, back, closed)) add({ ...pr('late-props'), kind: 'late-props', email: r.creatorEmail, date: r.endDate, text: `"${r.title}" props came back late`, to, late: propsLate(local(back)) })
    }
    const bad = (r.lines ?? []).filter(l => l.checkIn && l.checkIn.result !== 'ok')
    if (bad.length) add({ ...pr('props-damaged'), kind: 'props-damaged', email: r.creatorEmail, date: r.endDate, text: `${bad.map(l => `${l.itemName} (${l.checkIn!.result})`).join(', ')} on "${r.title}"`, to })
    // Arts department side
    const requested = h[0]?.at, packed = h.find(e => e.status === 'packed'), returned = h.find(e => e.status === 'return_pending'), checked = h.find(e => e.status === 'returned')
    const pick = pickupDay(r.startDate, closed)
    if (packed?.by && requested) jobs.push({ team: 'props', kind: 'packed', by: packed.by, date: local(packed.at).slice(0, 10), hours: hoursBetween(requested, packed.at), onTime: local(packed.at).slice(0, 10) <= pick, to, title: r.title })
    if (checked?.by && returned) jobs.push({ team: 'props', kind: 'checked-in', by: checked.by, date: local(checked.at).slice(0, 10), hours: hoursBetween(returned.at, checked.at), to, title: r.title })
    if (r.status === 'requested' || r.status === 'preparing') { backlog.propsToPack++; if (pick <= today) backlog.propsPackLate++ }
    if (r.status === 'return_pending') backlog.propsToCheckIn++
  }

  for (const g of o.gear) {
    const to = `/gear/bookings/${g.id}`, h = g.history ?? []
    name(g.creatorEmail, g.creatorName)
    const users = g.usedBy?.length ? g.usedBy : [g.pickup?.by && [g.creatorEmail, ...(g.crewEmails ?? [])].includes(g.pickup.by) ? g.pickup.by : g.creatorEmail]
    const lateNow = isGearLate(g, now)
    if (lateNow) backlog.gearOutLate++
    // One late return, on the LAST person to have it (owner, Oct 27): whoever returned or handed it over (saved on the
    // booking), else whoever signed for it at pickup. Older returns without a record: whoever signed for it.
    if (lateNow || g.returnedLate) {
      const holder = g.pickup?.by && [g.creatorEmail, ...(g.crewEmails ?? [])].includes(g.pickup.by) ? g.pickup.by : g.creatorEmail
      const who = g.late?.by ?? holder
      const backAt = g.late?.backAt ?? g.returnedAt
      const v = g.late ?? (typeof g.value === 'number' ? { value: g.value, valueMissing: g.valueMissing ?? 0 } : null)
      const late: LateInfo = { minutes: Math.max(0, Math.round(minutesLocal(g.to, lateNow ? now : backAt ?? now))), dueAt: g.to, backAt: lateNow ? undefined : backAt,
        still: lateNow, fee: true, value: v ? v.value : null, valueMissing: v ? v.valueMissing : 0 }
      add({ id: `late-gear:${g.id}:${slug(who)}`, src: { type: 'gear', id: g.id }, kind: 'late-gear', email: who, name: who === g.late?.by ? g.late?.byName : undefined, date: g.date, text: lateNow ? `"${g.title}" gear still out, late` : `"${g.title}" gear came back late`, to, open: lateNow, late })
    }
    for (const [n, p] of (g.problems ?? []).entries()) {
      if (p.kind !== 'missing_at_checkin' && p.kind !== 'missing_after') continue
      for (const e of p.usedBy?.length ? p.usedBy : users) add({ id: `gear-missing:${g.id}:${n}:${slug(e)}`, src: { type: 'gear', id: g.id }, kind: 'gear-missing', email: e, date: g.date, text: `${p.name ?? 'A piece'} missing from "${g.title}"`, to })
    }
    const returned = h.find(e => e.action === 'returned'), checked = h.find(e => e.action === 'checked_in')
    if (checked?.by && returned) jobs.push({ team: 'gear', kind: 'checked-in', by: checked.by, date: local(checked.at).slice(0, 10), hours: hoursBetween(returned.at, checked.at), to, title: g.title })
    if (g.status === 'returned') backlog.gearToCheckIn++
  }

  for (const s of o.strikes) {
    if (s.removedAt) continue
    const why = s.reason === 'manual' ? `${s.about && s.about !== 'other' ? `${s.about}: ` : ''}${s.note ?? 'given by an admin'}` : s.reason === 'late-cancel' ? 'late cancel' : s.reason === 'report' ? 'upheld report' : 'no-show'
    add({ id: `strike:${s.id}`, src: { type: 'strike', id: s.id }, strikeId: s.id, shootId: s.shootId || undefined, kind: 'strike', email: s.email, date: local(s.at).slice(0, 10), house: s.shootId ? houseOfShoot.get(s.shootId) : undefined, text: `Strike: ${why}`, to: s.shootId ? `/schedule?shoot=${s.shootId}` : undefined })
  }
  for (const v of o.invites) {
    if (v.status === 'expired' || (v.status === 'pending' && local(v.until) < now))
      add({ id: `invite-lapsed:${v.id}`, src: { type: 'invite', id: v.id }, kind: 'invite-lapsed', email: v.toEmail, name: v.toName, date: v.date, house: houseOf(v.place), text: `Let ${v.fromName}'s held slot run out` })
  }
  for (const i of incidents) { i.name = name(i.email); i.strikeId ??= byFlag.get(i.id) }
  for (const i of excused) i.name = name(i.email)
  return { facts, incidents, excused, jobs, backlog, names, upcoming }
}

// ── Periods ──
const iso = (d: Date) => d.toISOString().slice(0, 10)
export function periodOf(date: string, grain: Grain) {
  if (grain === 'month') return date.slice(0, 7)
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d)
}
// The last n periods ending with the one holding `today`, oldest first.
export function periods(grain: Grain, today: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(periodOf(today, grain) + (grain === 'month' ? '-01' : '') + 'T12:00:00Z')
  for (let i = 0; i < n; i++) {
    out.unshift(grain === 'month' ? iso(d).slice(0, 7) : iso(d))
    if (grain === 'month') d.setUTCMonth(d.getUTCMonth() - 1); else d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}
export function periodLabel(p: string, grain: Grain, long = false) {
  const d = new Date((grain === 'month' ? p + '-01' : p) + 'T12:00:00Z')
  return grain === 'month' ? d.toLocaleDateString('en-CA', { month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    : `${long ? 'Week of ' : ''}${d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

// ── Grouping ──
export interface Filter { email?: string; house?: House; periods: string[]; grain: Grain }
const inFilter = (f: Filter) => (x: { email: string; date: string; house?: House }) =>
  (!f.email || x.email === f.email) && (!f.house || x.house === f.house) && f.periods.includes(periodOf(x.date, f.grain))

export function filterAll(a: ReturnType<typeof analyze>, f: Filter) {
  const ok = inFilter(f)
  // Report/strike incidents have no house; a house filter keeps only incidents that know their house.
  return { facts: a.facts.filter(ok), incidents: a.incidents.filter(ok) }
}
export function series(facts: Fact[], incidents: Incident[], f: Filter) {
  return f.periods.map(p => {
    const fs = facts.filter(x => periodOf(x.date, f.grain) === p), is = incidents.filter(x => periodOf(x.date, f.grain) === p)
    return { period: p, booked: fs.length, filmed: fs.filter(x => x.filmed).length, flags: is.length, creators: new Set(fs.filter(x => x.filmed).map(x => x.email)).size }
  })
}
export interface CreatorRow { email: string; name: string; booked: number; filmed: number; rate: number | null; perPeriod: number; flags: number; serious: number; byKind: Partial<Record<Kind, number>>; videos: string[] }
export function creatorRows(facts: Fact[], incidents: Incident[], nPeriods: number, people: { email: string; name: string }[] = []): CreatorRow[] {
  const m = new Map<string, CreatorRow>()
  const get = (email: string, name: string) => {
    let r = m.get(email)
    if (!r) { r = { email, name, booked: 0, filmed: 0, rate: null, perPeriod: 0, flags: 0, serious: 0, byKind: {}, videos: [] }; m.set(email, r) }
    return r
  }
  for (const p of people) get(p.email, p.name)
  for (const x of facts) { const r = get(x.email, x.name); r.booked++; if (x.filmed) { r.filmed++; if (x.title) r.videos.push(x.title) } }
  for (const i of incidents) { const r = get(i.email, i.name); r.flags++; if (SERIOUS_KINDS.includes(i.kind)) r.serious++; r.byKind[i.kind] = (r.byKind[i.kind] ?? 0) + 1 }
  for (const r of m.values()) { r.rate = r.booked ? r.filmed / r.booked : null; r.perPeriod = nPeriods ? r.filmed / nPeriods : 0 }
  return [...m.values()]
}
export function staffRows(jobs: Job[], f: { periods: string[]; grain: Grain }, team: 'props' | 'gear') {
  const m = new Map<string, { by: string; packed: number; onTime: number; packHours: number[]; checkedIn: number; checkHours: number[] }>()
  for (const j of jobs) {
    if (j.team !== team || !f.periods.includes(periodOf(j.date, f.grain))) continue
    let r = m.get(j.by); if (!r) { r = { by: j.by, packed: 0, onTime: 0, packHours: [], checkedIn: 0, checkHours: [] }; m.set(j.by, r) }
    if (j.kind === 'packed') { r.packed++; if (j.onTime) r.onTime++; r.packHours.push(j.hours) } else { r.checkedIn++; r.checkHours.push(j.hours) }
  }
  return [...m.values()]
}
export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2 }
export const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
