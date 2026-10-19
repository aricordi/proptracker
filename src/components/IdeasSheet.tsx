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
import { useActiveShoot, useShootLabel, useCutoffs, useAddToShoot, savePendingAdds } from '../activeShoot'
import { formatDay } from '../lib/dates'
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
  const { shoot, upcoming } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const addToShoot = useAddToShoot()
  // Owner (Oct 19): tick suggestions, then add them all to one of your shoots or a new one.
  // Keys: 'p:<prop id>', 'g:<gear id>', 'b:<thing to make or find>'.
  const [sel, setSel] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [addedTo, setAddedTo] = useState('')
  const toggle = (k: string) => { setAddedTo(''); setSel(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k]) }
  const picks = () => ({ props: sel.filter(k => k.startsWith('p:')).map(k => k.slice(2)), gear: sel.filter(k => k.startsWith('g:')).map(k => k.slice(2)), builds: sel.filter(k => k.startsWith('b:')).map(k => k.slice(2)) })
  const addTo = (id: string) => {
    const sh = upcoming.find(x => x.id === id)
    addToShoot(id, picks()); setSel([]); setPicking(false); setAddedTo(sh ? label(sh) : 'your shoot')
  }
  const newShoot = () => { savePendingAdds(picks()); setSel([]); setPicking(false); go('/schedule?book=1') }
  const tick = (k: string, name: string, done: boolean) => (
    <button onClick={() => toggle(k)} aria-pressed={sel.includes(k)} aria-label={`${sel.includes(k) ? 'Untick' : 'Tick'} ${name}`}
      className={`w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 ${sel.includes(k) ? 'pop bg-[#BF9DFF] text-[#140f22]' : done ? 'bg-pt-accent/20 text-pt-accent' : 'bg-pt-border text-pt-text text-xl'}`}>
      {sel.includes(k) || done ? '✓' : '+'}</button>
  )
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<IdeaResult | null>(null)
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()

  async function ask() {
    setBusy(true); setErr(''); setResult(null); setNoMore(false)
    try { setResult((await ideaToProps({ idea: idea.trim(), ...(shoot ? { shootId: shoot.id } : {}) })).data) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  // "See more ideas" (owner, Oct 19): ask again for different things, never repeating what's shown; new
  // picks join their scene (or a new one) below.
  const [moreBusy, setMoreBusy] = useState(false)
  const [noMore, setNoMore] = useState(false)
  async function seeMore() {
    if (!result) return
    setMoreBusy(true); setErr('')
    try {
      const exclude = result.groups.flatMap(g => g.picks.map(p => p.id))
      const searched = [...(result.searched ?? []), ...result.missing.map(m => m.name)]
      const r = (await ideaToProps({ idea: idea.trim(), exclude, searched, ...(shoot ? { shootId: shoot.id } : {}) })).data
      const groups = result.groups.map(g => ({ ...g, picks: [...g.picks] }))
      let added = 0
      for (const g of r.groups) {
        const fresh = g.picks.filter(p => !exclude.includes(p.id))
        if (!fresh.length) continue
        added += fresh.length
        const same = groups.find(x => x.title.toLowerCase() === g.title.toLowerCase())
        if (same) same.picks.push(...fresh); else groups.push({ title: g.title, picks: fresh })
      }
      const have = new Set(result.missing.map(m => m.name.toLowerCase()))
      const missing = [...result.missing, ...r.missing.filter(m => !have.has(m.name.toLowerCase()))]
      setResult({ ...result, groups, missing, searched: [...searched, ...(r.searched ?? [])] })
      if (!added && missing.length === result.missing.length) setNoMore(true)
    } catch (e) { setErr(errText(e)) } finally { setMoreBusy(false) }
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
            <p className="text-pt-muted text-xs">{shoot ? `Free or taken for ${label(shoot)}. ` : ''}Tick what you want, then add them to a shoot.</p>
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
                          <span className="w-[52px] h-[52px] rounded-xl bg-pt-border overflow-hidden shrink-0">{it.photos[0] && <img loading="lazy" decoding="async" src={thumbOf(it, it.photos[0])} alt="" className="w-full h-full object-cover" />}</span>
                          <span className="min-w-0"><b className="block text-sm truncate">{it.name}</b><span className="block text-xs text-[#CDB8FF]">{p.why}</span>
                            <span className="block text-xs text-pt-muted">{free === null ? 'Check it ›' : free > 0 ? `Free · check it ›` : 'Taken that day · check it ›'}</span></span>
                        </button>
                        {(inCart && !sel.includes(`p:${p.id}`) ? <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent/20 text-pt-accent" title="Already in your shoot">✓</span> : tick(`p:${p.id}`, it.name, false))}
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
                      {inCart && !sel.includes(`g:${p.id}`) ? <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent/20 text-pt-accent" title="Already in your shoot">✓</span> : tick(`g:${p.id}`, b.name, false)}
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
                      {added && !sel.includes(`b:${m.name}`) ? <span className="shrink-0 text-xs font-semibold rounded-full px-3 py-2 bg-violet-500/20 text-violet-200 opacity-60">Asked ✓</span>
                        : <button onClick={() => toggle(`b:${m.name}`)} aria-pressed={sel.includes(`b:${m.name}`)} className={`shrink-0 text-xs font-semibold rounded-full px-3 min-h-[44px] ${sel.includes(`b:${m.name}`) ? 'bg-[#BF9DFF] text-[#140f22]' : 'bg-violet-500/20 text-violet-200'}`}>{sel.includes(`b:${m.name}`) ? 'Ticked ✓' : 'Ask for it'}</button>}
                    </div>
                  )
                })}
              </div>
            )}
            {result.groups.length > 0 && (noMore
              ? <p className="text-pt-muted text-sm text-center">That's everything that fits. Search or browse for more.</p>
              : <button disabled={moreBusy} onClick={seeMore} className="w-full rounded-2xl py-3 min-h-[48px] font-semibold text-[#CDB8FF] bg-[#BF9DFF]/[0.12] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] disabled:opacity-60">
                  {moreBusy ? <span className="inline-flex gap-1 items-center">Finding more <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span> : '✦ See more ideas'}</button>)}
            {addedTo && <p className="text-pt-accent text-sm text-center">Added to {addedTo} ✓</p>}
            {(cart.count + gearCart.count) > 0 && sel.length === 0 && <button onClick={() => go('/reserve')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Review your shoot · {cart.count + gearCart.count}</button>}
            <p className="text-pt-muted text-xs text-center">Not quite it? Search or browse for the real thing.</p>
          </div>
        )}
        {sel.length > 0 && (
          <div className="sticky bottom-0 pt-2 pb-1 bg-pt-surface">
            <button onClick={() => setPicking(true)} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} to a shoot</button>
          </div>
        )}
      </div>
      <BottomSheet open={picking} onClose={() => setPicking(false)} title="Add to which shoot?">
        <div className="space-y-2">
          {upcoming.length === 0 && <p className="text-pt-muted text-sm">No shoots booked yet. Book one and these come with you.</p>}
          {[...upcoming].sort((a, b) => (a.id === shoot?.id ? -1 : b.id === shoot?.id ? 1 : a.from.localeCompare(b.from))).map(sh => {
            const c = cutoffs(sh), late = (d: string) => today > d
            const p = picks()
            const warn = [p.props.length && late(c.props) ? 'props' : '', p.builds.length && late(c.builds) ? 'new props' : '', p.gear.length && late(c.gear) ? 'gear' : ''].filter(Boolean)
            return (
              <button key={sh.id} onClick={() => addTo(sh.id)} className={`w-full text-left rounded-2xl px-4 py-3 ${shoot?.id === sh.id ? 'bg-pt-accent/15 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.5)]' : 'bg-pt-bg'}`}>
                <span className="block text-pt-text text-[15px] font-semibold">{label(sh)}</span>
                <span className={`block text-xs ${warn.length ? 'text-red-300' : 'text-pt-muted'}`}>{warn.length ? `Too late for ${warn.join(' and ')}` : `Props by ${formatDay(c.props)} · Gear by ${formatDay(c.gear)}`}</span>
              </button>
            )
          })}
          <button onClick={newShoot} className="w-full rounded-2xl py-4 mt-2 font-bold text-stone-900 bg-pt-accent shadow-gold">+ Book a new shoot for these</button>
          <p className="text-pt-muted text-xs text-center">Your picks wait while you book, then go into the new shoot.</p>
        </div>
      </BottomSheet>
    </BottomSheet>
  )
}
