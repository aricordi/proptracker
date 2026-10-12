import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, ACTIVE_STATUSES, type Reservation } from '../services/reservations'
import { todayInStudio } from '../../functions/src/booking'
import { formatRange } from '../lib/dates'
import { STATUS_LABELS, STATUS_STYLES } from '../lib/reservationLabels'

export default function ReservationsScreen() {
  const navigate = useNavigate()
  const { isStaff, profile } = useSession()
  const [list, setList] = useState<Reservation[] | null>(null)
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const today = todayInStudio()

  useEffect(() => subscribeToReservations({ email: profile.email, all: isStaff }, setList), [profile.email, isStaff])

  const { current, past } = useMemo(() => {
    const all = list ?? []
    return {
      current: all.filter(r => ACTIVE_STATUSES.includes(r.status)),                       // soonest shoot first
      past:    all.filter(r => !ACTIVE_STATUSES.includes(r.status)).reverse(),             // most recent first
    }
  }, [list])
  const shown = tab === 'current' ? current : past

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">{isStaff ? 'All bookings' : 'My bookings'}</h1>
        <div className="flex gap-2">
          {(['current', 'past'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-sm ${tab === t ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>
              {t === 'current' ? `Current (${current.length})` : `Past (${past.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {list !== null && shown.length === 0 && (
          <div className="text-center mt-12">
            <p className="text-pt-muted text-sm mb-3">{tab === 'current' ? 'No current bookings.' : 'Nothing here yet.'}</p>
            {tab === 'current' && <button onClick={() => navigate('/')} className="text-pt-accent text-sm font-medium">Find props to reserve</button>}
          </div>
        )}
        {shown.map(r => {
          const overdue = ACTIVE_STATUSES.includes(r.status) && r.endDate < today
          const units = r.lines.reduce((n, l) => n + l.qty, 0)
          return (
            <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
              className="w-full text-left bg-pt-surface border border-pt-border rounded-2xl p-3 active:opacity-75">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-pt-text font-semibold truncate">{r.title}</p>
                  <p className="text-pt-muted text-sm">{formatRange(r.startDate, r.endDate)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${overdue ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[r.status]}`}>
                  {overdue ? 'Not returned' : STATUS_LABELS[r.status]}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex -space-x-2">
                  {r.lines.slice(0, 4).map(l => (
                    <div key={l.itemId} className="w-8 h-8 rounded-lg bg-pt-border border-2 border-pt-surface overflow-hidden">
                      {l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}
                    </div>
                  ))}
                </div>
                <p className="text-pt-muted text-xs truncate">
                  {r.lines.length} prop{r.lines.length !== 1 ? 's' : ''}{units !== r.lines.length ? ` · ${units} units` : ''}
                  {isStaff && ` · ${r.creatorName}`}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
