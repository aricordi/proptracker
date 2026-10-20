// Analytics v2 (owner, Oct 20: "like a famous app… simple to read at every level of drill down, dive deep and zoom out
// without getting confusing"). Modelled on YouTube Studio's analytics: one date range at a time ("Last 12 weeks"),
// every number compared with the same length of time just before, metric cards that pick what the one chart shows,
// and an "Advanced view" table that breaks any number down by creator, house, flag type, week/month or staff member.
// Pure: it works on the facts / incidents / jobs that analyze() in ./analytics.ts produces.
import { periodOf, KIND, THEMES, SERIOUS_KINDS, median, type Fact, type Incident, type Job, type House, type Kind } from './analytics'

export type Grain = 'day' | 'week' | 'month'
export type Preset = '7d' | '28d' | '12w' | '6m' | '12m' | 'tm' | 'lm'
export const PRESETS: [Preset, string][] = [
  ['7d', 'Last 7 days'], ['28d', 'Last 28 days'], ['12w', 'Last 12 weeks'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'],
  ['tm', 'This month'], ['lm', 'Last month'],
]
const PREV: Record<Preset, string> = { '7d': 'the 7 days before', '28d': 'the 28 days before', '12w': 'the 12 weeks before',
  '6m': 'the 6 months before', '12m': 'the year before', tm: 'the same days last month', lm: 'the month before' }

// ── Dates ('YYYY-MM-DD', studio days) ──
const D = (s: string) => new Date(s + 'T12:00:00Z')
const S = (d: Date) => d.toISOString().slice(0, 10)
export const shift = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d) }
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 864e5)
const monthStart = (s: string, back = 0) => { const d = D(s.slice(0, 7) + '-01'); d.setUTCMonth(d.getUTCMonth() - back); return S(d) }
const monthEnd = (s: string) => { const d = D(s.slice(0, 7) + '-01'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return S(d) }
const short = (s: string) => D(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const withYear = (s: string) => D(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export interface Range { from: string; to: string; prevFrom: string; prevTo: string; label: string; phrase: string; prevLabel: string; dates: string; zoomed: boolean }
const datesOf = (from: string, to: string) => from === to ? withYear(from) : `${short(from)} – ${withYear(to)}`

export function rangeFor(p: Preset, today: string): Range {
  let from: string, to = today, prevFrom: string, prevTo: string
  const months = (n: number) => { prevFrom = monthStart(from, n); prevTo = shift(from, -1) }
  switch (p) {
    case '7d': from = shift(today, -6); break
    case '28d': from = shift(today, -27); break
    case '12w': from = shift(periodOf(today, 'week'), -77); break
    case '6m': from = monthStart(today, 5); break
    case '12m': from = monthStart(today, 11); break
    case 'tm': from = monthStart(today); break
    case 'lm': from = monthStart(today, 1); to = monthEnd(from); break
  }
  // Compared with the same number of days just before (fair while the current week or month is still running).
  const len = daysBetween(from!, to) + 1
  prevTo = shift(from!, -1); prevFrom = shift(from!, -len)
  if (p === 'lm') months(1)
  if (p === 'tm') { prevFrom = monthStart(today, 1); prevTo = [monthEnd(prevFrom), shift(prevFrom, len - 1)].sort()[0] }
  const label = PRESETS.find(x => x[0] === p)![1]
  return { from: from!, to, prevFrom: prevFrom!, prevTo: prevTo!, label, phrase: label === 'This month' || label === 'Last month' ? label.toLowerCase() : `in the ${label.toLowerCase()}`,
    prevLabel: PREV[p], dates: datesOf(from!, to), zoomed: false }
}
// A zoomed-in range (a tapped column, or a week/month row in the table): compared with the same length just before.
export function customRange(from: string, to: string): Range {
  const len = daysBetween(from, to) + 1
  const isWeek = len === 7 && periodOf(from, 'week') === from
  const isMonth = from === monthStart(from) && to === monthEnd(from)
  const label = from === to ? D(from).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : isWeek ? `Week of ${short(from)}` : isMonth ? D(from).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : datesOf(from, to)
  const prevFrom = isMonth ? monthStart(from, 1) : shift(from, -len), prevTo = shift(from, -1)
  return { from, to, prevFrom, prevTo, label, phrase: from === to ? `on ${label}` : isWeek ? `in the week of ${short(from)}` : isMonth ? `in ${label}` : `from ${datesOf(from, to)}`,
    prevLabel: from === to ? 'the day before' : isWeek ? 'the week before' : isMonth ? 'the month before' : 'the same length before', dates: datesOf(from, to), zoomed: true }
}

// Which "Show by" choices make sense for a range (3 to 31 columns).
export function grainsFor(r: Range): Grain[] {
  const len = daysBetween(r.from, r.to) + 1
  return (['day', 'week', 'month'] as Grain[]).filter(g => { const n = buckets(r.from, r.to, g).length; return (g === 'day' ? n >= 2 : n >= 3) && n <= 31 || (g === 'day' && len <= 7) })
}
export function defaultGrain(r: Range): Grain {
  const len = daysBetween(r.from, r.to) + 1
  const g: Grain = len <= 31 ? 'day' : len <= 120 ? 'week' : 'month'
  const ok = grainsFor(r)
  return ok.includes(g) ? g : ok[0] ?? 'day'
}
export const bucketOf = (date: string, g: Grain) => g === 'day' ? date : periodOf(date, g)
export function buckets(from: string, to: string, g: Grain): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shift(d, 1)) { const b = bucketOf(d, g); if (out[out.length - 1] !== b) out.push(b) }
  return out
}
// The days a column covers, clipped to the range (so the first/last week can be partial).
export function bucketSpan(b: string, g: Grain, r: Range): [string, string] {
  const start = g === 'month' ? b + '-01' : b, end = g === 'day' ? b : g === 'week' ? shift(b, 6) : monthEnd(start)
  return [start < r.from ? r.from : start, end > r.to ? r.to : end]
}
export function bucketLabel(b: string, g: Grain, long = false): string {
  if (g === 'month') return D(b + '-01').toLocaleDateString('en-CA', { month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  if (g === 'week') return long ? `Week of ${short(b)}` : short(b)
  return long ? D(b).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : short(b)
}

// ── Scope (what's drilled into) ──
export interface Scope { email?: string; house?: House; kinds?: Kind[] }
export interface Data { facts: Fact[]; incidents: Incident[]; jobs: Job[] }
export interface Source { facts: Fact[]; incidents: Incident[]; jobs: Job[] }
export function slice(a: Source, from: string, to: string, s: Scope = {}): Data {
  const when = (x: { date: string }) => x.date >= from && x.date <= to
  const who = (x: { email: string; house?: House }) => (!s.email || x.email === s.email) && (!s.house || x.house === s.house)
  return {
    facts: a.facts.filter(x => when(x) && who(x)),
    incidents: a.incidents.filter(x => when(x) && who(x) && (!s.kinds || s.kinds.includes(x.kind))),
    jobs: a.jobs.filter(when),
  }
}

// ── Metrics ──
export type Metric = 'filmed' | 'booked' | 'showRate' | 'creators' | 'perCreator' | 'flags' | 'serious' | 'flagged' | 'open'
  | 'packed' | 'packOnTime' | 'packTime' | 'propsChecked' | 'propsCheckTime' | 'gearChecked' | 'gearCheckTime'
type Fmt = 'count' | 'pct' | 'hours' | 'ratio'
export const METRICS: Record<Metric, { label: string; unit: string; fmt: Fmt; better: 'up' | 'down'; means: string }> = {
  filmed: { label: 'Shoots filmed', unit: 'shoots', fmt: 'count', better: 'up', means: 'House and offsite shoots that happened: checked in, or marked "They filmed" by the team.' },
  booked: { label: 'Shoots booked', unit: 'shoots', fmt: 'count', better: 'up', means: 'Shoots whose time has passed, plus late cancels (those count as booked, not filmed).' },
  showRate: { label: 'Show-up rate', unit: '', fmt: 'pct', better: 'up', means: 'Filmed out of booked. 90% or more is healthy.' },
  creators: { label: 'Creators filming', unit: 'creators', fmt: 'count', better: 'up', means: 'Different people who filmed at least once.' },
  perCreator: { label: 'Shoots per creator', unit: 'shoots', fmt: 'ratio', better: 'up', means: 'Shoots filmed divided by the creators who filmed.' },
  flags: { label: 'Flags', unit: 'flags', fmt: 'count', better: 'down', means: 'Every flag: no-shows, running over, mess, late returns, skipped check-ins and more.' },
  serious: { label: 'Serious flags', unit: 'flags', fmt: 'count', better: 'down', means: 'No-shows, late cancels, strikes, and damaged or missing props and gear.' },
  flagged: { label: 'Creators flagged', unit: 'creators', fmt: 'count', better: 'down', means: 'Different people with at least one flag.' },
  open: { label: 'Still open', unit: 'flags', fmt: 'count', better: 'down', means: 'Flags waiting on someone: a decision, a report review, or things still out late.' },
  packed: { label: 'Requests packed', unit: 'requests', fmt: 'count', better: 'up', means: 'Props requests the arts department packed.' },
  packOnTime: { label: 'Packed on time', unit: '', fmt: 'pct', better: 'up', means: 'Packed by the pickup day.' },
  packTime: { label: 'Time to pack', unit: '', fmt: 'hours', better: 'down', means: 'Typical time from the request to packed (the middle value).' },
  propsChecked: { label: 'Props returns checked', unit: 'returns', fmt: 'count', better: 'up', means: 'Props returns the arts department checked in.' },
  propsCheckTime: { label: 'Props check-in time', unit: '', fmt: 'hours', better: 'down', means: 'Typical time from the creator returning props to the arts department checking them.' },
  gearChecked: { label: 'Gear returns checked', unit: 'returns', fmt: 'count', better: 'up', means: 'Gear returns the equipment team checked in.' },
  gearCheckTime: { label: 'Gear check-in time', unit: '', fmt: 'hours', better: 'down', means: 'Typical time from the creator returning gear to the equipment team checking it.' },
}
const jobsOf = (d: Data, team: 'props' | 'gear', kind: 'packed' | 'checked-in') => d.jobs.filter(j => j.team === team && j.kind === kind)
export function value(m: Metric, d: Data): number | null {
  const filmed = d.facts.filter(f => f.filmed)
  switch (m) {
    case 'filmed': return filmed.length
    case 'booked': return d.facts.length
    case 'showRate': return d.facts.length ? filmed.length / d.facts.length : null
    case 'creators': return new Set(filmed.map(f => f.email)).size
    case 'perCreator': { const n = new Set(filmed.map(f => f.email)).size; return n ? filmed.length / n : null }
    case 'flags': return d.incidents.length
    case 'serious': return d.incidents.filter(i => SERIOUS_KINDS.includes(i.kind)).length
    case 'flagged': return new Set(d.incidents.map(i => i.email)).size
    case 'open': return d.incidents.filter(i => i.open).length
    case 'packed': return jobsOf(d, 'props', 'packed').length
    case 'packOnTime': { const j = jobsOf(d, 'props', 'packed'); return j.length ? j.filter(x => x.onTime).length / j.length : null }
    case 'packTime': return median(jobsOf(d, 'props', 'packed').map(j => j.hours))
    case 'propsChecked': return jobsOf(d, 'props', 'checked-in').length
    case 'propsCheckTime': return median(jobsOf(d, 'props', 'checked-in').map(j => j.hours))
    case 'gearChecked': return jobsOf(d, 'gear', 'checked-in').length
    case 'gearCheckTime': return median(jobsOf(d, 'gear', 'checked-in').map(j => j.hours))
  }
}
const one = (x: number) => (Math.round(x * 10) / 10).toString()
export function fmt(m: Metric, v: number | null): string {
  if (v === null) return '–'
  switch (METRICS[m].fmt) {
    case 'pct': return `${Math.round(v * 100)}%`
    case 'hours': return v < 1 ? `${Math.max(1, Math.round(v * 60))} min` : v < 48 ? `${one(v)} h` : `${one(v / 24)} days`
    case 'ratio': return one(v)
    default: return String(Math.round(v * 10) / 10)
  }
}
// "↑ 12%" against the same length of time before. Tone says whether that's good for this metric.
export function compare(m: Metric, cur: number | null, prev: number | null): { text: string; tone: 'good' | 'bad' | 'flat' } | null {
  if (cur === null || prev === null) return null
  const up = METRICS[m].better === 'up'
  const tone = (rise: boolean) => (rise === up ? 'good' : 'bad') as 'good' | 'bad'
  if (METRICS[m].fmt === 'pct') {
    const pts = Math.round((cur - prev) * 100)
    return Math.abs(pts) < 3 ? { text: 'About the same', tone: 'flat' } : { text: `${pts > 0 ? '↑' : '↓'} ${Math.abs(pts)} pts`, tone: tone(pts > 0) }
  }
  if (prev === 0) return cur === 0 ? { text: 'About the same', tone: 'flat' } : { text: 'New', tone: tone(true) }
  const ch = (cur - prev) / prev
  return Math.abs(ch) < 0.05 ? { text: 'About the same', tone: 'flat' } : { text: `${ch > 0 ? '↑' : '↓'} ${Math.round(Math.abs(ch) * 100)}%`, tone: tone(ch > 0) }
}
export function seriesOf(m: Metric, a: Source, r: Range, g: Grain, s: Scope) {
  return buckets(r.from, r.to, g).map(b => { const [f, t] = bucketSpan(b, g, r); return { bucket: b, value: value(m, slice(a, f, t, s)) } })
}
// Averages over time (owner): the typical column, ignoring columns with no data for rates/times.
export const averageOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null }

// ── Advanced view: break a number down by one dimension ──
export type Dim = 'creator' | 'house' | 'theme' | 'kind' | 'period' | 'staff'
export const DIMS: Record<Dim, { label: string; metrics: Metric[]; drill?: Dim }> = {
  creator: { label: 'Creator', metrics: ['filmed', 'booked', 'showRate', 'flags', 'serious'], drill: 'theme' },
  house: { label: 'House', metrics: ['filmed', 'booked', 'showRate', 'creators', 'flags'], drill: 'creator' },
  period: { label: 'Week or month', metrics: ['filmed', 'showRate', 'creators', 'flags', 'serious'], drill: 'creator' },
  theme: { label: 'Flag type', metrics: ['flags', 'flagged', 'open'], drill: 'kind' },
  kind: { label: 'Flag', metrics: ['flags', 'flagged', 'open'], drill: 'creator' },
  staff: { label: 'Staff member', metrics: ['packed', 'packOnTime', 'packTime', 'propsChecked', 'propsCheckTime', 'gearChecked', 'gearCheckTime'] },
}
export const HOUSE_LABEL: Record<House, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }
export interface Row { key: string; label: string; email?: string; data: Data }
export function rowsBy(dim: Dim, d: Data, o: { grain: Grain; people?: { email: string; name: string }[]; staffName?: (e: string) => string; range?: Range }): Row[] {
  const m = new Map<string, Row>()
  const get = (key: string, label: string, email?: string) => { let r = m.get(key); if (!r) { r = { key, label, email, data: { facts: [], incidents: [], jobs: [] } }; m.set(key, r) }; return r }
  if (dim === 'creator') {
    for (const p of o.people ?? []) get(p.email, p.name, p.email)
    for (const f of d.facts) get(f.email, f.name, f.email).data.facts.push(f)
    for (const i of d.incidents) get(i.email, i.name, i.email).data.incidents.push(i)
  } else if (dim === 'house') {
    for (const h of ['cliff1', 'cliff2', 'offsite'] as House[]) get(h, HOUSE_LABEL[h])
    for (const f of d.facts) get(f.house, HOUSE_LABEL[f.house]).data.facts.push(f)
    for (const i of d.incidents) if (i.house) get(i.house, HOUSE_LABEL[i.house]).data.incidents.push(i)
  } else if (dim === 'period') {
    if (o.range) for (const b of buckets(o.range.from, o.range.to, o.grain)) get(b, bucketLabel(b, o.grain, true))
    const at = (date: string) => { const b = bucketOf(date, o.grain); return get(b, bucketLabel(b, o.grain, true)).data }
    for (const f of d.facts) at(f.date).facts.push(f)
    for (const i of d.incidents) at(i.date).incidents.push(i)
    for (const j of d.jobs) at(j.date).jobs.push(j)
  } else if (dim === 'theme') {
    for (const t of THEMES) get(t.key, t.label)
    for (const i of d.incidents) { const t = THEMES.find(x => x.kinds.includes(i.kind)); if (t) get(t.key, t.label).data.incidents.push(i) }
  } else if (dim === 'kind') {
    for (const i of d.incidents) get(i.kind, KIND[i.kind].label).data.incidents.push(i)
  } else {
    for (const j of d.jobs) get(j.by, o.staffName?.(j.by) ?? j.by.split('@')[0]).data.jobs.push(j)
  }
  return [...m.values()]
}
export function sortRows(rows: Row[], m: Metric, dir: 'desc' | 'asc' = 'desc') {
  return [...rows].sort((x, y) => {
    const a = value(m, x.data), b = value(m, y.data)
    if (a === null && b === null) return x.label.localeCompare(y.label)
    if (a === null) return 1
    if (b === null) return -1
    return (dir === 'desc' ? b - a : a - b) || x.label.localeCompare(y.label)
  })
}
const csvCell = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
export function toCsv(dim: Dim, rows: Row[], metrics: Metric[], total?: Data) {
  const head = [DIMS[dim].label, ...metrics.map(m => METRICS[m].label)]
  const line = (label: string, d: Data) => [label, ...metrics.map(m => { const v = value(m, d); return v === null ? '' : METRICS[m].fmt === 'pct' ? String(Math.round(v * 100)) + '%' : String(Math.round(v * 100) / 100) })]
  return [head, ...(total ? [line('Total', total)] : []), ...rows.map(r => line(r.label, r.data))].map(r => r.map(csvCell).join(',')).join('\n')
}
