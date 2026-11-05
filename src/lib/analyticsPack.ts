// "Ask AI about the analytics" (owner, Nov 5: "allow the admins to have AI to query the analytics"). Pure.
// The app already has every number on screen; this turns them into ONE compact data pack the AI reads to answer a
// question. People are short ids (c1, c2…) so the AI can point back at a person and the app opens that person's page.
// Only counts, dates, flag types and short flag texts go in: no emails, no notes, no photos, no wrap titles.
import { KIND, median, type Fact, type Incident, type Job, type Backlog, type Kind } from './analytics'

export interface PackInput {
  facts: Fact[]; incidents: Incident[]; jobs: Job[]; backlog: Backlog; upcoming: { email: string; date: string }[]
  people: { email: string; name: string }[]; today: string; paused: string[]; strikes: Record<string, number>
  staffName: (email: string) => string
  requests?: { email: string; date: string; status: string }[]
}
export interface Pack {
  today: string
  creators: { id: string; name: string; paused: boolean; activeStrikes: number; comingUp: number }[]
  // Per creator per month (last 6 months, oldest first): [shoots that happened, filmed, flags].
  months: string[]; byMonth: Record<string, [number, number, number][]>
  // Per creator, last 30 and last 90 days.
  last30: Record<string, Totals>; last90: Record<string, Totals>
  // Whole company per week (last 12 weeks, oldest first): [week starting, shoots, filmed, flags, creators who filmed].
  weeks: [string, number, number, number, number][]
  houses90: Record<string, number>
  // Every flag of the last 90 days (newest first, at most 250): [date, creator id, flag type, still open 1/0, short text].
  flags: [string, string, Kind, number, string][]
  flagTypes: Record<string, string>
  // Booking requests per creator, shoot days in the last 90 days: approved / waiting / denied / ran out (expired).
  requests90: Record<string, { approved: number; waiting: number; denied: number; expired: number }>
  teams: { name: string; team: 'props' | 'gear'; job: 'packed' | 'checked-in'; last30: number; last90: number; medianHours: number | null; onTimePct: number | null }[]
  backlog: Backlog
}
interface Totals { booked: number; filmed: number; flags: number; byKind: Partial<Record<Kind, number>> }

const D = (s: string) => new Date(s + 'T12:00:00Z')
const shift = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monday = (s: string) => { const d = D(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
const monthsBack = (today: string, n: number) => {
  const [y, m] = today.slice(0, 7).split('-').map(Number), out: string[] = []
  for (let i = n - 1; i >= 0; i--) { const t = y * 12 + (m - 1) - i; out.push(`${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`) }
  return out
}

export function buildPack(o: PackInput): { pack: Pack; idToEmail: Record<string, string> } {
  // Everyone who is scored, plus anyone who shows up in the data (e.g. deactivated creators with history).
  const order = new Map<string, string>()
  for (const p of o.people) order.set(p.email, p.name)
  for (const x of [...o.facts, ...o.incidents]) if (!order.has(x.email)) order.set(x.email, x.name)
  const ids = new Map<string, string>(), idToEmail: Record<string, string> = {}
  ;[...order.keys()].forEach((e, i) => { ids.set(e, `c${i + 1}`); idToEmail[`c${i + 1}`] = e })
  const id = (e: string) => ids.get(e) ?? '?'

  const months = monthsBack(o.today, 6)
  const byMonth: Record<string, [number, number, number][]> = {}
  for (const e of order.keys()) byMonth[id(e)] = months.map(() => [0, 0, 0])
  for (const f of o.facts) { const k = months.indexOf(f.date.slice(0, 7)); if (k >= 0) { const r = byMonth[id(f.email)][k]; r[0]++; if (f.filmed) r[1]++ } }
  for (const i of o.incidents) { const k = months.indexOf(i.date.slice(0, 7)); if (k >= 0) byMonth[id(i.email)][k][2]++ }

  const totals = (from: string) => {
    const t: Record<string, Totals> = {}
    for (const e of order.keys()) t[id(e)] = { booked: 0, filmed: 0, flags: 0, byKind: {} }
    for (const f of o.facts) if (f.date >= from && f.date <= o.today) { const r = t[id(f.email)]; r.booked++; if (f.filmed) r.filmed++ }
    for (const i of o.incidents) if (i.date >= from && i.date <= o.today) { const r = t[id(i.email)]; r.flags++; r.byKind[i.kind] = (r.byKind[i.kind] ?? 0) + 1 }
    return t
  }

  const weeks: Pack['weeks'] = []
  for (let k = 11; k >= 0; k--) {
    const w = monday(shift(o.today, -7 * k)), end = shift(w, 6)
    const fs = o.facts.filter(f => f.date >= w && f.date <= end)
    weeks.push([w, fs.length, fs.filter(f => f.filmed).length, o.incidents.filter(i => i.date >= w && i.date <= end).length, new Set(fs.filter(f => f.filmed).map(f => f.email)).size])
  }
  const from90 = shift(o.today, -90), from30 = shift(o.today, -30)
  const houses90: Record<string, number> = {}
  for (const f of o.facts) if (f.date >= from90) houses90[f.house] = (houses90[f.house] ?? 0) + 1

  const flags: Pack['flags'] = o.incidents.filter(i => i.date >= from90).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 250)
    .map(i => [i.date, id(i.email), i.kind, i.open ? 1 : 0, i.text.slice(0, 80)])

  const teamKey = new Map<string, Job[]>()
  for (const j of o.jobs) if (j.date >= from90) { const k = `${j.by}|${j.team}|${j.kind}`; teamKey.set(k, [...(teamKey.get(k) ?? []), j]) }
  const teams: Pack['teams'] = [...teamKey.entries()].map(([k, js]) => {
    const [by, team, job] = k.split('|') as [string, 'props' | 'gear', 'packed' | 'checked-in']
    const timed = js.filter(j => j.onTime !== undefined)
    const med = median(js.map(j => j.hours))
    return { name: o.staffName(by), team, job, last30: js.filter(j => j.date >= from30).length, last90: js.length,
      medianHours: med === null ? null : Math.round(med * 10) / 10, onTimePct: timed.length ? Math.round(100 * timed.filter(j => j.onTime).length / timed.length) : null }
  })

  const requests90: Pack['requests90'] = {}
  for (const r of o.requests ?? []) {
    if (r.date < from90 || !['approved', 'waiting', 'denied', 'expired'].includes(r.status)) continue
    const k = id(r.email); if (k === '?') continue
    const x = requests90[k] ??= { approved: 0, waiting: 0, denied: 0, expired: 0 }
    x[r.status as 'approved']++
  }
  const coming = new Map<string, number>()
  for (const u of o.upcoming) coming.set(u.email, (coming.get(u.email) ?? 0) + 1)
  const pack: Pack = {
    today: o.today,
    creators: [...order.entries()].map(([e, name]) => ({ id: id(e), name, paused: o.paused.includes(e), activeStrikes: o.strikes[e] ?? 0, comingUp: coming.get(e) ?? 0 })),
    months, byMonth, last30: totals(from30), last90: totals(from90), weeks, houses90, flags,
    flagTypes: Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, `${v.label}: ${v.means}`])),
    teams, requests90, backlog: o.backlog,
  }
  return { pack, idToEmail }
}

// Where "Open it" goes after an answer: the AI may point at a tab, a person (by id) and/or a flag type; the app checks
// every part against what exists, so a bad pointer just opens Analytics.
export type DrillTab = 'creators' | 'late' | 'flags' | 'teams' | 'trends'
export interface Drill { tab?: DrillTab; who?: string; kind?: Kind; period?: '7d' | '28d' | '12w' | '6m' | '12m' | 'tm' | 'lm' }
export function drillUrl(d: Drill | null | undefined, idToEmail: Record<string, string>): string | null {
  if (!d) return null
  const q = new URLSearchParams()
  if (d.tab && ['creators', 'late', 'flags', 'teams', 'trends'].includes(d.tab) && d.tab !== 'creators') q.set('tab', d.tab)
  if (d.who && idToEmail[d.who]) q.set('who', idToEmail[d.who])
  if (d.kind && d.kind in KIND) { q.set('kind', d.kind); if (!q.has('tab')) q.set('tab', 'flags') }
  if (d.period && ['7d', '28d', '12w', '6m', '12m', 'tm', 'lm'].includes(d.period)) q.set('period', d.period)
  return q.toString() ? `/analytics?${q}` : null
}
