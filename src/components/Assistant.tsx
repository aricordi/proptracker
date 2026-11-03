// The one AI chat ("✦ AI" on every creator screen; owner, Oct 19). It does two jobs in one conversation:
// - PROP IDEAS: describe the video, keep going ("something for a séance"); real props and gear from the inventory,
//   grouped by scene, never repeated. Tick what you want, add it all to a shoot (or book a new one).
// - FIND A TIME: "4 hours with Kyle next week, evenings" → real free slots with a Book button. Booking with friends
//   books your slot and holds theirs for 20 minutes.
// - PLAN MY SHOOT (owner, Oct 19): walks through it in order: 1 time (book a new one or pick a booked shoot),
//   2 props (the ideas chat for that shoot), 3 gear (NOT AI: the list of gear free for the shoot's hours),
//   4 review = the normal "Your shoot" page already filled in, where the creator changes anything and sends it.
// PROPS ONLY (demo) creators (owner, Oct 28): the same chat, locked to prop ideas. No plan, no times, no ticks or
// "add to a shoot", no gear; each suggestion just opens the prop page. The server enforces the same (ideaToProps
// demo mode; every other helper refuses them), so nothing here can book anything even if the screen were changed.
// It stays in its box: each message goes to one of the two server helpers (ideaToProps / askForTime), which check
// the budget, treat the words as data only, and return fixed answers the server has checked. The AI can't book,
// read or change anything itself; every Book / Add button here is a normal tap by the person.
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import type { AssistantMode } from '../assistant'
import { routeMessage, cancelIntent, isStatusQuestion, detectIntent, findShoot, type Helper, type Route } from '../lib/aiRoute'
import { ReturnCard, ReportCard, PickupList } from './ChatNow'
import GuidelinePicker from './GuidelinePicker'
import { useReturnGroups, returnCount } from '../hooks/useReturnables'
import ChatNow from './ChatNow'
import BrandMark from './BrandMark'
type Step = 'time' | 'props' | 'gear' | 'review'
import BottomSheet from './BottomSheet'
import { GearArt, useGearWhen } from './GearUi'
import { useItems } from '../hooks/useItems'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import { useCart } from '../cart'
import { useGearCart } from '../gearCart'
import { useActiveShoot, useShootLabel, useCutoffs, useAddToShoot, savePendingAdds, useGearWindow, stampLabel } from '../activeShoot'
import { formatDay } from '../lib/dates'
import { ideaToProps, askApp, type IdeaResult, type AppAnswer } from '../services/ai'
import { subscribeToGearBundles, subscribeToGearHolds, freeQty, byCount, type GearBundle, type GearHold } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import {
  askForTime, bookWithFriends, useMyInvites, useMyStatus, useScheduleSettings, needsGuideline, type Guideline, fmtSlot, errorText, INVITE_HOLD_MINUTES, cancelShoot, isShortNotice, withinUndo,
  type TimeAskResult,
} from '../services/schedule'
import { freeForRange, todayInStudio } from '../../functions/src/booking'
import { fmtTime, fmtHours } from '../../functions/src/gearBooking'
import { Icon } from './Icon'
import { friendlyError } from '../lib/errors'

type Msg =
  | { who: 'me'; text: string; mode: Helper }
  | { who: 'bot'; text: string; result?: IdeaResult; alt?: { q: string; to: Helper }; retry?: string; search?: string; guide?: Omit<AppAnswer, 'answer'> }   // alt = "Meant a time instead?"; retry/search = ways out when it fails
  | { who: 'choose' }
  | { who: 'options'; options: TimeAskResult['options'] }
  | { who: 'booked'; inviteIds: string[]; shootId: string; label: string }
  | { who: 'shoots' }   // plan: pick one of your booked shoots or a new time
  | { who: 'gear' }     // plan: live list of gear free for the shoot
  | { who: 'review' }   // plan: what's in the shoot so far + Review & send
  | { who: 'already' }  // plan: what this shoot already has (sent requests), live
  | { who: 'cancel'; shootId?: string }   // chat: "cancel my thursday shoot" → confirm (or pick which)
  | { who: 'status' }   // chat: "is my shoot approved?" → your shoots with their status
  | { who: 'actions'; items: { label: string; to?: string; shootId?: string; ask?: string }[] }   // buttons that open the right screen
  | { who: 'return' } | { who: 'report'; text: string } | { who: 'pickup' }   // done right in the chat (Nov 3)

const STAFF_STARTERS: Record<string, string[]> = {
  arts: ['How do I pack a request?', 'How do I check props back in?', 'How do I do a bin check?'],
  equipment: ['How do I check gear back in?', 'How do I build a kit?', 'How do I block time on the schedule?'],
  admin: ['How do I give a strike?', 'What do the flags mean?', 'How do I invite a creator?'],
}
const MORE = 'More like these'
const TIME_CHIP = 'Find a time to film this'
const PROPS_CHIP = 'Props for this shoot'
const NEXT_GEAR = 'Next: gear ›'
const SKIP_PROPS = 'Skip props ›'
const NEXT_REVIEW = 'Next: review ›'
const STEPS: [Step, string][] = [['time', 'Time'], ['props', 'Props'], ['gear', 'Gear'], ['review', 'Review']]
const STARTERS: Record<Helper, string[]> = {
  props: ['Prank: I dress up as a cop and pull my friend over at a diner', 'A séance that goes wrong', '90s sitcom kitchen', 'Royal wedding parody'],
  time: ['Thursday at Cliff 1 at 5pm', "I'm filming with a friend this week", 'Earliest free slot at Cliff 2'],
  help: ['How do I return my gear?', 'Where do I see my requests?', 'How do I change a request?'],
}
const OPENERS: Record<Helper, string> = {
  props: 'What\'s the video? Tell me the idea and I\'ll build a prop list from what we have. Then keep going: "something for a séance", "make it funnier", "props for the ending"…',
  time: 'When do you want to film, for how long, and with who? Type it, or tap the mic and just say it.',
  help: 'Ask me how to do anything in the app.',
}
// No "props or time" switch (owner, Oct 20): src/lib/aiRoute.ts reads each message and runs one helper or both.
const GREETING = 'Tell me your video idea, or when you want to film, or both. I\'ll find the props we have and the times that are free. Stuck somewhere? Ask me how anything in the app works.'
// The chat tab (owner, Nov 2): say it like you'd say it on Slack.
const CHAT_GREETING = 'Just tell me what you need, like you\'d text it: "Thursday Cliff 1 at 5pm", "props for a séance video", "cancel my next shoot". Tap an example below to start.'
const DEMO_OPENER = 'Tell me your video idea and I\'ll find props from our closet that fit, scene by scene. Then keep going: "make it spookier", "something for the ending"… Tap any prop to see it. You can also ask me how the app works.'
const DEMO_NO_TIME = 'Booking isn\'t open for you yet, so I can\'t look at times. Tell me about the video and I\'ll find props for it.'
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const propsErr = (e: unknown) => friendlyError(e, "The AI helper didn't answer. Try again.")
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

export default function Assistant({ shown, ask, onClose, page = false }: { shown: boolean; ask: { mode?: AssistantMode; shootId?: string; text?: string; n: number }; onClose: () => void; page?: boolean }) {
  const navigate = useNavigate()
  const { profile, user, demo, canBook, role } = useSession()
  // Staff who don't book (arts, equipment, admins): the chat only explains how the app works.
  const helpOnly = !canBook && !demo
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
  const returns = useReturnGroups(profile.email)
  const myStatus = useMyStatus(profile.email)
  const gw = useGearWindow()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const house = (p: string) => p === 'cliff2' ? s.houses.cliff2.name : s.houses.cliff1.name
  // Creators ask for times (the schedule team approves); the owner and people on "Books without approval" book straight away.
  const asks = role !== 'owner' && !s.instantBookers.some(p => p.email === profile.email)

  const hello = `Hi${first ? ` ${first}` : ''}!`
  const helper = ask.mode === 'plan' ? undefined : ask.mode
  const fresh = (m?: Helper): Msg[] => helpOnly ? [{ who: 'bot', text: `${hello} Ask me how to do anything in the app, and I'll show you where.` }] : demo ? [{ who: 'bot', text: `${hello} ${DEMO_OPENER}` }]
    : m ? [{ who: 'bot', text: `${hello} ${OPENERS[m]}` }] : [{ who: 'bot', text: `${hello} ${page ? CHAT_GREETING : GREETING}` }, { who: 'choose' }]
  // Examples of both kinds, plus your next booked shoot when you have one.
  // Chat first (owner, Nov 2: "clickable pre-populated prompts"): the things people actually say, booking first.
  const mixed = () => [
    `Book ${WEEKDAY[(new Date(today + 'T12:00:00').getDay() + 2) % 7]} at ${s.houses.cliff1.name} at 5pm`,
    'Find me 2 hours this week with a friend',
    ...(upcoming[0] ? [`Props for my ${WEEKDAY[new Date(upcoming[0].date + 'T12:00:00').getDay()]} shoot`] : [STARTERS.props[1]]),
    'Is my shoot approved?',
    ...(upcoming[0] ? ['Cancel my next shoot'] : []),
    STARTERS.help[0],
  ]
  // `mode` = what the chat was last doing, so short follow-ups ("anything earlier?") keep going.
  const [mode, setMode] = useState<Helper | null>(helpOnly ? 'help' : demo ? 'props' : helper ?? null)
  const [msgs, setMsgs] = useState<Msg[]>(() => fresh(helper))
  const demoChips = helpOnly ? (STAFF_STARTERS[role] ?? STARTERS.help) : [...STARTERS.props.slice(0, 3), 'How do I search the props?']
  const [chips, setChips] = useState<string[]>(() => demo || helpOnly ? demoChips : helper ? STARTERS[helper] : mixed())
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
  const [heard, setHeard] = useState(''), [micErr, setMicErr] = useState('')
  const stopped = useRef(false), quiet = useRef<ReturnType<typeof setTimeout>>()
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
    else if (ask.text) { setPlan(null); send(ask.text, false, ask.mode) }
    else if (ask.mode && ask.mode !== mode) { setPlan(null); switchTo(ask.mode) }
  }, [ask.n])
  const started = useRef(false)
  useEffect(() => {   // opened straight into planning (once, even if React starts effects twice)
    if (started.current || ask.mode !== 'plan') return
    started.current = true
    if (ask.shootId) planProps(ask.shootId); else startPlan()
  }, [])
  const restart = () => { setMode(helpOnly ? 'help' : demo ? 'props' : null); setPlan(null); setMsgs(fresh()); setChips(demo || helpOnly ? demoChips : mixed()); setPrevious(undefined); setSel([]); setAddedTo(''); setText('') }

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
    if (listening) stopTalk()   // Send while talking = done talking
    const q = t.trim(); if (!q || busy) return
    // Which helper(s): a forced one ("Meant a time instead?"), the plan's current step, or read from the words.
    // Props only: the words never reach the time finder (the server would refuse anyway).
    if (demo && !helpOnly && !force && !more) {
      const r = routeMessage(q, { last: 'props', shoots: [] })
      if (!r.helpers.includes('props') && !r.helpers.includes('help')) {
        setText(''); setMsgs(x => [...x, { who: 'me', text: q, mode: 'props' }, { who: 'bot', text: DEMO_NO_TIME }]); setChips(STARTERS.props); return
      }
    }
    // Done right here, no AI (owner, Nov 3: "flexible enough to understand nuance and guide people in the right direction").
    if (!force && !more && !plan) {
      const intent = detectIntent(q)
      const say = (reply: string, extra: Msg[] = [], chips: string[] = []) => {
        setText(''); setChips(chips)
        setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: 'help' }, { who: 'bot', text: reply }, ...extra])
      }
      if (intent === 'greeting') { say(`Hey${first ? ` ${first}` : ''}! What do you need? A time to film, props, gear, or a question.`, [], helpOnly ? (STAFF_STARTERS[role] ?? []) : demo ? STARTERS.props.slice(0, 3) : mixed().slice(0, 4)); return }
      if (intent === 'thanks') { say('Anytime. I\'m here if you need anything else.'); return }
      if (!demo && !helpOnly && intent) {
        const sorted = [...upcoming].sort((a, b) => a.from.localeCompare(b.from))
        const named = sorted.find(x => x.id === findShoot(`${q} my shoot`, sorted.map(y => ({ id: y.id, date: y.date })))) ?? sorted[0]
        const out = (returns ?? []).length > 0
        if (intent === 'return') {
          if (!out) { say('Nothing to bring back right now: everything on your name is already returned.'); return }
          say('Let\'s do it. A few taps and one photo.', [{ who: 'return' }]); return
        }
        if (intent === 'report') {
          if (!out) { say('I don\'t see any gear or props out on your name right now. If something in the house or the gear room is broken, tell the equipment team (Maanik) so it\'s fixed before the next shoot.'); return }
          say('Thanks for flagging it. Pick the piece and say what happened; the team gets it right away.', [{ who: 'report', text: q }]); return
        }
        if (intent === 'pickup') { say('Here\'s where your props are.', [{ who: 'pickup' }]); return }
        if (intent === 'take-gear') {
          const live = sorted.filter(x => x.status === 'booked')
          const now0 = live.find(x => gw(x).state === 'take'), soon = live.find(x => gw(x).state === 'reserve'), later = live.find(x => gw(x).state === 'early')
          if (now0) { say(`Your shoot is on (${label(now0)}). Pick what you're taking, then tick every piece and take one photo.`, [{ who: 'actions', items: [{ label: 'Pick the gear', to: '/gear', shootId: now0.id }] }]); return }
          if (soon) { say(`You can reserve gear now for ${label(soon)}. Or just take what's free on the day, from an hour before.`, [{ who: 'actions', items: [{ label: 'Reserve gear', to: '/gear', shootId: soon.id }] }]); return }
          if (later) { say(`For ${label(later)}: you can reserve gear from ${stampLabel(gw(later).opens)}, or take what's free from an hour before your shoot. Nothing to do yet.`); return }
          say('Gear goes with a shoot. Book a time first, then take what you need on the day.', [], ['Find me a time today', 'Earliest free slot']); return
        }
        if (intent === 'move' || intent === 'swap') {
          if (!named) { say('You don\'t have any shoots coming up to change. Want to book one?', [], mixed().slice(0, 2)); return }
          const free = named.status === 'requested' ? 'It\'s still a request, so you can move it freely.' : `Moving is free with ${s.noticeHours} hours' notice; closer than that, a swap with someone is the only way without a strike.`
          say(intent === 'swap' ? `Your shoot: ${label(named)}. Open it and tap "Swap with someone" to ask another creator to trade.` : `Your shoot: ${label(named)}. ${free}`,
            [{ who: 'actions', items: [{ label: intent === 'swap' ? 'Swap it' : 'Move it', to: `/schedule?shoot=${named.id}` }, ...(intent === 'move' ? [{ label: 'Shoot offsite instead', to: `/schedule?offsite=${named.date}` }] : [])] }]); return
        }
        if (intent === 'offsite') { say('Shooting somewhere else? Pick the day, the hours and the address. It still goes to the schedule team.', [{ who: 'actions', items: [{ label: 'Book an offsite shoot', to: `/schedule?offsite=${today}` }] }]); return }
        if (intent === 'strikes') {
          const paused = !!myStatus?.pausedUntil && myStatus.pausedUntil > today
          say(paused ? `Prop requests are paused until ${myStatus!.pausedUntil}. You can still book filming time and take gear. Ask the schedule team if this looks wrong.`
            : myStatus?.strikes ? `You have ${myStatus.strikes} strike${myStatus.strikes === 1 ? '' : 's'} in the last ${s.strikeDays} days. ${s.strikeCount} in that time pauses prop requests for ${s.pauseDays} days.`
            : 'No strikes. You\'re all good.'); return
        }
        if (intent === 'requests') { say('Everything you asked for, by shoot, with where each one is.', [{ who: 'actions', items: [{ label: 'My requests', to: '/requests' }] }]); return }
      }
    }
    // Done right here, no AI: cancelling a shoot, and "is my shoot approved?" (owner, Nov 2: type it, it gets done).
    if (!demo && !helpOnly && !force && !more && !plan) {
      const sorted = [...upcoming].sort((a, b) => a.from.localeCompare(b.from))
      const c = cancelIntent(q, sorted.map(x => ({ id: x.id, date: x.date })))
      if (c) {
        setText(''); setChips([])
        setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: 'time' },
          ...(sorted.length ? [{ who: 'bot' as const, text: c.shootId ? 'Cancel this one?' : 'Which shoot do you want to cancel?' }, { who: 'cancel' as const, shootId: c.shootId }]
            : [{ who: 'bot' as const, text: 'You don\'t have any shoots coming up.' }])])
        return
      }
      if (isStatusQuestion(q)) {
        setText(''); setChips(mixed().slice(0, 3))
        setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: 'time' },
          ...(upcoming.length ? [{ who: 'bot' as const, text: 'Here are your shoots coming up.' }, { who: 'status' as const }]
            : [{ who: 'bot' as const, text: 'Nothing booked yet. Tell me when you want to film.' }])])
        return
      }
    }
    const route: Route = helpOnly ? { helpers: ['help'] } : demo ? (routeMessage(q, { last: mode, shoots: [] }).helpers[0] === 'help' && !more ? { helpers: ['help'] } : { helpers: ['props'] }) : force ? { helpers: [force] } : more || plan?.step === 'props' ? { helpers: ['props'] }
      : plan?.step === 'time' ? { helpers: ['time'] }
      : routeMessage(q, { last: mode, shoots: upcoming.map(x => ({ id: x.id, date: x.date })) })
    const hs = route.helpers, both = hs.length > 1
    const target = demo ? undefined : route.shootId ?? shoot?.id
    const named = route.shootId && route.shootId !== shoot?.id ? upcoming.find(x => x.id === route.shootId) : undefined
    if (route.shootId) choose(route.shootId)
    // Offer "Meant … instead?" only when the chat just picked a direction (not on every follow-up).
    const offer = !demo && !both && !force && !plan && !more && mode !== hs[0]
    setMode(hs[hs.length - 1])
    setText(''); setChips([]); setBusy(true)
    setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: hs[0] },
      ...(named ? [{ who: 'bot' as const, text: `For your shoot (${label(named)}). I'll check what's free that day.` }] : [])])
    const next: string[][] = []
    for (const h of hs) {
      setThinking(h)
      next.push(h === 'props' ? await sendProps(q, more, target, offer) : h === 'help' ? await sendHelp(q) : await sendTime(q, offer))
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
        ...(shootId && !demo ? { shootId } : {}),
      })).data
      const kept = { ...r, groups: r.groups.map(g => ({ ...g, picks: g.picks.filter(p => !shownIds.includes(p.id) && (p.kind === 'prop' ? itemById.has(p.id) : !demo)) })).filter(g => g.picks.length) }
      const found = kept.groups.length + kept.missing.length > 0
      // Nothing (new) found: offer a plain search for the same words, so the chat is never a dead end.
      setMsgs(x => [...x, { who: 'bot', text: r.note || r.reply || (found ? 'Here\'s what we have for that.' : 'Nothing new fits that. Try another angle, or search the closet.'),
        ...(found ? { result: kept } : r.note ? {} : { search: q }), ...(offerOther && !more ? { alt: { q, to: 'time' as const } } : {}) }])
      const next = [...(plan?.step === 'props' ? [NEXT_GEAR] : []), ...(found ? [MORE] : []), ...(r.chips ?? []).filter(c => !/^more like these$/i.test(c.trim())), ...(found && !shootId && !plan && !demo ? [TIME_CHIP] : [])]
      return [...new Set(next)].slice(0, 5)
    } catch (e) {
      // Busy, offline, today's limit: say so plainly, and offer to try again or search the closet instead.
      const limit = /resource-exhausted/.test(String((e as { code?: string })?.code ?? ''))
      setMsgs(x => [...x, { who: 'bot', text: propsErr(e), search: q, ...(limit ? {} : { retry: q }) }]); return []
    }
  }

  // "How do I…?": the server answers from the app guide for this person's role only, with buttons to real screens.
  async function sendHelp(q: string): Promise<string[]> {
    const history = msgs.flatMap(x => x.who === 'me' && x.mode === 'help' ? [x.text] : [])
    try {
      const r = (await askApp({ question: q, history })).data
      setMsgs(x => [...x, { who: 'bot', text: r.answer, guide: { steps: r.steps, links: r.links } }])
      return helpOnly ? [] : demo ? [STARTERS.props[0], 'How do I search the props?'] : [STARTERS.props[0], 'Find me 2 hours this week']
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: propsErr(e), retry: q }]); return [] }
  }

  async function sendTime(q: string, offerOther: boolean): Promise<string[]> {
    try {
      const r = (await askForTime({ text: q, ...(previous ? { previous } : {}) })).data
      setPrevious(r.ask)
      setMsgs(x => [...x, { who: 'bot', text: r.reply, ...(offerOther ? { alt: { q, to: 'props' as const } } : {}) }, ...(r.options.length ? [{ who: 'options' as const, options: r.options }] : [])])
      // Follow-ups that change something (never "Evenings only" when it already is).
      const a = r.ask as { timeOfDay?: string; houses?: string[] }
      const one = (h: string) => a.houses?.length === 1 && a.houses[0] === h
      const next = r.friends.length ? ['Anything on the weekend?', one('cliff2') ? '' : `Only ${s.houses.cliff2.name}`, 'Just me, 2 hours']
        : ['Anything earlier?', a.timeOfDay === 'evening' ? 'Mornings instead' : 'Evenings only', one('cliff1') ? `Only ${s.houses.cliff2.name}` : `Only ${s.houses.cliff1.name}`]
      return next.filter(Boolean)
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: errorText(e) }]); return [] }
  }

  // Cliff 1 Thursdays/Saturdays need the filming guideline (owner, Nov 3): the option asks for the PDF first.
  const [guideFor, setGuideFor] = useState<string | null>(null)
  const [guide, setGuide] = useState<Guideline | null>(null)
  const optKey = (o: TimeAskResult['options'][number]) => `${o.date}-${o.place}-${o.start}`
  async function book(o: TimeAskResult['options'][number]) {
    if (needsGuideline(o.date, o.place, profile.email, s) && !(guide && guideFor === optKey(o))) { setGuideFor(optKey(o)); return }
    setBusy(true)
    try {
      const friends = o.slots.filter(x => !x.me).map(x => x.email)
      const r = (await bookWithFriends({ place: o.place, date: o.date, start: o.start, friends, mySlots: o.slots.filter(x => x.me).length, ...(guide && guideFor === optKey(o) ? { guideline: guide } : {}) })).data
      const where = `${formatDay(o.date)} · ${house(o.place)} · ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}`
      // Every creator booking is a request the schedule team approves (owner, Nov 2); the slot is held meanwhile.
      const asked = r.status === 'requested'
      const mine = asked ? 'Requested ✓ It\'s held for you while the schedule team looks at it; you\'ll get a notification when it\'s approved.' : 'Booked ✓'
      setMsgs(x => [...x,
        { who: 'bot', text: friends.length ? `${mine} I've invited ${o.slots.filter(y => !y.me).map(y => y.name.split(' ')[0]).join(' and ')}: ${friends.length > 1 ? 'their slots are' : 'their slot is'} held for ${INVITE_HOLD_MINUTES} minutes for them to confirm.` : mine },
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

  // Talking (owner, Oct 20: it got stuck on "Listening"): the words show as they're heard, in the box and above it.
  // Stop (or 6 s of quiet) ends it and keeps the words to edit; Send ends it and sends. Never sends on its own.
  function stopTalk() {
    stopped.current = true; clearTimeout(quiet.current)
    const r = rec.current; rec.current = null; setListening(false)
    try { r?.stop() } catch { /* already stopped */ }
    setTimeout(() => { try { r?.abort() } catch { /* gone */ } }, 700)   // iPhone sometimes ignores stop()
  }
  function talk() {
    if (!Speech) return
    if (listening) { stopTalk(); return }
    const r = new Speech()
    r.lang = 'en-CA'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1
    const before = text.trim() ? `${text.trim()} ` : ''
    stopped.current = false
    r.onresult = (e: any) => {
      if (stopped.current) return
      const said = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join('').trimStart()
      setHeard(said); setText((before + said).slice(0, 600))
      clearTimeout(quiet.current); quiet.current = setTimeout(stopTalk, 6000)
    }
    r.onend = () => { if (rec.current === r) { rec.current = null; setListening(false) } }
    r.onerror = (e: any) => {
      if (rec.current === r) { rec.current = null; setListening(false) }
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') setMicErr('The microphone is blocked for this app. Allow it in your phone settings, or just type.')
    }
    rec.current = r; setHeard(''); setMicErr(''); setListening(true)
    try { r.start() } catch { rec.current = null; setListening(false) }
    quiet.current = setTimeout(stopTalk, 8000)
  }
  useEffect(() => () => stopTalk(), [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!shown && rec.current) stopTalk() }, [shown])   // eslint-disable-line react-hooks/exhaustive-deps

  // Tick suggestions, then add them all to one of your shoots or a new one.
  // Keys: 'p:<prop id>', 'g:<gear id>', 'b:<thing to make or find>'.
  const [sel, setSel] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [addedTo, setAddedTo] = useState('')
  const toggle = (k: string) => { setAddedTo(''); setSel(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k]) }
  const picks = () => ({ props: sel.filter(k => k.startsWith('p:')).map(k => k.slice(2)), gear: sel.filter(k => k.startsWith('g:')).map(k => k.slice(2)), builds: sel.filter(k => k.startsWith('b:')).map(k => k.slice(2)) })
  const go = (to: string, state?: unknown) => { if (!page) onClose(); navigate(to, state ? { state } : undefined) }
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
  const tick = (k: string, name: string, inBasket: boolean) => demo
    ? <button onClick={() => go(`/item/${k.slice(2)}`)} aria-label={`See ${name}`} className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-pt-border text-pt-text text-xl">›</button>
    : inBasket && !sel.includes(k)
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
                      <span className="block text-xs text-pt-muted">{demo ? `${it.quantity > 1 ? `We have ${it.quantity} · ` : ''}See it ›` : free === null ? 'Check it ›' : free > 0 ? 'Free · check it ›' : 'Taken that day · check it ›'}</span></span>
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
          <p className="text-pt-muted text-xs font-semibold">{demo ? 'Not in the closet yet' : 'We don\'t have it'}</p>
          {result.missing.map(m => {
            const k = `b:${m.name}`, asked = cart.builds.some(b => b.description === m.name)
            return (
              <div key={m.name} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-2xl bg-violet-500/10 shrink-0"><Icon name="tools" className="w-6 h-6 text-violet-300" /></span>
                <span className="flex-1 min-w-0"><b className="block text-sm">{m.name}</b><span className="block text-xs text-[#CDB8FF]">{demo ? (m.why || 'Not in the closet yet') : m.why || 'The arts team can make or find it'}</span></span>
                {demo ? null : asked && !sel.includes(k) ? <span className="shrink-0 text-xs font-semibold rounded-full px-3 py-2 bg-violet-500/20 text-violet-200 opacity-60">Asked ✓</span>
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
    <div className={page ? 'h-full bg-pt-bg flex flex-col' : `fixed inset-0 z-50 bg-pt-bg flex flex-col ${shown ? '' : 'hidden'}`} role={page ? 'main' : 'dialog'} aria-label={page ? 'Chat' : 'AI helper'}>
      <div className="pt-safe px-5 shrink-0">
        {page ? (
          <div className="flex items-center gap-2 py-2">
            <BrandMark className="w-7 h-7 text-white" title="" />
            <h1 className="font-display text-[28px] font-extrabold tracking-tight flex-1">Chat</h1>
            {msgs.length > 2 && <button onClick={restart} className="tap text-pt-muted text-sm">New chat</button>}
          </div>
        ) : <>
        <div className="flex items-center justify-between py-3">
          <button onClick={onClose} className="text-pt-accent text-[17px]">‹ Back</button>
          {msgs.length > 2 && <button onClick={restart} className="tap text-pt-muted text-sm">New chat</button>}
        </div>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>AI helper</h1>
        </>}
        {plan ? (
          <div className="flex gap-1.5 mt-1" aria-label="Plan my shoot steps">
            {STEPS.map(([k, t], n) => {
              const at = STEPS.findIndex(x => x[0] === plan.step), done = n < at, now = n === at
              return <span key={k} className="flex-1"><span className={`block h-1 rounded-full ${done || now ? 'bg-[#BF9DFF]' : 'bg-pt-border'}`} /><span className={`block text-xs mt-1 ${now ? 'text-pt-text font-semibold' : 'text-pt-muted'}`}>{done ? '✓ ' : ''}{t}</span></span>
            })}
          </div>
        ) : page ? null : <p className="text-pt-muted text-[13px]">{helpOnly ? 'Ask how anything in the app works.' : demo ? 'Prop ideas for your videos, from our real closet.' : <>Ideas from our real props and gear, and times that are actually free.{shoot ? ` Checking free or taken for ${label(shoot)}.` : ''}</>}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {page && canBook && !demo && <ChatNow onAsk={q => send(q, false, 'time')} onProps={id => propsFor(id)} />}
        {msgs.map((m, i) => m.who === 'me' ? (
          <p key={i} className="rise-in ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent shadow-gold">{m.text}</p>
        ) : m.who === 'bot' ? (
          <div key={i} className="space-y-3">
            <p className="rise-in max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">{m.text}</p>
            {m.result?.fallback && <p className="text-pt-muted text-xs">Quick match: the AI was busy, so these are the closest props by name and tags.</p>}
            {m.guide && (m.guide.steps.length > 0 || m.guide.links.length > 0) && (
              <div className="rise-in space-y-2">
                {m.guide.steps.length > 0 && <ol className="max-w-[86%] list-decimal pl-9 space-y-1 text-[15px]">{m.guide.steps.map((st, k) => <li key={k}>{st}</li>)}</ol>}
                {m.guide.links.length > 0 && <div className="flex flex-wrap gap-2">{m.guide.links.map(l => (
                  <button key={l.path} onClick={() => go(l.path)} className="rounded-full px-4 min-h-[44px] text-[13px] font-semibold bg-pt-accent/15 text-pt-accent">Open {l.label} ›</button>))}</div>}
              </div>
            )}
            {m.result && renderResult(m.result)}
            {(m.retry || m.search) && i === lastBot && !busy && (
              <div className="flex flex-wrap gap-2">
                {m.retry && <button onClick={() => send(m.retry!)} className="rounded-full px-4 min-h-[44px] text-[13px] font-semibold bg-[#BF9DFF]/20 text-[#CDB8FF]">Try again</button>}
                {m.search && <button onClick={() => go(`/browse?q=${encodeURIComponent(m.search!.slice(0, 80))}`)} className="rounded-full px-4 min-h-[44px] text-[13px] font-semibold bg-pt-border">Search the closet for "{m.search.length > 24 ? `${m.search.slice(0, 24)}…` : m.search}"</button>}
              </div>
            )}
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
                <button disabled={busy} onClick={() => book(o)} className="shrink-0 rounded-xl px-4 py-2 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40">{asks ? 'Request' : 'Book'}</button>
              </div>
            ))}
            {guideFor && m.options.some(o => optKey(o) === guideFor) && (() => { const o = m.options.find(x => optKey(x) === guideFor)!; return (
              <div className="space-y-2"><GuidelinePicker value={guide} onChange={setGuide} />
                {guide && <button disabled={busy} onClick={() => book(o)} className="w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40">{asks ? 'Request' : 'Book'} {formatDay(o.date, { weekday: 'short' })} · {fmtSlot(o.start, o.slots.length * s.slotMinutes)}</button>}
              </div>) })()}
          </div>
        ) : m.who === 'shoots' ? (
          <div key={i} className="rise-in space-y-2">
            {[...upcoming].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 5).map(sh => (
              <button key={sh.id} disabled={plan?.step !== 'time'} onClick={() => planProps(sh.id)} className="w-full text-left rounded-[18px] bg-pt-surface border border-pt-accent/40 px-4 py-3 disabled:opacity-50">
                <b className="block text-[15px]">{label(sh)}</b>
                <span className="block text-xs text-pt-muted">Props by {formatDay(cutoffs(sh).props)} · Gear on the day</span>
              </button>
            ))}
            <button disabled={plan?.step !== 'time'} onClick={planTime} className="w-full rounded-[18px] py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-50">Book a new time</button>
          </div>
        ) : m.who === 'gear' ? (
          <div key={i} className="rise-in space-y-2">
            <p className="text-pt-muted text-xs">{formatDay(w.date)} · {fmtHours(w.start, w.end)}. Change the hours on the next page if you need.</p>
            {bundles.filter(b => !b.archived).length === 0 && <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl p-4">No gear in the app yet. Skip this step.</p>}
            {bundles.filter(b => !b.archived).map(b => {
              const offered = byCount(b.kind) ? (b.pieces[0]?.qty ?? 0) : 1
              const free = freeQty(offered, holds[b.id] ?? [], w.win.from, w.win.to)
              const qty = gearCart.lines[b.id] ?? 0
              const already = sentGearIds.includes(b.id)
              return (
                <div key={b.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                  <button onClick={() => go(`/gear/b/${b.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                    <GearArt photo={b.photos?.[0]} category={b.category} className="w-[52px] h-[52px] rounded-xl shrink-0" />
                    <span className="min-w-0"><b className="block text-sm truncate">{b.name}</b>
                      <span className={`block text-xs ${free > 0 ? 'text-green-400' : 'text-pt-muted'}`}>{free > 0 ? (byCount(b.kind) ? `${free} free` : 'Free') : 'Taken then'} · {b.category}</span></span>
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
        ) : m.who === 'actions' ? (
          <div key={i} className="rise-in flex flex-wrap gap-2">{m.items.map((a, k) => (
            <button key={a.label} onClick={() => { if (a.shootId) choose(a.shootId); if (a.ask) send(a.ask); else if (a.to) go(a.to) }}
              className={`rounded-xl px-4 min-h-[44px] font-semibold ${k === 0 ? 'bg-pt-accent text-stone-900' : 'bg-pt-border text-pt-text'}`}>{a.label}</button>))}
          </div>
        ) : m.who === 'return' ? (
          returns && returns.length ? <ReturnCard key={i} groups={returns} count={returns.reduce((n, g) => n + returnCount(g), 0)} label={label} /> : null
        ) : m.who === 'report' ? (
          returns && returns.length ? <ReportCard key={i} groups={returns} first={m.text} /> : null
        ) : m.who === 'pickup' ? (
          <PickupList key={i} />
        ) : m.who === 'cancel' ? (
          <CancelCard key={i} shootId={m.shootId} shoots={[...upcoming].sort((a, b) => a.from.localeCompare(b.from))} label={label} />
        ) : m.who === 'status' ? (
          <div key={i} className="rise-in space-y-2">
            {[...upcoming].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 5).map(sh => (
              <button key={sh.id} onClick={() => go(`/schedule?shoot=${sh.id}`)} className="w-full flex items-center gap-3 text-left rounded-[18px] bg-pt-surface px-4 py-3">
                <b className="flex-1 min-w-0 text-[15px]">{label(sh)}</b>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${sh.status === 'requested' ? 'bg-amber-400/15 text-amber-300' : 'bg-green-500/15 text-green-400'}`}>{sh.status === 'requested' ? 'Waiting for OK' : sh.moveRequest ? 'Move asked' : 'Approved ✓'}</span>
              </button>
            ))}
          </div>
        ) : m.who === 'booked' ? (
          <div key={i} className="rise-in rounded-[18px] bg-pt-surface border border-pt-accent/40 p-4 space-y-2">
            <b className="block">{m.label}</b>
            <BookedYou shootId={m.shootId} />
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
          {thinking && <span className="text-pt-muted text-[13px]">{thinking === 'props' ? 'Looking through the props…' : thinking === 'help' ? 'Looking at how the app works…' : 'Checking the schedule…'}</span>}
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
        {listening && (
          <div className="mb-2 flex items-start gap-3 rounded-2xl bg-[#BF9DFF]/10 px-4 py-3 shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.4)]" aria-live="polite">
            <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden />
            <p className={`flex-1 min-w-0 text-[15px] ${heard ? 'text-pt-text' : 'text-[#CDB8FF]'}`}>{heard || 'Listening… just say it.'}</p>
            <button onClick={stopTalk} className="shrink-0 text-[#CDB8FF] text-sm font-semibold tap">Stop</button>
          </div>
        )}
        {micErr && <p className="mb-2 text-amber-300 text-xs">{micErr}</p>}
        <div className="flex items-center gap-2 pb-2">
          <label htmlFor="aiAsk" className="sr-only">Message</label>
          <input id="aiAsk" value={text} onChange={e => setText(e.target.value.slice(0, 600))} onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder={listening ? 'Listening…' : helpOnly ? 'How do I…?' : demo ? 'Describe your video idea…' : plan?.step === 'time' ? 'When do you want to film?' : plan?.step === 'props' ? 'What\'s your video about?' : 'Your video idea, or when to film…'}
            className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
          {Speech && (
            <button onClick={talk} aria-label={listening ? 'Stop listening' : 'Talk'}
              className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${listening ? 'bg-red-500 text-white' : 'bg-[#BF9DFF]/20 text-[#BF9DFF]'}`}>
              {listening
                ? <span className="w-4 h-4 rounded-[3px] bg-white" aria-hidden />
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
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
                <span className={`block text-xs ${warn.length ? 'text-red-300' : 'text-pt-muted'}`}>{warn.length ? `Too late for ${warn.join(' and ')}` : `Props by ${formatDay(c.props)} · Gear on the day`}</span>
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

// "Cancel my Thursday shoot" in the chat: confirm (or pick which), with the same rules as the shoot page:
// withdrawing a request is free, cancelling inside the notice period counts as a no-show (after the undo minutes).
function CancelCard({ shootId, shoots, label }: { shootId?: string; shoots: import('../services/schedule').Shoot[]; label: (x: import('../services/schedule').Shoot) => string }) {
  const s = useScheduleSettings()
  const [pick, setPick] = useState<string | undefined>(shootId)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')
  const sh = shoots.find(x => x.id === pick)
  if (done) return <p className="rise-in text-green-400 text-[15px] font-semibold">{done}</p>
  if (!sh) return (
    <div className="rise-in space-y-2">
      {shoots.slice(0, 5).map(x => <button key={x.id} onClick={() => setPick(x.id)} className="w-full text-left rounded-[18px] bg-pt-surface px-4 py-3 text-[15px] font-semibold">{label(x)}</button>)}
    </div>
  )
  const nowS = new Date().toLocaleString('sv-SE', { timeZone: 'America/Toronto' }).slice(0, 16).replace(' ', 'T')
  const strike = sh.status === 'booked' && isShortNotice(sh.from, nowS, s) && !withinUndo(sh.createdAt)
  async function go() {
    setBusy(true); setErr('')
    try {
      await cancelShoot({ id: sh!.id, ...(strike ? { confirmNoShow: true } : {}) })
      setDone(sh!.status === 'requested' ? 'Request withdrawn ✓ The time is free again.' : 'Cancelled ✓ Props and gear on it were cancelled too.')
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rise-in rounded-[18px] bg-pt-surface p-4 space-y-3">
      <b className="block text-[15px]">{label(sh)}</b>
      <p className={`text-[13px] ${strike ? 'text-red-300' : 'text-pt-muted'}`}>{sh.status === 'requested' ? 'It\'s still a request, so withdrawing it is free.'
        : strike ? `It's less than ${s.noticeHours} hours away, so cancelling now counts as a no-show (a strike). A swap with someone avoids that.` : 'Cancelling now is free. Props and gear on this shoot are cancelled too.'}</p>
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={go} className={`flex-1 rounded-xl py-3 font-bold disabled:opacity-40 ${strike ? 'bg-red-500/20 text-red-200' : 'bg-pt-accent text-stone-900'}`}>{busy ? 'Cancelling…' : sh.status === 'requested' ? 'Withdraw it' : strike ? 'Cancel anyway' : 'Yes, cancel it'}</button>
        <button disabled={busy} onClick={() => setDone('Kept ✓')} className="rounded-xl px-4 font-semibold bg-pt-border">Keep it</button>
      </div>
    </div>
  )
}

// Your own slot after booking in the chat: live, so it changes from "Waiting for OK" to "Approved ✓".
function BookedYou({ shootId }: { shootId: string }) {
  const { upcoming } = useActiveShoot()
  const sh = upcoming.find(x => x.id === shootId)
  const waiting = !sh || sh.status === 'requested'
  return <div className="flex items-center justify-between text-sm"><span>You</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${waiting ? 'bg-amber-400/15 text-amber-300' : 'bg-green-500/15 text-green-400'}`}>{waiting ? 'Waiting for OK' : 'Approved ✓'}</span></div>
}
