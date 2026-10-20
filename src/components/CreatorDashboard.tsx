// The admin dashboard (top of the admin's home page and the owner's Team page). Owner, Oct 20: "what I'm most interested
// in is accountability, checking individual creators… organised by creator rather than by time"; "no set minimum… mainly
// just to see who's posting more and who's posting less"). So: every creator ranked by shoots filmed, compared with the
// typical creator, behaviour problems flagged separately, then what's waiting on you. Trends live in Analytics.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionHead, NeedsYou, needsYouItems, StandingTiles, StandingList, TypicalKey, type StandFilter } from './analytics/Parts'
import { useAnalyticsData } from '../hooks/useAnalytics'
import { rangeFor, defaultGrain, slice, rowsBy, shift, standings, sortStandings, comingThisMonth, type Preset } from '../lib/insights'

const CHOICES: [Preset, string][] = [['tm', 'This month'], ['lm', 'Last month'], ['12w', '12 weeks']]
const SHOW = 8

export default function CreatorDashboard() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('tm')
  const [filter, setFilter] = useState<StandFilter | ''>('')
  const { a, people, pausedNow, loading, today } = useAnalyticsData(shift(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), -100))
  if (loading) return <p className="text-pt-muted text-sm text-center py-6">Loading the dashboard…</p>

  const range = rangeFor(preset, today), grain = defaultGrain(range)
  const list = sortStandings(standings(rowsBy('creator', slice(a, range.from, range.to), { grain, people }),
    { paused: pausedNow, coming: comingThisMonth(a.upcoming, range, today) }))
  const typical = list[0]?.typical ?? 0
  const shown = !filter ? list : filter === 'attention' ? list.filter(s => s.attention) : list.filter(s => s.output === filter)
  const max = Math.max(1, ...list.map(s => s.filmed))
  const q = `period=${preset}`

  return (
    <div className="space-y-4" data-tour="dashboard">
      <div className="space-y-1.5">
        <div className="flex bg-pt-surface rounded-full p-0.5 text-sm w-fit" role="tablist" aria-label="Date range">
          {CHOICES.map(([p, l]) => <button key={p} role="tab" aria-selected={preset === p} onClick={() => setPreset(p)} className={`px-3.5 py-1.5 rounded-full whitespace-nowrap ${preset === p ? 'bg-pt-accent text-stone-900 font-medium' : 'text-pt-muted'}`}>{l}</button>)}
        </div>
        <p className="text-pt-muted text-xs px-1">{range.dates} · the typical creator filmed {Math.round(typical * 10) / 10}</p>
      </div>

      <StandingTiles tourId="tiles" list={list} filter={filter} onFilter={setFilter} />

      <SectionHead title={filter === 'more' ? 'Posting more' : filter === 'less' ? 'Posting less' : filter === 'typical' ? 'Typical' : filter === 'attention' ? 'Needs attention' : 'Every creator'} sub="Most shoots filmed first. Tap someone for their report card."
        onMore={() => navigate(`/analytics?${q}`)} more="Analytics" />
      <StandingList max={max} list={shown.slice(0, SHOW)} onOpen={e => navigate(`/analytics?${q}&who=${encodeURIComponent(e)}`)} empty="Nobody in this group." />
      {shown.length > SHOW && <button onClick={() => navigate(`/analytics?${q}${filter ? `&level=${filter}` : ''}`)} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-accent text-[15px]">See all {shown.length}</button>}
      <TypicalKey typical={typical} />

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate(`/analytics?${q}`)} className="py-3 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Open analytics</button>
        <button onClick={() => navigate('/rules-sheet')} className="py-3 rounded-2xl bg-pt-surface shadow-hairline text-pt-text font-semibold">Settings sheet</button>
      </div>

      <SectionHead title="Needs you now" />
      <NeedsYou items={needsYouItems(a, pausedNow, to => navigate(to))} />
    </div>
  )
}
