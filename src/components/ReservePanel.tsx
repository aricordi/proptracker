import { useEffect, useState } from 'react'
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
import { noteWanted } from '../services/propWants'
import { nowStamp } from '../../functions/src/gearBooking'

// On a prop's page: when it's booked, and adding it to the reservation being built.
export default function ReservePanel({ item, entries }: { item: Item; entries: BookingEntry[] }) {
  const navigate = useNavigate()
  const cart = useCart()
  const { isStaff, shootFlow, canBook, demo, viewingAs } = useSession()
  const noShoot = useAddWithoutShoot()
  const settings = useBookingSettings()
  const turnaroundDays = useTurnaround()(item)
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  const legacyOut = item.status === 'checked-out'
  const { shoot } = useActiveShoot()
  const cutoffs = useCutoffs()
  // Creators can't add after the cutoff (the server refuses it too); staff and the owner skip the notice.
  const propsLate = !!shoot && !isStaff && nowStamp() > cutoffs(shoot).props
  // Creators add props to one of their booked shoots; staff can pick any day.
  const dates = cart.start && cart.end && (isStaff || shoot) ? { start: cart.start, end: cart.end } : null
  const free = dates
    ? freeForRange({ quantity: item.quantity, missingQty: item.missingQty, legacyCheckedOut: legacyOut }, entries, dates.start, dates.end, today, turnaroundDays, settings)
    : null
  const inCart = cart.lines[item.id] ?? 0
  const [qty, setQty] = useState(Math.max(1, inCart))
  const [note, setNote] = useState<string | null>(null)
  const blocked = item.condition === 'damaged' && !isStaff

  // "Wanted but booked" (owner, Nov 7): a creator adding to a shoot opens a prop with nothing free that day → the app quietly
  // tells the arts department (Prop insights). Only when units exist but are all booked (not missing ones), only for people
  // who book (not staff, not Props only, not the owner's "View as"), and after a moment so a page still loading never counts.
  const units = Math.max(0, item.quantity - (item.missingQty ?? 0))
  const wantDay = shoot && dates && free === 0 && units > 0 && !legacyOut && dates.start === shoot.date
    && canBook && !isStaff && !demo && !viewingAs && item.collection === 'company' && !item.archived ? shoot.date : null
  useEffect(() => {
    if (!wantDay) return
    const t = setTimeout(() => noteWanted(item.id, wantDay), 1500)
    return () => clearTimeout(t)
  }, [item.id, wantDay])

  // People who can't book (arts, admins): just the calendar to check a day, no "pick one of your shoots" or add buttons
  // (audit Nov 7: admins were told to book a shoot they can't book).
  if (!canBook) {
    const day = cart.start && cart.end ? { start: cart.start, end: cart.end } : null
    const freeThen = day
      ? freeForRange({ quantity: item.quantity, missingQty: item.missingQty, legacyCheckedOut: legacyOut }, entries, day.start, day.end, today, turnaroundDays, settings)
      : null
    return (
      <div className="space-y-3">
        <p className="text-pt-muted text-xs">Availability</p>
        <AvailabilityCalendar quantity={Math.max(0, item.quantity - (item.missingQty ?? 0))} entries={entries} today={today}
          bufferDays={turnaroundDays} closed={settings} unavailable={legacyOut} selected={day} onPick={d => cart.setDates(d, d)} />
        {legacyOut && <p className="text-amber-400 text-sm">Out on a quick checkout. Unavailable until the arts team marks it returned.</p>}
        {day ? (
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-medium ${freeThen ? 'text-green-400' : 'text-red-300'}`}>
              {formatDay(day.start)}: {freeThen === 0 ? 'not available' : item.quantity > 1 ? `${freeThen} of ${item.quantity} free` : 'free'}
            </p>
            <button onClick={() => cart.setDates(null, null)} className="text-pt-accent text-xs tap">Clear</button>
          </div>
        ) : <p className="text-pt-muted text-sm">Tap a day to see how many are free.</p>}
      </div>
    )
  }

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
