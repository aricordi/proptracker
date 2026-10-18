// "Got an idea for a video?": the AI suggests props and gear from the inventory for it, grouped by
// scene, each with why it fits. Creators check each one (tap opens its page) and add with +.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from './BottomSheet'
import { GearArt } from './GearUi'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import { useCart } from '../cart'
import { useGearCart } from '../gearCart'
import { useActiveShoot, useShootLabel } from '../activeShoot'
import { ideaToProps, type IdeaResult } from '../services/ai'
import { subscribeToGearBundles, type GearBundle } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import { freeForRange, todayInStudio } from '../../functions/src/booking'

const EXAMPLES = ['Prank: I dress up as a cop and pull my friend over at a diner', 'Bank heist gone wrong', '90s sitcom kitchen', 'Royal wedding parody']
const errText = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'The AI helper didn\'t answer. Try again.'

export function IdeasButton({ onClick, small = false }: { onClick: () => void; small?: boolean }) {
  if (small) return (
    <button onClick={onClick} className="shrink-0 rounded-full px-3 py-2 text-[13px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">✦ Ideas</button>
  )
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-4 rounded-[20px] text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] active:scale-[0.98] transition-transform">
      <span className="w-[42px] h-[42px] rounded-[13px] grid place-items-center text-xl bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">✦</span>
      <span className="flex-1 min-w-0"><b className="block text-base">Got an idea for a video?</b><span className="text-pt-muted text-[13px]">Tell the AI. It pulls props and gear for it.</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )
}

export default function IdeasSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const items = useItems()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const turnaround = useTurnaround()
  const cart = useCart(), gearCart = useGearCart()
  const { shoot } = useActiveShoot()
  const label = useShootLabel()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<IdeaResult | null>(null)
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()

  async function ask() {
    setBusy(true); setErr(''); setResult(null)
    try { setResult((await ideaToProps({ idea: idea.trim(), ...(shoot ? { shootId: shoot.id } : {}) })).data) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const freeProp = (id: string) => {
    const i = itemById.get(id)
    if (!i || !shoot) return null
    if (i.condition === 'damaged') return 0
    return freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' }, bookings[id] ?? [], shoot.date, shoot.date, today, turnaround(i), settings)
  }
  const go = (to: string) => { onClose(); navigate(to) }

  return (
    <BottomSheet open={open} onClose={onClose} title="✦ Prop ideas">
      <div className="space-y-3">
        <p className="text-pt-muted text-sm">What's your video about? The AI looks through everything we have and suggests props and gear. Check each one before adding.</p>
        <label htmlFor="ideaText" className="sr-only">Your video idea</label>
        <textarea id="ideaText" value={idea} onChange={e => setIdea(e.target.value.slice(0, 600))} rows={3}
          placeholder="e.g. I dress up as a cop and pull my friend over at a diner, then it turns into his surprise birthday"
          className="w-full bg-pt-bg border border-pt-border rounded-2xl px-4 py-3 text-pt-text text-base resize-none focus:outline-none focus:border-[#BF9DFF]" />
        {!idea && <div className="flex gap-2 overflow-x-auto no-scrollbar">{EXAMPLES.map(t => <button key={t} onClick={() => setIdea(t)} className="shrink-0 rounded-full px-3 py-2 text-[13px] bg-pt-border text-pt-text">{t}</button>)}</div>}
        <button disabled={busy || idea.trim().length < 8} onClick={ask}
          className="w-full rounded-2xl py-4 font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet disabled:opacity-40">{busy ? 'Thinking…' : 'Find props for this idea'}</button>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {busy && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-pt-surface animate-pulse" />)}</div>}

        {result && (
          <div className="space-y-4 pt-1">
            <p className="text-pt-muted text-xs">{shoot ? `Free or taken for ${label(shoot)}.` : 'Pick a shoot in Browse to see what\'s free and add things.'}</p>
            {result.groups.length === 0 && <p className="text-pt-muted text-sm">{result.note || 'Nothing in the inventory fits that well. Try describing the scenes differently, or search.'}</p>}
            {result.groups.map(g => (
              <div key={g.title} className="space-y-2">
                <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider">{g.title}</p>
                {g.picks.map(p => {
                  if (p.kind === 'prop') {
                    const it = itemById.get(p.id); if (!it) return null
                    const free = freeProp(p.id), inCart = !!cart.lines[p.id]
                    return (
                      <div key={p.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                        <button onClick={() => go(`/item/${p.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                          <span className="w-[52px] h-[52px] rounded-xl bg-pt-border overflow-hidden shrink-0">{it.photos[0] && <img src={thumbOf(it, it.photos[0])} alt="" className="w-full h-full object-cover" />}</span>
                          <span className="min-w-0"><b className="block text-sm truncate">{it.name}</b><span className="block text-xs text-[#CDB8FF]">{p.why}</span>
                            <span className="block text-xs text-pt-muted">{free === null ? 'Check it ›' : free > 0 ? `Free · check it ›` : 'Taken that day · check it ›'}</span></span>
                        </button>
                        {shoot && !!free && (
                          <button onClick={() => cart.setQty(p.id, inCart ? 0 : 1)} aria-label={inCart ? `Remove ${it.name}` : `Add ${it.name}`}
                            className={`w-10 h-10 rounded-full grid place-items-center font-bold shrink-0 ${inCart ? 'pop bg-pt-accent text-stone-900' : 'bg-pt-border text-pt-text text-xl'}`}>{inCart ? '✓' : '+'}</button>
                        )}
                      </div>
                    )
                  }
                  const b = bundles.find(x => x.id === p.id); if (!b) return null
                  const inCart = !!gearCart.lines[p.id]
                  return (
                    <div key={p.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                      <button onClick={() => go(`/gear/b/${p.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                        <GearArt photo={b.photos?.[0]} category={b.category} className="w-[52px] h-[52px] rounded-xl shrink-0" />
                        <span className="min-w-0"><b className="block text-sm truncate">{b.name}</b><span className="block text-xs text-[#CDB8FF]">{p.why}</span><span className="block text-xs text-pt-muted">Gear · check it ›</span></span>
                      </button>
                      {shoot && (
                        <button onClick={() => gearCart.setQty(p.id, inCart ? 0 : 1)} aria-label={inCart ? `Remove ${b.name}` : `Add ${b.name}`}
                          className={`w-10 h-10 rounded-full grid place-items-center font-bold shrink-0 ${inCart ? 'pop bg-pt-accent text-stone-900' : 'bg-pt-border text-pt-text text-xl'}`}>{inCart ? '✓' : '+'}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {result.missing.length > 0 && (
              <div className="space-y-2">
                <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider">We don't have it</p>
                {result.missing.map(m => {
                  const added = cart.builds.some(b => b.description === m.name)
                  return (
                    <div key={m.name} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                      <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-2xl bg-violet-500/10 shrink-0">🛠️</span>
                      <span className="flex-1 min-w-0"><b className="block text-sm">{m.name}</b><span className="block text-xs text-[#CDB8FF]">{m.why || 'The arts team can make or find it'}</span></span>
                      {shoot && <button disabled={added} onClick={() => cart.addBuild({ description: m.name, qty: 1 })} className="shrink-0 text-xs font-semibold rounded-full px-3 py-2 bg-violet-500/20 text-violet-200 disabled:opacity-50">{added ? 'Asked ✓' : 'Ask for it'}</button>}
                    </div>
                  )
                })}
              </div>
            )}
            {(cart.count + gearCart.count) > 0 && <button onClick={() => go('/reserve')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Review your shoot · {cart.count + gearCart.count}</button>}
            <p className="text-pt-muted text-xs text-center">Not quite it? Search or browse for the real thing.</p>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
