import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToGearBookings, fmtHours, type GearBooking } from '../services/gear'
import { Pill, STATUS_LABEL } from '../components/GearUi'
import { formatDay } from '../lib/dates'
import { todayInStudio } from '../../functions/src/booking'

// Creators: their gear bookings. Owner + equipment team: everyone's.
export default function GearBookingsScreen() {
  const navigate = useNavigate()
  const { isGearStaff, profile, role } = useSession()
  const [list, setList] = useState<GearBooking[] | null>(null)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  useEffect(() => subscribeToGearBookings(isGearStaff ? null : profile.email, setList), [isGearStaff, profile.email])

  const today = todayInStudio()
  const upcoming = (list ?? []).filter(b => b.status === 'held' && b.date >= today).sort((a, b) => a.from.localeCompare(b.from))
  const past = (list ?? []).filter(b => !upcoming.includes(b))
  const shown = tab === 'upcoming' ? upcoming : past

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-end justify-between py-2">
          {role !== 'equipment' && <button onClick={() => navigate('/gear')} className="text-pt-accent text-[17px] pb-1 mr-2">‹</button>}
          <h1 className="font-display text-3xl text-pt-text flex-1">{isGearStaff ? 'Gear bookings' : 'My gear bookings'}</h1>
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 bg-pt-surface rounded-xl">
          {([['upcoming', `Upcoming (${upcoming.length})`], ['past', 'Past & cancelled']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={`py-1.5 rounded-lg text-sm font-medium ${tab === v ? 'bg-pt-border text-pt-text' : 'text-pt-muted'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {list && shown.length === 0 && <p className="text-pt-muted text-sm text-center py-10">{tab === 'upcoming' ? 'No upcoming gear bookings.' : 'Nothing here yet.'}</p>}
        {shown.map(b => (
          <button key={b.id} onClick={() => navigate(`/gear/bookings/${b.id}`)} className="w-full text-left bg-pt-surface rounded-2xl p-3.5 space-y-1 active:opacity-80">
            <div className="flex items-center justify-between gap-2">
              <p className="text-pt-text font-semibold truncate">{b.title}</p>
              <Pill tone={STATUS_LABEL[b.status]?.tone ?? 'muted'}>{STATUS_LABEL[b.status]?.text ?? b.status}</Pill>
            </div>
            <p className="text-pt-muted text-sm">{formatDay(b.date)} · {fmtHours(b.start, b.end)}{isGearStaff ? ` · ${b.creatorName || b.creatorEmail}` : ''}</p>
            <p className="text-pt-muted text-xs truncate">{b.lines.map(l => `${l.kind === 'extra' ? `${l.qty}× ` : ''}${l.name}`).join(', ')}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
