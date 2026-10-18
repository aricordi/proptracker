import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGearCart } from '../gearCart'
import { subscribeToGearBundles, subscribeToGearHolds, subscribeToGearBookings, freeQty, pieceTotal, fmtHours, nowStamp, isGearLate, type GearBundle, type GearHold, type GearBooking } from '../services/gear'
import { useSession } from '../auth'
import { GearWhenPicker, GearArt, Pill, useGearWhen } from '../components/GearUi'
import { formatDay } from '../lib/dates'
import { useActiveShoot } from '../activeShoot'
import AddingToBar, { BrowseTabs } from '../components/AddingToBar'
import IdeasSheet, { IdeasButton } from '../components/IdeasSheet'

// Creators: pick the shoot day + hours, see which bundles and extras are free, add them.
export default function GearShopScreen() {
  const navigate = useNavigate()
  const cart = useGearCart()
  const w = useGearWhen()
  const [offers, setOffers] = useState<GearBundle[] | null>(null)
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  const [cat, setCat] = useState<string | null>(null)
  const [ideas, setIdeas] = useState(false)
  const { profile, role, shootFlow, isStaff } = useSession()
  // Creators add gear to one of their booked shoots; without one they just browse.
  const creator = shootFlow   // creator layout (creators + the owner)
  const { shoot } = useActiveShoot()
  const showFree = role !== 'creator' || !!shoot
  const [mine, setMine] = useState<GearBooking[]>([])
  useEffect(() => subscribeToGearBookings(profile.email, setMine), [profile.email])
  const lateOnes = mine.filter(b => isGearLate(b, nowStamp()))
  useEffect(() => subscribeToGearBundles(setOffers), [])
  useEffect(() => subscribeToGearHolds(setHolds), [])

  const live = (offers ?? []).filter(o => !o.archived)
  const bundles = live.filter(o => (o.kind ?? 'bundle') === 'bundle')
  const extras = live.filter(o => o.kind === 'extra')
  const cats = useMemo(() => [...new Set(bundles.map(b => b.category))], [bundles])
  const free = (o: GearBundle) => freeQty(o.kind === 'extra' ? (o.pieces[0]?.qty ?? 0) : 1, holds[o.id] ?? [], w.win.from, w.win.to)

  return (
    <div className="min-h-full bg-pt-bg pb-28">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-end justify-between py-2">
          <h1 className="font-display text-3xl text-pt-text">{creator ? 'Browse' : 'Gear'}</h1>
          <span className="flex items-center gap-3 pb-1">{creator && <IdeasButton small onClick={() => setIdeas(true)} />}<button onClick={() => navigate('/gear/bookings')} className="text-pt-accent text-sm font-medium">{creator ? 'My gear' : 'My gear bookings'}</button></span>
        </div>
        {creator ? <div className="space-y-2"><BrowseTabs /><AddingToBar kind="gear" />{shoot ? <GearWhenPicker hoursOnly /> : isStaff && <GearWhenPicker />}</div> : <GearWhenPicker />}
      </div>

      <div className="p-4 space-y-6">
        {lateOnes.length > 0 && (
          <button onClick={() => navigate(`/gear/bookings/${lateOnes[0].id}`)} className="w-full text-left bg-red-500/10 rounded-2xl px-4 py-3 text-red-200 text-[15px]">
            You have gear that's late coming back ({lateOnes.map(b => b.title).join(', ')}). Return it before booking more. <span className="text-pt-accent font-medium">Open ›</span>
          </button>
        )}
        {offers === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {offers && live.length === 0 && <p className="text-pt-muted text-sm text-center py-10">No gear to book yet. The equipment team is setting it up.</p>}

        {bundles.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Bundles</h2>
              <span className="text-pt-muted text-xs">Booked as a whole</span>
            </div>
            {cats.length > 1 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {[null, ...cats].map(c => (
                  <button key={c ?? 'all'} onClick={() => setCat(c)}
                    className={`shrink-0 px-3 py-1 rounded-full text-sm ${cat === c ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{c ?? 'All'}</button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {bundles.filter(b => !cat || b.category === cat).map(b => {
                const ok = !w.problem && free(b) > 0, inCart = !!cart.lines[b.id]
                return (
                  <button key={b.id} onClick={() => navigate(`/gear/b/${b.id}`)} className="text-left bg-pt-surface rounded-2xl overflow-hidden active:opacity-80">
                    <div className="relative">
                      <GearArt photo={b.photos?.[0]} category={b.category} className="w-full aspect-square" />
                      {inCart && <span className="absolute top-2 left-2 bg-pt-accent text-stone-900 text-xs font-bold px-2 py-0.5 rounded-full">✓ Added</span>}
                    </div>
                    <div className="p-2.5 space-y-1">
                      <p className="text-pt-text text-sm font-semibold leading-tight">{b.name}</p>
                      <p className="text-pt-muted text-xs">{b.category} · {pieceTotal(b.pieces)} pieces</p>
                      {b.missing?.length ? <p className="text-amber-200 text-xs">⚠ Missing: {b.missing.map(m => `${m.qty}× ${m.name}`).join(', ')}</p> : null}
                      {showFree && !w.problem && (ok ? <Pill tone="free">Free {fmtHours(w.start, w.end)}</Pill> : <Pill tone="taken">Taken</Pill>)}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {extras.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Add-on extras</h2>
              <span className="text-pt-muted text-xs">Pick how many</span>
            </div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
              {extras.map(x => {
                const n = cart.lines[x.id] ?? 0, f = w.problem || !showFree ? 0 : free(x)
                return (
                  <div key={x.id} className="flex items-center gap-3 px-3 py-2.5">
                    <GearArt photo={x.photos?.[0]} category={x.category} className="w-11 h-11 rounded-xl shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-pt-text text-[15px] truncate">{x.name}</p>
                      <p className={`text-xs ${f || !showFree ? 'text-pt-muted' : 'text-red-300'}`}>{!showFree ? `${x.pieces[0]?.qty ?? 0} offered` : f ? `${f} free for your hours` : 'None free for your hours'}</p>
                    </div>
                    <div className="flex items-center rounded-xl overflow-hidden bg-pt-bg border border-pt-border shrink-0">
                      <button onClick={() => cart.setQty(x.id, n - 1)} disabled={n === 0} aria-label={`One less ${x.name}`} className="w-9 h-9 text-pt-text disabled:opacity-30">−</button>
                      <span className="w-7 text-center text-pt-text font-semibold tabular-nums">{n}</span>
                      <button onClick={() => cart.setQty(x.id, n + 1)} disabled={n >= f} aria-label={`One more ${x.name}`} className="w-9 h-9 text-pt-text disabled:opacity-30">+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {cart.count > 0 && (
        <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
          <button onClick={() => navigate('/reserve')}
            className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-lg shadow-black/50">
            Review your shoot ({cart.count}) · {formatDay(w.date)}
          </button>
        </div>
      )}
      {creator && <IdeasSheet open={ideas} onClose={() => setIdeas(false)} />}
    </div>
  )
}
