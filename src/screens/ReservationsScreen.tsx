import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, ACTIVE_STATUSES, type Reservation, type ReservationStatus } from '../services/reservations'
import { todayInStudio, daysBetween, pickupDay, isLate, returnDueDay, RETURN_DEADLINE_HOUR } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { useAtRisk } from '../hooks/useAtRisk'
import { formatRange } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { Pill } from '../components/GearUi'

interface Tab { key: string; label: string; statuses: ReservationStatus[]; newestFirst?: boolean; byEnd?: boolean; today?: boolean }

// The arts department works the queue left to right. Same look as the gear queue (owner, Oct 20), starting on Today.
const STAFF_TABS: Tab[] = [
  { key: 'today',   label: 'Today',      statuses: ['requested', 'preparing', 'packed', 'collected'], today: true },
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
  const { canSeeStaff: staff, profile, canBook } = useSession()   // admins see the whole queue (view only)
  // ?mine=1: just your own requests (the owner's "Me" tab), even for staff.
  const [params] = useSearchParams()
  const isStaff = staff && params.get('mine') !== '1'
  const [list, setList] = useState<Reservation[] | null>(null)
  const tabs = isStaff ? STAFF_TABS : CREATOR_TABS
  const [tabKey, setTabKey] = useState(tabs[0].key)
  const today = todayInStudio()

  useEffect(() => subscribeToReservations({ email: profile.email, all: isStaff }, setList), [profile.email, isStaff])

  // Today: props being picked up today, and props due back today (like the gear queue's Today).
  const pickupToday = (r: Reservation) => ['requested', 'preparing', 'packed'].includes(r.status) && pickupDay(r.startDate, settings) <= today
  const dueToday = (r: Reservation) => r.status === 'collected' && returnDueDay(r.endDate, settings) <= today
  const byTab = useMemo(() => Object.fromEntries(tabs.map(t => {
    let rows = (list ?? []).filter(r => t.statuses.includes(r.status) && (!t.today || pickupToday(r) || dueToday(r)))
    if (t.byEnd) rows = [...rows].sort((a, b) => a.endDate.localeCompare(b.endDate))
    if (t.newestFirst) rows = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return [t.key, rows]
  })), [list, tabs, settings, today])   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = byTab[tabKey] ?? []
  const atRisk = useAtRisk(list ?? [])

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[34px] text-pt-text py-2">{isStaff ? 'Props queue' : 'My bookings'}</h1>
          {canBook && <button onClick={() => navigate('/reserve')} className="text-pt-accent text-sm font-medium py-1 tap">+ New request</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map(t => {
            const n = byTab[t.key]?.length ?? 0
            return (
              <button key={t.key} onClick={() => setTabKey(t.key)}
                className={`shrink-0 px-3 py-1 rounded-full text-sm ${tabKey === t.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>
                {t.label}{t.key !== 'done' && t.key !== 'past' ? ` (${n})` : ''}
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
            {!isStaff && tabKey === 'current' && <button onClick={() => navigate('/browse')} className="text-pt-accent text-sm font-medium tap">Find props to reserve</button>}
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
          const items = [...r.lines.map(l => l.qty > 1 ? `${l.qty}× ${l.itemName}` : l.itemName), ...builds.map(b => `${b.qty > 1 ? `${b.qty}× ` : ''}${b.description} (to make)`)]
          const todayLine = tabKey === 'today' && (r.status === 'collected' ? `Due back by ${RETURN_DEADLINE_HOUR} AM` : pickup < today ? 'Pickup was due' : 'Pickup today')
          return (
            <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
              className={`w-full text-left bg-pt-surface rounded-2xl p-4 space-y-1 active:opacity-80 ${overdue || urgent ? 'ring-1 ring-red-400/60' : atRisk[r.id] ? 'ring-1 ring-amber-400/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-pt-text font-semibold truncate">{r.title}</p>
                <div className="flex gap-1 shrink-0">
                  {overdue && <Pill tone="taken">Late</Pill>}
                  {atRisk[r.id] && <Pill tone="warn">⚠ At risk</Pill>}
                  {r.pickup && !r.pickup.allReceived && <Pill tone="taken">⚠ Pickup issue</Pill>}
                  {isStaff && r.status === 'preparing' && <Pill tone="info">{done}/{total} picked</Pill>}
                  {!overdue && <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status]}`}>{statusLabel(r)}</span>}
                </div>
              </div>
              <p className="text-pt-muted text-sm">
                {todayLine || <>{formatRange(r.startDate, r.endDate)}{isStaff && ['requested', 'preparing', 'packed'].includes(r.status) && (
                  <span className={urgent ? 'text-red-300' : ''}> · {pickup !== r.startDate ? `pickup ${whenLabel(pickup, today).toLowerCase()}` : whenLabel(r.startDate, today)}</span>
                )}</>}
                {isStaff && ` · ${r.creatorName}`}
              </p>
              <p className="text-pt-muted text-xs truncate">{items.join(', ')}</p>
              {atRisk[r.id] && (
                <p className="text-amber-300 text-xs">
                  {atRisk[r.id].map(x => x.itemName).join(', ')} {atRisk[r.id].some(x => x.risk === 'late') ? 'not back yet' : 'may not be usable'}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
