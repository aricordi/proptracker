import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, ACTIVE_STATUSES, type Reservation, type ReservationStatus } from '../services/reservations'
import { todayInStudio, daysBetween, pickupDay, isLate } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { useAtRisk } from '../hooks/useAtRisk'
import { formatRange } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'

interface Tab { key: string; label: string; statuses: ReservationStatus[]; newestFirst?: boolean; byEnd?: boolean }

// The arts department works the queue left to right.
const STAFF_TABS: Tab[] = [
  { key: 'prepare', label: 'To prepare', statuses: ['requested', 'preparing'] },
  { key: 'ready',   label: 'Ready',      statuses: ['packed'] },
  { key: 'out',     label: 'Out',        statuses: ['collected'], byEnd: true },
  { key: 'returns', label: 'Returns',    statuses: ['return_pending'] },
  { key: 'done',    label: 'Done',       statuses: ['returned', 'declined', 'cancelled'], newestFirst: true },
]

const CREATOR_TABS: Tab[] = [
  { key: 'current', label: 'Current', statuses: ACTIVE_STATUSES },
  { key: 'past',    label: 'Past',    statuses: ['returned', 'declined', 'cancelled'], newestFirst: true },
]

function whenLabel(start: string, today: string) {
  const d = daysBetween(today, start)
  if (d < 0) return 'Started'
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `In ${d} days`
}

export default function ReservationsScreen() {
  const settings = useBookingSettings()
  const navigate = useNavigate()
  const { isStaff, profile } = useSession()
  const [list, setList] = useState<Reservation[] | null>(null)
  const tabs = isStaff ? STAFF_TABS : CREATOR_TABS
  const [tabKey, setTabKey] = useState(tabs[0].key)
  const today = todayInStudio()

  useEffect(() => subscribeToReservations({ email: profile.email, all: isStaff }, setList), [profile.email, isStaff])

  const byTab = useMemo(() => Object.fromEntries(tabs.map(t => {
    let rows = (list ?? []).filter(r => t.statuses.includes(r.status))
    if (t.byEnd) rows = [...rows].sort((a, b) => a.endDate.localeCompare(b.endDate))
    if (t.newestFirst) rows = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return [t.key, rows]
  })), [list, tabs])

  const shown = byTab[tabKey] ?? []
  const atRisk = useAtRisk(list ?? [])

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl text-pt-text py-2">{isStaff ? 'Queue' : 'My bookings'}</h1>
          <button onClick={() => navigate('/reserve')} className="text-pt-accent text-sm font-medium py-1">+ New request</button>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map(t => {
            const n = byTab[t.key]?.length ?? 0
            return (
              <button key={t.key} onClick={() => setTabKey(t.key)}
                className={`shrink-0 px-3 py-1 rounded-full text-sm ${tabKey === t.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>
                {t.label}{t.key !== 'done' && t.key !== 'past' && n > 0 ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {list !== null && shown.length === 0 && (
          <div className="text-center mt-12">
            <p className="text-pt-muted text-sm mb-3">Nothing here.</p>
            {!isStaff && tabKey === 'current' && <button onClick={() => navigate('/')} className="text-pt-accent text-sm font-medium">Find props to reserve</button>}
          </div>
        )}
        {shown.map(r => {
          const overdue = isLate(r.status, r.endDate, settings)
          // Urgency counts to pickup: a Sunday shoot is picked up Saturday if the prop room is closed Sundays.
          const pickup = pickupDay(r.startDate, settings)
          const urgent = (r.status === 'requested' || r.status === 'preparing') && daysBetween(today, pickup) <= 1
          const builds = r.builds ?? []
          const total = r.lines.length + builds.length
          const done = r.lines.filter(l => l.pick).length + builds.filter(b => b.state !== 'todo').length
          return (
            <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
              className={`w-full text-left bg-pt-surface border rounded-2xl p-3 active:opacity-75 ${overdue || urgent ? 'border-red-500/50' : atRisk[r.id] ? 'border-amber-500/60' : 'border-pt-border'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-pt-text font-semibold truncate">{r.title}</p>
                  <p className="text-pt-muted text-sm">
                    {formatRange(r.startDate, r.endDate)}
                    {isStaff && ['requested', 'preparing', 'packed'].includes(r.status) && (
                      <span className={urgent ? 'text-red-300' : ''}> · {pickup !== r.startDate ? `pickup ${whenLabel(pickup, today).toLowerCase()}` : whenLabel(r.startDate, today)}</span>
                    )}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${overdue ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[r.status]}`}>
                  {overdue ? 'Late' : statusLabel(r)}
                </span>
              </div>
              {atRisk[r.id] && (
                <p className="text-amber-300 text-xs mt-1.5">
                  ⚠ At risk: {atRisk[r.id].map(x => x.itemName).join(', ')} {atRisk[r.id].some(x => x.risk === 'late') ? 'not back yet' : 'may not be usable'}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex -space-x-2">
                  {r.lines.slice(0, 4).map(l => (
                    <div key={l.itemId} className="w-8 h-8 rounded-lg bg-pt-border border-2 border-pt-surface overflow-hidden">
                      {l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}
                    </div>
                  ))}
                  {builds.length > 0 && <div className="w-8 h-8 rounded-lg bg-violet-500/20 border-2 border-pt-surface flex items-center justify-center text-sm">🛠️</div>}
                </div>
                <p className="text-pt-muted text-xs truncate flex-1">
                  {total} item{total !== 1 ? 's' : ''}{isStaff && ` · ${r.creatorName}`}
                </p>
                {isStaff && r.status === 'preparing' && <span className="text-violet-300 text-xs shrink-0">{done}/{total} picked</span>}
                {r.pickup && !r.pickup.allReceived && <span className="text-red-300 text-xs shrink-0">⚠ pickup issue</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
