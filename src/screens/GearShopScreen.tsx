import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGearCart } from '../gearCart'
import { useCart } from '../cart'
import BrandMark from '../components/BrandMark'
import { subscribeToGearBundles, subscribeToGearHolds, subscribeToGearBookings, freeQty, pieceTotal, fmtHours, nowStamp, isGearLate, byCount, type GearBundle, type GearHold, type GearBooking } from '../services/gear'
import { useSession } from '../auth'
import { GearWhenPicker, GearArt, useGearWhen } from '../components/GearUi'
import { useActiveShoot } from '../activeShoot'
import { BrowseTabs, AddingToChip, useAddingNote } from '../components/AddingToBar'
import MyRequestsButton from '../components/MyRequestsButton'
import AiButton from '../components/AiButton'

// Creators: pick the shoot day + hours, see which kits (bundles) and single items are free, add them.
// Owner, Oct 21: kits are what most people grab; single items are the pieces the team marked "Creators can book".
export default function GearShopScreen() {
  const navigate = useNavigate()
  const cart = useGearCart()
  const w = useGearWhen()
  const [offers, setOffers] = useState<GearBundle[] | null>(null)
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  const [cat, setCat] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const propsCart = useCart()
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

  // Owner (Oct 19): gear browses like props: search box, category chips, photo tiles with a status badge and +.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (o: GearBundle) => (!cat || o.category === cat) && words.every(wd =>
    [o.name, o.category, o.description ?? '', ...o.pieces.map(p => p.name ?? '')].join(' ').toLowerCase().includes(wd))
  const all = (offers ?? []).filter(o => !o.archived)
  const live = all.filter(matches)
  const bundles = live.filter(o => (o.kind ?? 'bundle') === 'bundle')
  const extras = live.filter(o => byCount(o.kind))
  const cats = useMemo(() => [...new Set(all.map(b => b.category))].sort(), [all.map(o => o.category).join()])   // eslint-disable-line react-hooks/exhaustive-deps
  const note = useAddingNote('gear')
  const free = (o: GearBundle) => freeQty(byCount(o.kind) ? (o.pieces[0]?.qty ?? 0) : 1, holds[o.id] ?? [], w.win.from, w.win.to)

  return (
    <div className="min-h-full bg-pt-bg pb-28">
      {/* Same as Browse → Props: title and tabs scroll away; search, chips and the hours stay pinned. */}
      <div className="pt-safe px-4">
        <h1 className="font-display text-[30px] leading-tight text-pt-text flex items-center gap-2.5"><BrandMark className="w-8 text-pt-text" title="" /><span className="flex-1">{creator ? 'Browse' : 'Gear'}</span>{creator && <><AiButton mode="props" /><MyRequestsButton /></>}</h1>
        {creator && <div className="mt-2.5"><BrowseTabs /></div>}
      </div>
      <div className="sticky z-10 bg-pt-bg px-4 pt-2.5 pb-2" style={{ top: 'env(safe-area-inset-top)' }}>
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cameras, lights, sound…" enterKeyHint="search" aria-label="Search gear"
            className="w-full bg-pt-surface border border-pt-border rounded-xl pl-10 pr-10 py-2.5 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none">×</button>}
        </div>
        {(creator || cats.length > 1) && (
          <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {creator && <AddingToChip kind="gear" />}
            {cats.length > 1 && [null, ...cats].map(c => (
              <button key={c ?? 'all'} onClick={() => setCat(c)}
                className={`shrink-0 px-3 py-1 rounded-full text-sm transition-colors ${cat === c ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{c ?? 'All'}</button>
            ))}
          </div>
        )}
        {creator ? (shoot ? null : isStaff && <div className="mt-2"><GearWhenPicker /></div>) : <div className="mt-2"><GearWhenPicker /></div>}
      </div>

      <div className="px-4 pb-4 pt-1 space-y-6">
        <p className="text-xs flex gap-2 -mb-3"><span className="text-pt-muted shrink-0">{bundles.length} kit{bundles.length === 1 ? '' : 's'}{extras.length ? ` · ${extras.length} single item${extras.length === 1 ? '' : 's'}` : ''}</span>
          {creator && <span className={`truncate ${note.late ? 'text-red-300' : 'text-pt-muted'}`}>· {shoot ? `Gear for your shoot's hours · ${note.text}` : note.text}</span>}</p>
        {lateOnes.length > 0 && (
          <button onClick={() => navigate(`/gear/bookings/${lateOnes[0].id}`)} className="w-full text-left bg-red-500/10 rounded-2xl px-4 py-3 text-red-200 text-[15px]">
            You have gear that's late coming back ({lateOnes.map(b => b.title).join(', ')}). Return it before booking more. <span className="text-pt-accent font-medium">Open ›</span>
          </button>
        )}
        {offers === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {offers && all.length === 0 && <p className="text-pt-muted text-sm text-center py-10">No gear to book yet. The equipment team is setting it up.</p>}
        {offers && all.length > 0 && live.length === 0 && <p className="text-pt-muted text-sm text-center py-10">No gear matches{query ? ` "${query.trim()}"` : ''}. Try another word{cat ? ' or All' : ''}.</p>}

        {bundles.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Grab-and-go kits</h2>
              <span className="text-pt-muted text-xs">Everything in the case, booked whole</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {bundles.map(b => {
                const ok = !w.problem && free(b) > 0, inCart = !!cart.lines[b.id]
                // Same badge colours as props: green = free/available, red = taken, amber = something missing.
                const badge = showFree && !w.problem ? (ok ? { label: 'Free', style: 'bg-green-500/90 text-stone-900' } : { label: 'Taken', style: 'bg-red-500/90 text-white' })
                  : b.missing?.length ? { label: 'Piece missing', style: 'bg-amber-500/90 text-stone-900' } : { label: 'Available', style: 'bg-green-500/90 text-stone-900' }
                const canAdd = creator && !!shoot && ok
                return (
                  <div key={b.id} className="relative w-full h-full">
                    <button onClick={() => navigate(`/gear/b/${b.id}`)} className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
                      <div className="relative aspect-square">
                        <GearArt photo={b.photos?.[0]} category={b.category} className="w-full h-full" />
                        <span className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${badge.style}`}>{badge.label}</span>
                        {inCart && !canAdd && <span className="absolute top-2 right-2 bg-pt-accent text-stone-900 text-xs font-bold px-2 py-0.5 rounded-full">✓ Added</span>}
                        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">{pieceTotal(b.pieces)} pcs</span>
                      </div>
                      <div className="px-3 pt-2 pb-3">
                        <p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{b.name}</p>
                        <p className="text-pt-muted text-xs truncate mt-0.5">{b.category}{showFree && ok && !w.problem ? ` · free ${fmtHours(w.start, w.end)}` : ''}</p>
                        {b.missing?.length ? <p className="text-amber-200 text-xs mt-0.5">⚠ Missing: {b.missing.map(m => `${m.qty}× ${m.name}`).join(', ')}</p> : null}
                      </div>
                    </button>
                    {canAdd && (
                      <button onClick={() => cart.setQty(b.id, inCart ? 0 : 1)} aria-label={inCart ? `Remove ${b.name}` : `Add ${b.name}`}
                        className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${
                          inCart ? 'pop bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{inCart ? '✓' : '+'}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {extras.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Single items</h2>
              <span className="text-pt-muted text-xs">Need just one thing? Pick how many</span>
            </div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {extras.map(x => {
                const n = cart.lines[x.id] ?? 0, f = w.problem || !showFree ? 0 : free(x)
                return (
                  <div key={x.id} className="flex items-center gap-3 px-3 py-3">
                    <GearArt photo={x.photos?.[0]} category={x.category} className="w-11 h-11 rounded-xl shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-pt-text text-[15px] truncate">{x.name}</p>
                      <p className={`text-xs ${f || !showFree ? 'text-pt-muted' : 'text-red-300'}`}>{!showFree ? `${x.pieces[0]?.qty ?? 0} offered` : f ? `${f} free for your hours` : 'None free for your hours'}</p>
                    </div>
                    <div className="flex items-center rounded-xl overflow-hidden bg-pt-bg shadow-hairline shrink-0">
                      <button onClick={() => cart.setQty(x.id, n - 1)} disabled={n === 0} aria-label={`One less ${x.name}`} className="w-11 h-11 text-pt-text text-lg disabled:opacity-30">−</button>
                      <span className="w-7 text-center text-pt-text font-semibold tabular-nums">{n}</span>
                      <button onClick={() => cart.setQty(x.id, n + 1)} disabled={n >= f} aria-label={`One more ${x.name}`} className="w-11 h-11 text-pt-text text-lg disabled:opacity-30">+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {/* The shoot being put together (props + gear): the same bar as on Props. */}
      {cart.count + propsCart.count > 0 && (
        <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
          <button onClick={() => navigate('/reserve')}
            className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-4 shadow-lg font-semibold active:opacity-90 shadow-gold">
            <span>Your shoot · {[propsCart.count && `${propsCart.count} prop${propsCart.count !== 1 ? 's' : ''}`, cart.count && `${cart.count} gear`].filter(Boolean).join(' · ')}</span>
            <span>Review</span>
          </button>
        </div>
      )}
    </div>
  )
}
