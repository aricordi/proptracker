import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToGearBookings, fmtHours, fmtTime, nowStamp, isGearLate, type GearBooking } from '../services/gear'
import { Pill, STATUS_LABEL, dueBackLabel } from '../components/GearUi'
import { formatDay } from '../lib/dates'
import ShootLine from '../components/ShootLine'
import { useShootLines } from '../hooks/useShootLines'

type Tab = 'today' | 'out' | 'checkin' | 'upcoming' | 'past'

// Creators: their gear bookings. Owner + equipment team: the gear queue for everyone.
export default function GearBookingsScreen() {
  const navigate = useNavigate()
  const { canSeeGear: gearStaff, profile, role } = useSession()   // admins see the whole gear queue (view only)
  // ?mine=1: just your own gear (the owner's "Me" tab), even for the gear team.
  const [params] = useSearchParams()
  const isGearStaff = gearStaff && params.get('mine') !== '1'
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
  const EMPTY: Partial<Record<Tab, [string, string]>> = isGearStaff ? {
    today: ['Nothing today', 'Gear creators take on a shoot day shows up here.'],
    out: ['Nothing out', 'When a creator takes gear, it shows here until it comes back.'],
    checkin: ['Nothing to check in', 'Returned gear waits here for you to tick every piece.'],
    upcoming: ['Nothing coming up', 'Gear held for a shoot ahead shows up here.'],
    past: ['No history yet', 'Checked-in and cancelled gear lands here.'],
  } : { upcoming: ['No gear yet', 'Take gear on the day of your shoot from the chat.'], past: ['Nothing yet', 'Gear you returned shows up here.'] }
  const tabs: [Tab, string][] = isGearStaff
    ? [['today', `Today (${groups.today.length})`], ['out', `Out (${groups.out.length})`], ['checkin', `To check in (${groups.checkin.length})`], ['upcoming', 'Upcoming'], ['past', 'Past']]
    : [['upcoming', `Upcoming (${groups.upcoming.length})`], ['past', 'Past & cancelled']]
  const shown = groups[tab]
  // Which shoot each booking is for (house, day, hours, creator), from the schedule.
  const shootLine = useShootLines(shown.map(b => ({ shootId: b.scheduleShootId, date: b.date })), profile.email)

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-end justify-between py-2">
          {role !== 'equipment' && <button onClick={() => navigate('/gear')} className="text-pt-accent text-[17px] pb-1 mr-2">‹</button>}
          <h1 className="font-display text-[34px] text-pt-text flex-1">{isGearStaff ? 'Gear log' : 'My gear'}</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`shrink-0 px-3.5 min-h-[40px] inline-flex items-center gap-1 rounded-full text-sm ${tab === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {list && shown.length === 0 && (
          <div className="text-center py-12 px-6">
            <span className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-pt-surface grid place-items-center text-pt-muted"><Icon name="check" className="w-6 h-6" /></span>
            <p className="text-pt-text font-semibold">{EMPTY[tab]?.[0] ?? 'All clear'}</p>
            <p className="text-pt-muted text-sm mt-1">{EMPTY[tab]?.[1] ?? ''}</p>
          </div>
        )}
        {shown.map(b => {
          const late = isGearLate(b, now)
          const pickupToday = b.status === 'held' && b.pickupDay === today
          // With a shoot, its line already has the day and the creator: the line under it keeps the gear's own times.
          const shootText = shootLine(b.scheduleShootId)
          const crewNames = (b.crew ?? []).map(c => c.name.split(' ')[0]).join(', ')
          return (
            <button key={b.id} onClick={() => navigate(`/gear/bookings/${b.id}`)}
              className={`w-full text-left bg-pt-surface rounded-2xl p-4 space-y-1 active:opacity-80 ${late ? 'ring-1 ring-red-400/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-pt-text font-semibold truncate">{b.title}</p>
                <div className="flex gap-1 shrink-0">
                  {late && <Pill tone="taken">Late</Pill>}
                  {b.alerts?.length ? <Pill tone="warn">⚠ Missing reported</Pill> : null}
                  <Pill tone={STATUS_LABEL[b.status]?.tone ?? 'muted'}>{STATUS_LABEL[b.status]?.text ?? b.status}</Pill>
                </div>
              </div>
              <ShootLine text={shootText} />
              <p className="text-pt-muted text-sm">
                {isGearStaff && tab === 'today'
                  ? (pickupToday ? `Pickup ${fmtTime(b.start)}` : `Due back ${dueBackLabel(b)}`)
                  : shootText ? `Gear ${fmtHours(b.start, b.end)}` : `${formatDay(b.date)} · ${fmtHours(b.start, b.end)}`}
                {isGearStaff
                  ? (shootText ? (crewNames ? ` · with ${crewNames}` : '') : ` · ${b.creatorName || b.creatorEmail}${crewNames ? ` + ${crewNames}` : ''}`)
                  : b.crew?.length && b.creatorEmail !== profile.email ? ` · shared by ${(b.creatorName ?? '').split(' ')[0]}` : ''}
              </p>
              <p className="text-pt-muted text-xs truncate">{b.lines.map(l => `${l.kind === 'extra' ? `${l.qty}× ` : ''}${l.name}`).join(', ')}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
