// The one AI chat ("✦ AI" on every creator screen; owner, Oct 19). It does two jobs in one conversation:
// - PROP IDEAS: describe the video, keep going ("something for a séance"); real props and gear from the inventory,
//   grouped by scene, never repeated. Tick what you want, add it all to a shoot (or book a new one).
// - FIND A TIME: "4 hours with Kyle next week, evenings" → real free slots with a Book button. Booking with friends
//   books your slot and holds theirs for 20 minutes.
// - PLAN MY SHOOT (owner, Oct 19): walks through it in order: 1 time (book a new one or pick a booked shoot),
//   2 props (the ideas chat for that shoot), 3 gear (NOT AI: the list of gear free for the shoot's hours),
//   4 review = the normal "Your shoot" page already filled in, where the creator changes anything and sends it.
// It stays in its box: each message goes to one of the two server helpers (ideaToProps / askForTime), which check
// the budget, treat the words as data only, and return fixed answers the server has checked. The AI can't book,
// read or change anything itself; every Book / Add button here is a normal tap by the person.
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import type { AssistantMode } from '../assistant'
import { routeMessage, type Helper, type Route } from '../lib/aiRoute'
type Step = 'time' | 'props' | 'gear' | 'review'
import BottomSheet from './BottomSheet'
import { GearArt, useGearWhen } from './GearUi'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import { useCart } from '../cart'
import { useGearCart } from '../gearCart'
import { useActiveShoot, useShootLabel, useCutoffs, useAddToShoot, savePendingAdds } from '../activeShoot'
import { formatDay } from '../lib/dates'
import { ideaToProps, type IdeaResult } from '../services/ai'
import { subscribeToGearBundles, subscribeToGearHolds, freeQty, type GearBundle, type GearHold } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import {
  askForTime, bookWithFriends, useMyInvites, useScheduleSettings, fmtSlot, errorText, INVITE_HOLD_MINUTES,
  type TimeAskResult,
} from '../services/schedule'
import { freeForRange, todayInStudio } from '../../functions/src/booking'
import { fmtTime, fmtHours } from '../../functions/src/gearBooking'
import { Icon } from './Icon'

type Msg =
  | { who: 'me'; text: string; mode: Helper }
  | { who: 'bot'; text: string; result?: IdeaResult; alt?: { q: string; to: Helper } }   // alt = "Meant a time instead?"
  | { who: 'choose' }
  | { who: 'options'; options: TimeAskResult['options'] }
  | { who: 'booked'; inviteIds: string[]; shootId: string; label: string }
  | { who: 'shoots' }   // plan: pick one of your booked shoots or a new time
  | { who: 'gear' }     // plan: live list of gear free for the shoot
  | { who: 'review' }   // plan: what's in the shoot so far + Review & send
  | { who: 'already' }  // plan: what this shoot already has (sent requests), live

const MORE = 'More like these'
const TIME_CHIP = 'Find a time to film this'
const PROPS_CHIP = 'Props for this shoot'
const NEXT_GEAR = 'Next: gear ›'
const SKIP_PROPS = 'Skip props ›'
const NEXT_REVIEW = 'Next: review ›'
const STEPS: [Step, string][] = [['time', 'Time'], ['props', 'Props'], ['gear', 'Gear'], ['review', 'Review']]
const STARTERS: Record<Helper, string[]> = {
  props: ['Prank: I dress up as a cop and pull my friend over at a diner', 'A séance that goes wrong', '90s sitcom kitchen', 'Royal wedding parody'],
  time: ["I'm filming with a friend this week", '4 hours next week, evenings', 'Earliest free slot at Cliff 2'],
}
const OPENERS: Record<Helper, string> = {
  props: 'What\'s the video? Tell me the idea and I\'ll build a prop list from what we have. Then keep going: "something for a séance", "make it funnier", "props for the ending"…',
  time: 'When do you want to film, for how long, and with who? Type it, or tap the mic and just say it.',
}
// No "props or time" switch (owner, Oct 20): src/lib/aiRoute.ts reads each message and runs one helper or both.
const GREETING = 'Tell me your video idea, or when you want to film, or both. I\'ll find the props we have and the times that are free.'
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const propsErr = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'The AI helper didn\'t answer. Try again.'
// The phone's own speech recognition, when the browser has it (Safari and Chrome do).
const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null

// What a shoot already has: its sent props requests and gear holds that are still going (not cancelled/declined).
interface SentProps { id: string; status: string; lines: { itemId: string; itemName: string; qty: number }[]; builds: { description: string }[] }
interface SentGear { id: string; status: string; lines: { offerId: string; name: string; qty: number }[] }
function useShootRequests(shootId: string | undefined, email: string) {
  const [props, setProps] = useState<SentProps[]>([])
  const [gear, setGear] = useState<SentGear[]>([])
  const live = (st: string) => st !== 'cancelled' && st !== 'declined'
  useEffect(() => {
    if (!shootId) { setProps([]); return }
    return onSnapshot(query(collection(db, 'reservations'), where('shootId', '==', shootId), where('creatorEmail', '==', email)),
      snap => setProps(snap.docs.map(d => ({ id: d.id, status: d.get('status'), lines: d.get('lines') ?? [], builds: d.get('builds') ?? [] })).filter(x => live(x.status))), () => setProps([]))
  }, [shootId, email])
  useEffect(() => {
    if (!shootId) { setGear([]); return }
    return onSnapshot(query(collection(db, 'gear_bookings'), where('shootId', '==', shootId), where('creatorEmail', '==', email)),
      snap => setGear(snap.docs.map(d => ({ id: d.id, status: d.get('status'), lines: d.get('lines') ?? [] })).filter(x => live(x.status))), () => setGear([]))
  }, [shootId, email])
  return { props, gear }
}

export default function Assistant({ shown, ask, onClose }: { shown: boolean; ask: { mode?: AssistantMode; shootId?: string; n: number }; onClose: () => void }) {
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const items = useItems()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const turnaround = useTurnaround()
  const s = useScheduleSettings()
  const cart = useCart(), gearCart = useGearCart()
  const { shoot, upcoming, choose } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const addToShoot = useAddToShoot()
  const invites = useMyInvites(profile.email)
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const house = (p: string) => p === 'cliff2' ? s.houses.cliff2.name : s.houses.cliff1.name

  const hello = `Hi${first ? ` ${first}` : ''}!`
  const helper = ask.mode === 'plan' ? undefined : ask.mode
  const fresh = (m?: Helper): Msg[] => m ? [{ who: 'bot', text: `${hello} ${OPENERS[m]}` }] : [{ who: 'bot', text: `${hello} ${GREETING}` }, { who: 'choose' }]
  // Examples of both kinds, plus your next booked shoot when you have one.
  const mixed = () => [
    ...(upcoming[0] ? [`Props for my ${WEEKDAY[new Date(upcoming[0].date + 'T12:00:00').getDay()]} shoot`] : []),
    STARTERS.props[1], 'Find me 2 hours this week', STARTERS.props[0], STARTERS.time[0],
  ]
  // `mode` = what the chat was last doing, so short follow-ups ("anything earlier?") keep going.
  const [mode, setMode] = useState<Helper | null>(helper ?? null)
  const [msgs, setMsgs] = useState<Msg[]>(() => fresh(helper))
  const [chips, setChips] = useState<string[]>(() => helper ? STARTERS[helper] : mixed())
  // Plan my shoot: which step, and which shoot it's for (set once the time is booked or picked).
  const [plan, setPlan] = useState<{ step: Step; shootId?: string; label?: string } | null>(null)
  const [holds, setHolds] = useState<Record<string, GearHold[]>>({})
  useEffect(() => subscribeToGearHolds(setHolds), [])
  const w = useGearWhen()
  const sent = useShootRequests(plan?.shootId, profile.email)
  const sentPropIds = sent.props.flatMap(r => r.lines.map(l => l.itemId))
  const sentGearIds = sent.gear.flatMap(g => g.lines.map(l => l.offerId))
  const openRequest = sent.props.find(r => r.status === 'requested')   // still changeable
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState<Helper | null>(null)   // label under the typing dots
  const [listening, setListening] = useState(false)
  const [previous, setPrevious] = useState<Record<string, unknown> | undefined>()
  const rec = useRef<any>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { if (shown) end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy, shown])

  // Point the chat at one helper (a screen that opened it for times, a chip, a button).
  function switchTo(m: Helper, say = true) {
    setMode(m); setChips(STARTERS[m])
    if (say) setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'bot', text: OPENERS[m] }])
  }
  // Opened again from a screen that asks for a specific helper.
  const lastAsk = useRef(ask.n)
  useEffect(() => {
    if (ask.n === lastAsk.current) return
    lastAsk.current = ask.n
    if (ask.mode === 'plan') { if (ask.shootId) planProps(ask.shootId); else if (!plan) startPlan() }
    else if (ask.mode && ask.mode !== mode) { setPlan(null); switchTo(ask.mode) }
  }, [ask.n])
  const started = useRef(false)
  useEffect(() => {   // opened straight into planning (once, even if React starts effects twice)
    if (started.current || ask.mode !== 'plan') return
    started.current = true
    if (ask.shootId) planProps(ask.shootId); else startPlan()
  }, [])
  const restart = () => { setMode(null); setPlan(null); setMsgs(fresh()); setChips(mixed()); setPrevious(undefined); setSel([]); setAddedTo(''); setText('') }

  // ── Plan my shoot ──
  const bot = (text: string, ...extra: Msg[]) => setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'bot', text }, ...extra])
  const planShoot = upcoming.find(x => x.id === plan?.shootId)
  const planLabel = planShoot ? label(planShoot) : plan?.label ?? 'your shoot'
  const late = (kind: 'props' | 'builds' | 'gear') => !!planShoot && today > cutoffs(planShoot)[kind]
  function startPlan() {
    setPlan({ step: 'time' }); setChips([])
    if (upcoming.length) bot('Let\'s plan your shoot, step by step: time, props, gear, then you check it all and send. Is it one you\'ve already booked, or a new time?', { who: 'shoots' })
    else planTime()
  }
  function planTime() {
    setPlan({ step: 'time' }); setMode('time'); setChips(STARTERS.time)
    bot('Step 1 · Time. When do you want to film, for how long, and with who?')
  }
  function planProps(shootId: string, where?: string) {
    choose(shootId)
    const sh = upcoming.find(x => x.id === shootId)
    const name = sh ? label(sh) : where ?? 'your shoot'
    setPlan({ step: 'props', shootId, label: name }); setMode('props')
    const tooLate = sh && today > cutoffs(sh).props
    if (tooLate) { setChips([SKIP_PROPS]); bot(`Step 2 · Props. It's too late to add props to ${name} (the last day was ${formatDay(cutoffs(sh).props)}). Let's look at gear.`); return }
    setChips([...STARTERS.props.slice(0, 3), SKIP_PROPS])
    bot(`Step 2 · Props for ${name}. What's the video about? I'll find what we have and check it's free that day.${sh ? ` Props by ${formatDay(cutoffs(sh).props)}.` : ''}`, { who: 'already' })
  }
  // Ticked suggestions go into the shoot when you move on, so nothing is lost.
  function commitTicks() { if (plan?.shootId && sel.length) { addToShoot(plan.shootId, picks()); setSel([]) } }
  function planGear() {
    commitTicks()
    setPlan(p => p && { ...p, step: 'gear' }); setChips([NEXT_REVIEW])
    if (late('gear')) { bot(`Step 3 · Gear. It's too late to add gear to ${planLabel}.`); return }
    bot(`Step 3 · Gear free for ${planLabel}. Tap + on anything you want; skip it if you don't need any.`, { who: 'gear' })
  }
  // The video name on the review page starts as the first idea typed while planning (they can change it).
  const planIdea = () => {
    const at = msgs.findIndex(x => x.who === 'bot' && x.text.startsWith('Step 2'))
    const idea = msgs.slice(at + 1).find(x => x.who === 'me' && x.mode === 'props' && x.text !== MORE)
    return idea && idea.who === 'me' ? idea.text.slice(0, 80) : ''
  }
  function planReview() {
    commitTicks()
    setPlan(p => p && { ...p, step: 'review' }); setChips([])
    bot('Step 4 · Review. Here\'s your shoot. On the next page you can change amounts, add or remove anything, then send it to the teams.', { who: 'review' })
  }

  // Everything already suggested (never repeated) and everything the AI already looked for.
  const results = msgs.flatMap(m => m.who === 'bot' && m.result ? [m.result] : [])
  const shownIds = results.flatMap(r => r.groups.flatMap(g => g.picks.map(p => p.id)))
  const searched = results.flatMap(r => [...(r.searched ?? []), ...r.missing.map(m => m.name)])
  const lastBot = msgs.reduce((n, x, i) => x.who === 'bot' ? i : n, -1)   // "Meant … instead?" only under the newest answer

  async function send(t = text, more = false, force?: Helper) {
    const q = t.trim(); if (!q || busy) return
    // Which helper(s): a forced one ("Meant a time instead?"), the plan's current step, or read from the words.
    const route: Route = force ? { helpers: [force] } : more || plan?.step === 'props' ? { helpers: ['props'] }
      : plan?.step === 'time' ? { helpers: ['time'] }
      : routeMessage(q, { last: mode, shoots: upcoming.map(x => ({ id: x.id, date: x.date })) })
    const hs = route.helpers, both = hs.length > 1
    const target = route.shootId ?? shoot?.id
    const named = route.shootId && route.shootId !== shoot?.id ? upcoming.find(x => x.id === route.shootId) : undefined
    if (route.shootId) choose(route.shootId)
    // Offer "Meant … instead?" only when the chat just picked a direction (not on every follow-up).
    const offer = !both && !force && !plan && !more && mode !== hs[0]
    setMode(hs[hs.length - 1])
    setText(''); setChips([]); setBusy(true)
    setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: hs[0] },
      ...(named ? [{ who: 'bot' as const, text: `For your shoot (${label(named)}). I'll check what's free that day.` }] : [])])
    const next: string[][] = []
    for (const h of hs) {
      setThinking(h)
      next.push(h === 'props' ? await sendProps(q, more, target, offer) : await sendTime(q, offer))
    }
    // Both ran: a few follow-ups from each.
    setChips([...new Set(both ? [...next[0].filter(c => c !== TIME_CHIP).slice(0, 3), ...next[1].slice(0, 2)] : next[0])].slice(0, 5))
    setThinking(null); setBusy(false)
  }

  // Each helper returns its follow-up chips. `offerOther` adds "Meant a time instead?" under its answer.
  async function sendProps(q: string, more: boolean, shootId: string | undefined, offerOther: boolean): Promise<string[]> {
    const history = msgs.flatMap(x => x.who === 'me' && x.mode === 'props' && x.text !== MORE ? [x.text] : [])
    try {
      // "More like these" repeats the last real ask as a second look.
      const idea = more ? (history[history.length - 1] ?? q) : q
      const r = (await ideaToProps({
        idea, history: more ? history.slice(0, -1) : history, exclude: [...new Set([...shownIds, ...sentPropIds, ...sentGearIds])], ...(more ? { searched, more: true } : {}),
        ...(shootId ? { shootId } : {}),
      })).data
      const kept = { ...r, groups: r.groups.map(g => ({ ...g, picks: g.picks.filter(p => !shownIds.includes(p.id)) })).filter(g => g.picks.length) }
      const found = kept.groups.length + kept.missing.length > 0
      setMsgs(x => [...x, { who: 'bot', text: r.note || r.reply || (found ? 'Here\'s what we have for that.' : 'Nothing new fits that. Try another angle, or search and browse.'), ...(found ? { result: kept } : {}), ...(offerOther && !more ? { alt: { q, to: 'time' as const } } : {}) }])
      const next = [...(plan?.step === 'props' ? [NEXT_GEAR] : []), ...(found ? [MORE] : []), ...(r.chips ?? []).filter(c => !/^more like these$/i.test(c.trim())), ...(found && !shootId && !plan ? [TIME_CHIP] : [])]
      return [...new Set(next)].slice(0, 5)
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: propsErr(e) }]); return [] }
  }

  async function sendTime(q: string, offerOther: boolean): Promise<string[]> {
    try {
      const r = (await askForTime({ text: q, ...(previous ? { previous } : {}) })).data
      setPrevious(r.ask)
      setMsgs(x => [...x, { who: 'bot', text: r.reply, ...(offerOther ? { alt: { q, to: 'props' as const } } : {}) }, ...(r.options.length ? [{ who: 'options' as const, options: r.options }] : [])])
      return r.friends.length ? ['Anything on the weekend?', `Only ${s.houses.cliff2.name}`, 'Just me, 2 hours'] : ['Anything earlier?', 'Evenings only', `Only ${s.houses.cliff1.name}`]
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: errorText(e) }]); return [] }
  }

  async function book(o: TimeAskResult['options'][number]) {
    setBusy(true)
    try {
      const friends = o.slots.filter(x => !x.me).map(x => x.email)
      const r = (await bookWithFriends({ place: o.place, date: o.date, start: o.start, friends, mySlots: o.slots.filter(x => x.me).length })).data
      const where = `${formatDay(o.date)} · ${house(o.place)} · ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}`
      setMsgs(x => [...x,
        { who: 'bot', text: friends.length ? `Booked your slot. I've invited ${o.slots.filter(y => !y.me).map(y => y.name.split(' ')[0]).join(' and ')}: ${friends.length > 1 ? 'their slots are' : 'their slot is'} held for ${INVITE_HOLD_MINUTES} minutes for them to confirm.` : 'Booked. 🎬' },
        { who: 'booked', inviteIds: r.inviteIds, shootId: r.shootIds[0], label: where }])
      if (plan) planProps(r.shootIds[0], where)
      else setChips([PROPS_CHIP])
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: errorText(e) }]) } finally { setBusy(false) }
  }

  // After booking a time here: brainstorm props for that shoot in the same chat (free/taken for its day).
  function propsFor(shootId: string) {
    choose(shootId); setMode('props'); setChips(STARTERS.props)
    bot('What\'s the video about? I\'ll find props we have and check they\'re free for that shoot.')
  }
  function askTime() { setMode('time'); setChips(STARTERS.time); bot(OPENERS.time) }

  function chip(c: string) {
    if (c === NEXT_GEAR || c === SKIP_PROPS) return planGear()
    if (c === NEXT_REVIEW) return planReview()
    if (c === TIME_CHIP) return askTime()
    if (c === PROPS_CHIP) { const b = [...msgs].reverse().find(x => x.who === 'booked'); if (b && b.who === 'booked') propsFor(b.shootId); return }
    send(c, c === MORE)
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
  const go = (to: string, state?: unknown) => { onClose(); navigate(to, state ? { state } : undefined) }
  const addTo = (id: string, name?: string) => {
    const sh = upcoming.find(x => x.id === id)
    addToShoot(id, picks()); setSel([]); setPicking(false); setAddedTo(sh ? label(sh) : name || 'your shoot')
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
          <p className="text-pt-muted text-xs font-semibold">{g.title}</p>
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
          <p className="text-pt-muted text-xs font-semibold">We don't have it</p>
          {result.missing.map(m => {
            const k = `b:${m.name}`, asked = cart.builds.some(b => b.description === m.name)
            return (
              <div key={m.name} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-2xl bg-violet-500/10 shrink-0"><Icon name="tools" className="w-6 h-6 text-violet-300" /></span>
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

  const choice = (m: AssistantMode, icon: string, title: string, sub: string) => (
    <button onClick={() => m === 'plan' ? startPlan() : (setPlan(null), switchTo(m))} className="w-full flex items-center gap-3 p-4 rounded-[20px] text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] active:scale-[0.98] transition-transform">
      <span className="w-[42px] h-[42px] rounded-[13px] grid place-items-center text-xl bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">{icon}</span>
      <span className="flex-1 min-w-0"><b className="block text-base">{title}</b><span className="text-pt-muted text-[13px]">{sub}</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )

  return (
    <div className={`fixed inset-0 z-50 bg-pt-bg flex flex-col ${shown ? '' : 'hidden'}`} role="dialog" aria-label="AI helper">
      <div className="pt-safe px-5 shrink-0">
        <div className="flex items-center justify-between py-3">
          <button onClick={onClose} className="text-pt-accent text-[17px]">‹ Back</button>
          {msgs.length > 2 && <button onClick={restart} className="tap text-pt-muted text-sm">New chat</button>}
        </div>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>AI helper</h1>
        {plan ? (
          <div className="flex gap-1.5 mt-1" aria-label="Plan my shoot steps">
            {STEPS.map(([k, t], n) => {
              const at = STEPS.findIndex(x => x[0] === plan.step), done = n < at, now = n === at
              return <span key={k} className="flex-1"><span className={`block h-1 rounded-full ${done || now ? 'bg-[#BF9DFF]' : 'bg-pt-border'}`} /><span className={`block text-xs mt-1 ${now ? 'text-pt-text font-semibold' : 'text-pt-muted'}`}>{done ? '✓ ' : ''}{t}</span></span>
            })}
          </div>
        ) : <p className="text-pt-muted text-[13px]">Ideas from our real props and gear, and times that are actually free.{shoot ? ` Checking free or taken for ${label(shoot)}.` : ''}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {msgs.map((m, i) => m.who === 'me' ? (
          <p key={i} className="rise-in ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent shadow-gold">{m.text}</p>
        ) : m.who === 'bot' ? (
          <div key={i} className="space-y-3">
            <p className="rise-in max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">{m.text}</p>
            {m.result && renderResult(m.result)}
            {m.alt && i === lastBot && !busy && !plan && (
              <button onClick={() => send(m.alt!.q, false, m.alt!.to)} className="tap text-[13px] text-[#CDB8FF] underline underline-offset-2">
                {m.alt.to === 'time' ? 'Meant a time to film? Find one' : 'Meant props for this? Find some'}</button>
            )}
          </div>
        ) : m.who === 'choose' ? (
          <div key={i} className="rise-in space-y-2">
            {choice('plan', '✦', 'Plan my shoot with me', 'Time, props and gear, step by step. You check it all at the end')}
          </div>
        ) : m.who === 'options' ? (
          <div key={i} className="rise-in space-y-2">
            {m.options.map(o => (
              <div key={`${o.date}-${o.place}-${o.start}`} className="flex items-center gap-3 rounded-[18px] bg-pt-surface border border-pt-accent/40 px-4 py-3">
                <span className="w-12 text-center shrink-0"><span className="block text-xs text-pt-muted">{formatDay(o.date, { weekday: 'short' })}</span><b className="block font-display text-[22px] leading-none font-extrabold">{Number(o.date.slice(8))}</b></span>
                <span className="flex-1 min-w-0">
                  <b className="block">{house(o.place)} · {fmtSlot(o.start, o.slots.length * s.slotMinutes)}</b>
                  <span className="block text-pt-muted text-[13px]">{o.slots.map(x => `${x.me ? 'You' : x.name.split(' ')[0]} ${fmtTime(x.start)}`).join(' · ')}</span>
                </span>
                <button disabled={busy} onClick={() => book(o)} className="shrink-0 rounded-xl px-4 py-2 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40">Book</button>
              </div>
            ))}
          </div>
        ) : m.who === 'shoots' ? (
          <div key={i} className="rise-in space-y-2">
            {[...upcoming].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 5).map(sh => (
              <button key={sh.id} disabled={plan?.step !== 'time'} onClick={() => planProps(sh.id)} className="w-full text-left rounded-[18px] bg-pt-surface border border-pt-accent/40 px-4 py-3 disabled:opacity-50">
                <b className="block text-[15px]">{label(sh)}</b>
                <span className="block text-xs text-pt-muted">Props by {formatDay(cutoffs(sh).props)} · Gear by {formatDay(cutoffs(sh).gear)}</span>
              </button>
            ))}
            <button disabled={plan?.step !== 'time'} onClick={planTime} className="w-full rounded-[18px] py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-50">Book a new time</button>
          </div>
        ) : m.who === 'gear' ? (
          <div key={i} className="rise-in space-y-2">
            <p className="text-pt-muted text-xs">{formatDay(w.date)} · {fmtHours(w.start, w.end)}. Change the hours on the next page if you need.</p>
            {bundles.filter(b => !b.archived).length === 0 && <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl p-4">No gear in the app yet. Skip this step.</p>}
            {bundles.filter(b => !b.archived).map(b => {
              const offered = b.kind === 'extra' ? (b.pieces[0]?.qty ?? 0) : 1
              const free = freeQty(offered, holds[b.id] ?? [], w.win.from, w.win.to)
              const qty = gearCart.lines[b.id] ?? 0
              const already = sentGearIds.includes(b.id)
              return (
                <div key={b.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                  <button onClick={() => go(`/gear/b/${b.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                    <GearArt photo={b.photos?.[0]} category={b.category} className="w-[52px] h-[52px] rounded-xl shrink-0" />
                    <span className="min-w-0"><b className="block text-sm truncate">{b.name}</b>
                      <span className={`block text-xs ${free > 0 ? 'text-green-400' : 'text-pt-muted'}`}>{free > 0 ? (b.kind === 'extra' ? `${free} free` : 'Free') : 'Taken then'} · {b.category}</span></span>
                  </button>
                  {already ? <span className="shrink-0 text-xs font-semibold rounded-full px-3 py-2 bg-pt-accent/15 text-pt-accent">On this shoot ✓</span>
                    : qty > 0
                    ? <button onClick={() => gearCart.setQty(b.id, 0)} aria-label={`Remove ${b.name}`} className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent text-stone-900">✓</button>
                    : <button disabled={free === 0} onClick={() => gearCart.setQty(b.id, 1)} aria-label={`Add ${b.name}`} className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-border text-pt-text text-xl disabled:opacity-30">+</button>}
                </div>
              )
            })}
          </div>
        ) : m.who === 'already' ? (
          (sent.props.length + sent.gear.length) === 0 ? null : (
            <div key={i} className="rise-in rounded-[18px] bg-pt-surface p-4 space-y-2">
              <p className="text-pt-muted text-xs font-semibold">Already on this shoot</p>
              {sent.props.map(r => <p key={r.id} className="text-sm"><span className="text-pt-accent">{r.status === 'requested' ? 'Requested' : 'In progress'}</span> · {[...r.lines.map(l => `${l.itemName}${l.qty > 1 ? ` ×${l.qty}` : ''}`), ...r.builds.map(b => b.description)].join(', ')}</p>)}
              {sent.gear.map(g => <p key={g.id} className="text-sm"><span className="text-pt-accent">Gear held</span> · {g.lines.map(l => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}`).join(', ')}</p>)}
              <p className="text-pt-muted text-xs">I won't suggest these again.</p>
            </div>
          )
        ) : m.who === 'review' ? (
          <div key={i} className="rise-in rounded-[18px] bg-pt-surface border border-pt-accent/40 p-4 space-y-3">
            <b className="block">{planLabel}</b>
            {(() => {
              const props = Object.entries(cart.lines).map(([id, q]) => `${itemById.get(id)?.name ?? 'Prop'}${q > 1 ? ` ×${q}` : ''}`)
              const builds = cart.builds.map(b => b.description)
              const gear = Object.entries(gearCart.lines).map(([id, q]) => `${bundles.find(b => b.id === id)?.name ?? 'Gear'}${q > 1 ? ` ×${q}` : ''}`)
              const row = (t: string, list: string[], empty: string) => (
                <div><p className="text-pt-muted text-xs font-semibold">{t} · {list.length}</p><p className="text-sm">{list.length ? list.join(', ') : empty}</p></div>
              )
              return <>{row('Props', props, 'None yet')}{builds.length > 0 && row('To make or find', builds, '')}{row('Gear', gear, 'None')}</>
            })()}
            {openRequest && (cart.count > 0) ? (<>
              <button onClick={() => go(`/reservations/${openRequest.id}`, { add: { lines: cart.lines, builds: cart.builds.map(b => ({ description: b.description, qty: b.qty, ...(b.refPhoto ? { refPhoto: b.refPhoto } : {}) })) } })}
                className="w-full rounded-xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add the props to my sent request ›</button>
              <p className="text-pt-muted text-xs -mt-1">Your request is still "Requested", so these join it. You check it and tap Save.{Object.keys(gearCart.lines).length ? ' Gear is sent on the Your shoot page.' : ''}</p>
              {Object.keys(gearCart.lines).length > 0 && <button onClick={() => go('/reserve', { title: planIdea() })} className="w-full rounded-xl py-3 font-semibold bg-pt-border">Send the gear ›</button>}
            </>) : (
              <button onClick={() => go('/reserve', { title: planIdea() })} className="w-full rounded-xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Review &amp; send ›</button>
            )}
            <div className="flex gap-2">
              <button onClick={() => plan?.shootId && planProps(plan.shootId, plan.label)} className="flex-1 rounded-xl py-3 text-sm font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ More props</button>
              <button onClick={planGear} className="flex-1 rounded-xl py-3 text-sm font-semibold bg-pt-border">Gear</button>
              <button onClick={() => go('/browse')} className="flex-1 rounded-xl py-3 text-sm font-semibold bg-pt-border">Browse all</button>
            </div>
          </div>
        ) : m.who === 'booked' ? (
          <div key={i} className="rise-in rounded-[18px] bg-pt-surface border border-pt-accent/40 p-4 space-y-2">
            <b className="block">{m.label}</b>
            <div className="flex items-center justify-between text-sm"><span>You</span><span className="rounded-full px-3 py-1 text-xs font-semibold bg-green-500/15 text-green-400">Booked ✓</span></div>
            {m.inviteIds.map(id => {
              const inv = invites.outgoing.find(x => x.id === id)
              if (!inv) return null
              const expired = inv.status === 'pending' && inv.until <= new Date().toISOString().slice(0, 16)
              const [txt, cls] = inv.status === 'accepted' ? ['Confirmed ✓', 'bg-green-500/15 text-green-400']
                : inv.status === 'pending' && !expired ? [`Held until ${fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))}`, 'bg-amber-400/15 text-amber-300']
                : ['Not confirmed', 'bg-pt-border text-pt-muted']
              return <div key={id} className="flex items-center justify-between text-sm"><span>{inv.toName} · {fmtTime(inv.start)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{txt}</span></div>
            })}
            {!plan && (sel.length > 0
              ? <button onClick={() => addTo(m.shootId, m.label)} className="w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold">Add the {sel.length} ticked to this shoot</button>
              : <button onClick={() => propsFor(m.shootId)} className="w-full rounded-xl py-3 font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ Find props for this shoot</button>)}
            {!plan && <button onClick={() => { choose(m.shootId); go('/browse') }} className="w-full rounded-xl py-3 font-semibold bg-pt-border">Browse props &amp; gear</button>}
          </div>
        ) : null)}
        {busy && <div role="status" aria-label="Thinking" className="rise-in flex items-center gap-3">
          <p className="w-fit flex items-center gap-1.5 rounded-[20px] rounded-bl-md px-4 py-4 bg-[#BF9DFF]/10"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></p>
          {thinking && <span className="text-pt-muted text-[13px]">{thinking === 'props' ? 'Looking through the props…' : 'Checking the schedule…'}</span>}
        </div>}
        {addedTo && <p className="text-pt-accent text-sm text-center">Added to {addedTo} ✓ <button onClick={() => go('/reserve')} className="tap underline">Review it</button></p>}
        <div ref={end} />
      </div>

      <div className="shrink-0 border-t border-pt-border px-5 pt-3 pb-safe bg-pt-bg">
        {sel.length > 0 && plan?.step === 'props' ? (
          <button onClick={planGear} className="w-full mb-3 rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} &amp; go to gear ›</button>
        ) : plan && plan.step !== 'time' && plan.step !== 'review' && sel.length === 0 ? null : sel.length > 0 ? (
          <button onClick={() => setPicking(true)} className="w-full mb-3 rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} to a shoot</button>
        ) : (cart.count + gearCart.count) > 0 && results.length > 0 ? (
          <button onClick={() => go('/reserve')} className="w-full mb-3 rounded-2xl py-3 font-semibold text-pt-accent bg-pt-accent/10">Review your shoot · {cart.count + gearCart.count}</button>
        ) : null}
        {chips.length > 0 && !busy && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
            {chips.map(c => {
              const special = c === MORE || c === TIME_CHIP || c === PROPS_CHIP || c === NEXT_GEAR || c === SKIP_PROPS || c === NEXT_REVIEW
              return <button key={c} onClick={() => chip(c)} className={`shrink-0 rounded-full px-3 py-2 text-[13px] ${special ? 'bg-[#BF9DFF]/20 text-[#CDB8FF] font-semibold' : 'bg-pt-border'}`}>{c === MORE ? '✦ More like these' : c === TIME_CHIP ? c : c === PROPS_CHIP ? c : c}</button>
            })}
          </div>
        )}
        <div className="flex items-center gap-2 pb-2">
          <label htmlFor="aiAsk" className="sr-only">Message</label>
          <input id="aiAsk" value={text} onChange={e => setText(e.target.value.slice(0, 600))} onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder={listening ? 'Listening…' : plan?.step === 'time' ? 'When do you want to film?' : plan?.step === 'props' ? 'What\'s your video about?' : 'Your video idea, or when to film…'}
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
          <button onClick={() => { setPicking(false); askTime() }} className="w-full rounded-2xl py-4 mt-2 font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">✦ Find a time here in the chat</button>
          <button onClick={newShoot} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">+ Book a new shoot for these</button>
          <p className="text-pt-muted text-xs text-center">Your picks wait while you book, then go into the new shoot.</p>
        </div>
      </BottomSheet>
    </div>
  )
}
