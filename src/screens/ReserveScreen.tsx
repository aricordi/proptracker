import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useCart } from '../cart'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import DateRangePicker from '../components/DateRangePicker'
import { createReservation, type Conflict } from '../services/reservations'
import { freeForRange, todayInStudio, earliestStart } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

export default function ReserveScreen() {
  const navigate = useNavigate()
  const cart = useCart()
  const { isStaff } = useSession()
  const items = useItems()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Record<string, Conflict>>({})

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const dates = cart.start && cart.end ? { start: cart.start, end: cart.end } : null

  const lines = Object.entries(cart.lines).map(([itemId, qty]) => {
    const item = itemById.get(itemId)
    const free = item && dates
      ? freeForRange({ quantity: item.quantity, legacyCheckedOut: item.status === 'checked-out' },
          bookings[itemId] ?? [], dates.start, dates.end, today, settings.bufferDays)
      : null
    const problem = !item ? 'No longer in the inventory'
      : item.archived ? 'No longer in the inventory'
      : item.condition === 'damaged' && !isStaff ? 'Damaged, can’t be reserved'
      : free !== null && free < qty ? (free === 0 ? 'Not available for these dates' : `Only ${free} free for these dates`)
      : conflicts[itemId] ? `Just taken: ${conflicts[itemId].free} free now`
      : null
    return { itemId, qty, item, free, problem }
  })

  const datesOk = !!dates && dates.start >= minStart
  const canSubmit = datesOk && title.trim() && lines.length > 0 && lines.every(l => !l.problem) && !busy

  async function submit() {
    if (!dates) return
    setBusy(true); setError(null); setConflicts({})
    try {
      const res = await createReservation({
        title: title.trim(), notes: notes.trim(),
        startDate: dates.start, endDate: dates.end,
        lines: lines.map(l => ({ itemId: l.itemId, qty: l.qty })),
      })
      cart.clear()
      navigate(`/reservations/${res.data.id}?new=1`, { replace: true })
    } catch (err) {
      if (err instanceof FirebaseError) {
        const details = (err as FirebaseError & { details?: { conflicts?: Conflict[] } }).details
        if (details?.conflicts) setConflicts(Object.fromEntries(details.conflicts.map(c => [c.itemId, c])))
        setError(err.message.replace(/^.*?:\s*/, '') || 'Could not reserve.')
      } else {
        setError("Couldn't reach the server. Check your connection and try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'

  return (
    <div className="min-h-screen bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text text-base font-medium py-1">‹ Back</button>
        <h1 className="font-display text-xl text-pt-text">Your reservation</h1>
        <div className="w-12" />
      </div>

      <div className="p-4 space-y-5">
        <DateRangePicker start={cart.start} end={cart.end} min={minStart} onChange={cart.setDates}
          leadTimeNote={!isStaff && settings.leadTimeDays > 0 ? `Earliest start: ${formatDay(minStart)} (${settings.leadTimeDays} days' notice).` : undefined} />

        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Shoot or video name *" className={input} maxLength={120} />
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000}
            placeholder="Anything the arts department should know (optional)" className={`${input} resize-none`} />
        </div>

        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Props ({lines.length})</p>
          {lines.length === 0 && (
            <div className="text-center py-8">
              <p className="text-pt-muted text-sm mb-3">Nothing added yet.</p>
              <button onClick={() => navigate('/')} className="text-pt-accent text-sm font-medium">Browse props</button>
            </div>
          )}
          <div className="space-y-2">
            {lines.map(({ itemId, qty, item, free, problem }) => (
              <div key={itemId} className={`flex items-center gap-3 bg-pt-surface border rounded-2xl p-2.5 ${problem ? 'border-red-500/50' : 'border-pt-border'}`}>
                <button onClick={() => navigate(`/item/${itemId}`)} className="w-14 h-14 rounded-xl bg-pt-border overflow-hidden shrink-0">
                  {item?.photos[0] && <img src={item.photos[0]} alt="" className="w-full h-full object-cover" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-pt-text text-sm font-medium truncate">{item?.name ?? 'Unknown prop'}</p>
                  {problem
                    ? <p className="text-red-300 text-xs">{problem}</p>
                    : free !== null && <p className="text-green-400 text-xs">{item!.quantity > 1 ? `${free} free` : 'Free'}</p>}
                  {item && item.quantity > 1 && (
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => cart.setQty(itemId, Math.max(1, qty - 1))} className="w-7 h-7 rounded-full bg-pt-bg border border-pt-border text-pt-text">−</button>
                      <span className="text-pt-text text-sm w-6 text-center">{qty}</span>
                      <button onClick={() => cart.setQty(itemId, Math.min(item.quantity, qty + 1))} className="w-7 h-7 rounded-full bg-pt-bg border border-pt-border text-pt-text">+</button>
                    </div>
                  )}
                </div>
                <button onClick={() => cart.setQty(itemId, 0)} aria-label="Remove" className="text-pt-muted text-2xl px-2">×</button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
        <button onClick={submit} disabled={!canSubmit}
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80 mb-3">
          {busy ? 'Reserving…' : 'Reserve these props'}
        </button>
      </div>
    </div>
  )
}
