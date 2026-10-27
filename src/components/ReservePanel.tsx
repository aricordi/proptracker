import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart'
import { useSession } from '../auth'
import { useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import AvailabilityCalendar from './AvailabilityCalendar'
import DateRangePicker from './DateRangePicker'
import { freeForRange, todayInStudio, earliestStart, pickupDay, type BookingEntry } from '../../functions/src/booking'
import { formatDay, formatRange } from '../lib/dates'
import type { Item } from '../types'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import AddingToBar from './AddingToBar'
import { IconText } from './Icon'
import { useAddWithoutShoot } from './AddWithoutShoot'

// On a prop's page: when it's booked, and adding it to the reservation being built.
export default function ReservePanel({ item, entries }: { item: Item; entries: BookingEntry[] }) {
  const navigate = useNavigate()
  const cart = useCart()
  const { isStaff, shootFlow, canBook } = useSession()
  const noShoot = useAddWithoutShoot()
  const settings = useBookingSettings()
  const turnaroundDays = useTurnaround()(item)
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  const legacyOut = item.status === 'checked-out'
  const { shoot } = useActiveShoot()
  const cutoffs = useCutoffs()
  // Creators can't add after the cutoff (the server refuses it too); staff and the owner skip the notice.
  const propsLate = !!shoot && !isStaff && todayInStudio() > cutoffs(shoot).props
  // Creators add props to one of their booked shoots; staff can pick any day.
  const dates = cart.start && cart.end && (isStaff || shoot) ? { start: cart.start, end: cart.end } : null
  const free = dates
    ? freeForRange({ quantity: item.quantity, missingQty: item.missingQty, legacyCheckedOut: legacyOut }, entries, dates.start, dates.end, today, turnaroundDays, settings)
    : null
  const inCart = cart.lines[item.id] ?? 0
  const [qty, setQty] = useState(Math.max(1, inCart))
  const [note, setNote] = useState<string | null>(null)
  const blocked = item.condition === 'damaged' && !isStaff

  function pick(day: string) {
    if (!isStaff || shoot) { setNote(isStaff ? "You're adding to your shoot, so its day is used. Pick \"Just browsing\" above to choose another day." : 'Pick one of your shoots below. Its day is used.'); return }
    if (day < minStart) { setNote(`The earliest you can book is ${formatDay(minStart)}.`); return }
    setNote(null)
    // One shoot day per booking: tapping a day picks it.
    cart.setDates(day, day)
  }

  return (
    <div className="space-y-3">
      <p className="text-pt-muted text-xs">Availability</p>
      <AvailabilityCalendar quantity={Math.max(0, item.quantity - (item.missingQty ?? 0))} entries={entries} today={today}
        bufferDays={turnaroundDays} closed={settings} unavailable={legacyOut} selected={dates} onPick={pick} />
      {note && <p className="text-amber-400 text-xs">{note}</p>}
      {legacyOut && <p className="text-amber-400 text-sm">Out on a quick checkout. Unavailable until the arts team marks it returned.</p>}

      {blocked ? (
        <p className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3">
          This prop is damaged and can't be reserved until the arts department fixes it.
        </p>
      ) : !isStaff && !dates ? (
        <div className="space-y-2">
          <AddingToBar kind="props" />
          {canBook && <button onClick={() => noShoot.open(item.name, 'props', item.id)}
            className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Add to a shoot</button>}
          {noShoot.sheet}
        </div>
      ) : !dates ? (
        <div className="space-y-2">
          {shootFlow && <AddingToBar kind="props" />}
          <p className="text-pt-text text-sm">Tap your shoot day on the calendar, or pick it here:</p>
          <DateRangePicker start={cart.start} end={cart.end} min={minStart} onChange={cart.setDates} compact
            maxDays={1} />
        </div>
      ) : (
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
          {!shoot ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-pt-text text-sm"><IconText name="calendar">{formatRange(dates.start, dates.end)}</IconText></p>
              <button onClick={() => cart.setDates(null, null)} className="text-pt-accent text-xs tap">Change day</button>
            </div>
          ) : <AddingToBar kind="props" />}
          {pickupDay(dates.start, settings) !== dates.start && (
            <p className="text-amber-300 text-xs -mt-1">The prop room is closed that day: pick up on {formatDay(pickupDay(dates.start, settings))}.</p>
          )}
          <p className={`text-sm font-medium ${free ? 'text-green-400' : 'text-red-300'}`}>
            {free === 0 ? 'Not available on this day'
              : item.quantity > 1 ? `${free} of ${item.quantity} free on this day`
              : 'Free on this day'}
          </p>
          {propsLate && <p className="text-red-300 text-sm">Too late to add props to this shoot (the cutoff was {formatDay(cutoffs(shoot!).props)}). Pick a later shoot above.</p>}
          {canBook && !!free && !propsLate && (
            <>
              {item.quantity > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-pt-muted text-sm">How many?</span>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-11 h-11 rounded-full bg-pt-bg shadow-hairline text-pt-text text-xl">−</button>
                  <span className="text-pt-text text-lg font-semibold w-8 text-center">{Math.min(qty, free)}</span>
                  <button onClick={() => setQty(q => Math.min(free, q + 1))} className="w-11 h-11 rounded-full bg-pt-bg shadow-hairline text-pt-text text-xl">+</button>
                </div>
              )}
              {inCart === Math.min(qty, free) ? (
                <p className="w-full py-3 rounded-xl bg-pt-accent/15 text-pt-accent font-semibold text-center">
                  ✓ {shoot ? 'Added to this shoot' : 'In your reservation'}{item.quantity > 1 ? ` (${inCart})` : ''}
                </p>
              ) : (
                <button onClick={() => cart.setQty(item.id, Math.min(qty, free))}
                  className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold active:opacity-80 shadow-gold">
                  {inCart ? `Change to ${Math.min(qty, free)}` : shoot ? 'Add to this shoot' : 'Add to reservation'}
                </button>
              )}
            </>
          )}
          {canBook && inCart > 0 && (
            <div className="flex gap-2">
              <button onClick={() => cart.setQty(item.id, 0)} className="flex-1 py-3 rounded-xl border border-red-500/50 text-red-300 text-sm font-medium active:opacity-70">Remove</button>
              <button onClick={() => navigate('/reserve')} className="flex-1 py-3 rounded-xl bg-pt-bg border border-pt-accent text-pt-accent text-sm font-medium">
                {shoot ? 'Review shoot' : 'Review reservation'} ({cart.count})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
