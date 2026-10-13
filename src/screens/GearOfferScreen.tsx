import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGearCart } from '../gearCart'
import { subscribeToGearBundles, subscribeToGearHolds, freeQty, nextFreeStart, fmtHours, type GearBundle, type GearHold } from '../services/gear'
import { GearWhenPicker, GearArt, Pill, DayTimeline, useGearWhen } from '../components/GearUi'
import ImageLightbox from '../components/ImageLightbox'
import { formatDay } from '../lib/dates'

// One bundle: what's in the case, when it's free, and "Add to my shoot".
export default function GearOfferScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const cart = useGearCart()
  const w = useGearWhen()
  const [offers, setOffers] = useState<GearBundle[] | null>(null)
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  const [zoom, setZoom] = useState<string | null>(null)
  useEffect(() => subscribeToGearBundles(setOffers), [])
  useEffect(() => subscribeToGearHolds(setHolds), [])

  const b = offers?.find(o => o.id === id)
  if (offers && (!b || b.archived)) return <div className="p-6 pt-safe text-pt-muted">This bundle isn't available any more.</div>
  if (!b) return <div className="p-6 pt-safe text-pt-muted">Loading…</div>

  const mine = holds[b.id] ?? []
  const free = !w.problem && freeQty(1, mine, w.win.from, w.win.to) > 0
  const next = !free && !w.problem ? nextFreeStart(1, 1, mine, w.date, w.start, w.end, w.settings) : null
  const similar = (offers ?? []).filter(o => !o.archived && o.id !== b.id && (o.kind ?? 'bundle') === 'bundle' && o.category === b.category
    && !w.problem && freeQty(1, holds[o.id] ?? [], w.win.from, w.win.to) > 0)
  const inCart = !!cart.lines[b.id]

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-2 py-2 flex items-center">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] px-2 py-1">‹ Gear</button>
      </div>
      <div className="px-4 space-y-4">
        <button onClick={() => b.photos?.[0] && setZoom(b.photos[0])} className="block w-full">
          <GearArt photo={b.photos?.[0]} category={b.category} className="w-full aspect-[4/3] rounded-2xl" />
        </button>
        <div>
          <h1 className="font-display text-[28px] leading-tight text-pt-text">{b.name}</h1>
          <p className="text-pt-muted text-sm mt-0.5">{b.category} bundle · comes as a whole</p>
          {b.description && <p className="text-pt-text text-[15px] mt-2 leading-relaxed">{b.description}</p>}
        </div>
        {b.missing?.length ? (
          <div className="bg-amber-500/10 rounded-2xl px-4 py-3 text-amber-200 text-[15px]">
            ⚠ Missing right now: {b.missing.map(m => `${m.qty}× ${m.name}`).join(', ')}. The rest of the bundle is fine.
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-pt-muted text-xs uppercase tracking-wider px-1">In the case</p>
          <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
            {b.pieces.map(p => (
              <div key={p.itemId} className="flex justify-between px-4 py-2.5 text-[15px]">
                <span className="text-pt-text">{p.name || 'Piece'}</span><span className="text-pt-muted tabular-nums">{p.qty}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-pt-muted text-[13px] leading-snug px-1">
          🔋 Batteries are charged when gear comes back, but a bundle can go straight out again, so we can't promise a full charge.
        </p>

        <GearWhenPicker />
        {!w.problem && (
          <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-pt-muted text-xs uppercase tracking-wider">{formatDay(w.date)}</p>
              {free ? <Pill tone="free">Free {fmtHours(w.start, w.end)}</Pill> : <Pill tone="taken">Taken</Pill>}
            </div>
            <DayTimeline holds={mine} date={w.date} start={w.start} end={w.end} />
          </div>
        )}

        {!w.problem && !free && (
          <div className="space-y-3">
            <div className="bg-red-500/10 rounded-2xl px-4 py-3 text-[15px] text-red-200">
              Someone has it for part of those hours.
              {next !== null
                ? <> It's free from <b>{fmtHours(next, next + (w.end - w.start))}</b>. <button onClick={() => cart.setWhen(w.date, next, next + (w.end - w.start))} className="text-pt-accent font-semibold">Use those hours</button></>
                : ' It isn\'t free for that long later that day.'}
            </div>
            {similar.length > 0 && (
              <div className="space-y-2">
                <p className="text-pt-muted text-xs uppercase tracking-wider px-1">Similar bundles free for your hours</p>
                {similar.map(s => (
                  <button key={s.id} onClick={() => navigate(`/gear/b/${s.id}`, { replace: true })} className="w-full flex items-center gap-3 bg-pt-surface rounded-2xl p-2.5 text-left active:opacity-80">
                    <GearArt photo={s.photos?.[0]} category={s.category} className="w-12 h-12 rounded-xl shrink-0" />
                    <div className="min-w-0"><p className="text-pt-text text-[15px] font-medium truncate">{s.name}</p><Pill tone="free">Free {fmtHours(w.start, w.end)}</Pill></div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {inCart ? (
          <div className="space-y-2">
            <button onClick={() => navigate('/reserve')} className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold">In your shoot ✓ · Review</button>
            <button onClick={() => cart.setQty(b.id, 0)} className="w-full py-2 text-pt-muted text-sm">Remove from my shoot</button>
          </div>
        ) : (
          <button onClick={() => { cart.setQty(b.id, 1); navigate(-1) }} disabled={!free}
            className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
            Add to my shoot · {fmtHours(w.start, w.end)}
          </button>
        )}
      </div>
      {zoom && <ImageLightbox src={zoom} alt={b.name} onClose={() => setZoom(null)} />}
    </div>
  )
}
