import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useGearCart } from '../gearCart'
import { subscribeToGearBundles, subscribeToGearHolds, createGearBooking, freeQty, fmtHours, fmtTime, type GearBundle, type GearHold } from '../services/gear'
import { GearWhenPicker, GearArt, Pill, useGearWhen } from '../components/GearUi'
import { formatDay } from '../lib/dates'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."

// Review the gear for a shoot and hold it (instant hold; the equipment team can still decline).
export default function GearReviewScreen() {
  const navigate = useNavigate()
  const cart = useGearCart()
  const w = useGearWhen()
  const [offers, setOffers] = useState<GearBundle[]>([])
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => subscribeToGearBundles(setOffers), [])
  useEffect(() => subscribeToGearHolds(setHolds), [])

  const lines = Object.entries(cart.lines).map(([id, qty]) => ({ offer: offers.find(o => o.id === id), qty, id })).filter(l => l.qty > 0)
  const unavailable = lines.filter(l => !l.offer || l.offer.archived ||
    freeQty(l.offer.kind === 'extra' ? (l.offer.pieces[0]?.qty ?? 0) : 1, holds[l.id] ?? [], w.win.from, w.win.to) < l.qty)

  async function hold() {
    setBusy(true); setError(null)
    try {
      const r = await createGearBooking({ title: title.trim() || 'Shoot', notes, date: w.date, start: w.start, end: w.end, lines: lines.map(l => ({ offerId: l.id, qty: l.qty })) })
      cart.clear()
      navigate(`/gear/bookings/${r.data.id}`, { replace: true })
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  const input = 'w-full bg-pt-surface rounded-xl px-4 py-3 text-pt-text text-[15px] placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent'
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-2 py-2 flex items-center">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] px-2 py-1">‹ Gear</button>
      </div>
      <div className="px-4 space-y-4">
        <h1 className="font-display text-3xl text-pt-text">Your gear</h1>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Shoot name, e.g. The Classroom · Ep 3" className={input} />
        <GearWhenPicker />

        <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
          {lines.length === 0 && <p className="text-pt-muted text-sm p-4">Nothing added yet. <button onClick={() => navigate('/gear')} className="text-pt-accent">Browse gear</button></p>}
          {lines.map(l => {
            const bad = unavailable.includes(l)
            return (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <GearArt photo={l.offer?.photos?.[0]} category={l.offer?.category} className="w-12 h-12 rounded-xl shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-pt-text text-[15px] truncate">{l.offer?.kind === 'extra' ? `${l.qty}× ` : ''}{l.offer?.name ?? 'No longer offered'}</p>
                  {bad ? <Pill tone="taken">Not free for these hours</Pill> : <p className="text-pt-muted text-xs">{l.offer?.kind === 'extra' ? 'Add-on extra' : 'Bundle'}</p>}
                </div>
                <button onClick={() => cart.setQty(l.id, 0)} className="text-pt-muted text-sm px-2">Remove</button>
              </div>
            )
          })}
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes for the equipment team (optional)" className={`${input} resize-none`} />

        {!w.problem && (
          <div className="text-pt-muted text-[13px] leading-snug space-y-1 px-1">
            <p>Pick up {w.closed ? `${formatDay(w.win.pickup)} at ${fmtTime(w.start)}` : `${formatDay(w.date)} at ${fmtTime(w.start)}`} from the equipment cage.
              Back {w.closed ? `${formatDay(w.win.to.slice(0, 10))} by 10 AM` : `by ${fmtTime(w.end)}`} (late 30 minutes after).</p>
            <p>When you bring it back you'll take one photo: everything in the case and the batteries plugged in.</p>
          </div>
        )}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        <button onClick={hold} disabled={busy || !!w.problem || lines.length === 0 || unavailable.length > 0}
          className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Holding…' : `Hold for ${formatDay(w.date)} · ${fmtHours(w.start, w.end)}`}
        </button>
        <p className="text-pt-muted text-xs text-center">It's yours right away. The equipment team checks it and can decline if something's wrong.</p>
      </div>
    </div>
  )
}
