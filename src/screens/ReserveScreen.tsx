import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useCart } from '../cart'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import DateRangePicker from '../components/DateRangePicker'
import LateBanner from '../components/LateBanner'
import { useMyLateBookings } from '../hooks/useLateBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import ProofPhotos from '../components/ProofPhotos'
import { createReservation, type Conflict } from '../services/reservations'
import { freeForRange, todayInStudio, earliestStart, daysBetween } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import { useGearCart } from '../gearCart'
import {
  subscribeToGearBundles, subscribeToGearHolds, createGearBooking, cancelGearBooking,
  freeQty, holdWindow, checkGearTimes, earliestGearDay, fmtHours, fmtTime, GEAR_TIME_MESSAGES, type GearBundle, type GearHold,
} from '../services/gear'
import { GearArt, GearWhenPicker, Pill, nowMinutes } from '../components/GearUi'
import { thumbOf } from '../services/itemShape'
import { useActiveShoot } from '../activeShoot'
import AddingToBar from '../components/AddingToBar'
import { addOpenDays } from '../../functions/src/booking'

const shootIdNew = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const errMsg = (err: unknown) => err instanceof FirebaseError ? (err.message.replace(/^.*?:\s*/, '') || 'Could not book.') : "Couldn't reach the server. Check your connection and try again."

// "Your shoot": the props AND gear for one shoot day, sent together. Gear is held first;
// if the props part then fails, the gear hold is cancelled again so nothing is half-booked.
// Each team only sees its own part (props → arts department, gear → equipment team).
export default function ReserveScreen() {
  const navigate = useNavigate()
  const cart = useCart()
  const gear = useGearCart()
  const { isStaff, isGearStaff, profile, shootFlow } = useSession()
  const items = useItems()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const late = useMyLateBookings()
  const turnaround = useTurnaround()
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  // Creators: everything is for one of their booked shoots (its day).
  const { shoot } = useActiveShoot()
  const needShoot = !isStaff && !shoot

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
          bookings[itemId] ?? [], dates.start, dates.end, today, turnaround(item), settings)
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
  const hasProps = lines.length > 0 || cart.builds.length > 0
  const datesOk = !!dates && dates.start >= minStart && !tooLong

  // ── Gear for the same day ──
  const [offers, setOffers] = useState<GearBundle[]>([])
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  useEffect(() => subscribeToGearBundles(setOffers), [])
  useEffect(() => subscribeToGearHolds(setHolds), [])
  const day = dates?.start ?? gear.date
  const gearLines = Object.entries(gear.lines).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty, offer: offers.find(o => o.id === id) }))
  const hasGear = gearLines.length > 0
  const gearProblem = hasGear ? (day ? checkGearTimes(day, gear.start, gear.end, today, nowMinutes(), settings, isStaff || isGearStaff) : 'bad-format') : null
  const win = day ? holdWindow(day, gear.start, gear.end, settings) : null
  const gearUnavailable = gearLines.filter(l => !l.offer || l.offer.archived || !win
    || freeQty(l.offer.kind === 'extra' ? (l.offer.pieces[0]?.qty ?? 0) : 1, holds[l.id] ?? [], win.from, win.to) < l.qty)
  const gearOk = !hasGear || (!gearProblem && gearUnavailable.length === 0)
  // With props, the props notice applies to the day; gear alone only needs the gear notice.
  const pickerMin = hasProps || !hasGear ? minStart : (isStaff ? today : earliestGearDay(today, settings))

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

  const buildsTooSoon = !isStaff && cart.builds.length > 0 && !!day && day < addOpenDays(today, settings.buildLeadDays, settings)
  const propsOk = !hasProps || (late.length === 0 && datesOk && !buildsTooSoon && lines.every(l => !l.problem))
  const canSubmit = !needShoot && !!day && title.trim() && (hasProps || hasGear) && propsOk && gearOk && !busy && !buildUploading

  async function submit() {
    if (!day) return
    setBusy(true); setError(null); setConflicts({})
    const shootId = hasProps && hasGear && !shoot ? shootIdNew() : undefined
    const scheduleShootId = shoot && shootFlow ? shoot.id : undefined
    let gearId: string | null = null
    try {
      // 1. Hold the gear (instant).
      if (hasGear) {
        gearId = (await createGearBooking({
          title: title.trim(), notes: notes.trim(), date: day, start: gear.start, end: gear.end, shootId, scheduleShootId,
          lines: gearLines.map(l => ({ offerId: l.id, qty: l.qty })),
        })).data.id
      }
      // 2. Request the props.
      let resId: string | null = null
      if (hasProps && dates) {
        try {
          resId = (await createReservation({
            title: title.trim(), notes: notes.trim(), startDate: dates.start, endDate: dates.end, shootId, scheduleShootId,
            lines: lines.map(l => ({ itemId: l.itemId, qty: l.qty })),
            builds: cart.builds.map(({ description, qty, refPhoto }) => ({ description, qty, ...(refPhoto ? { refPhoto } : {}) })),
          })).data.id
        } catch (err) {
          // Don't leave the gear half-booked.
          if (gearId) await cancelGearBooking({ id: gearId }).catch(() => {})
          const details = err instanceof FirebaseError ? (err as FirebaseError & { details?: { conflicts?: Conflict[] } }).details : undefined
          if (details?.conflicts) setConflicts(Object.fromEntries(details.conflicts.map(c => [c.itemId, c])))
          setError(`${errMsg(err)}${gearId ? ' Nothing was booked; your gear is still in the basket.' : ''}`)
          return
        }
      }
      if (hasProps) cart.clear()
      if (hasGear) gear.clear()
      navigate(resId ? `/reservations/${resId}?new=1` : `/gear/bookings/${gearId}`, { replace: true })
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'

  return (
    // Bottom padding = height of the floating Reserve button, so nothing hides behind it.
    <div className="min-h-screen bg-pt-bg pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-pt-text text-base font-medium py-1">‹ Back</button>
        <h1 className="font-display text-xl text-pt-text">Your shoot</h1>
        <div className="w-12" />
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        {hasProps && <LateBanner late={late} />}
        {shootFlow && <AddingToBar kind="shoot" />}
        {/* Staff can book any day (the owner: when it isn't for one of their shoots) */}
        {!isStaff || shoot ? null : <DateRangePicker start={cart.start ?? gear.date} end={cart.end ?? gear.date} min={pickerMin} onChange={(s, e) => { cart.setDates(s, e); if (s) gear.setWhen(s, gear.start, gear.end) }}
          maxDays={1}
          leadTimeNote={!isStaff && hasProps && settings.leadTimeDays > 0 ? `Props need ${settings.leadTimeDays} open days' notice: earliest ${formatDay(minStart)}.` : undefined} />}
        {!isStaff && shoot && hasProps && !datesOk && <p className="text-red-300 text-sm -mt-3">It's too late to add props from the inventory to this shoot.</p>}
        {buildsTooSoon && <p className="text-red-300 text-sm -mt-3">New props (things to make or find) need {settings.buildLeadDays} open days' notice, so they can't be added to this shoot.</p>}
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
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-pt-muted text-xs uppercase tracking-wider">Props ({lines.length}) · arts department</p>
            <button onClick={() => navigate(shootFlow ? '/browse' : '/')} className="text-pt-accent text-sm tap">+ Add props</button>
          </div>
          {lines.length === 0 && cart.builds.length === 0 && (
            <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-4 py-3">No props yet.</p>
          )}
          <div className="space-y-2">
            {lines.map(({ itemId, qty, item, free, problem }) => (
              <div key={itemId} className={`flex items-center gap-3 bg-pt-surface border rounded-2xl p-3 ${problem ? 'border-red-500/50' : 'border-pt-border'}`}>
                <button onClick={() => navigate(`/item/${itemId}`)} className="w-14 h-14 rounded-xl bg-pt-border overflow-hidden shrink-0">
                  {item?.photos[0] && <img loading="lazy" decoding="async" src={thumbOf(item, item.photos[0])} alt="" className="w-full h-full object-cover" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-pt-text text-sm font-medium truncate">{item?.name ?? 'Unknown prop'}</p>
                  {problem
                    ? <p className="text-red-300 text-xs">{problem}</p>
                    : free !== null && <p className="text-green-400 text-xs">{item!.quantity > 1 ? `${free} free` : 'Free'}</p>}
                  {item && item.quantity > 1 && (
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => cart.setQty(itemId, Math.max(1, qty - 1))} className="w-7 h-7 rounded-full bg-pt-bg shadow-hairline text-pt-text">−</button>
                      <span className="text-pt-text text-sm w-6 text-center">{qty}</span>
                      <button onClick={() => cart.setQty(itemId, Math.min(item.quantity, qty + 1))} className="w-7 h-7 rounded-full bg-pt-bg shadow-hairline text-pt-text">+</button>
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
              <div key={b.key} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-3">
                <div className="w-14 h-14 rounded-xl bg-violet-500/10 overflow-hidden shrink-0 flex items-center justify-center text-2xl">
                  {b.refPhoto ? <img loading="lazy" decoding="async" src={b.refPhoto} alt="" className="w-full h-full object-cover" /> : '🛠️'}
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
            <div className="mt-2 bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-3">
              <textarea value={buildDesc} onChange={e => setBuildDesc(e.target.value)} rows={2} maxLength={500}
                placeholder="What do you need? e.g. Half-eaten birthday cake, chocolate" className={`${input} resize-none`} />
              <div className="flex items-center gap-3">
                <span className="text-pt-muted text-sm">How many?</span>
                <button onClick={() => setBuildQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">−</button>
                <span className="text-pt-text w-6 text-center">{buildQty}</span>
                <button onClick={() => setBuildQty(q => Math.min(1000, q + 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">+</button>
              </div>
              <ProofPhotos cameraOnly={false} folder={`request-photos/${profile.email}`} urls={buildPhotos} onChange={setBuildPhotos}
                onUploading={setBuildUploading} max={1} label="Reference photo (optional)" hint="A photo or screenshot of what you have in mind." />
              <div className="flex gap-2">
                <button onClick={() => setShowBuild(false)} className="flex-1 py-3 rounded-xl shadow-hairline text-pt-muted text-sm">Cancel</button>
                <button onClick={addBuild} disabled={!buildDesc.trim() || buildUploading}
                  className="flex-1 py-3 rounded-xl bg-violet-500 text-white text-sm font-semibold disabled:opacity-40">Add request</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowBuild(true)}
              className="mt-2 w-full py-3 rounded-2xl border border-dashed border-violet-500/60 text-violet-300 text-sm font-medium active:opacity-70">
              + Request something we don't have
            </button>
          )}
        </div>

        {/* Gear (equipment team) */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-pt-muted text-xs uppercase tracking-wider">Gear ({gearLines.length}) · equipment team</p>
            <button onClick={() => navigate('/gear')} className="text-pt-accent text-sm tap">+ Add gear</button>
          </div>
          {!hasGear && <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-4 py-3">No gear yet. Cameras, lights and sound come as bundles.</p>}
          {hasGear && (
            <>
              <GearWhenPicker hoursOnly />
              {gearProblem && day && <p className="text-red-300 text-sm">{GEAR_TIME_MESSAGES[gearProblem]}</p>}
              <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
                {gearLines.map(l => {
                  const bad = gearUnavailable.includes(l)
                  return (
                    <div key={l.id} className="flex items-center gap-3 px-3 py-3">
                      <GearArt photo={l.offer?.photos?.[0]} category={l.offer?.category} className="w-12 h-12 rounded-xl shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-pt-text text-sm font-medium truncate">{l.offer?.kind === 'extra' ? `${l.qty}× ` : ''}{l.offer?.name ?? 'No longer offered'}</p>
                        {bad && !gearProblem ? <Pill tone="taken">Not free for these hours</Pill> : <p className="text-pt-muted text-xs">{l.offer?.kind === 'extra' ? 'Add-on extra' : 'Bundle'} · {fmtHours(gear.start, gear.end)}</p>}
                      </div>
                      <button onClick={() => gear.setQty(l.id, 0)} aria-label="Remove" className="text-pt-muted text-2xl px-2">×</button>
                    </div>
                  )
                })}
              </div>
              {win && !gearProblem && (
                <p className="text-pt-muted text-xs leading-snug px-1">
                  Gear: pick up {formatDay(win.pickup)} at {fmtTime(gear.start)} from the equipment cage; back {win.closedDay ? `${formatDay(win.to.slice(0, 10))} by 10 AM` : `by ${fmtTime(gear.end)}`}. Return photo required.
                </p>
              )}
            </>
          )}
        </div>

        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
        <button onClick={submit} disabled={!canSubmit}
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80 mb-3 shadow-gold">
          {busy ? 'Sending…' : hasProps && hasGear ? 'Book props + gear' : hasGear ? 'Hold this gear' : 'Reserve these props'}
        </button>
      </div>
    </div>
  )
}
