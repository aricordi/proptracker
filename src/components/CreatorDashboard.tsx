// The admin dashboard (top of the admin's home page and the owner's Team page). Owner, Oct 20: "the admin team will
// live in these dashboards… simple to read". The short version of Analytics, built from the same parts and the same
// numbers: one date range, headline, metric cards (each picks the chart), what's waiting on you, who needs attention,
// top creators. Every row opens Analytics already narrowed to it.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MetricCards, ColumnChart, SectionHead, RankList, NeedsYou, needsYouItems } from './analytics/Parts'
import { useAnalyticsData } from '../hooks/useAnalytics'
import { SERIOUS_KINDS, KIND, type Kind } from '../lib/analytics'
import { rangeFor, defaultGrain, slice, value, fmt, compare, seriesOf, rowsBy, sortRows, shift, bucketSpan, type Preset, type Metric } from '../lib/insights'

const CHOICES: [Preset, string][] = [['7d', '7 days'], ['28d', '28 days'], ['12w', '12 weeks']]
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export default function CreatorDashboard() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('28d')
  const [m, setM] = useState<Metric>('filmed')
  const { a, people, pausedNow, loading, today } = useAnalyticsData(shift(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), -170))
  if (loading) return <p className="text-pt-muted text-sm text-center py-6">Loading the dashboard…</p>

  const range = rangeFor(preset, today), grain = defaultGrain(range)
  const cur = slice(a, range.from, range.to), prev = slice(a, range.prevFrom, range.prevTo)
  const filmed = value('filmed', cur)!, creators = value('creators', cur)!
  const cmp = compare('filmed', filmed, value('filmed', prev))
  const rows = rowsBy('creator', cur, { grain, people })
  const attention = rows.filter(r => r.data.incidents.some(i => SERIOUS_KINDS.includes(i.kind)) || pausedNow.includes(r.key))
    .sort((x, y) => value('serious', y.data)! - value('serious', x.data)! || value('flags', y.data)! - value('flags', x.data)!).slice(0, 4)
  const top = sortRows(rows, 'filmed').filter(r => value('filmed', r.data)! > 0).slice(0, 5)
  const topMax = Math.max(1, ...top.map(r => value('filmed', r.data)!))
  const attMax = Math.max(1, ...attention.map(r => value('flags', r.data)!))
  const q = `period=${preset}`
  const worst = (r: typeof rows[number]) => {
    const counts = new Map<Kind, number>()
    for (const i of r.data.incidents) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
    return [...counts].sort((x, y) => Number(SERIOUS_KINDS.includes(y[0])) - Number(SERIOUS_KINDS.includes(x[0])) || y[1] - x[1]).slice(0, 2).map(([k, n]) => `${n} ${KIND[k].label.toLowerCase()}`).join(' · ')
  }

  return (
    <div className="space-y-4" data-tour="dashboard">
      <div className="space-y-1.5">
        <div className="flex bg-pt-surface rounded-full p-0.5 text-sm w-fit" role="tablist" aria-label="Date range">
          {CHOICES.map(([p, l]) => <button key={p} role="tab" aria-selected={preset === p} onClick={() => setPreset(p)} className={`px-3.5 py-1.5 rounded-full whitespace-nowrap ${preset === p ? 'bg-pt-accent text-stone-900 font-medium' : 'text-pt-muted'}`}>{l}</button>)}
        </div>
        <p className="text-pt-muted text-xs px-1">Last {CHOICES.find(c => c[0] === preset)![1]} · {range.dates}</p>
      </div>

      <div>
        <p className="text-pt-text text-[22px] font-semibold leading-snug tracking-tight">{plural(creators, 'creator')} filmed {plural(filmed, 'shoot')} {range.phrase}</p>
        {cmp && cmp.text !== 'New' && <p className="text-pt-muted text-[15px] mt-1">{cmp.tone === 'flat' ? 'About the same as' : cmp.text.replace('↑', 'Up').replace('↓', 'Down') + ' on'} {range.prevLabel}.</p>}
      </div>

      <MetricCards tourId="tiles" metrics={['filmed', 'showRate', 'creators', 'flags']} cur={x => value(x, cur)} prev={x => value(x, prev)} selected={m} onSelect={setM} />
      <ColumnChart data={seriesOf(m, a, range, grain, {})} grain={grain} m={m} avgWord={`per ${grain}`}
        onZoom={b => { const [f, t] = bucketSpan(b, grain, range); navigate(`/analytics?${q}&m=${m}&from=${f}&to=${t}`) }} />

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate(`/analytics?${q}${m !== 'filmed' ? `&m=${m}` : ''}`)} className="py-3 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Open analytics</button>
        <button onClick={() => navigate('/rules-sheet')} className="py-3 rounded-2xl bg-pt-surface shadow-hairline text-pt-text font-semibold">Settings sheet</button>
      </div>

      <SectionHead title="Needs you now" />
      <NeedsYou items={needsYouItems(a, pausedNow, to => navigate(to))} />

      {attention.length > 0 && <>
        <SectionHead title="Needs attention" sub="Serious flags or paused" onMore={() => navigate(`/analytics?${q}&tab=flags`)} />
        <RankList rows={attention.map(r => ({ key: r.key, label: r.label, email: r.email, value: plural(value('flags', r.data)!, 'flag'), share: value('flags', r.data)! / attMax, tone: 'text-amber-200',
          sub: `${pausedNow.includes(r.key) ? 'Paused · ' : ''}${worst(r)}`, onClick: () => navigate(`/analytics?${q}&tab=creators&who=${encodeURIComponent(r.key)}`) }))} />
      </>}

      <SectionHead title="Top creators" onMore={() => navigate(`/analytics?${q}&tab=creators`)} />
      <RankList empty="Nobody filmed in this range yet." rows={top.map(r => ({ key: r.key, label: r.label, email: r.email, value: fmt('filmed', value('filmed', r.data)), share: value('filmed', r.data)! / topMax,
        sub: `${fmt('showRate', value('showRate', r.data))} showed up`, onClick: () => navigate(`/analytics?${q}&tab=creators&who=${encodeURIComponent(r.key)}`) }))} />
    </div>
  )
}
