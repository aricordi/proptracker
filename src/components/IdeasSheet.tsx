// "✦ Prop ideas": a brainstorm chat for building a prop list (owner, Oct 19: like "Ask for a time", but for props).
// Describe the video, then keep going ("something for a séance", "make it spookier"): each answer is a short tip
// plus real props and gear from the inventory, grouped by scene, never repeating earlier ones. Tick what you want,
// then add it all to one of your shoots or book a new one for it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
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

const STARTERS = ['Prank: I dress up as a cop and pull my friend over at a diner', 'A séance that goes wrong', '90s sitcom kitchen', 'Royal wedding parody']
const errText = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'The AI helper didn\'t answer. Try again.'
// The phone's own speech recognition, when the browser has it (Safari and Chrome do).
const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null

export function IdeasButton({ onClick, small = false }: { onClick: () => void; small?: boolean }) {
  if (small) return (
    <button onClick={onClick} className="shrink-0 rounded-full px-3 py-2 text-[13px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">✦ Ideas</button>
  )
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-4 rounded-[20px] text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] active:scale-[0.98] transition-transform">
      <span className="w-[42px] h-[42px] rounded-[13px] grid place-items-center text-xl bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">✦</span>
      <span className="flex-1 min-w-0"><b className="block text-base">Got an idea for a video?</b><span className="text-pt-muted text-[13px]">Brainstorm it with the AI. It builds a prop list from what we have.</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )
}

type Msg = { who: 'me'; text: string } | { who: 'bot'; text: string; result?: IdeaResult }

export default function IdeasSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <IdeasChat onClose={onClose} />
}

function IdeasChat({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const items = useItems()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const turnaround = useTurnaround()
  const cart = useCart(), gearCart = useGearCart()
  const { shoot, upcoming } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const addToShoot = useAddToShoot()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()
  const first = (profile.name || user.displayName || '').split(' ')[0]

  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'bot', text: `Hi${first ? ` ${first}` : ''}! What's the video? Tell me the idea and I'll build a prop list from what we have. Then keep going: "something for a séance", "make it funnier", "props for the ending"…` }])
  const [chips, setChips] = useState<string[]>(STARTERS)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const rec = useRef<any>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  // Everything already suggested (never repeated) and everything the AI already looked for.
  const results = msgs.flatMap(m => m.who === 'bot' && m.result ? [m.result] : [])
  const shownIds = results.flatMap(r => r.groups.flatMap(g => g.picks.map(p => p.id)))
  const searched = results.flatMap(r => [...(r.searched ?? []), ...r.missing.map(m => m.name)])

  async function send(t = text, more = false) {
    const q = t.trim(); if (!q || busy) return
    const history = msgs.flatMap(m => m.who === 'me' && m.text !== 'More like these' ? [m.text] : [])
    setText(''); setChips([]); setMsgs(m => [...m, { who: 'me', text: q }]); setBusy(true)
    try {
      // "More like these" repeats the last real ask as a second look.
      const ask = more ? (history[history.length - 1] ?? q) : q
      const r = (await ideaToProps({
        idea: ask, history: more ? history.slice(0, -1) : history, exclude: shownIds, ...(more ? { searched, more: true } : {}),
        ...(shoot ? { shootId: shoot.id } : {}),
      })).data
      const fresh = { ...r, groups: r.groups.map(g => ({ ...g, picks: g.picks.filter(p => !shownIds.includes(p.id)) })).filter(g => g.picks.length) }
      const found = fresh.groups.length + fresh.missing.length > 0
      setMsgs(m => [...m, { who: 'bot', text: r.note || r.reply || (found ? 'Here\'s what we have for that.' : 'Nothing new fits that. Try another angle, or search and browse.'), ...(found ? { result: fresh } : {}) }])
      const next = [...(found ? ['More like these'] : []), ...(r.chips ?? []).filter(c => !/^more like these$/i.test(c.trim()))]
      setChips([...new Set(next)].slice(0, 4))
    } catch (e) { setMsgs(m => [...m, { who: 'bot', text: errText(e) }]) } finally { setBusy(false) }
  }

  function talk() {
    if (!Speech) return
    if (listening) { rec.current?.stop(); return }
    const r = new Speech()
    r.lang = 'en-CA'; r.interimResults = true; r.maxAlternatives = 1
    r.onresult = (e: any) => {
      const said = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join('')
      setText(said)
      if (e.results[e.results.length - 1].isFinal) { r.stop(); send(said) }
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r; setListening(true); r.start()
  }

  // Tick suggestions, then add them all to one of your shoots or a new one.
  // Keys: 'p:<prop id>', 'g:<gear id>', 'b:<thing to make or find>'.
  const [sel, setSel] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [addedTo, setAddedTo] = useState('')
  const toggle = (k: string) => { setAddedTo(''); setSel(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k]) }
  const picks = () => ({ props: sel.filter(k => k.startsWith('p:')).map(k => k.slice(2)), gear: sel.filter(k => k.startsWith('g:')).map(k => k.slice(2)), builds: sel.filter(k => k.startsWith('b:')).map(k => k.slice(2)) })
  const go = (to: string) => { onClose(); navigate(to) }
  const addTo = (id: string) => {
    const sh = upcoming.find(x => x.id === id)
    addToShoot(id, picks()); setSel([]); setPicking(false); setAddedTo(sh ? label(sh) : 'your shoot')
  }
  const newShoot = () => { savePendingAdds(picks()); setSel([]); setPicking(false); go('/schedule?book=1') }
  const freeProp = (id: string) => {
    const i = itemById.get(id)
    if (!i || !shoot) return null
    if (i.condition === 'damaged') return 0
    return freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' }, bookings[id] ?? [], shoot.date, shoot.date, today, turnaround(i), settings)
  }
  const tick = (k: string, name: string, inBasket: boolean) => inBasket && !sel.includes(k)
    ? <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent/20 text-pt-accent" title="Already in your shoot">✓</span>
    : <button onClick={() => toggle(k)} aria-pressed={sel.includes(k)} aria-label={`${sel.includes(k) ? 'Untick' : 'Tick'} ${name}`}
        className={`w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 ${sel.includes(k) ? 'pop bg-[#BF9DFF] text-[#140f22]' : 'bg-pt-border text-pt-text text-xl'}`}>
        {sel.includes(k) ? '✓' : '+'}</button>

  const renderResult = (result: IdeaResult) => (
    <div className="rise-in space-y-4">
      {result.groups.map(g => (
        <div key={g.title} className="space-y-2">
          <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider">{g.title}</p>
          {g.picks.map(p => {
            if (p.kind === 'prop') {
              const it = itemById.get(p.id); if (!it) return null
              const free = freeProp(p.id)
              return (
                <div key={p.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                  <button onClick={() => go(`/item/${p.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                    <span className="w-[52px] h-[52px] rounded-xl bg-pt-border overflow-hidden shrink-0">{it.photos[0] && <img loading="lazy" decoding="async" src={thumbOf(it, it.photos[0])} alt="" className="w-full h-full object-cover" />}</span>
                    <span className="min-w-0"><b className="block text-sm truncate">{it.name}</b><span className="block text-xs text-[#CDB8FF]">{p.why}</span>
                      <span className="block text-xs text-pt-muted">{free === null ? 'Check it ›' : free > 0 ? 'Free · check it ›' : 'Taken that day · check it ›'}</span></span>
                  </button>
                  {tick(`p:${p.id}`, it.name, !!cart.lines[p.id])}
                </div>
              )
            }
            const b = bundles.find(x => x.id === p.id); if (!b) return null
            return (
              <div key={p.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                <button onClick={() => go(`/gear/b/${p.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                  <GearArt photo={b.photos?.[0]} category={b.category} className="w-[52px] h-[52px] rounded-xl shrink-0" />
                  <span className="min-w-0"><b className="block text-sm truncate">{b.name}</b><span className="block text-xs text-[#CDB8FF]">{p.why}</span><span className="block text-xs text-pt-muted">Gear · check it ›</span></span>
                </button>
                {tick(`g:${p.id}`, b.name, !!gearCart.lines[p.id])}
              </div>
            )
          })}
        </div>
      ))}
      {result.missing.length > 0 && (
        <div className="space-y-2">
          <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider">We don't have it</p>
          {result.missing.map(m => {
            const k = `b:${m.name}`, asked = cart.builds.some(b => b.description === m.name)
            return (
              <div key={m.name} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-2xl bg-violet-500/10 shrink-0">🛠️</span>
                <span className="flex-1 min-w-0"><b className="block text-sm">{m.name}</b><span className="block text-xs text-[#CDB8FF]">{m.why || 'The arts team can make or find it'}</span></span>
                {asked && !sel.includes(k) ? <span className="shrink-0 text-xs font-semibold rounded-full px-3 py-2 bg-violet-500/20 text-violet-200 opacity-60">Asked ✓</span>
                  : <button onClick={() => toggle(k)} aria-pressed={sel.includes(k)} className={`shrink-0 text-xs font-semibold rounded-full px-3 min-h-[44px] ${sel.includes(k) ? 'bg-[#BF9DFF] text-[#140f22]' : 'bg-violet-500/20 text-violet-200'}`}>{sel.includes(k) ? 'Ticked ✓' : 'Ask for it'}</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 bg-pt-bg flex flex-col">
      <div className="pt-safe px-5 shrink-0">
        <div className="flex items-center justify-between py-3">
          <button onClick={onClose} className="text-pt-accent text-[17px]">‹ Back</button>
          <span className="rounded-full px-3 py-1 text-xs font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">✦ From our real inventory</span>
        </div>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight">Prop ideas</h1>
        <p className="text-pt-muted text-[13px]">{shoot ? `Free or taken for ${label(shoot)}. ` : ''}Brainstorm your video. Tick what you like, then add it to a shoot.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {msgs.map((m, i) => m.who === 'me' ? (
          <p key={i} className="rise-in ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent shadow-gold">{m.text}</p>
        ) : (
          <div key={i} className="space-y-3">
            <p className="rise-in max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">{m.text}</p>
            {m.result && renderResult(m.result)}
          </div>
        ))}
        {busy && <p role="status" aria-label="Thinking" className="rise-in w-fit flex items-center gap-1.5 rounded-[20px] rounded-bl-md px-4 py-4 bg-[#BF9DFF]/10"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></p>}
        {addedTo && <p className="text-pt-accent text-sm text-center">Added to {addedTo} ✓ <button onClick={() => go('/reserve')} className="tap underline">Review it</button></p>}
        <div ref={end} />
      </div>

      <div className="shrink-0 border-t border-pt-border px-5 pt-3 pb-safe bg-pt-bg">
        {sel.length > 0 ? (
          <button onClick={() => setPicking(true)} className="w-full mb-3 rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} to a shoot</button>
        ) : (cart.count + gearCart.count) > 0 && results.length > 0 ? (
          <button onClick={() => go('/reserve')} className="w-full mb-3 rounded-2xl py-3 font-semibold text-pt-accent bg-pt-accent/10">Review your shoot · {cart.count + gearCart.count}</button>
        ) : null}
        {chips.length > 0 && !busy && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
            {chips.map(c => <button key={c} onClick={() => send(c, c === 'More like these')} className={`shrink-0 rounded-full px-3 py-2 text-[13px] ${c === 'More like these' ? 'bg-[#BF9DFF]/20 text-[#CDB8FF] font-semibold' : 'bg-pt-border'}`}>{c === 'More like these' ? '✦ More like these' : c}</button>)}
          </div>
        )}
        <div className="flex items-center gap-2 pb-2">
          <label htmlFor="ideaAsk" className="sr-only">Message</label>
          <input id="ideaAsk" value={text} onChange={e => setText(e.target.value.slice(0, 600))} onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder={listening ? 'Listening…' : results.length ? 'Something for a séance…' : 'What\'s your video about?'}
            className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
          {Speech && (
            <button onClick={talk} aria-label={listening ? 'Stop listening' : 'Talk'}
              className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#BF9DFF]/20 text-[#BF9DFF]'}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
            </button>
          )}
          <button onClick={() => send()} disabled={!text.trim() || busy} aria-label="Send" className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-xl font-bold disabled:opacity-40">↑</button>
        </div>
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
    </div>
  )
}
