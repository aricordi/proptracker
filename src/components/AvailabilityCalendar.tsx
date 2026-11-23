import { useMemo, useState } from 'react'
import { addDays, bookedOn, isOpen, NO_CLOSED_DAYS, type BookingEntry, type ClosedDays } from '../../functions/src/booking'

interface Props {
  quantity: number
  entries: BookingEntry[]
  today: string
  bufferDays: number
  closed?: ClosedDays             // arts department's days off
  unavailable?: boolean           // e.g. out on the old Checkout screen
  selected?: { start: string; end: string } | null
  onPick?: (day: string) => void
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Month view of one prop: which days are free, partly booked or fully booked.
export default function AvailabilityCalendar({ quantity, entries, today, bufferDays, closed = NO_CLOSED_DAYS, unavailable, selected, onPick }: Props) {
  const [month, setMonth] = useState(() => (selected?.start ?? today).slice(0, 7))

  const days = useMemo(() => {
    const first = `${month}-01`
    const lead = new Date(`${first}T12:00:00`).getDay()
    const out: (string | null)[] = Array(lead).fill(null)
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const shift = (n: number) => {
    const d = new Date(`${month}-01T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })

  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} aria-label="Previous month"
          className="w-9 h-9 rounded-full text-pt-text disabled:opacity-20 active:bg-pt-bg">‹</button>
        <p className="text-pt-text font-medium">{label}</p>
        <button onClick={() => shift(1)} aria-label="Next month" className="w-9 h-9 rounded-full text-pt-text active:bg-pt-bg">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => <span key={i} className="text-pt-muted text-xs pb-1">{w}</span>)}
        {days.map((d, i) => {
          if (!d) return <span key={i} />
          const past = d < today
          const used = unavailable ? quantity : bookedOn(d, entries, today, bufferDays, closed)
          const free = Math.max(0, quantity - used)
          const off = !isOpen(d, closed)
          const inRange = selected && d >= selected.start && d <= selected.end
          const tone = past ? 'text-pt-border'
            : free === 0 ? 'bg-red-500/25 text-red-300'
            : free < quantity ? 'bg-amber-500/20 text-amber-200'
            : off ? 'text-pt-muted'
            : 'text-pt-text'
          const some = !past && quantity > 1 && free > 0 && free < quantity
          return (
            <button key={d} disabled={past || !onPick} onClick={() => onPick?.(d)}
              aria-label={off && !past ? `${Number(d.slice(8))}, prop room closed` : undefined}
              className={`relative h-11 rounded-lg text-sm flex flex-col items-center justify-start pt-1.5 ${tone} ${inRange ? 'ring-2 ring-pt-accent' : ''} ${d === today ? 'font-bold' : ''}`}>
              <span className={`leading-5 ${off && !past ? 'line-through decoration-pt-muted/70' : ''}`}>{Number(d.slice(8))}</span>
              <span className="h-3 flex items-center justify-center">
                {some ? <span className="text-xs leading-none whitespace-nowrap">{free} left</span>
                  : !past && off ? <i aria-hidden className="w-1 h-1 rounded-full bg-pt-muted inline-block" />
                  : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex gap-3 mt-3 text-xs text-pt-muted flex-wrap">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-pt-text/10 ring-1 ring-pt-text/25 inline-block" /> Free</span>
        {quantity > 1 && <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Some booked</span>}
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-500/30 inline-block" /> Booked</span>
        {(closed.closedWeekdays.length > 0 || closed.closedDates.length > 0) && <span className="flex items-center gap-1"><span className="line-through text-pt-muted">7</span><i aria-hidden className="w-1 h-1 rounded-full bg-pt-muted inline-block" /> Prop room closed</span>}
        {selected && <span className="flex items-center gap-1"><i className="w-3 h-3 rounded ring-2 ring-pt-accent inline-block" /> Your day</span>}
      </div>
      {bufferDays > 0 && <p className="text-pt-muted text-xs mt-1">Booked days include {bufferDays} turnaround day{bufferDays > 1 ? 's' : ''} after each shoot{closed.closedWeekdays.length || closed.closedDates.length ? ' (days the prop room is open)' : ''}.</p>}
    </div>
  )
}
