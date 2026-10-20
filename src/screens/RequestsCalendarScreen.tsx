// Arts department: every props request laid out by shoot day (owner, Oct 19: arts don't book shoots or
// manage the schedule; they just need to see what's coming). Tap a request to work on it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { useScheduleDays, useScheduleSettings, fmtSlot, type ScheduleDay } from '../services/schedule'
import { todayInStudio, addDays, pickupDay, isLate } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { formatDay } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { Icon } from '../components/Icon'

const BEFORE = 7, AFTER = 42

// Where and when the request's shoot is, from the schedule (if it was booked for a schedule shoot).
function shootPlace(day: ScheduleDay | undefined, shootId: string | undefined, houses: Record<string, { name: string }>, slotMinutes: number) {
  if (!day || !shootId) return ''
  for (const h of ['cliff1', 'cliff2'] as const) {
    const hit = Object.entries(day[h] ?? {}).find(([, e]) => e.shootId === shootId)
    if (hit) return `${houses[h].name} · ${fmtSlot(Number(hit[0]), slotMinutes)}`
  }
  const o = (day.offsite ?? []).find(x => x.shootId === shootId)
  return o ? `${o.where} · ${fmtSlot(o.start, o.end - o.start)}` : ''
}

export default function RequestsCalendarScreen() {
  const navigate = useNavigate()
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
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => { stripRef.current?.querySelector('[data-today]')?.scrollIntoView({ inline: 'center', block: 'nearest' }) }, [])
  const pickup = pickupDay(day, settings)

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2">Calendar</h1>
        <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar" ref={stripRef}>
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
      </div>

      <div className="px-4 space-y-3">
        <p className="text-pt-text text-[20px] font-semibold tracking-heading">{day === today ? 'Today' : formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        {pickup !== day && shown.length > 0 && <p className="text-amber-300 text-sm -mt-2">The prop room is closed that day: these are picked up {formatDay(pickup, { weekday: 'long' })}.</p>}
        {list === null && <p className="text-pt-muted text-sm">Loading…</p>}
        {list !== null && shown.length === 0 && <p className="text-pt-muted text-sm">No props requests for this day.</p>}
        {shown.map(r => {
          const late = isLate(r.status, r.endDate, settings)
          const total = r.lines.length + (r.builds ?? []).length
          const where = shootPlace(days?.[r.startDate], (r as Reservation & { scheduleShootId?: string }).scheduleShootId, s.houses, s.slotMinutes)
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
