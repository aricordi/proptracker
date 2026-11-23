import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, ACTIVE_STATUSES, type Reservation, type ReservationStatus } from '../services/reservations'
import { todayInStudio, daysBetween, pickupDay, isLate, returnDueDay, RETURN_DEADLINE_HOUR } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { useAtRisk } from '../hooks/useAtRisk'
import { formatRange, formatDay } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { Pill } from '../components/GearUi'
import ShootLine from '../components/ShootLine'
import { PageHeader, HeaderAction, EmptyState } from '../components/PageHeader'
import { useShootLines } from '../hooks/useShootLines'

interface Tab { key: string; label: string; statuses: ReservationStatus[]; newestFirst?: boolean; byEnd?: boolean; today?: boolean }

// What each empty tab says (owner, Nov 3: guide people instead of "Nothing here").
const EMPTY: Record<string, [string, string]> = {
  today: ['Nothing due today', 'Pickups and returns due today show up here.'],
  prepare: ['Nothing to prepare', 'New prop requests land here to pick and pack.'],
  ready: ['Nothing waiting for pickup', 'Packed requests wait here until the creator signs for them.'],
  out: ['Nothing out', 'Props creators have picked up show here until they come back.'],
  returns: ['Nothing to check in', 'Returned props wait here for you to check each one.'],
  done: ['No history yet', 'Finished, declined and cancelled requests land here.'],
  current: ['No prop requests', 'Ask for props from your shoot, or in the chat.'],
  past: ['Nothing yet', 'Requests you finished show up here.'],
}

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
  const { canSeeStaff: staff, profile, canBook, role } = useSession()   // admins see the whole queue (view only)
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
  // Which shoot each request is for (house, day, hours, creator), from the schedule.
  const shootLine = useShootLines(shown.map(r => ({ shootId: r.scheduleShootId, date: r.startDate, email: r.creatorEmail })), profile.email)

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <PageHeader title={isStaff ? 'Props queue' : 'My prop requests'} back={role !== 'arts'} noBackOnDesk={isStaff}
        action={canBook ? <HeaderAction onClick={() => navigate('/reserve')}>+ New</HeaderAction> : undefined}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 scroll-px-4 min-[1100px]:mx-0 min-[1100px]:px-0 min-[1100px]:flex-wrap min-[1100px]:overflow-visible">
          {tabs.map(t => {
            const n = byTab[t.key]?.length ?? 0
            return (
              <button key={t.key} onClick={() => setTabKey(t.key)}
                className={`shrink-0 whitespace-nowrap px-4 min-h-[40px] inline-flex items-center gap-1 rounded-full text-[15px] ${tabKey === t.key ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>
                {t.label}{t.key !== 'done' && t.key !== 'past' && n > 0 ? ` ${n}` : ''}
              </button>
            )
          })}
        </div>
      </PageHeader>

      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {list !== null && shown.length === 0 && (
          <EmptyState icon={tabKey === 'returns' || tabKey === 'done' ? 'check' : 'box'} title={(EMPTY[tabKey] ?? ['All clear'])[0]} line={(EMPTY[tabKey] ?? ['', ''])[1]}
            action={!isStaff && tabKey === 'current' ? 'Find props' : undefined} onAction={() => navigate('/browse')} />
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
          const todayLine = tabKey === 'today' && (r.status === 'collected' ? (returnDueDay(r.endDate, settings) < today ? `Was due back ${formatDay(returnDueDay(r.endDate, settings))}` : `Due back by ${RETURN_DEADLINE_HOUR} AM`) : pickup < today ? 'Pickup was due' : 'Pickup today')
          const soon = isStaff && ['requested', 'preparing', 'packed'].includes(r.status) ? (pickup !== r.startDate ? `pickup ${whenLabel(pickup, today).toLowerCase()}` : whenLabel(r.startDate, today)) : ''
          // With a shoot, its line already has the day and the creator: the line under it keeps only what's due when.
          const shootText = shootLine({ shootId: r.scheduleShootId, date: r.startDate, email: r.creatorEmail })
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
              <ShootLine text={shootText} />
              {shootText ? (todayLine || soon) && (
                <p className="text-pt-muted text-sm">{todayLine || <span className={urgent ? 'text-red-300' : ''}>{soon.charAt(0).toUpperCase() + soon.slice(1)}</span>}</p>
              ) : (
                <p className="text-pt-muted text-sm">
                  {todayLine || <>{formatRange(r.startDate, r.endDate)}{soon && <span className={urgent ? 'text-red-300' : ''}> · {soon}</span>}</>}
                  {isStaff && ` · ${r.creatorName}`}
                </p>
              )}
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
