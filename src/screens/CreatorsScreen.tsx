// Creators dashboard (owner + admins, owner Oct 20): how much each creator is filming, and how well they keep to the
// rules. Tap someone for every flag on their record. View only: nothing here changes anything.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { PageHeader } from '../components/PageHeader'
import { useDesk } from '../desk/desk'
import { subscribeToUsers } from '../services/users'
import { OWNER_EMAIL } from '../config'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useAllStatuses, useFlagReviews } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { creatorStats, flagTotal, strikeTotal, FLAG_LABEL, SERIOUS, type CreatorStats, type FlagKind } from '../lib/creatorStats'
import type { AppUser } from '../types'
import { creatorPeople, countedEmails } from '../lib/creatorPeople'

export type Period = '30' | 'month' | '90'
export const PERIODS: [Period, string][] = [['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days']]
export const periodStart = (p: Period, today: string) => p === 'month' ? `${today.slice(0, 8)}01` : addDays(today, p === '30' ? -30 : -90)

// "1 no-show", "2 late prop returns", "Ran over 2×" (design pass, Nov 23: was "1 late props" / "1 no check-in").
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export function flagWords(k: FlagKind, n: number): string {
  switch (k) {
    case 'no-show': return pl(n, 'no-show', 'no-shows')
    case 'missed-checkin': return pl(n, 'missed check-in', 'missed check-ins')
    case 'late-cancel': return pl(n, 'late cancel', 'late cancels')
    case 'late-start': return pl(n, 'late start', 'late starts')
    case 'ran-over': return n === 1 ? 'Ran over' : `Ran over ${n}×`
    case 'mess': return n === 1 ? 'Left a mess' : `Left a mess ${n}×`
    case 'late-props': return pl(n, 'late prop return', 'late prop returns')
    case 'late-gear': return pl(n, 'late gear return', 'late gear returns')
    case 'strike': return pl(n, 'strike', 'strikes')
    default: return `${n} ${FLAG_LABEL[k as FlagKind] ?? k}`
  }
}

export function FlagPills({ c, max = 4 }: { c: CreatorStats; max?: number }) {
  const kinds = (Object.keys(c.counts) as FlagKind[]).sort((a, b) => Number(SERIOUS.includes(b)) - Number(SERIOUS.includes(a)) || (c.counts[b]! - c.counts[a]!))
  if (!kinds.length) return <span className="justify-self-start inline-flex w-fit text-xs rounded-full px-2 py-1 bg-green-500/15 text-green-300">No flags ✓</span>
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.slice(0, max).map(k => (
        <span key={k} className={`text-xs rounded-full px-2 py-1 ${SERIOUS.includes(k) ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200'}`}>{flagWords(k, c.counts[k]!)}</span>
      ))}
      {kinds.length > max && <span className="text-xs text-pt-muted px-1 py-1">+{kinds.length - max} more</span>}
    </span>
  )
}

export default function CreatorsScreen() {
  const navigate = useNavigate()
  const desk = useDesk().on
  const today = todayInStudio(), now = nowStamp()
  const settings = useBookingSettings()
  const [period, setPeriod] = useState<Period>('30')
  const [sort, setSort] = useState<'filming' | 'flags'>('filming')
  const from = periodStart(period, today)
  const since = addDays(today, -90)   // load 90 days once; each period filters it
  const shoots = useShootsSince(since, true)
  const reports = useReportsSince(since, true)
  const strikes = useStrikesSince(since, true)
  const statuses = useAllStatuses(true)
  // Flags excused in Analytics don't count here either.
  const reviews = useFlagReviews(true)
  const excused = useMemo(() => new Set([...reviews.values()].filter(r => r.status === 'excused').map(r => r.flagId)), [reviews])
  const [users, setUsers] = useState<AppUser[]>([])
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])
  useEffect(() => subscribeToReservations({ email: '', all: true }, setProps), [])
  useEffect(() => subscribeToGearBookings(null, setGear), [])

  const people = useMemo(() => creatorPeople(users), [users])
  const counted = useMemo(() => countedEmails(users), [users])
  const stats = useMemo(() => {
    const list = creatorStats({ from, now, closed: settings, shoots: shoots ?? [], props, gear, reports, strikes, people,
      checksIn: e => e === OWNER_EMAIL || users.some(u => u.email === e && u.role === 'creator' && u.access === 'full'), excused }).filter(c => counted.has(c.email))
    return sort === 'flags' ? [...list].sort((a, b) => flagTotal(b, SERIOUS) - flagTotal(a, SERIOUS) || flagTotal(b) - flagTotal(a)) : list
  }, [from, now, settings, shoots, props, gear, reports, strikes, people, counted, sort, excused])
  const sum = (f: (c: CreatorStats) => number) => stats.reduce((n, c) => n + f(c), 0)
  const tiles: [string, number, string][] = [
    ['Shoots filmed', sum(c => c.filmed), 'text-pt-text'],
    ['No-shows (incl. late cancels)', sum(c => (c.counts['no-show'] ?? 0) + (c.counts['late-cancel'] ?? 0)), 'text-red-300'],
    ['Late returns', sum(c => (c.counts['late-props'] ?? 0) + (c.counts['late-gear'] ?? 0)), 'text-amber-200'],
    ['Strikes', sum(strikeTotal), 'text-red-300'],
  ]

  // Laptop (owner, Nov 3): one wide table, every creator on one screen, click a column to sort.
  if (desk) return (
    <div className="min-h-full bg-pt-bg pb-10 px-8">
      <div className="sticky top-0 bg-pt-bg z-10 pt-6 pb-4 space-y-4">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-[34px] text-pt-text flex-1">Creators</h1>
          <div className="flex gap-2">
            {PERIODS.map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`whitespace-nowrap px-4 min-h-[40px] inline-flex items-center rounded-full text-[15px] ${period === v ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {tiles.map(([t, n, cls]) => (
            <div key={t} className="bg-pt-surface rounded-2xl p-4">
              <p className={`text-[32px] font-bold leading-none tabular-nums ${n ? cls : 'text-pt-text'}`}>{n}</p>
              <p className="text-pt-muted text-sm mt-1">{t}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Scrolls sideways on narrower laptop windows instead of cutting off the last columns (audit, Nov 7). */}
      <div className="rounded-[20px] bg-pt-surface overflow-x-auto"><div className="min-w-[1040px]">
        <div className="grid grid-cols-[minmax(220px,1.4fr)_110px_minmax(160px,1fr)_90px_minmax(240px,2fr)_90px] gap-4 px-4 py-3 text-xs text-pt-muted border-b border-white/[0.06]">
          <span>Creator</span>
          <button onClick={() => setSort('filming')} className={`text-left ${sort === 'filming' ? 'text-pt-text font-semibold' : ''}`}>Filmed ↓</button>
          <span>Showed up</span><span>Coming up</span>
          <button onClick={() => setSort('flags')} className={`text-left ${sort === 'flags' ? 'text-pt-text font-semibold' : ''}`}>Flags ↓</button>
          <span>Status</span>
        </div>
        {shoots === null && <p className="text-pt-muted text-sm text-center py-6">Loading…</p>}
        {stats.map(c => {
          const st = statuses[c.email]
          const paused = !!st?.pausedUntil && st.pausedUntil > today
          const rate = c.booked ? c.filmed / c.booked : 0
          return (
            <button key={c.email} onClick={() => navigate(`/people/${encodeURIComponent(c.email)}?period=${period}`)}
              className="w-full grid grid-cols-[minmax(220px,1.4fr)_110px_minmax(160px,1fr)_90px_minmax(240px,2fr)_90px] gap-4 items-center px-4 py-3 text-left border-b border-white/[0.04] hover:bg-white/[0.03]">
              <span className="flex items-center gap-3 min-w-0"><Avatar email={c.email} name={c.name} /><b className="text-pt-text truncate">{c.name}</b></span>
              <span className="text-pt-text tabular-nums">{c.filmed} <span className="text-pt-muted text-sm">of {c.booked}</span></span>
              <span className="flex items-center gap-2">{c.booked > 0 ? <>
                <span className="flex-1 h-1.5 rounded-full bg-pt-border overflow-hidden"><i className={`block h-full rounded-full ${rate >= 0.9 ? 'bg-green-400' : rate >= 0.7 ? 'bg-pt-accent' : 'bg-red-400'}`} style={{ width: `${Math.round(rate * 100)}%` }} /></span>
                <span className="text-pt-muted text-sm tabular-nums w-10 text-right">{Math.round(rate * 100)}%</span></> : <span className="text-pt-muted text-sm">—</span>}</span>
              <span className="text-pt-text tabular-nums">{c.upcoming || '—'}</span>
              <FlagPills c={c} max={5} />
              <span>{paused ? <span className="text-xs rounded-full px-2 py-1 bg-red-500/20 text-red-300">Paused</span> : <span className="text-pt-muted text-sm">Active</span>}</span>
            </button>
          )
        })}
        {shoots !== null && stats.length === 0 && <p className="text-pt-muted text-sm text-center py-6">No creators yet.</p>}
      </div></div>
      <p className="text-pt-muted text-xs mt-3">Filmed = checked in on the day (or marked filmed by the schedule team). Started late = checked in more than 15 minutes after the slot began. Late cancels count as booked.</p>
    </div>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <PageHeader title="Creators" onBack={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/admin')}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 scroll-px-4">
          {PERIODS.map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`shrink-0 whitespace-nowrap px-4 min-h-[40px] inline-flex items-center gap-1 rounded-full text-[15px] ${period === v ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{l}</button>)}
        </div>
      </PageHeader>
      <div className="px-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([t, n, cls]) => (
            <div key={t} className="bg-pt-surface rounded-2xl p-3">
              <p className={`text-[28px] font-bold leading-none tabular-nums ${n ? cls : 'text-pt-text'}`}>{n}</p>
              <p className="text-pt-muted text-xs mt-1">{t}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2" role="tablist" aria-label="Sort">
          {([['filming', 'Most filming'], ['flags', 'Most flags']] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={sort === v} onClick={() => setSort(v)} className={`shrink-0 whitespace-nowrap px-4 min-h-[40px] inline-flex items-center gap-1 rounded-full text-[15px] ${sort === v ? 'bg-pt-raised text-pt-text font-semibold shadow-hairline' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>
          ))}
        </div>
        <p className="text-pt-muted text-[13px]">{stats.length} {stats.length === 1 ? 'creator' : 'creators'} · tap one for every flag</p>
        {shoots === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        <div className="space-y-2">
          {stats.map(c => {
            const st = statuses[c.email]
            const paused = !!st?.pausedUntil && st.pausedUntil > today
            const rate = c.booked ? c.filmed / c.booked : 0
            return (
              <button key={c.email} onClick={() => navigate(`/people/${encodeURIComponent(c.email)}?period=${period}`)}
                className="w-full text-left bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
                <span className="flex items-center gap-3">
                  <Avatar email={c.email} name={c.name} />
                  <span className="flex-1 min-w-0">
                    <b className="block text-pt-text truncate">{c.name}</b>
                    <span className="block text-pt-muted text-xs">{c.filmed} filmed of {c.booked} booked{c.upcoming ? ` · ${c.upcoming} coming up` : ''}</span>
                  </span>
                  {paused && <span className="text-xs rounded-full px-2 py-1 bg-red-500/20 text-red-300 shrink-0">Paused</span>}
                  <span className="text-pt-muted">›</span>
                </span>
                {c.booked > 0 && (
                  <span className="block h-1.5 rounded-full bg-pt-border overflow-hidden">
                    <i className={`block h-full rounded-full ${rate >= 0.9 ? 'bg-green-400' : rate >= 0.7 ? 'bg-pt-accent' : 'bg-red-400'}`} style={{ width: `${Math.round(rate * 100)}%` }} />
                  </span>
                )}
                <FlagPills c={c} />
              </button>
            )
          })}
          {shoots !== null && stats.length === 0 && <p className="text-pt-muted text-sm text-center">No creators yet.</p>}
        </div>
        <p className="text-pt-muted text-xs">Filmed = checked in on the day (or marked filmed by the schedule team). Started late = checked in more than 15 minutes after the slot began. Late cancels count as booked.</p>
      </div>
    </div>
  )
}
