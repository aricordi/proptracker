// Creators dashboard (owner + admins, owner Oct 20): how much each creator is filming, and how well they keep to the
// rules. Tap someone for every flag on their record. View only: nothing here changes anything.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { subscribeToUsers } from '../services/users'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useAllStatuses } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { creatorStats, flagTotal, FLAG_LABEL, SERIOUS, type CreatorStats, type FlagKind } from '../lib/creatorStats'
import type { AppUser } from '../types'
import { creatorPeople, countedEmails } from '../lib/creatorPeople'

export type Period = '30' | 'month' | '90'
export const PERIODS: [Period, string][] = [['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days']]
export const periodStart = (p: Period, today: string) => p === 'month' ? `${today.slice(0, 8)}01` : addDays(today, p === '30' ? -30 : -90)

export function FlagPills({ c, max = 4 }: { c: CreatorStats; max?: number }) {
  const kinds = (Object.keys(c.counts) as FlagKind[]).sort((a, b) => Number(SERIOUS.includes(b)) - Number(SERIOUS.includes(a)) || (c.counts[b]! - c.counts[a]!))
  if (!kinds.length) return <span className="text-xs rounded-full px-2 py-1 bg-green-500/15 text-green-300">No flags ✓</span>
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.slice(0, max).map(k => (
        <span key={k} className={`text-xs rounded-full px-2 py-1 ${SERIOUS.includes(k) ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200'}`}>{c.counts[k]} {FLAG_LABEL[k].toLowerCase()}</span>
      ))}
      {kinds.length > max && <span className="text-xs text-pt-muted px-1 py-1">+{kinds.length - max} more</span>}
    </span>
  )
}

export default function CreatorsScreen() {
  const navigate = useNavigate()
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
  const [users, setUsers] = useState<AppUser[]>([])
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])
  useEffect(() => subscribeToReservations({ email: '', all: true }, setProps), [])
  useEffect(() => subscribeToGearBookings(null, setGear), [])

  const people = useMemo(() => creatorPeople(users), [users])
  const counted = useMemo(() => countedEmails(users), [users])
  const stats = useMemo(() => {
    const list = creatorStats({ from, now, closed: settings, shoots: shoots ?? [], props, gear, reports, strikes, people }).filter(c => counted.has(c.email))
    return sort === 'flags' ? [...list].sort((a, b) => flagTotal(b, SERIOUS) - flagTotal(a, SERIOUS) || flagTotal(b) - flagTotal(a)) : list
  }, [from, now, settings, shoots, props, gear, reports, strikes, people, counted, sort])
  const sum = (f: (c: CreatorStats) => number) => stats.reduce((n, c) => n + f(c), 0)
  const tiles: [string, number, string][] = [
    ['Shoots filmed', sum(c => c.filmed), 'text-pt-text'],
    ['No-shows', sum(c => (c.counts['no-show'] ?? 0) + (c.counts['late-cancel'] ?? 0)), 'text-red-300'],
    ['Late returns', sum(c => (c.counts['late-props'] ?? 0) + (c.counts['late-gear'] ?? 0)), 'text-amber-200'],
    ['Strikes', sum(c => c.counts.strike ?? 0), 'text-red-300'],
  ]

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/admin')} className="text-pt-accent text-[17px] py-1">‹ Back</button>
        <h1 className="font-display text-[34px] text-pt-text py-1">Creators</h1>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {PERIODS.map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`shrink-0 px-3 py-1 rounded-full text-sm ${period === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{l}</button>)}
        </div>
      </div>
      <div className="px-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([t, n, cls]) => (
            <div key={t} className="bg-pt-surface rounded-2xl p-3">
              <p className={`text-[28px] font-bold leading-none tabular-nums ${n ? cls : 'text-pt-text'}`}>{n}</p>
              <p className="text-pt-muted text-xs mt-1">{t}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-pt-muted text-xs">{stats.length} {stats.length === 1 ? 'creator' : 'creators'} · tap one for every flag</p>
          <div className="flex bg-pt-surface rounded-full p-0.5 text-xs">
            {([['filming', 'Most filming'], ['flags', 'Most flags']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setSort(v)} className={`px-3 py-1 rounded-full ${sort === v ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>
            ))}
          </div>
        </div>
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
