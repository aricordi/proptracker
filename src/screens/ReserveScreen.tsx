import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useCart } from '../cart'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import DateRangePicker from '../components/DateRangePicker'
import ProofPhotos from '../components/ProofPhotos'
import { createReservation, type Conflict } from '../services/reservations'
import { freeForRange, todayInStudio, earliestStart, daysBetween } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

export default function ReserveScreen() {
  const navigate = useNavigate()
  const cart = useCart()
  const { isStaff, profile } = useSession()
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
      ? freeForRange({ quantity: item.quantity, missingQty: item.missingQty, legacyCheckedOut: item.status === 'checked-out' },
          bookings[itemId] ?? [], dates.start, dates.end, today, settings.bufferDays)
      : null
    const problem = !item ? 'No longer in the inventory'
      : item.archived ? 'No longer in the inventory'
      : item.condition === 'damaged' && !isStaff ? 'Damaged, can’t be reserved'
      : free !== null && free < qty ? (free === 0 ? 'Not available on this day' : `Only ${free} free on this day`)
      : conflicts[itemId] ? `Just taken: ${conflicts[itemId].free} free now`
      : null
    return { itemId, qty, item, free, problem }
  })

  const tooLong = !!dates && daysBetween(dates.start, dates.end) > 0
  const datesOk = !!dates && dates.start >= minStart && !tooLong

  // Build-to-order request form
  const [showBuild, setShowBuild] = useState(false)
  const [buildDesc, setBuildDesc] = useState('')
  const [buildQty, setBuildQty] = useState(1)
  const [buildPhotos, setBuildPhotos] = useState<string[]>([])
  const [buildUploading, setBuildUploading] = useState(false)
  function addBuild() {
    cart.addBuild({ description: buildDesc.trim(), qty: buildQty, ...(buildPhotos[0] ? { refPhoto: buildPhotos[0] } : {}) })
    setBuildDesc(''); setBuildQty(1); setBuildPhotos([]); setShowBuild(false)
  }

  const canSubmit = datesOk && title.trim() && (lines.length > 0 || cart.builds.length > 0) && lines.every(l => !l.problem) && !busy && !buildUploading

  async function submit() {
    if (!dates) return
    setBusy(true); setError(null); setConflicts({})
    try {
      const res = await createReservation({
        title: title.trim(), notes: notes.trim(),
        startDate: dates.start, endDate: dates.end,
        lines: lines.map(l => ({ itemId: l.itemId, qty: l.qty })),
        builds: cart.builds.map(({ description, qty, refPhoto }) => ({ description, qty, ...(refPhoto ? { refPhoto } : {}) })),
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
    // Bottom padding = height of the floating Reserve button, so nothing hides behind it.
    <div className="min-h-screen bg-pt-bg pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text text-base font-medium py-1">‹ Back</button>
        <h1 className="font-display text-xl text-pt-text">Your reservation</h1>
        <div className="w-12" />
      </div>

      <div className="p-4 space-y-5">
        <DateRangePicker start={cart.start} end={cart.end} min={minStart} onChange={cart.setDates}
          maxDays={1}
          leadTimeNote={!isStaff && settings.leadTimeDays > 0 ? `Earliest start: ${formatDay(minStart)} (${settings.leadTimeDays} days' notice).` : undefined} />
        {tooLong && (
          <p className="text-amber-400 text-sm -mt-3">
            Bookings are for a single shoot day now. Pick your shoot day above.
          </p>
        )}

        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Shoot or video name *" className={input} maxLength={120} />
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000}
            placeholder="Anything the arts department should know (optional)" className={`${input} resize-none`} />
        </div>

        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Props ({lines.length})</p>
          {lines.length === 0 && cart.builds.length === 0 && (
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

        {/* Things to build or source */}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">To build or source ({cart.builds.length})</p>
          <div className="space-y-2">
            {cart.builds.map(b => (
              <div key={b.key} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-2.5">
                <div className="w-14 h-14 rounded-xl bg-violet-500/10 overflow-hidden shrink-0 flex items-center justify-center text-2xl">
                  {b.refPhoto ? <img src={b.refPhoto} alt="" className="w-full h-full object-cover" /> : '🛠️'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-pt-text text-sm">{b.description}</p>
                  <p className="text-violet-300 text-xs">To build or source · ×{b.qty}</p>
                </div>
                <button onClick={() => cart.removeBuild(b.key)} aria-label="Remove" className="text-pt-muted text-2xl px-2">×</button>
              </div>
            ))}
          </div>
          {showBuild ? (
            <div className="mt-2 bg-pt-surface border border-pt-border rounded-2xl p-3 space-y-3">
              <textarea value={buildDesc} onChange={e => setBuildDesc(e.target.value)} rows={2} maxLength={500}
                placeholder="What do you need? e.g. Half-eaten birthday cake, chocolate" className={`${input} resize-none`} />
              <div className="flex items-center gap-3">
                <span className="text-pt-muted text-sm">How many?</span>
                <button onClick={() => setBuildQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-full bg-pt-bg border border-pt-border text-pt-text">−</button>
                <span className="text-pt-text w-6 text-center">{buildQty}</span>
                <button onClick={() => setBuildQty(q => Math.min(1000, q + 1))} className="w-9 h-9 rounded-full bg-pt-bg border border-pt-border text-pt-text">+</button>
              </div>
              <ProofPhotos folder={`request-photos/${profile.email}`} urls={buildPhotos} onChange={setBuildPhotos}
                onUploading={setBuildUploading} max={1} label="Reference photo (optional)" hint="A photo or screenshot of what you have in mind." />
              <div className="flex gap-2">
                <button onClick={() => setShowBuild(false)} className="flex-1 py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm">Cancel</button>
                <button onClick={addBuild} disabled={!buildDesc.trim() || buildUploading}
                  className="flex-1 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-semibold disabled:opacity-40">Add request</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowBuild(true)}
              className="mt-2 w-full py-3 rounded-2xl border border-dashed border-violet-500/60 text-violet-300 text-sm font-medium active:opacity-70">
              + Request something we don't have
            </button>
          )}
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
