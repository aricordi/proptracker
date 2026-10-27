// Analytics v2 (owner + admins, view only). Owner, Oct 20: "like a famous app… simple to read at every level of drill
// down, dive deep and zoom out without getting confusing". Modelled on YouTube Studio's analytics:
// - ONE date range at a time (Last 7 days … Last 12 months, This/Last month), every number compared with the same
//   length of time just before ("↑ 12% vs the 12 weeks before").
// - Tabs Overview / Creators / Flags / Teams, each the same shape: headline sentence → metric cards (pick what the chart
//   shows) → one column chart with a dashed average → ranked lists with "See more".
// - Drill-down by tapping: a column zooms into that week/month, a person/house/flag type narrows everything to it.
//   Every drill is a new page in the history, so the phone's Back (or ‹ Back) zooms out one step; the chips under the
//   tabs show what's narrowed and clear it with ×.
// - "Advanced view" (table icon / See more) = the Power BI part: break any number down by creator, house, week or month,
//   flag type, flag or staff member, sort any column, tap a row to drill in, export as a spreadsheet (CSV).
// Numbers come from src/lib/analytics.ts (what happened) and src/lib/insights.ts (ranges, metrics, breakdowns).
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import BottomSheet from '../components/BottomSheet'
import { Icon } from '../components/Icon'
import { MetricCards, ColumnChart, SectionHead, RankList, NeedsYou, needsYouItems, showRateTone, StandingTiles, StandingList, TypicalKey, OutputBar, OutPill, OUT_STYLE, vsTypicalText, type StandFilter } from '../components/analytics/Parts'
import { FlagFilters, FlagList, FlagSheet, STATE_STYLE, withState, notLookedAt, type FlagCtx, type FlagFilter } from '../components/analytics/Flags'
import { lateRows, latePeople, lateTotals, lateCsv, lateFor, stampLabel, fmtMoney, LATE_FEE_PERCENT, type LateRow } from '../lib/lateReturns'
import { STATE_LABEL } from '../lib/flagState'
import type { Incident } from '../lib/analytics'
import { useManageCreator } from '../components/ManageCreator'
import { useAnalyticsData } from '../hooks/useAnalytics'
import { formatDay } from '../lib/dates'
import { KIND, THEMES, SERIOUS_KINDS, type House, type Kind } from '../lib/analytics'
import { PRESETS, rangeFor, customRange, grainsFor, defaultGrain, bucketSpan, slice, value, fmt, compare, seriesOf, rowsBy, sortRows, toCsv, shift,
  METRICS, DIMS, HOUSE_LABEL, standings, sortStandings, comingThisMonth, typicalSeries, OUTPUT, ATTENTION_MEANS, type StandSort, type Output, type Preset, type Grain, type Metric, type Dim, type Data, type Range, type Row } from '../lib/insights'

type Tab = 'creators' | 'late' | 'flags' | 'teams' | 'trends'
// Owner, Oct 20: accountability first ("organised by creator rather than by time"); trends over time come last.
// Late returns (owner, Oct 27): the audit log for the late return fee, right after Creators.
const TABS: [Tab, string][] = [['creators', 'Creators'], ['late', 'Late returns'], ['flags', 'Flags'], ['teams', 'Teams'], ['trends', 'Trends']]
const DIM_ORDER: Dim[] = ['creator', 'house', 'period', 'theme', 'kind', 'staff']
const CAP = 5
const cap = <T,>(xs: T[], all: boolean) => all ? xs : xs.slice(0, CAP)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export default function AnalyticsScreen() {
  const navigate = useNavigate()
  const [qs, setQs] = useSearchParams()
  const set = (patch: Record<string, string | number | null>, push = false) => {
    const next = new URLSearchParams(qs)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, String(v)) }
    setQs(next, { replace: !push })
  }
  const drill = (patch: Record<string, string | number | null>) => set(patch, true)

  const tabQ = qs.get('tab'), tab: Tab = tabQ === 'overview' ? 'trends' : TABS.some(t => t[0] === tabQ) ? tabQ as Tab : 'creators'
  // Creators are compared month by month by default; trends default to 12 weeks.
  const preset = (PRESETS.some(p => p[0] === qs.get('period')) ? qs.get('period') : tab === 'trends' ? '12w' : 'tm') as Preset
  const zoomFrom = qs.get('from'), zoomTo = qs.get('to')
  const who = qs.get('who') || '', house = (qs.get('house') as House) || ''
  const theme = qs.get('theme') || '', kind = (qs.get('kind') as Kind) || ''
  const table = qs.get('view') === 'table'

  // Load two years back at most: the longest range (12 months) plus the 12 months it's compared with.
  const { a, people, staffName, pausedNow, loading, today, reviews, raw, statuses } = useAnalyticsData(shift(today0(), -740))
  const range: Range = zoomFrom && zoomTo ? customRange(zoomFrom, zoomTo) : rangeFor(preset, today)
  const grains = grainsFor(range)
  const grain = (grains.includes(qs.get('g') as Grain) ? qs.get('g') : defaultGrain(range)) as Grain
  const kinds = kind ? [kind] : theme ? THEMES.find(t => t.key === theme)?.kinds : undefined
  const scope = { email: who || undefined, house: (house || undefined) as House | undefined, kinds }
  const cur = useMemo(() => slice(a, range.from, range.to, scope), [a, range.from, range.to, who, house, theme, kind])   // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => slice(a, range.prevFrom, range.prevTo, scope), [a, range.prevFrom, range.prevTo, who, house, theme, kind])   // eslint-disable-line react-hooks/exhaustive-deps
  // Excused flags don't count in the numbers, but the flag lists still show them (filter "Excused").
  const excusedCur = useMemo(() => a.excused.filter(i => i.date >= range.from && i.date <= range.to && (!who || i.email === who) && (!house || i.house === house)
    && (!kinds || kinds.includes(i.kind))), [a, range.from, range.to, who, house, theme, kind])   // eslint-disable-line react-hooks/exhaustive-deps
  const flagCtx: FlagCtx = { reviews, raw, excused: a.excused, staffName, navigate: to => navigate(to) }
  const nameOf = (e: string) => a.names.get(e) ?? people.find(p => p.email === e)?.name ?? e.split('@')[0]

  const [periodOpen, setPeriodOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  const chips: { label: string; clear: () => void }[] = [
    ...(who ? [{ label: nameOf(who), clear: () => set({ who: null }) }] : []),
    ...(house ? [{ label: HOUSE_LABEL[house], clear: () => set({ house: null }) }] : []),
    ...(theme ? [{ label: THEMES.find(t => t.key === theme)?.label ?? theme, clear: () => set({ theme: null, kind: null }) }] : []),
    ...(kind ? [{ label: KIND[kind].label, clear: () => set({ kind: null }) }] : []),
  ]
  const zoomTo_ = (bucket: string) => { const [f, t] = bucketSpan(bucket, grain, range); drill({ from: f, to: t, g: null }) }
  const ctx: Ctx = { a, cur, prev, range, grain, scope, who, house, theme, kind, people, staffName, nameOf, set, drill, navigate, zoom: zoomTo_, tab, pausedNow, today, flagCtx, excusedCur, qs, statuses }

  if (loading) return <div className="min-h-full bg-pt-bg pt-safe px-4"><p className="text-pt-muted text-sm pt-10 text-center">Loading analytics…</p></div>

  return (
    <div className="min-h-full bg-pt-bg pb-16">
      <div className="pt-safe px-4">
        <div className="flex items-center gap-2">
          <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] py-1 tap">‹ Back</button>
          <span className="flex-1" />
          <button onClick={() => table ? set({ view: null }) : drill({ view: 'table' })} aria-label={table ? 'Close the advanced view' : 'Advanced view'} title="Advanced view"
            className={`w-11 h-11 rounded-full grid place-items-center ${table ? 'bg-pt-accent text-stone-900' : 'bg-pt-surface text-pt-text'}`}><Icon name="table" /></button>
          <button onClick={() => navigate('/rules-sheet')} aria-label="Settings sheet" title="Settings sheet" className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface text-pt-text"><Icon name="note" /></button>
        </div>
        <h1 className="font-display text-[34px] text-pt-text leading-tight">{table ? 'Advanced view' : 'Analytics'}</h1>
        <div className="flex items-center gap-2 mt-1 mb-3 flex-wrap">
          <button onClick={() => setPeriodOpen(true)} data-tour="period" className="flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-full bg-pt-surface shadow-hairline text-pt-text text-[15px]">
            <Icon name="calendar" className="w-4 h-4 text-pt-accent" />{range.label}<span className="text-pt-muted">▾</span>
          </button>
          {range.zoomed
            ? <button onClick={() => set({ from: null, to: null, g: null })} className="px-3 py-2 rounded-full bg-pt-accent/15 text-pt-accent text-sm">Zoom out to {PRESETS.find(p => p[0] === preset)![1].toLowerCase()}</button>
            : <span className="text-pt-muted text-sm">{range.dates}</span>}
        </div>
      </div>

      <div className="sticky z-10 bg-pt-bg px-4 border-b border-white/[0.06]" style={{ top: 'env(safe-area-inset-top)' }}>
        {!table && (
          <div role="tablist" className="flex gap-5 overflow-x-auto no-scrollbar">
            {TABS.map(([v, l]) => (
              <button key={v} role="tab" aria-selected={tab === v} onClick={() => set({ tab: v === 'creators' ? null : v, m: null })}
                className={`relative py-3 text-[15px] shrink-0 ${tab === v ? 'text-pt-text font-semibold' : 'text-pt-muted'}`}>
                {l}{tab === v && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-pt-accent" />}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 py-2 overflow-x-auto no-scrollbar" data-tour="scope">
          <button onClick={() => setFilterOpen(true)} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pt-surface text-pt-text text-sm"><Icon name="filter" className="w-4 h-4" />Filter</button>
          {chips.length === 0 && <span className="text-pt-muted text-sm whitespace-nowrap">Everyone · every house</span>}
          {chips.map((c, i) => <span key={c.label} className="shrink-0 flex items-center gap-1">{i > 0 && <span className="text-pt-muted">›</span>}
            <button onClick={c.clear} aria-label={`Remove ${c.label}`} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-pt-accent/15 text-pt-accent text-sm whitespace-nowrap">{c.label}<span aria-hidden>×</span></button></span>)}
          {chips.length > 1 && <button onClick={() => set({ who: null, house: null, theme: null, kind: null })} className="shrink-0 text-pt-muted text-sm px-1">Clear all</button>}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {table ? <AdvancedView {...ctx} qs={qs} /> : <>
          {tab === 'creators' && <CreatorsTab {...ctx} m={qs.get('m') as Metric} sort={(['most', 'least', 'flags', 'name'].includes(qs.get('sort') ?? '') ? qs.get('sort') : 'most') as StandSort} level={(qs.get('level') as StandFilter) || ''} />}
          {tab === 'late' && <LateTab {...ctx} />}
          {tab === 'flags' && <FlagsTab {...ctx} m={qs.get('m') as Metric} />}
          {tab === 'teams' && <TeamsTab {...ctx} m={qs.get('m') as Metric} />}
          {tab === 'trends' && <TrendsTab {...ctx} m={qs.get('m') as Metric} />}
        </>}
      </div>

      <BottomSheet open={periodOpen} onClose={() => setPeriodOpen(false)} title="Date range">
        <div className="space-y-4 pb-4">
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {PRESETS.map(([p, l]) => {
              const on = !range.zoomed && p === preset
              return (
                <button key={p} onClick={() => { set({ period: p, from: null, to: null, g: null }); setPeriodOpen(false) }} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="flex-1"><span className="block text-pt-text text-[15px]">{l}</span><span className="block text-pt-muted text-xs">{rangeFor(p, today).dates}</span></span>
                  {on && <Icon name="check" className="w-5 h-5 text-pt-accent" />}
                </button>
              )
            })}
          </div>
          {grains.length > 1 && <div>
            <p className="text-pt-muted text-sm mb-2">Show the chart by</p>
            <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
              {grains.map(g => <button key={g} onClick={() => set({ g })} className={`flex-1 py-2 rounded-[10px] text-sm ${grain === g ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{g === 'day' ? 'Day' : g === 'week' ? 'Week' : 'Month'}</button>)}
            </div>
          </div>}
          <p className="text-pt-muted text-xs">Every number is compared with {range.prevLabel}. Tap a column in a chart to zoom into it.</p>
        </div>
      </BottomSheet>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} {...{ people, who, house, theme, set }} />
    </div>
  )
}
// Today in the studio, before the data hook (the hook needs a fixed start date).
const today0 = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })

interface Ctx {
  a: ReturnType<typeof useAnalyticsData>['a']; cur: Data; prev: Data; range: Range; grain: Grain; scope: { email?: string; house?: House; kinds?: Kind[] }
  who: string; house: string; theme: string; kind: string; people: { email: string; name: string }[]; staffName: (e: string) => string; nameOf: (e: string) => string
  set: (p: Record<string, string | number | null>, push?: boolean) => void; drill: (p: Record<string, string | number | null>) => void
  navigate: ReturnType<typeof useNavigate>; zoom: (bucket: string) => void; tab: Tab; pausedNow: string[]; today: string
  flagCtx: FlagCtx; excusedCur: ReturnType<typeof useAnalyticsData>['a']['excused']; qs: URLSearchParams; statuses: ReturnType<typeof useAnalyticsData>['statuses']
}

function FilterSheet({ open, onClose, people, who, house, theme, set }: { open: boolean; onClose: () => void; people: { email: string; name: string }[]; who: string; house: string; theme: string
  set: Ctx['set'] }) {
  const [q, setQ] = useState('')
  const list = [...people].sort((x, y) => x.name.localeCompare(y.name)).filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <BottomSheet open={open} onClose={onClose} title="Filter">
      <div className="space-y-4 pb-4">
        <div>
          <p className="text-pt-muted text-sm mb-2">House</p>
          <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
            {([['', 'All'], ['cliff1', 'Cliff 1'], ['cliff2', 'Cliff 2'], ['offsite', 'Offsite']] as [string, string][]).map(([v, l]) =>
              <button key={l} onClick={() => set({ house: v || null })} className={`flex-1 py-2 rounded-[10px] text-sm ${house === v ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>)}
          </div>
        </div>
        <div>
          <p className="text-pt-muted text-sm mb-2">Flag type</p>
          <div className="flex flex-wrap gap-2">
            {[{ key: '', label: 'Any' }, ...THEMES].map(t => <button key={t.key} onClick={() => set({ theme: t.key || null, kind: null })} className={`px-3 py-1.5 rounded-full text-sm ${theme === t.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{t.label}</button>)}
          </div>
        </div>
        <div>
          <p className="text-pt-muted text-sm mb-2">Creator</p>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name" className="w-full bg-pt-surface rounded-xl px-3 py-2.5 text-pt-text mb-2" />
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06] max-h-[40vh] overflow-y-auto">
            {!q && <button onClick={() => set({ who: null })} className="w-full flex items-center gap-3 px-3 py-2.5 text-left"><span className="w-8 h-8 rounded-full bg-pt-border grid place-items-center"><Icon name="people" className="w-4 h-4" /></span><span className="flex-1 text-pt-text">Everyone</span>{!who && <Icon name="check" className="w-5 h-5 text-pt-accent" />}</button>}
            {list.map(p => <button key={p.email} onClick={() => set({ who: p.email })} className="w-full flex items-center gap-3 px-3 py-2.5 text-left"><Avatar email={p.email} name={p.name} size={32} /><span className="flex-1 text-pt-text truncate">{p.name}</span>{who === p.email && <Icon name="check" className="w-5 h-5 text-pt-accent" />}</button>)}
          </div>
        </div>
        <button onClick={onClose} className="w-full py-3 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
      </div>
    </BottomSheet>
  )
}

// ── The same top half on every tab: headline → metric cards → chart ──
// No chart (creator page, Flags, Teams): the cards are shortcuts instead (onCard), e.g. Flags opens the flag list.
function Top({ c, metrics, m, headline, sub, tourId, chart = true, onCard }: { c: Ctx; metrics: Metric[]; m?: Metric; headline?: ReactNode; sub?: ReactNode; tourId?: string; chart?: boolean
  onCard?: (m: Metric) => void }) {
  const sel = m && metrics.includes(m) ? m : metrics[0]
  const cv = (x: Metric) => value(x, c.cur), pv = (x: Metric) => value(x, c.prev)
  const data = seriesOf(sel, c.a, c.range, c.grain, c.scope)
  const cmp = compare(sel, cv(sel), pv(sel))
  return <>
    {headline && <div data-tour={tourId}>
      <p className="text-pt-text text-[22px] font-semibold leading-snug tracking-tight">{headline}</p>
      {sub && <p className="text-pt-muted text-[15px] mt-1">{sub}</p>}
    </div>}
    <MetricCards metrics={metrics} cur={cv} prev={pv} selected={chart ? sel : undefined} onSelect={chart ? x => c.set({ m: x === metrics[0] ? null : x }) : onCard} link={!chart && !!onCard} tourId="cards" />
    {chart && <div>
      <p className="text-pt-text text-[15px] font-medium mb-2">{METRICS[sel].label} by {c.grain}{cmp && cmp.text !== 'New' && <span className="text-pt-muted font-normal"> · {cmp.tone === 'flat' ? 'about the same as' : `${cmp.text} vs`} {c.range.prevLabel}</span>}</p>
      <ColumnChart data={data} grain={c.grain} m={sel} onZoom={c.zoom} avgWord={`per ${c.grain}`} />
      <p className="text-pt-muted text-xs mt-2">{METRICS[sel].means}</p>
    </div>}
  </>
}
const vsLine = (c: Ctx, m: Metric) => {
  const cmp = compare(m, value(m, c.cur), value(m, c.prev))
  if (!cmp) return null
  if (cmp.text === 'New') return `None in ${c.range.prevLabel} to compare with.`
  return cmp.tone === 'flat' ? `About the same as ${c.range.prevLabel}.` : `${cmp.text.replace('↑', 'Up').replace('↓', 'Down')} on ${c.range.prevLabel}.`
}

// ── Trends: the whole studio over time (owner: least important, so it's the last tab) ──
function TrendsTab(c: Ctx & { m: Metric }) {
  const filmed = value('filmed', c.cur)!, creators = value('creators', c.cur)!
  const people = rowsBy('creator', c.cur, { grain: c.grain, people: c.who ? [] : c.people })
  const top = sortRows(people, 'filmed').filter(r => value('filmed', r.data)! > 0).slice(0, 5)
  const topMax = Math.max(1, ...top.map(r => value('filmed', r.data)!))
  const themes = sortRows(rowsBy('theme', c.cur, { grain: c.grain }), 'flags').filter(r => value('flags', r.data)! > 0)
  const themeMax = Math.max(1, ...themes.map(r => value('flags', r.data)!))
  const houses = rowsBy('house', c.cur, { grain: c.grain })
  const houseMax = Math.max(1, ...houses.map(r => value('filmed', r.data)!))
  const subject = c.who ? c.nameOf(c.who) : plural(creators, 'creator')
  return <>
    <Top c={c} m={c.m} metrics={['filmed', 'showRate', 'creators', 'flags']} tourId="headline"
      headline={<>{subject} filmed {plural(filmed, 'shoot')} {c.range.phrase}</>} sub={vsLine(c, 'filmed')} />
    <SectionHead title="Top creators" sub="Most shoots filmed" onMore={() => c.drill({ view: 'table', dim: 'creator', sort: 'filmed' })} />
    <RankList tourId="topcreators" empty="Nobody filmed in this range." rows={top.map(r => ({ key: r.key, label: r.label, email: r.email, value: fmt('filmed', value('filmed', r.data)),
      share: value('filmed', r.data)! / topMax, sub: `${fmt('showRate', value('showRate', r.data))} showed up · ${plural(value('flags', r.data)!, 'flag')}`, onClick: () => c.drill({ who: r.key, tab: 'creators', m: null }) }))} />
    <SectionHead title="Flags by type" onMore={() => c.drill({ view: 'table', dim: 'theme', sort: 'flags' })} />
    <RankList empty="No flags in this range. Nice." rows={themes.map(r => ({ key: r.key, label: r.label, value: String(value('flags', r.data)), share: value('flags', r.data)! / themeMax,
      tone: 'text-amber-200', sub: [...new Set(r.data.incidents.map(i => i.name))].slice(0, 3).join(', '), onClick: () => c.drill({ theme: r.key, tab: 'flags', m: null }) }))} />
    <SectionHead title="Where they film" onMore={() => c.drill({ view: 'table', dim: 'house', sort: 'filmed' })} />
    <RankList rows={houses.map(r => ({ key: r.key, label: r.label, value: fmt('filmed', value('filmed', r.data)), share: value('filmed', r.data)! / houseMax,
      sub: `${fmt('showRate', value('showRate', r.data))} showed up`, onClick: () => c.drill({ house: r.key }) }))} />
  </>
}

// ── Creators: who's posting more, who's posting less (the default tab) ──
function CreatorsTab(c: Ctx & { m: Metric; sort: StandSort; level: StandFilter | '' }) {
  if (c.who) return <PersonView {...c} />
  const all = sortStandings(standings(rowsBy('creator', c.cur, { grain: c.grain, people: c.house || c.theme || c.kind ? [] : c.people }),
    { paused: c.pausedNow, coming: comingThisMonth(c.a.upcoming, c.range, c.today) }), c.sort)
  const list = !c.level ? all : c.level === 'attention' ? all.filter(s => s.attention) : all.filter(s => s.output === c.level)
  const typical = all[0]?.typical ?? 0
  const max = Math.max(1, ...all.map(s => s.filmed))
  const top = [...all].sort((x, y) => y.filmed - x.filmed)[0]
  const when = c.range.phrase.replace(/^in /, '')
  const t = Math.round(typical * 10) / 10
  return <>
    <div data-tour="headline">
      <p className="text-pt-text text-[22px] font-semibold leading-snug tracking-tight">
        {top && top.filmed > 0 ? <>{top.name} filmed the most {when}: {plural(top.filmed, 'shoot')}</> : `Nobody has filmed ${when} yet`}
      </p>
      <p className="text-pt-muted text-[15px] mt-1">The typical creator filmed {t} {when}. {all.filter(s => s.filmed === 0).length ? `${plural(all.filter(s => s.filmed === 0).length, 'creator')} filmed nothing.` : ''}</p>
    </div>
    <StandingTiles tourId="tiles" list={all} filter={c.level} onFilter={l => c.set({ level: l || null })} />
    <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5" role="tablist" aria-label="Sort">
      {([['most', 'Most filmed'], ['least', 'Least filmed'], ['flags', 'Most flags'], ['name', 'A–Z']] as [StandSort, string][]).map(([v, l]) =>
        <button key={v} role="tab" aria-selected={c.sort === v} onClick={() => c.set({ sort: v === 'most' ? null : v })} className={`flex-1 py-2 rounded-[10px] text-sm whitespace-nowrap ${c.sort === v ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>)}
    </div>
    <StandingList tourId="standings" max={max} list={list} onOpen={e => c.drill({ who: e, m: null })} empty="Nobody in this group." />
    <TypicalKey typical={typical} />
    <details className="bg-pt-surface rounded-2xl px-3 py-2">
      <summary className="text-pt-text text-[15px] py-1 cursor-pointer">How creators are compared</summary>
      <div className="space-y-2 py-2">
        <p className="text-pt-muted text-sm">There's no minimum. Everyone is compared with the <b className="text-pt-text">typical creator</b>: the middle number of shoots filmed in this date range (half filmed more, half less).</p>
        {(['more', 'typical', 'less'] as Output[]).map(l => <p key={l} className="text-pt-muted text-sm"><b className={OUT_STYLE[l].text}>{OUTPUT[l].label}:</b> {OUTPUT[l].means}</p>)}
        <p className="text-pt-muted text-sm"><b className={OUT_STYLE.attention.text}>Needs attention</b> is about behaviour, not output: {ATTENTION_MEANS}</p>
      </div>
    </details>
    <SectionHead title="Needs you now" sub="Live, whatever the date range" />
    <NeedsYou items={needsYouItems(c.a, c.pausedNow, to => c.navigate(to), notLookedAt(c.a.incidents, c.flagCtx.reviews, shift(c.today, -27)))} />
  </>
}
// A creator's report card: how they compare, month by month against the typical creator, then flags, videos, shoots.
function PersonView(c: Ctx & { m: Metric }) {
  const name = c.nameOf(c.who)
  const allRows = rowsBy('creator', slice(c.a, c.range.from, c.range.to, { house: c.scope.house }), { grain: c.grain, people: c.people })
  const everyone = standings(allRows, { paused: c.pausedNow, coming: comingThisMonth(c.a.upcoming, c.range, c.today) })
  const st = everyone.find(s => s.email === c.who) ?? standings([{ key: c.who, label: name, email: c.who, data: c.cur }], { paused: c.pausedNow, typical: everyone[0]?.typical ?? 0 })[0]
  const max = Math.max(1, ...everyone.map(s => s.filmed))
  const six = rangeFor('6m', c.today)
  const months = seriesOf('filmed', c.a, six, 'month', { email: c.who })
  const typical = typicalSeries(c.a, six, 'month', c.people)
  const above = months.filter((x, i) => (x.value ?? 0) > typical[i]).length
  // Their flags, with where each one stands (owner, Oct 21: tap a card → every flag → what you can do about it).
  const fs = (['todo', 'handled', 'excused'].includes(c.qs.get('fs') ?? '') ? c.qs.get('fs') : 'all') as FlagFilter, sev = c.qs.get('sev') === '1'
  const flagXs = withState(c.cur.incidents, c.excusedCur, c.flagCtx.reviews).filter(x => !sev || SERIOUS_KINDS.includes(x.i.kind))
  const jump = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  const onCard = (m: Metric) => {
    if (m === 'flags' || m === 'serious') { c.set({ fs: null, sev: m === 'serious' ? '1' : null }); jump('their-flags') }
    else { setShowAll(x => ({ ...x, shoots: true })); jump('every-shoot') }
  }
  const mg = useManageCreator(c.who, name, c.statuses[c.who] ?? null)
  const videos = c.cur.facts.filter(f => f.filmed && f.title).sort((x, y) => y.date.localeCompare(x.date))
  const shoots = [...c.cur.facts].sort((x, y) => y.date.localeCompare(x.date))
  const [showAll, setShowAll] = useState({ videos: false, shoots: false })
  const more = (k: 'videos' | 'shoots', n: number) => !showAll[k] && n > CAP && <button onClick={() => setShowAll({ ...showAll, [k]: true })} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-accent text-[15px]">Show all {n}</button>
  return <>
    <div className={`rounded-2xl p-3 space-y-3 ${st.attention ? OUT_STYLE.attention.tile : OUT_STYLE[st.output].tile}`} data-tour="reportcard">
      <div className="flex items-center gap-3">
        <Avatar email={c.who} name={name} size={52} />
        <span className="flex-1 min-w-0"><b className="block text-pt-text text-[17px] truncate">{name}</b>
          <span className="mt-1 flex flex-wrap gap-1.5"><OutPill k={st.output} />{st.attention && <OutPill k="attention" />}</span></span>
        <button onClick={() => c.navigate(`/people/${encodeURIComponent(c.who)}`)} className="shrink-0 px-3 py-2 rounded-full bg-pt-border text-pt-text text-sm">Record ›</button>
      </div>
      <div>
        <p className="text-pt-text text-[22px] font-semibold leading-snug">#{st.rank} of {everyone.length} · {plural(st.filmed, 'shoot')} filmed <span className="text-pt-muted text-[15px] font-normal">{c.range.phrase.replace(/^in /, '')}</span></p>
        <div className="mt-2"><OutputBar s={st} max={max} /></div>
        <p className="text-sm mt-2 text-pt-muted">The typical creator filmed {Math.round(st.typical * 10) / 10}: {vsTypicalText(st)}.{st.coming ? ` ${st.coming} more booked this month.` : ''}</p>
        {st.attention && <button onClick={() => { c.set({ fs: null, sev: null }); jump('their-flags') }} className={`text-sm mt-1 text-left ${OUT_STYLE.attention.text}`}>{st.reasons.join(' · ')} <span className="text-pt-muted">· See their flags ›</span></button>}
      </div>
    </div>
    <div data-tour="manage">{mg.buttons}</div>
    {mg.sheets}
    <Top c={c} m={c.m} chart={false} metrics={['filmed', 'showRate', 'flags', 'serious']} onCard={onCard} />
    <SectionHead title="Month by month" sub={`Shoots filmed; the white lines are the typical creator · above typical ${above} of the last ${months.length} months`} />
    <ColumnChart data={months} grain="month" m="filmed" typical={typical} avgWord="a month" onZoom={b => { const [f, t] = bucketSpan(b, 'month', six); c.drill({ from: f, to: t, g: null }) }} />
    <div id="their-flags" className="scroll-mt-32" />
    {(() => { const lt = lateTotals(lateRows(c.cur.incidents)); return (
      <button onClick={() => c.drill({ tab: 'late', m: null })} className="w-full flex items-center gap-3 bg-pt-surface rounded-2xl px-3 py-3 text-left" data-tour="theirlate">
        <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px]">Late returns · {lt.count}</span>
          <span className="block text-pt-muted text-xs">{lt.count ? `${lt.gear} gear (fee applies) · ${lt.props} props${lt.stillOut ? ` · ${lt.stillOut} still out` : ''}` : `Nothing late ${c.range.phrase}`}</span></span>
        <span className="text-pt-muted">›</span>
      </button>) })()}
    <SectionHead title={`Their flags · ${flagXs.length}`} sub="Tap one to see what happened and what you can do about it" onMore={() => c.drill({ tab: 'flags', m: null })} more="Flags tab" />
    <FlagFilters tourId="flagfilters" xs={flagXs} f={fs} onF={f => c.set({ fs: f === 'all' ? null : f })} serious={{ on: sev, toggle: () => c.set({ sev: sev ? null : '1' }) }} />
    <FlagList tourId="flaglist" xs={flagXs} f={fs} ctx={c.flagCtx} showWho={false} limit={6} />
    <SectionHead title="What they filmed" sub="From their wraps" />
    <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {videos.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">No wraps in this range.</p>}
      {cap(videos, showAll.videos).map(f => <button key={f.id} onClick={() => c.navigate(f.to)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left"><Icon name="video" className="w-5 h-5 text-pt-accent" /><span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px] truncate">“{f.title}”</span><span className="block text-pt-muted text-xs">{formatDay(f.date)} · {HOUSE_LABEL[f.house]}</span></span><span className="text-pt-muted">›</span></button>)}
    </div>
    {more('videos', videos.length)}
    <div id="every-shoot" className="scroll-mt-32" />
    <SectionHead title="Every shoot" sub={`${shoots.length} in this range`} />
    <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {shoots.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">No shoots in this range.</p>}
      {cap(shoots, showAll.shoots).map(f => (
        <button key={f.id} onClick={() => c.navigate(f.to)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
          <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px]">{formatDay(f.date)} · {HOUSE_LABEL[f.house]}</span>{f.title && <span className="block text-pt-muted text-xs truncate">“{f.title}”</span>}</span>
          <span className={`text-xs rounded-full px-2 py-1 ${f.filmed ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>{f.filmed ? 'Filmed' : 'Not filmed'}</span>
        </button>
      ))}
    </div>
    {more('shoots', shoots.length)}
  </>
}

// ── Late returns: the audit log for the late return fee (owner, Oct 27) ──
// Gear returned late carries a fee of 10% of its value (on whoever had it last); props are logged with no fee for now.
// Nothing is charged by the app: this is the record to enforce it from. Excusing one (on its sheet) makes an exception.
function LateTab(c: Ctx) {
  const [open, setOpen] = useState<Incident | null>(null)
  const [all, setAll] = useState(false)
  const type = (['gear', 'props'].includes(c.qs.get('lt') ?? '') ? c.qs.get('lt') : '') as '' | 'gear' | 'props'
  const show = (['excused', 'all'].includes(c.qs.get('ls') ?? '') ? c.qs.get('ls') : '') as '' | 'excused' | 'all'
  const counted = lateRows(c.cur.incidents), excused = lateRows(c.excusedCur)
  const t = lateTotals(counted), people = latePeople(counted)
  const states = new Map(withState([...counted, ...excused].map(r => r.i), excused.map(r => r.i), c.flagCtx.reviews).map(x => [x.i.id, x.s]))
  const pool = (show === 'excused' ? excused : show === 'all' ? [...counted, ...excused] : counted).filter(r => !type || r.kind === type)
    .sort((x, y) => y.late.dueAt.localeCompare(x.late.dueAt))
  const list = all ? pool : pool.slice(0, 12)
  const subject = c.who ? `${c.nameOf(c.who)} returned things late` : 'Things came back late'
  const pMax = Math.max(1, ...people.map(p => p.count))
  const download = () => {
    const blob = new Blob([lateCsv(pool, r => STATE_LABEL[states.get(r.i.id) ?? 'todo'])], { type: 'text/csv' })
    const url = URL.createObjectURL(blob), el = document.createElement('a')
    el.href = url; el.download = `prime-capitol-late-returns-${c.range.from}-to-${c.range.to}.csv`; el.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const tile = (n: string, label: string, tone = 'text-pt-text') => (
    <div className="bg-pt-surface rounded-2xl p-3"><p className={`text-[22px] font-semibold tabular-nums ${tone}`}>{n}</p><p className="text-pt-muted text-xs leading-snug">{label}</p></div>)
  const chip = (on: boolean, label: string, onClick: () => void) => <button key={label} onClick={onClick} className={`shrink-0 px-3 py-1.5 rounded-full text-sm ${on ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{label}</button>
  return <>
    <div data-tour="lateheadline">
      <p className="text-pt-text text-[22px] font-semibold leading-snug tracking-tight">{t.count ? <>{subject} {t.count} {t.count === 1 ? 'time' : 'times'} {c.range.phrase}</> : <>Nothing came back late {c.range.phrase}</>}</p>
      <p className="text-pt-muted text-[15px] mt-1">{t.count ? `${t.gear} gear (the fee applies) · ${t.props} props (no fee for now)` : 'Nice.'}</p>
    </div>
    <div className="grid grid-cols-2 gap-2" data-tour="latetiles">
      {tile(String(t.gear), `Gear late · fee applies (${LATE_FEE_PERCENT}% of value)`, t.gear ? 'text-amber-200' : 'text-pt-text')}
      {tile(String(t.props), 'Props late · no fee for now')}
      {tile(String(t.stillOut), 'Still out and late right now', t.stillOut ? 'text-red-300' : 'text-pt-text')}
      {tile(t.gearValue ? fmtMoney(t.gearValue) : '$0', 'Value of the late gear')}
    </div>
    <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-3 py-3"><b className="text-pt-text">Company rule:</b> gear returned late carries a fee of {LATE_FEE_PERCENT}% of its value, on whoever had it last. Gear is late 30 minutes after its end time; props at 10 AM the day after the shoot. The app keeps the record; nobody is charged automatically. To make an exception, open one and <b className="text-pt-text">Excuse it</b>.</p>
    {!c.who && <>
      <SectionHead title="Who returns late most" sub="Tap someone to see just theirs" />
      <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]" data-tour="latepeople">
        {people.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">Nobody. Nice.</p>}
        {people.slice(0, 10).map(p => (
          <button key={p.email} onClick={() => c.drill({ who: p.email })} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
            <Avatar email={p.email} name={p.name} size={32} />
            <span className="flex-1 min-w-0">
              <span className="block text-pt-text text-[15px] truncate">{p.name}</span>
              <span className="block text-pt-muted text-xs truncate">{[p.gear && `${p.gear} gear`, p.props && `${p.props} props`, `${lateFor(p.minutes)} late in all`, p.gearValue && `${fmtMoney(p.gearValue)} of gear`].filter(Boolean).join(' · ')}</span>
              <span className="block h-1 rounded-full bg-white/[0.06] mt-1.5 overflow-hidden"><i className="block h-full bg-amber-300/80" style={{ width: `${(p.count / pMax) * 100}%` }} /></span>
            </span>
            <span className="text-pt-text tabular-nums text-[17px] font-semibold">{p.count}</span>
            {p.stillOut > 0 && <span className="text-xs rounded-full px-2 py-0.5 bg-red-500/15 text-red-300">Still out</span>}
          </button>
        ))}
      </div>
    </>}
    <SectionHead title={`Every late return · ${pool.length}`} sub="Tap one for the times, the value and the photos, and to excuse it" />
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
      {chip(!type, 'Gear + props', () => c.set({ lt: null }))}{chip(type === 'gear', 'Gear', () => c.set({ lt: 'gear' }))}{chip(type === 'props', 'Props', () => c.set({ lt: 'props' }))}
      <span className="w-px bg-white/10 shrink-0" />
      {chip(!show, 'Counted', () => c.set({ ls: null }))}{chip(show === 'excused', `Excused · ${excused.length}`, () => c.set({ ls: 'excused' }))}{chip(show === 'all', 'All', () => c.set({ ls: 'all' }))}
    </div>
    <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]" data-tour="latelist">
      {pool.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">None in this view.</p>}
      {list.map((r: LateRow) => {
        const st = states.get(r.i.id) ?? 'todo'
        return (
          <button key={r.i.id} onClick={() => setOpen(r.i)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
            {!c.who && <Avatar email={r.i.email} name={r.i.name} size={32} />}
            <span className="flex-1 min-w-0">
              <span className="block text-pt-text text-[15px] truncate">{!c.who ? `${r.i.name} · ` : ''}{r.late.still ? `${lateFor(r.late.minutes)} late so far` : `${lateFor(r.late.minutes)} late`}</span>
              <span className="block text-pt-muted text-xs truncate">{formatDay(r.i.date)} · {r.i.text.replace(/ (came back late|still out, late)$/, '')}{r.kind === 'gear' ? ` · ${r.late.value === null ? 'value not recorded' : r.late.value ? fmtMoney(r.late.value) : 'no value set'}` : ''}</span>
              <span className="block text-pt-muted text-xs truncate">Due {stampLabel(r.late.dueAt)}{r.late.backAt ? ` · back ${stampLabel(r.late.backAt)}` : ''}</span>
            </span>
            <span className="flex flex-col items-end gap-1 shrink-0">
              {r.late.still ? <span className="text-xs rounded-full px-2 py-0.5 bg-red-500/15 text-red-300">Still out</span>
                : st === 'excused' ? <span className={`text-xs rounded-full px-2 py-1 ${STATE_STYLE.excused}`}>Excused</span>
                : <span className={`text-xs rounded-full px-2 py-1 ${r.kind === 'gear' ? 'bg-amber-500/15 text-amber-200' : 'bg-pt-border text-pt-muted'}`}>{r.kind === 'gear' ? 'Fee applies' : 'No fee'}</span>}
            </span>
          </button>
        )
      })}
    </div>
    {!all && pool.length > list.length && <button onClick={() => setAll(true)} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-accent text-[15px]">Show all {pool.length}</button>}
    <button onClick={download} disabled={!pool.length} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-pt-surface text-pt-text text-[15px] disabled:opacity-50"><Icon name="download" className="w-5 h-5" />Download this log as a spreadsheet</button>
    <FlagSheet flag={open} ctx={c.flagCtx} onClose={() => setOpen(null)} excused={!!open && c.flagCtx.excused.some(x => x.id === open.id)} />
  </>
}

// ── Flags: what kind, who, when ──
function FlagsTab(c: Ctx & { m: Metric }) {
  const n = value('flags', c.cur)!, serious = value('serious', c.cur)!
  const what = c.kind ? KIND[c.kind as Kind].label.toLowerCase() : c.theme ? `"${THEMES.find(t => t.key === c.theme)?.label.toLowerCase()}"` : ''
  const subject = c.who ? `${c.nameOf(c.who)} had` : 'There were'
  const themes = sortRows(rowsBy('theme', c.cur, { grain: c.grain }), 'flags')
  const tMax = Math.max(1, ...themes.map(r => value('flags', r.data)!))
  const kinds = sortRows(rowsBy('kind', c.cur, { grain: c.grain }), 'flags')
  const people = sortRows(rowsBy('creator', c.cur, { grain: c.grain }), 'flags').filter(r => value('flags', r.data)! > 0)
  const pMax = Math.max(1, ...people.map(r => value('flags', r.data)!))
  const fs = (['handled', 'excused', 'all'].includes(c.qs.get('fs') ?? '') ? c.qs.get('fs') : 'todo') as FlagFilter, sev = c.qs.get('sev') === '1'
  const flagXs = withState(c.cur.incidents, c.excusedCur, c.flagCtx.reviews).filter(x => !sev || SERIOUS_KINDS.includes(x.i.kind))
  const narrowed = !!(c.who || c.theme || c.kind)
  const jump = () => setTimeout(() => document.getElementById('every-flag')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  const onCard = (m: Metric) => {
    if (m === 'flagged') return document.getElementById('who-most')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    c.set({ fs: m === 'open' ? null : 'all', sev: m === 'serious' ? '1' : null }); jump()
  }
  return <>
    <Top c={c} m={c.m} chart={false} metrics={['flags', 'serious', 'flagged', 'open']} onCard={onCard}
      headline={<>{subject} {n} {what ? what + ' ' : ''}{n === 1 ? 'flag' : 'flags'} {c.range.phrase}</>}
      sub={<>{serious ? `${serious} serious. ` : ''}{vsLine(c, 'flags')}</>} />
    {!c.who && <>
      <div id="who-most" className="scroll-mt-32" />
      <SectionHead title="Who has the most" sub="Tap someone to see just their flags" onMore={() => c.drill({ view: 'table', dim: 'creator', sort: 'flags' })} />
      <RankList empty="Nobody. Nice." rows={people.slice(0, 8).map(r => ({ key: r.key, label: r.label, email: r.email, value: String(value('flags', r.data)), share: value('flags', r.data)! / pMax, tone: 'text-amber-200',
        sub: `${value('serious', r.data)} serious`, onClick: () => c.drill({ who: r.key, m: null }) }))} />
    </>}
    {!c.theme && !c.kind && <>
      <SectionHead title="By type" sub="Tap a type to see what's in it" onMore={() => c.drill({ view: 'table', dim: 'theme', sort: 'flags' })} />
      <RankList tourId="themes" rows={themes.map(r => ({ key: r.key, label: r.label, value: String(value('flags', r.data)), share: value('flags', r.data)! / tMax, tone: value('flags', r.data) ? 'text-amber-200' : 'text-pt-muted',
        sub: [...new Set(r.data.incidents.map(i => i.name))].slice(0, 3).join(', ') || 'Nobody', onClick: () => c.drill({ theme: r.key, m: null }) }))} />
    </>}
    {c.theme && !c.kind && <>
      <SectionHead title="In this type" />
      <RankList rows={(THEMES.find(t => t.key === c.theme)?.kinds ?? []).map(k => { const r = kinds.find(x => x.key === k); const v = r ? value('flags', r.data)! : 0
        return { key: k, label: KIND[k].label, value: String(v), share: v / Math.max(1, ...kinds.map(x => value('flags', x.data)!)), tone: v ? 'text-amber-200' : 'text-pt-muted', sub: KIND[k].means, onClick: () => c.drill({ kind: k, m: null }) } })} />
    </>}
    {c.kind && <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-3 py-3"><b className="text-pt-text">{KIND[c.kind as Kind].label}:</b> {KIND[c.kind as Kind].means}</p>}
    <div id="every-flag" className="scroll-mt-32" />
    <SectionHead title={`Every flag · ${flagXs.length}`} sub="To do = nobody has decided or done anything yet. Tap one to see what happened and act on it." />
    <FlagFilters xs={flagXs} f={fs} onF={f => c.set({ fs: f === 'todo' ? null : f })} serious={{ on: sev, toggle: () => c.set({ sev: sev ? null : '1' }) }} />
    <FlagList xs={flagXs} f={fs} ctx={c.flagCtx} showWho={!c.who} limit={narrowed ? undefined : 10} />
  </>
}

// ── Teams: the arts department and the equipment team ──
function TeamsTab(c: Ctx & { m: Metric }) {
  const b = c.a.backlog
  const packed = value('packed', c.cur)!, gear = value('gearChecked', c.cur)!
  const staff = rowsBy('staff', c.cur, { grain: c.grain, staffName: c.staffName })
  const arts = sortRows(staff.filter(r => r.data.jobs.some(j => j.team === 'props')), 'packed')
  const eq = sortRows(staff.filter(r => r.data.jobs.some(j => j.team === 'gear')), 'gearChecked')
  const aMax = Math.max(1, ...arts.map(r => value('packed', r.data)! + value('propsChecked', r.data)!))
  const eMax = Math.max(1, ...eq.map(r => value('gearChecked', r.data)!))
  const tile = (n: number, label: string, to: string, bad = false) => (
    <button onClick={() => c.navigate(to)} className="bg-pt-surface rounded-2xl p-3 text-left">
      <span className={`block text-[26px] font-bold leading-none tabular-nums ${bad && n ? 'text-red-300' : 'text-pt-text'}`}>{n}</span>
      <span className="block text-pt-muted text-xs mt-1">{label}</span>
    </button>
  )
  return <>
    <Top c={c} m={c.m} chart={false} metrics={['packed', 'packOnTime', 'packTime', 'propsCheckTime', 'gearChecked', 'gearCheckTime']}
      headline={<>The arts department packed {plural(packed, 'request')} and the equipment team checked in {plural(gear, 'return')} {c.range.phrase}</>} sub={vsLine(c, 'packed')} />
    <Top c={c} m={c.m} chart={false} metrics={['packed', 'packOnTime', 'packTime', 'propsCheckTime', 'gearChecked', 'gearCheckTime']}
      headline={<>The arts department packed {plural(packed, 'request')} and the equipment team checked in {plural(gear, 'return')} {c.range.phrase}</>} sub={vsLine(c, 'packed')} />
    <SectionHead title="Right now" sub="Live queues, whatever the date range" />
    <div className="grid grid-cols-3 gap-2">
      {tile(b.propsToPack, 'Props to pack', '/reservations')}
      {tile(b.propsPackLate, 'Due or overdue', '/reservations', true)}
      {tile(b.propsToCheckIn, 'Props to check', '/reservations')}
      {tile(b.gearToCheckIn, 'Gear to check', '/gear/bookings')}
      {tile(b.propsOutLate, 'Props out late', '/reservations', true)}
      {tile(b.gearOutLate, 'Gear out late', '/gear/bookings', true)}
    </div>
    {(c.who || c.house) && <p className="text-pt-muted text-xs">Team numbers count all of their work; the creator and house filters don't change them.</p>}
    <SectionHead title="Arts department" sub="Packed + returns checked, per person" onMore={() => c.drill({ view: 'table', dim: 'staff', sort: 'packed' })} more="Table" />
    <RankList empty="Nothing done in this range yet." rows={arts.map(r => ({ key: r.key, label: r.label, value: String(value('packed', r.data)! + value('propsChecked', r.data)!),
      share: (value('packed', r.data)! + value('propsChecked', r.data)!) / aMax,
      sub: `${value('packed', r.data)} packed (${fmt('packOnTime', value('packOnTime', r.data))} on time, typical ${fmt('packTime', value('packTime', r.data))}) · ${value('propsChecked', r.data)} checked in` }))} />
    <SectionHead title="Equipment team" sub="Gear returns checked, per person" onMore={() => c.drill({ view: 'table', dim: 'staff', sort: 'gearChecked' })} more="Table" />
    <RankList empty="Nothing done in this range yet." rows={eq.map(r => ({ key: r.key, label: r.label, value: String(value('gearChecked', r.data)), share: value('gearChecked', r.data)! / eMax,
      sub: `Typical check-in ${fmt('gearCheckTime', value('gearCheckTime', r.data))}` }))} />
    <p className="text-pt-muted text-xs">Counted from each request's history: who packed it and when, who checked returns in. "On time" = packed by the pickup day.</p>
  </>
}

// ── Advanced view: the Power BI part ──
function AdvancedView(c: Ctx & { qs: URLSearchParams }) {
  const dim = (DIM_ORDER.includes(c.qs.get('dim') as Dim) ? c.qs.get('dim') : 'creator') as Dim
  const cols = DIMS[dim].metrics
  const sort = (cols.includes(c.qs.get('sort') as Metric) ? c.qs.get('sort') : cols[0]) as Metric
  const dir = c.qs.get('dir') === 'asc' ? 'asc' : 'desc'
  const rows = sortRows(rowsBy(dim, c.cur, { grain: c.grain, people: c.who ? [] : c.people, staffName: c.staffName, range: c.range }), sort, dir)
    .filter(r => dim !== 'kind' || r.data.incidents.length)
  const max = Math.max(1e-9, ...rows.map(r => value(sort, r.data) ?? 0))
  const pct = METRICS[sort].fmt === 'pct'
  const open = (r: Row) => {
    if (dim === 'creator') c.drill({ who: r.key, dim: DIMS.creator.drill!, sort: null, dir: null })
    else if (dim === 'house') c.drill({ house: r.key, dim: 'creator', sort: null, dir: null })
    else if (dim === 'theme') c.drill({ theme: r.key, kind: null, dim: 'kind', sort: null, dir: null })
    else if (dim === 'kind') c.drill({ kind: r.key, dim: 'creator', sort: 'flags', dir: null })
    else if (dim === 'period') { const [f, t] = bucketSpan(r.key, c.grain, c.range); c.drill({ from: f, to: t, g: null, dim: 'creator', sort: null, dir: null }) }
  }
  const download = () => {
    const blob = new Blob([toCsv(dim, rows, cols, c.cur)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob), el = document.createElement('a')
    el.href = url; el.download = `prime-capitol-${dim}-${c.range.from}-to-${c.range.to}.csv`; el.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <p className="text-pt-muted text-[15px] -mt-1">Break any number down. Tap a column title to sort, tap a row to drill into it.</p>
    <div>
      <p className="text-pt-muted text-sm mb-2">Break down by</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4" data-tour="dims">
        {DIM_ORDER.map(d => <button key={d} onClick={() => c.set({ dim: d, sort: null, dir: null })} className={`shrink-0 px-3 py-1.5 rounded-full text-sm ${dim === d ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{d === 'period' ? (c.grain === 'month' ? 'Month' : c.grain === 'week' ? 'Week' : 'Day') : DIMS[d].label}</button>)}
      </div>
    </div>
    <ColumnChart data={seriesOf(sort, c.a, c.range, c.grain, c.scope)} grain={c.grain} m={sort} onZoom={c.zoom} avgWord={`per ${c.grain}`} />
    <div className="bg-pt-surface rounded-2xl overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 z-[1] bg-pt-surface text-left font-normal text-pt-muted text-xs px-3 py-2.5 min-w-[140px]">{dim === 'period' ? (c.grain === 'month' ? 'Month' : c.grain === 'week' ? 'Week' : 'Day') : DIMS[dim].label}</th>
            {cols.map(m => (
              <th key={m} className="px-2 py-1 text-right align-bottom">
                <button onClick={() => c.set({ sort: m === cols[0] ? null : m, dir: sort === m && dir === 'desc' ? 'asc' : null })} aria-sort={sort === m ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`text-xs leading-tight py-1.5 min-h-[36px] ${sort === m ? 'text-pt-accent font-semibold' : 'text-pt-muted font-normal'}`}>{METRICS[m].label}{sort === m ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-white/[0.03]">
            <td className="sticky left-0 z-[1] bg-[#232325] px-3 py-2.5 text-pt-text font-semibold border-t border-white/[0.06]">Total</td>
            {cols.map(m => <td key={m} className="px-2 py-2.5 text-right tabular-nums text-pt-text font-semibold border-t border-white/[0.06] whitespace-nowrap">{fmt(m, value(m, c.cur))}</td>)}
          </tr>
          {rows.map(r => {
            const can = dim !== 'staff'
            return (
              <tr key={r.key} onClick={can ? () => open(r) : undefined} className={can ? 'cursor-pointer active:bg-white/[0.04]' : ''}>
                <td className="sticky left-0 z-[1] bg-pt-surface px-3 py-2.5 border-t border-white/[0.06]">
                  <span className="flex items-center gap-2 min-w-0">{r.email && <Avatar email={r.email} name={r.label} size={24} />}<span className="text-pt-text truncate max-w-[130px]">{r.label}</span>{can && <span className="text-pt-muted ml-auto">›</span>}</span>
                </td>
                {cols.map(m => {
                  const v = value(m, r.data)
                  return (
                    <td key={m} className="px-2 py-2.5 text-right border-t border-white/[0.06] whitespace-nowrap">
                      <span className={`tabular-nums ${m === sort ? 'text-pt-text font-medium' : 'text-pt-text/80'} ${m === 'showRate' ? showRateTone(v) : ''}`}>{fmt(m, v)}</span>
                      {m === sort && v !== null && <span className="block h-1 rounded-full bg-white/[0.06] mt-1 ml-auto w-14 overflow-hidden"><i className="block h-full bg-pt-accent/80 ml-auto" style={{ width: `${(pct ? v : v / max) * 100}%` }} /></span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">Nothing in this view.</p>}
    </div>
    <div className="flex gap-2">
      <button onClick={download} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-pt-surface text-pt-text text-[15px]"><Icon name="download" className="w-5 h-5" />Download as a spreadsheet</button>
    </div>
    <details className="bg-pt-surface rounded-2xl px-3 py-2">
      <summary className="text-pt-text text-[15px] py-1 cursor-pointer">What these columns mean</summary>
      <div className="space-y-2 py-2">{cols.map(m => <p key={m} className="text-pt-muted text-sm"><b className="text-pt-text">{METRICS[m].label}:</b> {METRICS[m].means}</p>)}</div>
    </details>
  </>
}
