// Analytics (owner + admins; owner, Oct 20: "track what each creator is producing weekly and monthly, averages over time,
// what kind of flags, drill down like Power BI, and the props + equipment teams' work"). View only.
// Drill-down: tap a bar to focus on that week/month, a creator row to focus on that person, a theme or flag type to see
// every incident; the chips at the top show what's focused and clear it with ×. Numbers come from src/lib/analytics.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { subscribeToUsers } from '../services/users'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useInvitesSince } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { formatDay } from '../lib/dates'
import { analyze, periods as periodList, periodOf, periodLabel, filterAll, series, creatorRows, staffRows, median, KIND, THEMES, SERIOUS_KINDS,
  type Grain, type House, type Kind, type CreatorRow, type AShoot, type AProps, type AGear, type AReport, type AStrike, type AInvite } from '../lib/analytics'
import type { AppUser } from '../types'

type Tab = 'creators' | 'flags' | 'teams'
const RANGES: Record<Grain, number[]> = { week: [4, 8, 12], month: [3, 6, 12] }
const HOUSES: [House | '', string][] = [['', 'Any house'], ['cliff1', 'Cliff 1'], ['cliff2', 'Cliff 2'], ['offsite', 'Offsite']]
const pct = (x: number | null) => x === null ? '–' : `${Math.round(x * 100)}%`
const one = (x: number) => (Math.round(x * 10) / 10).toString()
const hrs = (h: number | null) => h === null ? '–' : h < 24 ? `${Math.round(h)} h` : `${one(h / 24)} days`

export default function AnalyticsScreen() {
  const navigate = useNavigate()
  const [qs, setQs] = useSearchParams()
  const today = todayInStudio(), now = nowStamp()
  const closed = useBookingSettings()
  // Everything lives in the address bar, so Back returns to the same view.
  const tab = (qs.get('tab') as Tab) || 'creators'
  const grain = (qs.get('grain') as Grain) || 'week'
  const n = Number(qs.get('n')) || (grain === 'week' ? 8 : 6)
  const email = qs.get('who') || '', house = (qs.get('house') as House) || '', focus = qs.get('p') || ''
  const theme = qs.get('theme') || '', kind = (qs.get('kind') as Kind) || ''
  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(qs)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, String(v)) }
    setQs(next, { replace: true })
  }

  const all = periodList(grain, today, n)
  const since = grain === 'month' ? `${all[0]}-01` : all[0]
  const loadFrom = addDays(today, -370) < since ? since : addDays(today, -370)
  const shoots = useShootsSince(loadFrom, true)
  const reports = useReportsSince(loadFrom, true)
  const strikes = useStrikesSince(loadFrom, true)
  const invites = useInvitesSince(loadFrom, true)
  const [users, setUsers] = useState<AppUser[]>([])
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])
  useEffect(() => subscribeToReservations({ email: '', all: true }, setProps), [])
  useEffect(() => subscribeToGearBookings(null, setGear), [])

  const people = useMemo(() => users.filter(u => u.active && (u.role === 'creator' || u.role === 'admin')).map(u => ({ email: u.email, name: u.name || u.email })), [users])
  const staffName = (e: string) => users.find(u => u.email === e)?.name || e.split('@')[0]
  const a = useMemo(() => analyze({ now, closed, shoots: (shoots ?? []) as unknown as AShoot[], props: props as unknown as AProps[], gear: gear as unknown as AGear[],
    reports: reports as unknown as AReport[], strikes: strikes as unknown as AStrike[], invites: invites as unknown as AInvite[] }), [now, closed, shoots, props, gear, reports, strikes, invites])
  const shown = focus ? [focus] : all
  const base = { grain, periods: all, email: email || undefined, house: (house || undefined) as House | undefined }
  const range = filterAll(a, base)                       // whole range (for the charts)
  const sel = filterAll(a, { ...base, periods: shown })  // the focused period, or the whole range
  const chart = series(range.facts, range.incidents, base)
  const rows = creatorRows(sel.facts, sel.incidents, shown.length, email ? [] : people)
  const unit = grain === 'week' ? 'week' : 'month'

  const chips: [string, () => void][] = [
    ...(focus ? [[periodLabel(focus, grain, true), () => set({ p: null })] as [string, () => void]] : []),
    ...(email ? [[a.names.get(email) ?? people.find(p => p.email === email)?.name ?? email, () => set({ who: null })] as [string, () => void]] : []),
    ...(house ? [[HOUSES.find(h => h[0] === house)![1], () => set({ house: null })] as [string, () => void]] : []),
    ...(theme ? [[THEMES.find(t => t.key === theme)?.label ?? theme, () => set({ theme: null, kind: null })] as [string, () => void]] : []),
    ...(kind ? [[KIND[kind].label, () => set({ kind: null })] as [string, () => void]] : []),
  ]

  if (shoots === null) return <div className="min-h-full bg-pt-bg pt-safe px-4"><p className="text-pt-muted text-sm pt-10 text-center">Loading analytics…</p></div>

  return (
    <div className="min-h-full bg-pt-bg pb-12">
      <div className="pt-safe px-4 pb-3 space-y-2">
        <div className="flex items-center gap-3">
          <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] py-1">‹ Back</button>
          <span className="flex-1" />
          <button onClick={() => navigate('/rules-sheet')} className="text-pt-accent text-sm tap">Settings sheet ›</button>
        </div>
        <h1 className="font-display text-[34px] text-pt-text">Analytics</h1>
        <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
          {([['creators', 'Creators'], ['flags', 'Flags'], ['teams', 'Teams']] as [Tab, string][]).map(([v, l]) => (
            <button key={v} onClick={() => set({ tab: v === 'creators' ? null : v })} className={`flex-1 py-2 rounded-[10px] text-sm ${tab === v ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <div className="flex bg-pt-surface rounded-full p-0.5 text-sm shrink-0">
            {(['week', 'month'] as Grain[]).map(g => <button key={g} onClick={() => set({ grain: g === 'week' ? null : g, n: null, p: null })} className={`px-3 py-1 rounded-full ${grain === g ? 'bg-pt-accent text-stone-900 font-medium' : 'text-pt-muted'}`}>{g === 'week' ? 'Weekly' : 'Monthly'}</button>)}
          </div>
          {RANGES[grain].map(r => <button key={r} onClick={() => set({ n: r === (grain === 'week' ? 8 : 6) ? null : r, p: null })} className={`shrink-0 px-3 py-1 rounded-full text-sm ${n === r ? 'bg-pt-border text-pt-text font-medium' : 'bg-pt-surface text-pt-muted'}`}>{r} {grain === 'week' ? 'wks' : 'mos'}</button>)}
        </div>
        <div className="flex gap-2">
          <select value={email} onChange={e => set({ who: e.target.value })} aria-label="Creator" className="flex-1 min-w-0 bg-pt-surface rounded-xl px-3 py-2 text-pt-text text-sm">
            <option value="">Every creator</option>
            {[...people].sort((x, y) => x.name.localeCompare(y.name)).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
          <select value={house} onChange={e => set({ house: e.target.value })} aria-label="House" className="bg-pt-surface rounded-xl px-3 py-2 text-pt-text text-sm">
            {HOUSES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
          </select>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map(([l, clear]) => <button key={l} onClick={clear} className="px-3 py-1 rounded-full text-sm bg-pt-accent/15 text-pt-accent">{l} ×</button>)}
          </div>
        )}
      </div>

      <div className="px-4 space-y-5">
        {tab === 'creators' && <CreatorsTab {...{ chart, rows, sel, grain, unit, focus, email, shown, set, navigate }} />}
        {tab === 'flags' && <FlagsTab {...{ chart, sel, range, grain, focus, theme, kind, set, navigate }} />}
        {tab === 'teams' && <TeamsTab {...{ a, grain, shown, all, focus, set, navigate, staffName }} />}
      </div>
    </div>
  )
}

// ── Shared pieces ──
function Tile({ label, value, sub, tone = 'text-pt-text' }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return <div className="bg-pt-surface rounded-2xl p-3"><p className={`text-[26px] font-bold leading-none tabular-nums ${tone}`}>{value}</p><p className="text-pt-muted text-xs mt-1">{label}</p>{sub && <p className="text-pt-muted text-xs">{sub}</p>}</div>
}
function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="flex items-baseline justify-between"><h2 className="text-pt-text text-[20px] font-semibold tracking-tight">{children}</h2>{right}</div>
}
// One bar per period: gold = the measure, grey = the rest of the total. Tap a bar to focus on that period.
function Bars({ data, grain, focus, onPick, label }: { data: { period: string; value: number; total?: number }[]; grain: Grain; focus: string; onPick: (p: string) => void; label: string }) {
  const max = Math.max(1, ...data.map(d => d.total ?? d.value))
  return (
    <div className="bg-pt-surface rounded-2xl p-4" role="img" aria-label={`${label}: ${data.map(d => `${periodLabel(d.period, grain)} ${d.value}${d.total !== undefined ? ` of ${d.total}` : ''}`).join('; ')}`}>
      <div className="flex items-end gap-1 h-36">
        {data.map(d => {
          const t = d.total ?? d.value, dim = focus && focus !== d.period
          return (
            <button key={d.period} onClick={() => onPick(focus === d.period ? '' : d.period)} className={`flex-1 h-full flex flex-col justify-end items-center gap-1 ${dim ? 'opacity-40' : ''}`}
              title={`${periodLabel(d.period, grain, true)}: ${d.value}${d.total !== undefined ? ` of ${d.total}` : ''}`}>
              <span className="text-pt-text text-xs tabular-nums">{t ? d.value : ''}</span>
              <span className="w-full flex flex-col justify-end rounded-t-[4px] overflow-hidden" style={{ height: `${(t / max) * 100}%`, minHeight: t ? 4 : 0 }}>
                {d.total !== undefined && <span className="w-full bg-pt-border" style={{ height: `${t ? ((t - d.value) / t) * 100 : 0}%` }} />}
                <span className={`w-full ${focus === d.period ? 'bg-amber-300' : 'bg-pt-accent'}`} style={{ height: `${t ? (d.value / t) * 100 : 0}%` }} />
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex gap-1 mt-1">{data.map(d => <span key={d.period} className="flex-1 text-center text-pt-muted text-[11px] leading-tight">{periodLabel(d.period, grain)}</span>)}</div>
      <p className="text-pt-muted text-xs mt-2">Tap a bar to focus on that {grain}.</p>
    </div>
  )
}
function KindChips({ byKind }: { byKind: Partial<Record<Kind, number>> }) {
  const ks = (Object.keys(byKind) as Kind[]).sort((x, y) => Number(SERIOUS_KINDS.includes(y)) - Number(SERIOUS_KINDS.includes(x)) || byKind[y]! - byKind[x]!)
  if (!ks.length) return <span className="text-xs rounded-full px-2 py-1 bg-green-500/15 text-green-300">No flags ✓</span>
  return <span className="flex flex-wrap gap-1">{ks.map(k => <span key={k} className={`text-xs rounded-full px-2 py-1 ${SERIOUS_KINDS.includes(k) ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200'}`}>{byKind[k]} {KIND[k].label.toLowerCase()}</span>)}</span>
}
type Setter = (patch: Record<string, string | number | null>) => void
type Nav = ReturnType<typeof useNavigate>

// ── Creators: production ──
function CreatorsTab({ chart, rows, sel, grain, unit, focus, email, shown, set, navigate }: {
  chart: ReturnType<typeof series>; rows: CreatorRow[]; sel: ReturnType<typeof filterAll>; grain: Grain; unit: string; focus: string; email: string; shown: string[]; set: Setter; navigate: Nav }) {
  const [sort, setSort] = useState<'filmed' | 'rate' | 'flags'>('filmed')
  const filmed = sel.facts.filter(f => f.filmed).length, booked = sel.facts.length
  const active = new Set(sel.facts.filter(f => f.filmed).map(f => f.email)).size
  const perPeriod = filmed / shown.length
  const perCreator = active ? filmed / active / shown.length : 0
  const sorted = [...rows].sort((x, y) => sort === 'rate' ? (x.rate ?? 2) - (y.rate ?? 2) : sort === 'flags' ? y.flags - x.flags || y.serious - x.serious : y.filmed - x.filmed || x.name.localeCompare(y.name))
  const me = email ? rows.find(r => r.email === email) : undefined
  const prev = !focus && chart.length >= 2 ? chart.slice(0, -1) : []
  const trend = prev.length ? perPeriod - prev.reduce((s, c) => s + c.filmed, 0) / prev.length : null
  return <>
    <div className="grid grid-cols-3 gap-2">
      <Tile label="Shoots filmed" value={filmed} />
      <Tile label={`Avg per ${unit}`} value={one(perPeriod)} />
      <Tile label="Filmed of booked" value={pct(booked ? filmed / booked : null)} tone={booked && filmed / booked < 0.7 ? 'text-red-300' : 'text-pt-text'} />
      <Tile label="Creators filming" value={active} />
      <Tile label={`Avg per creator / ${unit}`} value={one(perCreator)} />
      <Tile label={`This ${unit} so far vs avg`} value={trend === null ? '–' : `${trend >= 0 ? '+' : ''}${one(chart[chart.length - 1].filmed - (prev.reduce((s, c) => s + c.filmed, 0) / prev.length))}`} tone={trend !== null && trend < 0 ? 'text-amber-200' : 'text-pt-text'} />
    </div>
    <H2>Filming per {unit}</H2>
    <Bars data={chart.map(c => ({ period: c.period, value: c.filmed, total: c.booked }))} grain={grain} focus={focus} onPick={p => set({ p })} label="Shoots filmed out of booked" />
    <div className="flex gap-4 text-xs text-pt-muted -mt-3"><span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-pt-accent" />Filmed</span><span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-pt-border" />Booked, not filmed</span></div>
    <H2>Creators filming per {unit}</H2>
    <Bars data={chart.map(c => ({ period: c.period, value: c.creators }))} grain={grain} focus={focus} onPick={p => set({ p })} label="Creators who filmed" />

    {me ? <>
      <H2 right={<button onClick={() => navigate(`/people/${encodeURIComponent(me.email)}`)} className="text-pt-accent text-sm tap">Open record ›</button>}>{me.name}</H2>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Filmed" value={me.filmed} sub={`of ${me.booked} booked`} />
        <Tile label={`Avg per ${unit}`} value={one(me.perPeriod)} />
        <Tile label="Showed up" value={pct(me.rate)} tone={me.rate !== null && me.rate < 0.7 ? 'text-red-300' : 'text-pt-text'} />
      </div>
      <KindChips byKind={me.byKind} />
      <div className="bg-pt-surface rounded-2xl p-3 space-y-1">
        <p className="text-pt-muted text-xs">What they filmed (from their wraps)</p>
        {me.videos.length ? me.videos.map((v, i) => <p key={i} className="text-pt-text text-[15px]">“{v}”</p>) : <p className="text-pt-muted text-sm">No wraps in this period.</p>}
      </div>
      <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
        {sel.facts.filter(f => f.email === me.email).sort((x, y) => y.date.localeCompare(x.date)).map(f => (
          <button key={f.id} onClick={() => navigate(f.to)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
            <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px]">{formatDay(f.date)} · {f.house === 'offsite' ? 'Offsite' : f.house === 'cliff1' ? 'Cliff 1' : 'Cliff 2'}</span>{f.title && <span className="block text-pt-muted text-xs truncate">“{f.title}”</span>}</span>
            <span className={`text-xs rounded-full px-2 py-1 ${f.filmed ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>{f.filmed ? 'Filmed' : 'Not filmed'}</span>
          </button>
        ))}
      </div>
    </> : <>
      <H2 right={<select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort" className="bg-pt-surface rounded-lg px-2 py-1 text-pt-text text-sm"><option value="filmed">Most filming</option><option value="rate">Lowest show-up</option><option value="flags">Most flags</option></select>}>Every creator</H2>
      <p className="text-pt-muted text-xs -mt-3">{focus ? periodLabel(focus, grain, true) : `Last ${shown.length} ${unit}s`}. Tap someone to focus on them.</p>
      <div className="space-y-2">
        {sorted.map(r => (
          <button key={r.email} onClick={() => set({ who: r.email })} className="w-full text-left bg-pt-surface rounded-2xl p-3 space-y-2">
            <span className="flex items-center gap-3">
              <Avatar email={r.email} name={r.name} size={36} />
              <span className="flex-1 min-w-0"><b className="block text-pt-text truncate">{r.name}</b><span className="block text-pt-muted text-xs">{r.filmed} filmed of {r.booked} · {one(r.perPeriod)} per {unit}</span></span>
              <span className={`text-sm font-semibold tabular-nums ${r.rate === null ? 'text-pt-muted' : r.rate < 0.7 ? 'text-red-300' : r.rate < 0.9 ? 'text-amber-200' : 'text-green-300'}`}>{pct(r.rate)}</span>
            </span>
            <KindChips byKind={r.byKind} />
          </button>
        ))}
      </div>
    </>}
  </>
}

// ── Flags: what kind, who, when ──
function FlagsTab({ chart, sel, range, grain, focus, theme, kind, set, navigate }: {
  chart: ReturnType<typeof series>; sel: ReturnType<typeof filterAll>; range: ReturnType<typeof filterAll>; grain: Grain; focus: string; theme: string; kind: Kind | ''; set: Setter; navigate: Nav }) {
  const per = (ks: Kind[]) => chart.map(c => ({ period: c.period, value: range.incidents.filter(i => ks.includes(i.kind) && periodOf(i.date, grain) === c.period).length }))
  const kindsShown: Kind[] = kind ? [kind] : theme ? THEMES.find(t => t.key === theme)!.kinds : []
  const list = kindsShown.length ? sel.incidents.filter(i => kindsShown.includes(i.kind)).sort((x, y) => y.date.localeCompare(x.date)) : []
  const who = new Map<string, { name: string; n: number }>()
  for (const i of sel.incidents) { const w = who.get(i.email) ?? { name: i.name, n: 0 }; w.n++; who.set(i.email, w) }
  return <>
    {(() => { const n = kindsShown.length ? list.length : sel.incidents.length
      return <Tile label={`${kind ? KIND[kind].label : theme ? THEMES.find(t => t.key === theme)!.label : 'Flags'} · ${focus ? periodLabel(focus, grain, true) : 'this range'}`} value={n} tone={n ? 'text-amber-200' : 'text-pt-text'} /> })()}
    <H2>Flags per {grain}</H2>
    <Bars data={kindsShown.length ? per(kindsShown) : chart.map(c => ({ period: c.period, value: c.flags }))} grain={grain} focus={focus} onPick={p => set({ p })} label="Flags" />
    {!theme && <>
      <H2>By type</H2>
      <div className="space-y-2">
        {THEMES.map(t => {
          const items = sel.incidents.filter(i => t.kinds.includes(i.kind))
          const top = [...new Set(items.map(i => i.name))].slice(0, 3)
          return (
            <button key={t.key} onClick={() => set({ theme: t.key })} className="w-full text-left bg-pt-surface rounded-2xl p-3 flex items-center gap-3">
              <span className={`w-10 text-center text-[22px] font-bold tabular-nums ${items.length ? 'text-amber-200' : 'text-pt-muted'}`}>{items.length}</span>
              <span className="flex-1 min-w-0"><b className="block text-pt-text">{t.label}</b><span className="block text-pt-muted text-xs truncate">{items.length ? top.join(', ') : 'Nobody'}</span></span>
              <span className="text-pt-muted">›</span>
            </button>
          )
        })}
      </div>
      <H2>Who has the most</H2>
      <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
        {[...who.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([e, w]) => (
          <button key={e} onClick={() => set({ tab: null, who: e })} className="w-full flex items-center gap-3 px-3 py-3 text-left"><Avatar email={e} name={w.name} size={32} /><span className="flex-1 text-pt-text text-[15px]">{w.name}</span><span className="text-amber-200 font-semibold tabular-nums">{w.n}</span></button>
        ))}
        {!who.size && <p className="text-pt-muted text-sm p-3">No flags. Nice.</p>}
      </div>
    </>}
    {theme && !kind && <>
      <H2>{THEMES.find(t => t.key === theme)!.label}</H2>
      <div className="space-y-2">
        {THEMES.find(t => t.key === theme)!.kinds.map(k => (
          <button key={k} onClick={() => set({ kind: k })} className="w-full text-left bg-pt-surface rounded-2xl p-3 flex items-center gap-3">
            <span className="w-10 text-center text-[22px] font-bold tabular-nums text-amber-200">{sel.incidents.filter(i => i.kind === k).length}</span>
            <span className="flex-1 min-w-0"><b className="block text-pt-text">{KIND[k].label}</b><span className="block text-pt-muted text-xs">{KIND[k].means}</span></span>
            <span className="text-pt-muted">›</span>
          </button>
        ))}
      </div>
    </>}
    {kindsShown.length > 0 && <>
      <H2>{kind ? KIND[kind].label : 'Every incident'} · {list.length}</H2>
      {kind && <p className="text-pt-muted text-xs -mt-3">{KIND[kind].means}</p>}
      <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
        {list.map((i, n) => (
          <button key={n} onClick={() => i.to && navigate(i.to)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
            <Avatar email={i.email} name={i.name} size={32} />
            <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px]">{i.name} · {KIND[i.kind].label}</span><span className="block text-pt-muted text-xs">{formatDay(i.date)} · {i.text}</span></span>
            {i.open && <span className="text-xs rounded-full px-2 py-1 bg-amber-500/15 text-amber-200 shrink-0">Open</span>}
          </button>
        ))}
        {!list.length && <p className="text-pt-muted text-sm p-3">None in this view.</p>}
      </div>
    </>}
  </>
}

// ── Teams: the arts department and the equipment team ──
function TeamsTab({ a, grain, shown, all, focus, set, navigate, staffName }: {
  a: ReturnType<typeof analyze>; grain: Grain; shown: string[]; all: string[]; focus: string; set: Setter; navigate: Nav; staffName: (e: string) => string }) {
  const b = a.backlog
  const props = staffRows(a.jobs, { grain, periods: shown }, 'props'), gear = staffRows(a.jobs, { grain, periods: shown }, 'gear')
  const packedSeries = all.map(p => ({ period: p, value: a.jobs.filter(j => j.team === 'props' && j.kind === 'packed' && j.onTime && periodOf(j.date, grain) === p).length,
    total: a.jobs.filter(j => j.team === 'props' && j.kind === 'packed' && periodOf(j.date, grain) === p).length }))
  const checkSeries = all.map(p => ({ period: p, value: a.jobs.filter(j => j.team === 'gear' && periodOf(j.date, grain) === p).length }))
  const jobs = (team: 'props' | 'gear', kind: 'packed' | 'checked-in') => a.jobs.filter(j => j.team === team && j.kind === kind && shown.includes(periodOf(j.date, grain)))
  const packed = jobs('props', 'packed'), propsIn = jobs('props', 'checked-in'), gearIn = jobs('gear', 'checked-in')
  return <>
    <H2>Right now</H2>
    <div className="grid grid-cols-3 gap-2">
      <button onClick={() => navigate('/reservations')} className="text-left [&>div]:h-full"><Tile label="Props to pack" value={b.propsToPack} sub={b.propsPackLate ? `${b.propsPackLate} due today or overdue` : 'none overdue'} tone={b.propsPackLate ? 'text-red-300' : 'text-pt-text'} /></button>
      <button onClick={() => navigate('/reservations')} className="text-left [&>div]:h-full"><Tile label="Props returns to check" value={b.propsToCheckIn} /></button>
      <button onClick={() => navigate('/reservations')} className="text-left [&>div]:h-full"><Tile label="Props out late" value={b.propsOutLate} tone={b.propsOutLate ? 'text-amber-200' : 'text-pt-text'} /></button>
      <button onClick={() => navigate('/gear/bookings')} className="text-left [&>div]:h-full"><Tile label="Gear returns to check" value={b.gearToCheckIn} /></button>
      <button onClick={() => navigate('/gear/bookings')} className="text-left [&>div]:h-full"><Tile label="Gear out late" value={b.gearOutLate} tone={b.gearOutLate ? 'text-amber-200' : 'text-pt-text'} /></button>
    </div>

    <H2>Arts department</H2>
    <div className="grid grid-cols-3 gap-2">
      <Tile label="Requests packed" value={packed.length} />
      <Tile label="Packed before pickup" value={pct(packed.length ? packed.filter(j => j.onTime).length / packed.length : null)} tone={packed.length && packed.filter(j => j.onTime).length / packed.length < 0.9 ? 'text-amber-200' : 'text-pt-text'} />
      <Tile label="Typical check-in time" value={hrs(median(propsIn.map(j => j.hours)))} sub="return → checked" />
    </div>
    <Bars data={packedSeries} grain={grain} focus={focus} onPick={p => set({ p })} label="Requests packed on time, out of packed" />
    <StaffTable rows={props.map(r => ({ by: r.by, cells: [r.packed, pct(r.packed ? r.onTime / r.packed : null), hrs(median(r.packHours)), r.checkedIn, hrs(median(r.checkHours))] }))}
      head={['Packed', 'On time', 'Request → packed', 'Checked in', 'Check-in time']} staffName={staffName} />

    <H2>Equipment team</H2>
    <div className="grid grid-cols-2 gap-2">
      <Tile label="Gear returns checked in" value={gearIn.length} />
      <Tile label="Typical check-in time" value={hrs(median(gearIn.map(j => j.hours)))} sub="return → checked" />
    </div>
    <Bars data={checkSeries} grain={grain} focus={focus} onPick={p => set({ p })} label="Gear returns checked in" />
    <StaffTable rows={gear.map(r => ({ by: r.by, cells: [r.checkedIn, hrs(median(r.checkHours))] }))} head={['Checked in', 'Check-in time']} staffName={staffName} />
    <p className="text-pt-muted text-xs">Counted from each request's history: who packed it and when, who checked returns in. "Packed before pickup" = packed by the pickup day.</p>
  </>
}
function StaffTable({ rows, head, staffName }: { rows: { by: string; cells: (string | number)[] }[]; head: string[]; staffName: (e: string) => string }) {
  if (!rows.length) return <p className="text-pt-muted text-sm">Nothing done in this period yet.</p>
  return (
    <div className="bg-pt-surface rounded-2xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-pt-muted text-xs text-left"><th className="px-3 py-2 font-normal">Who</th>{head.map(h => <th key={h} className="px-2 py-2 font-normal text-right">{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.by} className="border-t border-white/[0.06]"><td className="px-3 py-2 text-pt-text whitespace-nowrap">{staffName(r.by)}</td>{r.cells.map((c, i) => <td key={i} className="px-2 py-2 text-right text-pt-text tabular-nums whitespace-nowrap">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
