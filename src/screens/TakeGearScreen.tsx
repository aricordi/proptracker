// GRAB-AND-GO (owner, Nov 2: "on a shoot day: checking out FX3 case 1 + photo, return + photo"). The creator picked what
// they're taking on Browse → Gear; here they tick every piece (or mark one missing), take ONE photo of it and that's it:
// it's theirs until the shoot ends. Return is the usual one (Return everything / the gear page).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveShoot, useGearWindow, useShootLabel } from '../activeShoot'
import { useGearCart } from '../gearCart'
import { friendlyError } from '../lib/errors'
import { checkLines, knownMissingKeys } from '../../functions/src/gearBooking'
import { byCount } from '../../functions/src/gearStock'
import ProofPhotos from '../components/ProofPhotos'
import { PieceChecklist, GearArt, LateFeeNote } from '../components/GearUi'
import { subscribeToGearBundles, takeGear, type GearBundle } from '../services/gear'
import { linesValue } from '../../functions/src/gearStock'

export default function TakeGearScreen() {
  const navigate = useNavigate()
  const cart = useGearCart()
  const { shoot } = useActiveShoot()
  const gw = useGearWindow(), label = useShootLabel()
  const [offers, setOffers] = useState<GearBundle[] | null>(null)
  useEffect(() => subscribeToGearBundles(setOffers), [])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Only what's still offered: a kit or item archived since it was picked (the cart lives on the phone) would
  // make every take fail, so it's dropped from the cart (audit, Nov 7).
  const picked = Object.entries(cart.lines).filter(([id, q]) => q > 0 && (!offers || offers.some(o => o.id === id && !o.archived)))
  const staleKey = offers ? Object.keys(cart.lines).filter(id => !offers.some(o => o.id === id && !o.archived)).join() : ''
  useEffect(() => { if (staleKey) staleKey.split(',').forEach(id => cart.setQty(id, 0)) }, [staleKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => picked.map(([offerId, qty]) => {
    const o = (offers ?? []).find(x => x.id === offerId)
    if (!o) return null
    return { offerId, qty, kind: byCount(o.kind) ? 'extra' : 'bundle', name: o.name, photo: o.photos?.[0], category: o.category, pieces: o.pieces.map(p => ({ itemId: p.itemId, qty: byCount(o.kind) ? qty : p.qty, name: p.name ?? '', value: (p as { value?: number | null }).value ?? null })) }
  }).filter((x): x is NonNullable<typeof x> => !!x), [picked.map(p => p.join(':')).join(), offers])   // eslint-disable-line react-hooks/exhaustive-deps
  const checks = checkLines(lines)
  // Pieces already reported missing (and not found since) start marked: they aren't on this creator.
  const known = useMemo(() => knownMissingKeys(checks, Object.fromEntries((offers ?? []).map(o => [o.id, o.missing]))), [checks.map(c => c.key).join(), offers])   // eslint-disable-line react-hooks/exhaustive-deps
  const knownKey = [...known].join()
  useEffect(() => { if (known.size) setMissing(m => new Set([...m, ...known])) }, [knownKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const allDone = checks.length > 0 && checks.every(c => ticked.has(c.key) || missing.has(c.key))
  const value = linesValue(lines)
  const state = shoot ? gw(shoot).state : 'early'

  const flip = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }
  async function take() {
    if (!shoot) return
    setBusy(true); setErr('')
    try {
      const r = await takeGear({ scheduleShootId: shoot.id, title: label(shoot).slice(0, 120) || 'Shoot', lines: picked.map(([offerId, qty]) => ({ offerId, qty })), missing: [...missing], photos })
      cart.clear()
      navigate(`/gear/bookings/${r.data.id}`, { replace: true, state: { taken: true } })
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="pt-safe px-4 pb-2">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] min-h-[44px]">‹ Back</button>
        <h1 className="font-display text-[30px] leading-tight text-pt-text">Take gear now</h1>
        {shoot && <p className="text-pt-muted text-sm">For your shoot: {label(shoot)}. It's yours until the shoot ends.</p>}
      </div>
      <div className="px-4 space-y-5">
        {!shoot || state !== 'take' ? (
          <p className="rounded-2xl bg-amber-400/10 text-amber-200 p-4 text-[15px]">{state === 'over' ? 'This shoot is over, so gear can\'t be taken for it any more.' : `You can take gear from an hour before your shoot until it ends.${state === 'reserve' ? ' Until then you can reserve it for your shoot.' : ''}`}</p>
        ) : !picked.length ? (
          <div className="rounded-2xl bg-pt-surface p-4 space-y-3"><p className="text-[15px]">Nothing picked yet.</p>
            <button onClick={() => navigate('/gear')} className="w-full rounded-xl py-3 font-bold bg-pt-accent text-stone-900">Pick gear</button></div>
        ) : <>
          <section className="space-y-2">
            <h2 className="text-pt-text text-lg font-semibold">1. Check every piece</h2>
            <p className="text-pt-muted text-[13px]">Tick each piece as you put it in the bag. Something not there? Tap Missing? so it isn't on you.</p>
            {lines.map(l => (
              <div key={l.offerId} className="rounded-2xl bg-pt-surface p-3 space-y-2">
                <div className="flex items-center gap-3"><GearArt photo={l.photo} category={l.category} className="w-11 h-11 rounded-xl shrink-0" />
                  <b className="text-[15px] flex-1 min-w-0">{l.name}{l.kind === 'extra' && l.qty > 1 ? ` × ${l.qty}` : ''}</b>
                  <button onClick={() => cart.setQty(l.offerId, 0)} aria-label={`Don't take ${l.name}`}
                    className="w-11 h-11 shrink-0 rounded-full bg-pt-bg text-pt-muted text-lg flex items-center justify-center">✕</button></div>
                <PieceChecklist lines={checks.filter(c => c.offerId === l.offerId)} ticked={ticked} missing={missing} known={known}
                  onTick={k => { setTicked(t => flip(t, k)); setMissing(m => { const n = new Set(m); n.delete(k); return n }) }}
                  onMissing={k => setMissing(m => flip(m, k))} />
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h2 className="text-pt-text text-lg font-semibold">2. One photo of what you're taking</h2>
            <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo of the gear" max={3} />
          </section>
          <LateFeeNote value={value.value} missing={value.missing} />
        </>}
        {err && <p className="text-red-300 text-sm">{err}</p>}
      </div>
      {shoot && state === 'take' && picked.length > 0 && (
        <div className="fixed left-0 right-0 bottom-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] z-20 bg-pt-bg">
          <button disabled={busy || uploading || !allDone || !photos.length} onClick={take} className="w-full rounded-2xl py-4 font-bold bg-pt-accent text-stone-900 shadow-gold disabled:opacity-40">
            {busy ? 'Taking it…' : !allDone ? 'Tick every piece first' : !photos.length ? 'Take the photo first' : missing.size ? `Take it (${missing.size} missing)` : 'Take it'}</button>
        </div>
      )}
    </div>
  )
}
