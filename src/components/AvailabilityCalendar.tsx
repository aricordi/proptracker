import { useMemo, useState } from 'react'
import { addDays, bookedOn, type BookingEntry } from '../../functions/src/booking'

interface Props {
  quantity: number
  entries: BookingEntry[]
  today: string
  bufferDays: number
  unavailable?: boolean           // e.g. out on the old Checkout screen
  selected?: { start: string; end: string } | null
  onPick?: (day: string) => void
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Month view of one prop: which days are free, partly booked or fully booked.
export default function AvailabilityCalendar({ quantity, entries, today, bufferDays, unavailable, selected, onPick }: Props) {
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
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} aria-label="Previous month"
          className="w-9 h-9 rounded-full text-pt-text disabled:opacity-20 active:bg-pt-bg">‹</button>
        <p className="text-pt-text font-medium">{label}</p>
        <button onClick={() => shift(1)} aria-label="Next month" className="w-9 h-9 rounded-full text-pt-text active:bg-pt-bg">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => <span key={i} className="text-pt-muted text-[11px] pb-1">{w}</span>)}
        {days.map((d, i) => {
          if (!d) return <span key={i} />
          const past = d < today
          const used = unavailable ? quantity : bookedOn(d, entries, today, bufferDays)
          const free = Math.max(0, quantity - used)
          const inRange = selected && d >= selected.start && d <= selected.end
          const tone = past ? 'text-pt-border'
            : free === 0 ? 'bg-red-500/25 text-red-300'
            : free < quantity ? 'bg-amber-500/20 text-amber-200'
            : 'text-pt-text'
          return (
            <button key={d} disabled={past || !onPick} onClick={() => onPick?.(d)}
              className={`relative h-10 rounded-lg text-sm flex flex-col items-center justify-center ${tone} ${inRange ? 'ring-2 ring-pt-accent' : ''} ${d === today ? 'font-bold' : ''}`}>
              {Number(d.slice(8))}
              {!past && quantity > 1 && free > 0 && free < quantity && (
                <span className="text-[9px] leading-none">{free} left</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex gap-3 mt-3 text-[11px] text-pt-muted flex-wrap">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-pt-bg border border-pt-border inline-block" /> Free</span>
        {quantity > 1 && <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Some booked</span>}
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-500/30 inline-block" /> Booked</span>
        {selected && <span className="flex items-center gap-1"><i className="w-3 h-3 rounded ring-2 ring-pt-accent inline-block" /> Your day</span>}
      </div>
      {bufferDays > 0 && <p className="text-pt-muted text-[11px] mt-1">Booked days include {bufferDays} turnaround day{bufferDays > 1 ? 's' : ''} after each shoot.</p>}
    </div>
  )
}
