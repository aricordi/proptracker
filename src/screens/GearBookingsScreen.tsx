import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToGearBookings, fmtHours, fmtTime, nowStamp, isGearLate, type GearBooking } from '../services/gear'
import { Pill, STATUS_LABEL } from '../components/GearUi'
import { formatDay } from '../lib/dates'

type Tab = 'today' | 'out' | 'checkin' | 'upcoming' | 'past'

// Creators: their gear bookings. Owner + equipment team: the gear queue for everyone.
export default function GearBookingsScreen() {
  const navigate = useNavigate()
  const { isGearStaff, profile, role } = useSession()
  const [list, setList] = useState<GearBooking[] | null>(null)
  const [tab, setTab] = useState<Tab>(isGearStaff ? 'today' : 'upcoming')
  useEffect(() => subscribeToGearBookings(isGearStaff ? null : profile.email, setList), [isGearStaff, profile.email])

  const now = nowStamp(), today = now.slice(0, 10)
  const all = list ?? []
  const byTime = (a: GearBooking, b: GearBooking) => a.from.localeCompare(b.from)
  const groups: Record<Tab, GearBooking[]> = {
    // Today: pickups today, and gear due back today.
    today: all.filter(b => (b.status === 'held' && b.pickupDay === today) || (b.status === 'out' && b.to.slice(0, 10) === today)).sort(byTime),
    out: all.filter(b => b.status === 'out').sort((a, b) => Number(isGearLate(b, now)) - Number(isGearLate(a, now)) || a.to.localeCompare(b.to)),
    checkin: all.filter(b => b.status === 'returned').sort(byTime),
    upcoming: all.filter(b => b.status === 'held' || (!isGearStaff && b.status === 'out')).sort(byTime),
    past: all.filter(b => ['checked_in', 'cancelled', 'declined'].includes(b.status) || (!isGearStaff && b.status === 'returned')),
  }
  const tabs: [Tab, string][] = isGearStaff
    ? [['today', `Today (${groups.today.length})`], ['out', `Out (${groups.out.length})`], ['checkin', `To check in (${groups.checkin.length})`], ['upcoming', 'Upcoming'], ['past', 'Past']]
    : [['upcoming', `Upcoming (${groups.upcoming.length})`], ['past', 'Past & cancelled']]
  const shown = groups[tab]

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-end justify-between py-2">
          {role !== 'equipment' && <button onClick={() => navigate('/gear')} className="text-pt-accent text-[17px] pb-1 mr-2">‹</button>}
          <h1 className="font-display text-3xl text-pt-text flex-1">{isGearStaff ? 'Gear queue' : 'My gear bookings'}</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`shrink-0 px-3 py-1 rounded-full text-sm ${tab === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {list && shown.length === 0 && <p className="text-pt-muted text-sm text-center py-10">Nothing here.</p>}
        {shown.map(b => {
          const late = isGearLate(b, now)
          const pickupToday = b.status === 'held' && b.pickupDay === today
          return (
            <button key={b.id} onClick={() => navigate(`/gear/bookings/${b.id}`)}
              className={`w-full text-left bg-pt-surface rounded-2xl p-3.5 space-y-1 active:opacity-80 ${late ? 'ring-1 ring-red-400/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-pt-text font-semibold truncate">{b.title}</p>
                <div className="flex gap-1 shrink-0">
                  {late && <Pill tone="taken">Late</Pill>}
                  {b.alerts?.length ? <Pill tone="warn">⚠ Missing reported</Pill> : null}
                  <Pill tone={STATUS_LABEL[b.status]?.tone ?? 'muted'}>{STATUS_LABEL[b.status]?.text ?? b.status}</Pill>
                </div>
              </div>
              <p className="text-pt-muted text-sm">
                {isGearStaff && tab === 'today'
                  ? (pickupToday ? `Pickup ${fmtTime(b.start)}` : `Due back ${fmtTime(b.end)}`)
                  : `${formatDay(b.date)} · ${fmtHours(b.start, b.end)}`}
                {isGearStaff ? ` · ${b.creatorName || b.creatorEmail}` : ''}
              </p>
              <p className="text-pt-muted text-xs truncate">{b.lines.map(l => `${l.kind === 'extra' ? `${l.qty}× ` : ''}${l.name}`).join(', ')}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
