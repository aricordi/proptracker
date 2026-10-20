// The admin dashboard (owner, Oct 20: "a small dashboard of how much each creator is filming… adherence to the rules";
// "the admin page has no dashboards or creator insights"). Sits at the top of the admin's home page and the owner's Team
// page. View only: every number opens the screen behind it (Creators, a person, Schedule team).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import { subscribeToUsers } from '../services/users'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useAllStatuses } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { creatorStats, weeklyFilming, flagTotal, SERIOUS } from '../lib/creatorStats'
import { FlagPills, PERIODS, periodStart, type Period } from '../screens/CreatorsScreen'
import { formatDay } from '../lib/dates'
import type { AppUser } from '../types'

export default function CreatorDashboard() {
  const navigate = useNavigate()
  const today = todayInStudio(), now = nowStamp()
  const closed = useBookingSettings()
  const [period, setPeriod] = useState<Period>('30')
  const from = periodStart(period, today)
  const since = addDays(today, -90)
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

  const people = useMemo(() => users.filter(u => u.active && (u.role === 'creator' || u.role === 'admin')).map(u => ({ email: u.email, name: u.name || u.email })), [users])
  const stats = useMemo(() => creatorStats({ from, now, closed, shoots: shoots ?? [], props, gear, reports, strikes, people }), [from, now, closed, shoots, props, gear, reports, strikes, people])
  const weeks = useMemo(() => weeklyFilming(shoots ?? [], today, now, 8), [shoots, today, now])

  const sum = (f: (c: typeof stats[number]) => number) => stats.reduce((n, c) => n + f(c), 0)
  const booked = sum(c => c.booked), filmed = sum(c => c.filmed)
  const rate = booked ? Math.round((filmed / booked) * 100) : null
  const pausedNow = Object.values(statuses).filter(st => st.pausedUntil && st.pausedUntil > today).length
  const decide = stats.flatMap(c => c.flags.filter(f => f.kind === 'missed-checkin' && f.open)).length
  const openReports = reports.filter(r => r.status === 'open').length
  const lateNow = stats.flatMap(c => c.flags.filter(f => (f.kind === 'late-props' || f.kind === 'late-gear') && f.open)).length
  const attention = stats.filter(c => flagTotal(c, SERIOUS) > 0 || (statuses[c.email]?.pausedUntil ?? '') > today)
    .sort((a, b) => flagTotal(b, SERIOUS) - flagTotal(a, SERIOUS) || flagTotal(b) - flagTotal(a)).slice(0, 4)
  const top = stats.filter(c => c.filmed > 0).slice(0, 5)
  const topMax = Math.max(1, ...top.map(c => c.filmed))
  const reliability = stats.filter(c => c.booked >= 2).map(c => ({ c, r: c.filmed / c.booked })).sort((a, b) => a.r - b.r).slice(0, 5)
  const weekMax = Math.max(1, ...weeks.map(w => w.booked))
  const open = (email: string) => navigate(`/people/${encodeURIComponent(email)}?period=${period}`)

  const tile = (label: string, value: string | number, tone = 'text-pt-text', onClick?: () => void) => (
    <button onClick={onClick} disabled={!onClick} className="bg-pt-surface rounded-2xl p-3 text-left disabled:cursor-default">
      <p className={`text-[28px] font-bold leading-none tabular-nums ${tone}`}>{value}</p>
      <p className="text-pt-muted text-xs mt-1">{label}</p>
    </button>
  )
  const section = (title: string, more?: { label: string; to: string }) => (
    <div className="flex items-baseline justify-between pt-2">
      <h2 className="text-pt-text text-[20px] font-semibold tracking-tight">{title}</h2>
      {more && <button onClick={() => navigate(more.to)} className="text-pt-accent text-sm tap">{more.label} ›</button>}
    </div>
  )

  if (shoots === null) return <p className="text-pt-muted text-sm text-center py-6">Loading the dashboard…</p>

  return (
    <div className="space-y-4" data-tour="dashboard">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {PERIODS.map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`shrink-0 px-3 py-1 rounded-full text-sm ${period === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{l}</button>)}
      </div>

      <div className="grid grid-cols-3 gap-2" data-tour="tiles">
        {tile('Shoots filmed', filmed)}
        {tile('Filmed of booked', rate === null ? '–' : `${rate}%`, rate !== null && rate < 70 ? 'text-red-300' : 'text-pt-text')}
        {tile('Coming up', sum(c => c.upcoming))}
        {tile('No-shows', sum(c => (c.counts['no-show'] ?? 0) + (c.counts['late-cancel'] ?? 0)), 'text-red-300', () => navigate('/creators'))}
        {tile('Late returns', sum(c => (c.counts['late-props'] ?? 0) + (c.counts['late-gear'] ?? 0)), 'text-amber-200', () => navigate('/creators'))}
        {tile('Paused now', pausedNow, pausedNow ? 'text-red-300' : 'text-pt-text', () => navigate('/creators'))}
      </div>

      {(decide > 0 || openReports > 0 || lateNow > 0) && (
        <div className="bg-amber-500/10 rounded-2xl p-3 space-y-2">
          <p className="text-amber-200 font-medium">Needs you</p>
          {decide > 0 && <button onClick={() => navigate('/schedule/team')} className="w-full flex justify-between text-left text-[15px] text-pt-text"><span>{decide} missed check-in{decide > 1 ? 's' : ''} to decide</span><span className="text-pt-accent">›</span></button>}
          {openReports > 0 && <button onClick={() => navigate('/schedule/team')} className="w-full flex justify-between text-left text-[15px] text-pt-text"><span>{openReports} report{openReports > 1 ? 's' : ''} to review</span><span className="text-pt-accent">›</span></button>}
          {lateNow > 0 && <button onClick={() => navigate('/creators')} className="w-full flex justify-between text-left text-[15px] text-pt-text"><span>{lateNow} late return{lateNow > 1 ? 's' : ''} still out</span><span className="text-pt-accent">›</span></button>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => navigate('/analytics')} className="py-3 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Open analytics</button>
        <button onClick={() => navigate('/rules-sheet')} className="py-3 rounded-2xl bg-pt-surface shadow-hairline text-pt-text font-semibold">Settings sheet</button>
      </div>

      {section('Filming per week', { label: 'Analytics', to: '/analytics' })}
      <div className="bg-pt-surface rounded-2xl p-4" role="img" aria-label={`Shoots filmed each week for the last 8 weeks: ${weeks.map(w => `week of ${formatDay(w.start)} ${w.filmed} of ${w.booked}`).join('; ')}`}>
        <div className="flex items-end gap-1.5 h-32">
          {weeks.map(w => (
            <div key={w.start} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`Week of ${formatDay(w.start)}: ${w.filmed} filmed of ${w.booked} booked`}>
              <span className="text-pt-text text-xs tabular-nums">{w.booked ? w.filmed : ''}</span>
              <div className="w-full flex flex-col justify-end rounded-t-[4px] overflow-hidden" style={{ height: `${(w.booked / weekMax) * 100}%`, minHeight: w.booked ? 4 : 0 }}>
                <div className="w-full bg-pt-border" style={{ height: `${w.booked ? ((w.booked - w.filmed) / w.booked) * 100 : 0}%` }} />
                <div className="w-full bg-pt-accent" style={{ height: `${w.booked ? (w.filmed / w.booked) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1">{weeks.map(w => <span key={w.start} className="flex-1 text-center text-pt-muted text-xs tabular-nums">{Number(w.start.slice(8))}</span>)}</div>
        <div className="flex gap-4 mt-3 text-xs text-pt-muted">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-pt-accent" />Filmed</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-pt-border" />Booked, not filmed</span>
          <span className="ml-auto">Week starting (Mon)</span>
        </div>
      </div>

      {attention.length > 0 && <>
        {section('Needs attention', { label: 'All creators', to: '/creators' })}
        <div className="space-y-2">
          {attention.map(c => {
            const paused = (statuses[c.email]?.pausedUntil ?? '') > today
            return (
              <button key={c.email} onClick={() => open(c.email)} className="w-full text-left bg-pt-surface rounded-2xl p-3 space-y-2">
                <span className="flex items-center gap-3">
                  <Avatar email={c.email} name={c.name} />
                  <span className="flex-1 min-w-0"><b className="block text-pt-text truncate">{c.name}</b><span className="block text-pt-muted text-xs">{c.filmed} filmed of {c.booked} booked</span></span>
                  {paused && <span className="text-xs rounded-full px-2 py-1 bg-red-500/20 text-red-300 shrink-0">Paused</span>}
                  <span className="text-pt-muted">›</span>
                </span>
                <FlagPills c={c} max={3} />
              </button>
            )
          })}
        </div>
      </>}

      {section('Most filming', { label: 'All creators', to: '/creators' })}
      <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
        {top.length === 0 && <p className="text-pt-muted text-sm">Nobody has filmed in this period yet.</p>}
        {top.map(c => (
          <button key={c.email} onClick={() => open(c.email)} className="w-full flex items-center gap-3 text-left">
            <span className="w-24 shrink-0 text-pt-text text-sm truncate">{c.name}</span>
            <span className="flex-1 h-3 rounded-full bg-pt-border overflow-hidden"><i className="block h-full rounded-full bg-pt-accent" style={{ width: `${(c.filmed / topMax) * 100}%` }} /></span>
            <span className="w-8 text-right text-pt-text text-sm tabular-nums">{c.filmed}</span>
          </button>
        ))}
      </div>

      {reliability.length > 0 && <>
        {section('Showing up')}
        <p className="text-pt-muted text-xs -mt-2">Lowest first: filmed out of booked (2 or more shoots).</p>
        <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
          {reliability.map(({ c, r }) => (
            <button key={c.email} onClick={() => open(c.email)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
              <Avatar email={c.email} name={c.name} size={32} />
              <span className="flex-1 min-w-0 text-pt-text text-[15px] truncate">{c.name}</span>
              <span className="text-pt-muted text-xs">{c.filmed} of {c.booked}</span>
              <span className={`w-12 text-right font-semibold tabular-nums ${r < 0.7 ? 'text-red-300' : r < 0.9 ? 'text-amber-200' : 'text-green-300'}`}>{Math.round(r * 100)}%</span>
            </button>
          ))}
        </div>
      </>}
    </div>
  )
}
