import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart'
import { useSession } from '../auth'
import { useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import AvailabilityCalendar from './AvailabilityCalendar'
import DateRangePicker from './DateRangePicker'
import { freeForRange, todayInStudio, earliestStart, type BookingEntry } from '../../functions/src/booking'
import { formatDay, formatRange } from '../lib/dates'
import type { Item } from '../types'

// On a prop's page: when it's booked, and adding it to the reservation being built.
export default function ReservePanel({ item, entries }: { item: Item; entries: BookingEntry[] }) {
  const navigate = useNavigate()
  const cart = useCart()
  const { isStaff } = useSession()
  const settings = useBookingSettings()
  const turnaroundDays = useTurnaround()(item)
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  const legacyOut = item.status === 'checked-out'
  const dates = cart.start && cart.end ? { start: cart.start, end: cart.end } : null
  const free = dates
    ? freeForRange({ quantity: item.quantity, missingQty: item.missingQty, legacyCheckedOut: legacyOut }, entries, dates.start, dates.end, today, turnaroundDays)
    : null
  const inCart = cart.lines[item.id] ?? 0
  const [qty, setQty] = useState(Math.max(1, inCart))
  const [note, setNote] = useState<string | null>(null)
  const blocked = item.condition === 'damaged' && !isStaff

  function pick(day: string) {
    if (day < minStart) { setNote(`The earliest you can book is ${formatDay(minStart)}.`); return }
    setNote(null)
    // One shoot day per booking: tapping a day picks it.
    cart.setDates(day, day)
  }

  return (
    <div className="space-y-3">
      <p className="text-pt-muted text-xs uppercase tracking-wider">Availability</p>
      <AvailabilityCalendar quantity={Math.max(0, item.quantity - (item.missingQty ?? 0))} entries={entries} today={today}
        bufferDays={turnaroundDays} unavailable={legacyOut} selected={dates} onPick={pick} />
      {note && <p className="text-amber-400 text-xs">{note}</p>}
      {legacyOut && <p className="text-amber-400 text-sm">Out on a quick checkout. Unavailable until the arts team marks it returned.</p>}

      {blocked ? (
        <p className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3">
          This prop is damaged and can't be reserved until the arts department fixes it.
        </p>
      ) : !dates ? (
        <div className="space-y-2">
          <p className="text-pt-text text-sm">Tap your shoot day on the calendar, or pick it here:</p>
          <DateRangePicker start={cart.start} end={cart.end} min={minStart} onChange={cart.setDates} compact
            maxDays={1} />
        </div>
      ) : (
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-pt-text text-sm">📅 {formatRange(dates.start, dates.end)}</p>
            <button onClick={() => cart.setDates(null, null)} className="text-pt-accent text-xs">Change day</button>
          </div>
          <p className={`text-sm font-medium ${free ? 'text-green-400' : 'text-red-300'}`}>
            {free === 0 ? 'Not available on this day'
              : item.quantity > 1 ? `${free} of ${item.quantity} free on this day`
              : 'Free on this day'}
          </p>
          {!!free && (
            <>
              {item.quantity > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-pt-muted text-sm">How many?</span>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 rounded-full bg-pt-bg border border-pt-border text-pt-text text-xl">−</button>
                  <span className="text-pt-text text-lg font-semibold w-8 text-center">{Math.min(qty, free)}</span>
                  <button onClick={() => setQty(q => Math.min(free, q + 1))} className="w-10 h-10 rounded-full bg-pt-bg border border-pt-border text-pt-text text-xl">+</button>
                </div>
              )}
              {inCart === Math.min(qty, free) ? (
                <p className="w-full py-3 rounded-xl bg-pt-accent/15 text-pt-accent font-semibold text-center">
                  ✓ In your reservation{item.quantity > 1 ? ` (${inCart})` : ''}
                </p>
              ) : (
                <button onClick={() => cart.setQty(item.id, Math.min(qty, free))}
                  className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold active:opacity-80">
                  {inCart ? `Change to ${Math.min(qty, free)}` : 'Add to reservation'}
                </button>
              )}
            </>
          )}
          {inCart > 0 && (
            <div className="flex gap-2">
              <button onClick={() => cart.setQty(item.id, 0)} className="flex-1 py-2.5 rounded-xl border border-red-500/50 text-red-300 text-sm font-medium active:opacity-70">Remove</button>
              <button onClick={() => navigate('/reserve')} className="flex-1 py-2.5 rounded-xl bg-pt-bg border border-pt-accent text-pt-accent text-sm font-medium">
                Review reservation ({cart.count})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
