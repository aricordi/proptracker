// Arts department: every props request laid out by shoot day (owner, Oct 19: arts don't book shoots or
// manage the schedule; they just need to see what's coming). Tap a request to work on it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { useScheduleDays, useScheduleSettings } from '../services/schedule'
import { findShootOnDay, placeName, compactHours } from '../lib/shootLine'
import { todayInStudio, addDays, pickupDay, isLate } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { formatDay } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { Icon } from '../components/Icon'
import { PageHeader, EmptyState } from '../components/PageHeader'
import { useSession } from '../auth'
import { MiniDayGrid, type GridTone } from '../components/DayGrid'

const BEFORE = 7, AFTER = 42

export default function RequestsCalendarScreen() {
  const navigate = useNavigate()
  const { role } = useSession()
  const settings = useBookingSettings()
  const s = useScheduleSettings()
  const today = todayInStudio()
  const [list, setList] = useState<Reservation[] | null>(null)
  useEffect(() => subscribeToReservations({ email: '', all: true }, setList), [])
  const [day, setDay] = useState(today)
  const strip = useMemo(() => Array.from({ length: BEFORE + AFTER }, (_, k) => addDays(today, k - BEFORE)), [today])
  const days = useScheduleDays(strip[0], strip[strip.length - 1])
  const live = (list ?? []).filter(r => r.status !== 'cancelled' && r.status !== 'declined')
  const byDay = useMemo(() => {
    const m: Record<string, Reservation[]> = {}
    for (const r of live) (m[r.startDate] ??= []).push(r)
    return m
  }, [live])
  const shown = byDay[day] ?? []
  // Who's filming that day (owner, Nov 24: every team sees the same day view): the read-only day grid, shoots with a
  // props request in gold. Folded or open is remembered on this device.
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem('pc.artsDayGrid') !== '0' } catch { return true } })
  const toggleGrid = () => setGrid(g => { try { localStorage.setItem('pc.artsDayGrid', g ? '0' : '1') } catch { /* private mode */ } return !g })
  const withProps = new Set(shown.map(r => r.scheduleShootId).filter(Boolean) as string[])
  const stripRef = useRef<HTMLDivElement>(null)
  // Today in the middle of the strip, without scrolling the page itself.
  useEffect(() => {
    const box = stripRef.current, el = box?.querySelector<HTMLElement>('[data-today]')
    if (box && el) box.scrollLeft = el.offsetLeft - box.offsetLeft - (box.clientWidth - el.clientWidth) / 2
  }, [])
  const pickup = pickupDay(day, settings)

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <PageHeader title="Calendar" sub="Props requests by shoot day" back={role !== 'arts'} noBackOnDesk>
        <div className="flex items-center gap-2">
          <button aria-label="Earlier days" onClick={() => stripRef.current?.scrollBy({ left: -stripRef.current.clientWidth * 0.8, behavior: 'smooth' })}
            className="hidden min-[1100px]:grid shrink-0 w-10 h-10 rounded-full bg-pt-surface text-pt-accent text-xl place-items-center">‹</button>
          <div className="-mx-4 px-4 scroll-px-4 flex-1 min-w-0 flex gap-2 overflow-x-auto no-scrollbar min-[1100px]:mx-0 min-[1100px]:px-0 min-[1100px]:scroll-px-0" ref={stripRef}>
            {strip.map(d => {
              const n = byDay[d]?.length ?? 0, on = d === day
              return (
                <button key={d} onClick={() => setDay(d)} {...(d === today ? { 'data-today': '' } : {})}
                  aria-label={`${formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${n} request${n === 1 ? '' : 's'}`}
                  className={`shrink-0 w-12 rounded-2xl min-h-[64px] flex flex-col items-center justify-center ${on ? 'bg-pt-accent text-stone-900 shadow-gold' : 'bg-pt-surface text-pt-text'} ${d < today && !on ? 'opacity-50' : ''}`}>
                  <span className="text-xs leading-none">{formatDay(d, { weekday: 'short' })}</span>
                  <span className="text-[17px] font-semibold leading-tight mt-1">{Number(d.slice(8))}</span>
                  <span className={`mt-1 h-4 text-xs font-semibold ${n ? '' : 'invisible'}`}>{n || 0}</span>
                </button>
              )
            })}
          </div>
          <button aria-label="Later days" onClick={() => stripRef.current?.scrollBy({ left: stripRef.current.clientWidth * 0.8, behavior: 'smooth' })}
            className="hidden min-[1100px]:grid shrink-0 w-10 h-10 rounded-full bg-pt-surface text-pt-accent text-xl place-items-center">›</button>
        </div>
      </PageHeader>

      <div className="px-4 space-y-3">
        <p className="text-pt-text text-[20px] font-semibold tracking-heading">{day === today ? 'Today' : formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        {pickup !== day && shown.length > 0 && <p className="text-amber-300 text-sm -mt-2">The prop room is closed that day: these are picked up {formatDay(pickup, { weekday: 'long' })}.</p>}
        <div className="rounded-2xl bg-pt-surface/40">
          <button onClick={toggleGrid} aria-expanded={grid} className="w-full min-h-[44px] px-3 flex items-center justify-between text-[15px]">
            <span className="text-pt-text font-semibold">Who's filming this day</span>
            <span className="text-pt-accent text-[14px] font-semibold">{grid ? 'Hide' : 'Show'}</span>
          </button>
          {grid && (days === null ? <p className="text-pt-muted text-sm px-3 pb-3">Loading the day…</p> : (
            <div className="px-2 pb-2">
              <MiniDayGrid date={day} day={days?.[day]} label={b => ({ text: `${b.entry.name.split(' ')[0]}${b.entry.withNames?.length ? ` + ${b.entry.withNames.length}` : ''}`,
                tone: (b.entry.pending || b.entry.hold ? 'waiting' : withProps.has(b.entry.shootId) ? 'you' : 'other') as GridTone })} />
              <p className="text-pt-muted text-[12px] mt-2 px-1">Gold = has a props request below. Dashed = waiting for the schedule team's OK. Purple = blocked.</p>
            </div>
          ))}
        </div>
        {list === null && <p className="text-pt-muted text-sm">Loading…</p>}
        {list !== null && shown.length === 0 && <EmptyState icon="calendar" title="No props requests this day" line="Pick another day above. Days with requests show a number." />}
        {shown.map(r => {
          const late = isLate(r.status, r.endDate, settings)
          const total = r.lines.length + (r.builds ?? []).length
          // Where and when the request's shoot is, from the schedule (if it was booked for a schedule shoot).
          const spot = findShootOnDay(days?.[r.startDate], r.scheduleShootId, s.slotMinutes, r.creatorEmail)
          const where = spot ? `${placeName(spot, s.houses, true)} · ${compactHours(spot.start, spot.end)}` : ''
          return (
            <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)} className="w-full text-left bg-pt-surface shadow-hairline rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-pt-text font-semibold truncate">{r.creatorName}</span>
                  <span className="block text-pt-muted text-sm truncate">{where || r.title}</span>
                </span>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${late ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[r.status]}`}>{late ? 'Late' : statusLabel(r)}</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <div className="flex -space-x-2">
                  {r.lines.slice(0, 5).map(l => (
                    <div key={l.itemId} className="w-8 h-8 rounded-lg bg-pt-border border-2 border-pt-surface overflow-hidden">
                      {l.photo && <img loading="lazy" decoding="async" src={l.photo} alt="" className="w-full h-full object-cover" />}
                    </div>
                  ))}
                  {(r.builds ?? []).length > 0 && <div className="w-8 h-8 rounded-lg bg-violet-500/20 border-2 border-pt-surface grid place-items-center text-sm"><Icon name="tools" className="w-4 h-4 text-violet-300" /></div>}
                </div>
                <span className="text-pt-muted text-xs">{total} item{total === 1 ? '' : 's'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
