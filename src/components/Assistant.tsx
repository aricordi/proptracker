// The one AI chat ("✦ AI" on every creator screen; owner, Oct 19). It does two jobs in one conversation:
// - PROP IDEAS: describe the video, keep going ("something for a séance"); real props from the inventory (gear only when
//   booking gear ahead is switched on; it's off since Nov 3),
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
import TypeOut from './TypeOut'
import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import type { AssistantMode } from '../assistant'
import { routeMessage, cancelIntent, isStatusQuestion, detectIntent, findShoot, namesADay, isAppBug, pickOption, isJustWhen, type Helper, type Route, type Intent } from '../lib/aiRoute'
import { useBugReport } from './BugReport'
import { ReturnCard, ReportCard, PickupList, ShootNow } from './ChatNow'
import GuidelinePicker from './GuidelinePicker'
import { useReturnGroups, returnCount, canReturnProps, canReturnGear } from '../hooks/useReturnables'
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
import { isFilmGear } from '../../functions/src/filmGear'
import { useActiveShoot, useShootLabel, useCutoffs, useAddToShoot, savePendingAdds, useGearWindow } from '../activeShoot'
import { formatDay } from '../lib/dates'
import { ideaToProps, askApp, askChat, type IdeaResult, type AppAnswer, type ChatTurn, type ChatStateIn } from '../services/ai'
import { subscribeToGearBundles, subscribeToGearHolds, freeQty, byCount, type GearBundle, type GearHold } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import {
  askForTime, bookWithFriends, useMyInvites, useMyStatus, useMyShoots, useShoot, useScheduleSettings, needsGuideline, type Guideline, fmtSlot, errorText, INVITE_HOLD_MINUTES, cancelShoot, cancelCountsAsNoShow,
  checkinWindow,
  type TimeAskResult, type House,
} from '../services/schedule'
import { freeForRange, todayInStudio, lastDayToBook } from '../../functions/src/booking'
import { useUsualPartners } from '../hooks/useUsualPartners'
import { joinWaitlist } from '../hooks/useWaitlist'
import { fmtTime, fmtHours, nowStamp } from '../../functions/src/gearBooking'
import { Icon, type IconName } from './Icon'
import { friendlyError } from '../lib/errors'
import { loadChat, saveChat, clearChat, summaryLine, earlierAsks, lastVideoNames, type Remembered } from '../lib/chatMemory'
import { subscribeToReservations, createReservation } from '../services/reservations'
import { ChatCard, primaryBtn, secondaryBtn } from './ChatCard'
import { pairOf, topPicks, planSkip, videoName } from '../lib/sayItOnce'

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
  | { who: 'now'; shootId: string }   // "im here" / "we're done": the check-in or wrap card, right in the chat (chat QA, Nov 6)
  | OncePlan   // Say it once, confirm once (owner, Nov 7): a time AND props in one message → one card, one "Do it"

// The one-card plan. `time` / `idea` keep both finders' answers, so "Change something" shows them as the usual
// separate answers without asking the AI again.
interface OncePlan {
  who: 'once'; id: number; o: TimeAskResult['options'][number]; picks: string[]; ticks: string[]; idea: string; notice: string
  time: TimeAskResult; props: IdeaResult; propsQuery: string; timeQuery: string
  stage: 'ready' | 'booking' | 'sending' | 'done' | 'failed' | 'propsFailed'; error?: string; shootId?: string; requested?: boolean; invited?: string[]; sent?: number
}

const STAFF_STARTERS: Record<string, string[]> = {
  arts: ['How do I pack a request?', 'How do I check props back in?', 'How do I do a bin check?'],
  equipment: ['How do I check gear back in?', 'How do I build a kit?', 'How do I block time on the schedule?'],
  admin: ['How do I give a strike?', 'What do the flags mean?', 'How do I invite a creator?'],
}
const MORE = 'More like these'
// After an answer, at most 2 next steps, the most useful first (owner, Nov 7: "like a modern AI assistant", no menu of options).
// Answers to a question the chat just asked (Keep going / Start over, "Cliff 1 or Cliff 2?") aren't capped.
const NEXT_MAX = 2
const nextSteps = (c: string[]) => [...new Set(c.filter(Boolean))].slice(0, NEXT_MAX)
const TIME_CHIP = 'Find a time to film this'
const PROPS_CHIP = 'Props for this shoot'
const NEXT_GEAR = 'Next: gear ›'
const SKIP_PROPS = 'Skip props ›'
const NEXT_REVIEW = 'Next: review ›'
// Owner, Nov 4: never block someone in a step. When a message doesn't fit, ASK what they want instead.
const SWITCH_TIME = 'Book a time instead'
const SWITCH_PROPS = 'Find props instead'
const KEEP_GOING = 'Keep going'
const START_OVER = 'Start over'
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
const DEMO_OPENER = 'Tell me your video idea and I\'ll find props from our closet that fit, scene by scene. Then keep going: "make it spookier", "something for the ending"… Tap any prop to see it. You can also ask me how the app works.'
const DEMO_NO_TIME = 'Booking isn\'t open for you yet, so I can\'t look at times. Tell me about the video and I\'ll find props for it.'
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const addMinutesLocal = (st: string, n: number) => { const d = new Date(`${st}:00Z`); d.setUTCMinutes(d.getUTCMinutes() + n); return d.toISOString().slice(0, 16) }
const addDaysLocal = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
// Answered by the app itself before the AI (chat QA, Nov 6): the app knows these facts better, and "are you a bot?" must
// always get an honest answer.
const LOCAL_FIRST: Intent[] = ['checkin', 'done', 'late', 'access', 'house', 'whoami']
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
  const { profile, user, demo, canBook, role, realRole } = useSession()
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
  const recent = useMyShoots(profile.email, addDaysLocal(todayInStudio(), -1))
  const returns = useReturnGroups(profile.email)
  const myStatus = useMyStatus(profile.email)
  const gw = useGearWindow()
  // Usual partners (owner, Nov 7): one "With Kyle?" chip after a time search that names nobody, and a hint for the chat's AI.
  const partners = useUsualPartners(profile.email, s.slotMinutes, !demo && !helpOnly)
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const today = todayInStudio()
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const house = (p: string) => p === 'cliff2' ? s.houses.cliff2.name : s.houses.cliff1.name
  // Creators ask for times (the schedule team approves); the owner and people on "Books without approval" book straight away.
  // (The owner in creator mode is still the owner to the server: booked at once, so say "Book", audit Nov 5.)
  const asks = role !== 'owner' && realRole !== 'owner' && !s.instantBookers.some(p => p.email === profile.email)

  const hello = `Hi${first ? ` ${first}` : ''}!`
  const helper = ask.mode === 'plan' ? undefined : ask.mode
  const fresh = (m?: Helper): Msg[] => helpOnly ? [{ who: 'bot', text: `${hello} Ask me how to do anything in the app, and I'll show you where.` }] : demo ? [{ who: 'bot', text: `${hello} ${DEMO_OPENER}` }]
    : m ? [{ who: 'bot', text: `${hello} ${OPENERS[m]}` }] : page ? [{ who: 'bot', text: `${hello} What do you need?` }] : [{ who: 'bot', text: `${hello} ${GREETING}` }, { who: 'choose' }]
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
  // Answers type out word by word (owner, Nov 7); ones already on screen when the chat opens (or after New chat) show at once.
  // A bot message is "done" once its text has finished: the cards and chips under it appear then.
  const shownNow = useRef(new WeakSet<Msg>())
  const atOnce = (list: Msg[]) => { list.forEach(m => shownNow.current.add(m)); return list }
  const isDone = (m: Msg) => m.who !== 'bot' || !m.text || shownNow.current.has(m)
  const [msgs, setMsgs] = useState<Msg[]>(() => atOnce(fresh(helper)))
  // The chat remembers you (owner, Nov 7): the creator chat page keeps its words on this phone (per person, 30 turns, 7 days)
  // and shows them again as plain text under "Earlier". Live cards are never brought back, only what they said.
  const remember = page && !!profile.email
  const store = () => { try { return window.localStorage } catch { return null } }
  const [old, setOld] = useState<Remembered[]>(() => remember ? loadChat(store(), profile.email) : [])
  // Their last 3 video names (from their own props requests), so the chat's AI knows them a little.
  const [videos, setVideos] = useState<string[]>([])
  useEffect(() => { if (!remember || demo || helpOnly) return; return subscribeToReservations({ email: profile.email, all: false }, l => setVideos(lastVideoNames(l))) }, [remember, demo, helpOnly, profile.email])
  const demoChips = helpOnly ? (STAFF_STARTERS[role] ?? STARTERS.help) : [...STARTERS.props.slice(0, 3), 'How do I search the props?']
  const [chips, setChips] = useState<string[]>(() => demo || helpOnly ? demoChips : helper ? STARTERS[helper] : mixed())
  // Keep the words on the phone once something new was said (just opening the chat doesn't restart the 7 days).
  // Result cards become one line of text ("Props I suggested: …", "Free times I found: …"); the hello isn't kept.
  useEffect(() => {
    if (!remember || !msgs.some(m => m.who === 'me')) return
    const now: Remembered[] = msgs.flatMap((m, i): Remembered[] => {
      if (m.who === 'me') return [{ who: 'me', text: m.text, mode: m.mode }]
      if (m.who === 'bot') {
        if (i === 0) return []
        const props = m.result ? summaryLine('Props I suggested', m.result.groups.flatMap(g => g.picks.map(p => itemById.get(p.id)?.name ?? bundles.find(b => b.id === p.id)?.name ?? ''))) : ''
        const asked = m.result ? summaryLine('Not in the closet', m.result.missing.map(x => x.name)) : ''
        const text = [m.text, props, asked].filter(Boolean).join('\n')
        return text ? [{ who: 'bot', text }] : []
      }
      if (m.who === 'options' && m.options.length) return [{ who: 'bot', text: summaryLine('Free times I found', m.options.map(o => `${formatDay(o.date, { weekday: 'short' })} ${house(o.place)} ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}`), 4) }]
      if (m.who === 'booked') return [{ who: 'bot', text: `${asks ? 'Asked for' : 'Booked'}: ${m.label}` }]
      if (m.who === 'once') return [{ who: 'bot', text: `${m.stage === 'done' || m.stage === 'propsFailed' ? (m.requested ? 'Asked for' : 'Booked') : 'Free time I found'}: ${formatDay(m.o.date, { weekday: 'short' })} ${house(m.o.place)} ${fmtSlot(m.o.start, m.o.slots.length * s.slotMinutes)}${m.sent ? ` · ${m.sent} props sent` : ''}` }]
      return []
    })
    saveChat(store(), profile.email, [...old, ...now])
  }, [msgs])
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
  const [thinking, setThinking] = useState<Helper | 'chat' | null>(null)   // label under the typing dots
  const [listening, setListening] = useState(false)
  const [previous, setPrevious] = useState<Record<string, unknown> | undefined>()
  const rec = useRef<any>(null)
  const [heard, setHeard] = useState(''), [micErr, setMicErr] = useState('')
  const stopped = useRef(false), quiet = useRef<ReturnType<typeof setTimeout>>()
  const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null)
  // Follow the conversation; an empty chat stays at the top (the hello and the to-dos).
  const [, setRevealTick] = useState(0) // re-render so finished answers show their cards
  useEffect(() => { if (shown && msgs.some(m => m.who === 'me')) end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy, shown])
  // Back with an earlier conversation: start just under it (the welcome and today's things), earlier words a scroll up.
  const nowRef = useRef<HTMLDivElement>(null), placed = useRef(false)
  useEffect(() => {
    if (!shown || placed.current || !old.length || msgs.some(m => m.who === 'me')) return
    placed.current = true
    requestAnimationFrame(() => { const el = scroller.current, mark = nowRef.current; if (el && mark) el.scrollTop += mark.getBoundingClientRect().top - el.getBoundingClientRect().top - 8 })
  }, [shown, old.length])
  // While an answer types out, keep its newest words in view (unless they scrolled up to read something earlier).
  const nearBottom = () => { const el = scroller.current; return !!el && el.scrollHeight - el.scrollTop - el.clientHeight <= 160 }
  const follow = () => {
    const el = scroller.current
    if (!shown || !el || !nearBottom()) return
    el.scrollTop = el.scrollHeight
  }
  // When an answer finishes typing, its cards fade in: follow them only if the person was at the bottom
  // (checked BEFORE the cards make the page taller), never yank them down from something they scrolled up to read.
  const textDone = (m: Msg) => {
    if (shownNow.current.has(m)) return
    shownNow.current.add(m)
    const atBottom = shown && nearBottom()
    setRevealTick(t => t + 1)
    if (atBottom) requestAnimationFrame(() => requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }))
  }

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
  const restart = () => { if (remember) clearChat(store(), profile.email); setOld([]); setMode(helpOnly ? 'help' : demo ? 'props' : null); setPlan(null); setMsgs(atOnce(fresh())); setChips(demo || helpOnly ? demoChips : mixed()); setPrevious(undefined); setSel([]); setAddedTo(''); setText('') }

  // "New chat" in the middle of a plan: explain what goes, then they choose (Start over / Keep going).
  function askRestart() {
    if (!plan || (!sel.length && !cart.count && !planShoot)) return restart()
    bot(withNote('Start a new chat?')); setChips([START_OVER, KEEP_GOING])
  }

  // ── Plan my shoot ──
  const bugReport = useBugReport()
  const bot = (text: string, ...extra: Msg[]) => setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'bot', text }, ...extra])
  const planShoot = upcoming.find(x => x.id === plan?.shootId)
  const planLabel = planShoot ? label(planShoot) : plan?.label ?? 'your shoot'
  const late = (kind: 'props' | 'builds' | 'gear') => !!planShoot && today > cutoffs(planShoot)[kind]
  function startPlan() {
    setPlan({ step: 'time' }); setChips([])
    if (upcoming.length) bot(`Let's plan your shoot, step by step: time, props${gearOn ? ', gear' : ''}, then you check it all and send. Is it one you've already booked, or a new time?`, { who: 'shoots' })
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
    if (tooLate) { setChips([SKIP_PROPS]); bot(`Step 2 · Props. It's too late to add props to ${name} (the last day was ${formatDay(cutoffs(sh).props)}). ${gearOn ? "Let's look at gear." : "Let's review."}`); return }
    setChips([...STARTERS.props.slice(0, 3), SKIP_PROPS])
    bot(`Step 2 · Props for ${name}. What's the video about? I'll find what we have and check it's free that day.${sh ? ` Props by ${formatDay(cutoffs(sh).props)}.` : ''}`, { who: 'already' })
  }
  // Ticked suggestions go into the shoot when you move on, so nothing is lost.
  function commitTicks() { if (plan?.shootId && sel.length) { addToShoot(plan.shootId, picks()); setSel([]) } }
  // Gear isn't booked ahead (owner, Nov 3): the plan goes straight from props to review.
  const gearOn = s.gearReserve
  function planGear() {
    if (!gearOn) return planReview()
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
    bot(`Step ${gearOn ? 4 : 3} · Review. Here's your shoot. On the next page you can change amounts, add or remove anything, then send it to the teams.`, { who: 'review' })
  }

  // Everything already suggested (never repeated) and everything the AI already looked for.
  const results = msgs.flatMap(m => m.who === 'bot' && m.result ? [m.result] : [])
  const shownIds = results.flatMap(r => r.groups.flatMap(g => g.picks.map(p => p.id)))
  const searched = results.flatMap(r => [...(r.searched ?? []), ...r.missing.map(m => m.name)])
  const lastBot = msgs.reduce((n, x, i) => x.who === 'bot' ? i : n, -1)   // "Meant … instead?" only under the newest answer

  // What the chat's AI may know: the last few lines, and a summary of this person's own shoots and what they have out.
  // Plus up to 6 things they said on an earlier visit (kept on the phone), marked so the AI treats them as the past.
  const chatLines = () => [
    ...earlierAsks(old).map(text => ({ who: 'me' as const, text, earlier: true })),
    ...msgs.flatMap(x => (x.who === 'me' || x.who === 'bot') && x.text ? [{ who: x.who, text: x.text.slice(0, 300) }] : []).slice(-8),
  ]
  const chatState = (): ChatStateIn => {
    const groups = returns ?? []
    const paused = myStatus?.pausedUntil && myStatus.pausedUntil.slice(0, 10) > today ? myStatus.pausedUntil.slice(0, 10) : undefined
    return {
      shoots: [...upcoming].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 8).map(x => ({ id: x.id, label: label(x), status: x.status === 'requested' ? 'requested' : x.checkin ? 'checked-in' : 'booked' })),
      out: { props: groups.reduce((n, g) => n + g.props.filter(canReturnProps).length, 0), gear: groups.flatMap(g => g.gear.filter(canReturnGear).flatMap(b => b.lines.map(l => l.name))).slice(0, 8) },
      ...(paused ? { paused } : {}), ...(myStatus?.strikes ? { strikes: myStatus.strikes } : {}),
      ...(plan ? { plan: { step: plan.step, ...(shoot?.id ? { shoot: shoot.id } : {}) } } : {}),
      ...(partners.length ? { usualPartners: partners.map(p => p.label) } : {}),
      ...(videos.length ? { recentVideos: videos } : {}),
    }
  }
  // The newest "me" line takes the helper it ended up going to (the prop finder reads earlier prop messages).
  const markMe = (m: Helper) => setMsgs(x => { const i = x.map(y => y.who).lastIndexOf('me'); return i < 0 ? x : x.map((y, k) => k === i && y.who === 'me' ? { ...y, mode: m } : y) })
  const defaultChips = () => helpOnly ? (STAFF_STARTERS[role] ?? []) : demo ? STARTERS.props.slice(0, 3) : mixed().slice(0, 4)

  const pendingSwitch = useRef('')
  // What leaving the plan would drop, and whether they can come back (owner, Nov 4: "explain what they would abandon…
  // if it's even possible to go back or if they'll have to start over… communicate that and give the option").
  function leavingNote(): string {
    if (!plan) return ''
    const lost = sel.length ? `the ${sel.length} pick${sel.length === 1 ? '' : 's'} you ticked but haven't added yet will be cleared` : ''
    const kept = [planShoot ? `your shoot (${planLabel}) stays booked` : '', cart.count ? `the ${cart.count} prop${cart.count === 1 ? '' : 's'} already in your basket stay there` : ''].filter(Boolean)
    const back = planShoot ? 'You can pick up where you left off any time: open the shoot and tap **Plan it with AI**.' : 'Nothing is booked yet, so next time the plan starts from the beginning.'
    return [lost ? `Heads-up: ${lost}.` : '', kept.length ? `${kept.join(', and ').replace(/^./, c => c.toUpperCase())}.` : '', back].filter(Boolean).join(' ')
  }
  const withNote = (t: string) => { const n = leavingNote(); return n ? `${t}\n\n${n}` : t }
  // Plan my shoot without the AI (busy / test mode): a message that isn't for this step gets a question, not a refusal.
  function askWhatTheyWant(q: string): boolean {
    if (!plan || (plan.step !== 'props' && plan.step !== 'time')) return false
    const r = routeMessage(q, { last: plan.step === 'props' ? 'props' : 'time', shoots: upcoming.map(x => ({ id: x.id, date: x.date })) })
    const fits = r.helpers.includes(plan.step === 'props' ? 'props' : 'time')
    const intent = detectIntent(q)
    if (fits && !intent) return false
    pendingSwitch.current = r.helpers.includes('time') || r.helpers.includes('props') ? q : ''
    if (intent === 'ack') {
      bot(withNote('No problem. Stop planning for now, or keep going?')); setChips([START_OVER, KEEP_GOING]); return true
    }
    const greet = intent === 'greeting'
    const wantsTime = r.helpers.includes('time') && plan.step === 'props', wantsProps = r.helpers.includes('props') && plan.step === 'time'
    bot(greet ? `Hey${first ? ` ${first}` : ''}! We were ${plan.step === 'props' ? `picking props for ${planLabel}` : 'finding you a time'}. Want to keep going, or do something else?`
      : withNote(wantsTime ? 'Sounds like you want to book a time. Want to do that now, or keep going with props first?'
      : wantsProps ? 'Sounds like you\'re thinking props. Find those now, or finish picking the time first?'
      : `Got it. We were ${plan.step === 'props' ? 'on props' : 'finding a time'}. Keep going, or start something else?`))
    setChips(wantsTime ? [SWITCH_TIME, KEEP_GOING, START_OVER] : wantsProps ? [SWITCH_PROPS, KEEP_GOING, START_OVER] : [KEEP_GOING, SWITCH_TIME, START_OVER])
    return true
  }

  // Typing instead of tapping (chat QA, Nov 6): "yes book it", "the 5pm one", "the second one" right after free times were shown
  // books that one; "yes" to a cancel card points at its button (cancelling stays a deliberate tap).
  const askedWhich = useRef<TimeAskResult['options'] | null>(null)   // "Which one: Cliff 1 or Cliff 2?" waiting for the answer
  // The follow-up chips the time and prop finders just offered ("Only Cliff 2", "Anything earlier?", "Make it spookier"):
  // a tap goes straight back to that finder, never read as picking a time shown (audit, Nov 7: "Only Cliff 1" booked
  // the first option) and without a second AI call first.
  const helperChips = useRef(new Map<string, Helper>())
  // "Tell me if 5 PM opens" (waitlist, Nov 7): the exact time asked for is someone else's; the chip puts them on its list.
  const waitChips = useRef(new Map<string, { date: string; house: House; start: number }>())
  // Did the chat's last words ask the person something? ("Want me to look at Saturday?")
  // The opening greeting ("What are we making today?") doesn't count: nothing has been asked about yet.
  function lastBotAsked(): boolean {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.who === 'me') return false
      if (m.who === 'bot' && m.text.trim()) return msgs.slice(0, i).some(x => x.who === 'me') && /\?\s*(\*\*)?\s*$/.test(m.text.trim())
    }
    return false
  }
  function typedPick(q: string): boolean {
    const waiting = askedWhich.current; askedWhich.current = null
    if (waiting) {
      const r = pickOption(q, waiting)
      if (r && 'index' in r) { void book(waiting[r.index], true); return true }
    }
    for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 4; i--) {
      const m = msgs[i]
      if (m.who === 'me') return false
      if (m.who === 'options') {
        const r = pickOption(q, m.options)
        if (!r) return false
        if ('which' in r) {
          // Name the choices when there are only a few ("Cliff 1 or Cliff 2?").
          const c = r.which.map(k => m.options[k])
          const sameTime = c.every(o => o.start === c[0].start && o.date === c[0].date)
          const names = c.map(o => sameTime ? house(o.place) : `${formatDay(o.date, { weekday: 'short' })} ${fmtTime(o.start)} at ${house(o.place)}`)
          setMsgs(x => [...x, { who: 'bot', text: c.length <= 3 ? `Which one: **${names.join('** or **')}**?` : `Which one? Tap **${asks ? 'Request' : 'Book'}** on the time you want, or say it ("the 5 PM one").` }])
          askedWhich.current = c
          setChips(c.length <= 3 ? names : []); return true
        }
        void book(m.options[r.index], true)
        return true
      }
      if (m.who === 'cancel') {
        if (!(detectIntent(q) === 'confirm' || /^\s*(cancel( it)?|do it|yes,? cancel( it)?)\s*[!.]*$/i.test(q))) return false
        // The card's button says "Withdraw it", "Cancel anyway" or "Yes, cancel it", or it still asks which shoot: don't name one.
        setMsgs(x => [...x, { who: 'bot', text: m.shootId ? 'Tap the button on the card above to confirm (or **Keep it**).' : 'Tap the shoot on the card above, then confirm there (or **Keep it**).' }]); return true
      }
    }
    return false
  }

  async function send(t = text, more = false, force?: Helper, fresh = false) {   // fresh: a whole new time request (see runHelpers)
    if (listening) stopTalk()   // Send while talking = done talking
    const q = t.trim(); if (!q || busy) return
    setText(''); setChips([])
    helperChips.current = new Map()
    if (force || more) askedWhich.current = null   // a new search: an old "Which one?" no longer applies
    setMsgs(x => [...x.filter(y => y.who !== 'choose'), { who: 'me', text: q, mode: force ?? (more ? 'props' : mode ?? 'help') }])
    // Something wrong with the app itself (owner, Nov 5): straight to "Report a problem", no AI needed.
    if (!force && !more && typedPick(q)) return
    // Typing a button's words ("start over", "keep going", "next") does what the button does (chat QA, Nov 6).
    if (!force && !more) {
      const lc = q.toLowerCase().replace(/[›.!]/g, '').trim()
      const btn = [START_OVER, KEEP_GOING, SWITCH_TIME, SWITCH_PROPS, NEXT_GEAR, SKIP_PROPS, NEXT_REVIEW].find(c => c.toLowerCase().replace(/[›.!]/g, '').trim() === lc)
      if (btn && (plan || btn === START_OVER)) { chip(btn); return }
      if (/^(start (over|again)|restart|reset|new chat|clear( chat)?)$/.test(lc)) { if (plan) askRestart(); else restart(); return }
    }
    // Planning (chat QA, Nov 6): "skip" / "next" / "that's it" on the props step moves on; "cancel" / "stop" asks whether to stop.
    if (!force && !more && plan) {
      const lc = q.toLowerCase().replace(/[.!?]/g, '').trim()
      if (plan.step === 'props' && /^(skip( (it|this|props))?|next( step)?|done|that'?s (it|all|everything)|no (more )?props|none|nothing( else)?|i'?m good|all good|move on)$/.test(lc)) { chip(gearOn ? NEXT_GEAR : NEXT_REVIEW); return }
      if (/^(cancel|stop|quit|exit|end|stop (it|this|planning)|cancel (it|this|the plan|planning)|i'?m done|forget (it|this))$/.test(lc)) { askRestart(); return }
    }
    if (!force && !more && !plan) {
      const pre = detectIntent(q)
      if (pre && LOCAL_FIRST.includes(pre) && localTurn(q)) return
      // A bare "ok" / "yes" / "no" with no question waiting (chat QA, Nov 6: the AI once answered "yes" with "you're all set").
      // After a question, the AI reads it with the conversation, so "yes" answers that question.
      if ((pre === 'ack' || pre === 'confirm') && !lastBotAsked() && localTurn(q)) return
      // Just a day or a time ("next sat", "the 31st", "5:30"): the time finder reads it exactly (the AI once got "next sat" wrong).
      if (!demo && !helpOnly && !pre && isJustWhen(q)) { await runHelpers(q, false, 'time'); return }
      // Only punctuation or emoji ("???", "🎬🎬", "."): no need to wake the AI.
      if (!/[\p{L}\p{N}]/u.test(q)) { setMsgs(x => [...x, { who: 'bot', text: 'Not sure what you mean. Tell me what you need: a time to film, props for a video, or anything about your shoots.' }]); setChips(nextSteps(defaultChips())); return }
    }
    if (!force && !more && isAppBug(q)) {
      bot('Sorry about that! Send it to us with a screenshot: tap Report a problem, go to the screen where it happened, then tap Report this screen.')
      setMsgs(x => [...x, { who: 'actions', items: [{ label: 'Report a problem', to: '#report' }, { label: "It's this chat", to: '#report-now' }] }])
      return
    }
    // The AI reads the message first (owner, Nov 3: "more conversational… open and accepting of anything"), and picks
    // what to show. "More like these" and a forced helper go straight to their helper. Plan my shoot too goes through the AI
    // (owner, Nov 4: "keep the steps in the backend and let the creator just chat"): it knows the step and picks from the words.
    if (!force && !more) {
      setBusy(true); setThinking('chat')
      const turn = await askChat({ message: q, history: chatLines(), state: chatState() }).then(r => r.data).catch(() => null)
      setThinking(null); setBusy(false)
      if (turn && !('fallback' in turn)) { await runTurn(turn, q); return }
      // No AI right now (busy, budget, offline, test mode): the chat's own built-in answers.
      if (askWhatTheyWant(q)) return
      if (localTurn(q)) return
    }
    await runHelpers(q, more, force, undefined, fresh)
  }

  // The AI read a change of direction in the middle of the plan: say what leaving means, then let them choose.
  function confirmLeave(reply: string, query: string, to: 'time' | 'props') {
    pendingSwitch.current = query
    bot(withNote(`${reply ? `${reply} ` : ''}${to === 'time' ? 'Want to switch to booking a time now, or finish the props first?' : 'Want to look at props now, or finish picking the time first?'}`))
    setChips(to === 'time' ? [SWITCH_TIME, KEEP_GOING, START_OVER] : [SWITCH_PROPS, KEEP_GOING, START_OVER])
  }

  // Do what the AI picked. Everything here is a card or a button; the person still taps to make anything happen.
  async function runTurn(turn: ChatTurn, q: string) {
    // A time AND props in one message: one card with one "Do it" (owner, Nov 7), instead of two separate answers.
    const pair = !plan && !demo && !helpOnly ? pairOf(turn) : null
    if (pair) return planOnce(turn, pair)
    await runOne(turn, q)
    // A second thing in the same message ("book friday 5pm and i need a cop costume"): done right after (chat QA, Nov 6).
    const also = turn.also
    if (also && !plan) {
      aiSpoke.current = false
      if (also.action === 'return') { localTurn(q, { intent: 'return', text: '' }); return }
      await runHelpers(also.query, false, also.action === 'times' ? 'time' : 'props', undefined, true)
    }
  }
  async function runOne(turn: ChatTurn, q: string) {
    aiSpoke.current = !!turn.reply
    const say = (txt: string, extra: Msg[] = []) => setMsgs(x => [...x, { who: 'bot', text: txt }, ...extra])
    switch (turn.action) {
      case 'times':
        if (plan && plan.step === 'props') return confirmLeave(turn.reply, turn.query || q, 'time')
        // The AI's query is a whole new sentence ("Thursday at 5 at Cliff 1"): search it fresh, so an earlier search's
        // friend, house or time doesn't sneak in (audit, Nov 7: "book me Thursday at 5" re-invited Kyle).
        if (turn.reply) say(turn.reply); return runHelpers(turn.query || q, false, 'time', undefined, !!turn.query)
      case 'props':
        if (plan && plan.step === 'time') return confirmLeave(turn.reply, turn.query || q, 'props')
        if (turn.shoot) choose(turn.shoot)
        // "props", "i need props", "props for tomorrow": no idea yet, so ask for one instead of searching the closet for
        // the word "props" (chat QA, Nov 6: that answered "I didn't catch a video idea there").
        if (!turn.query && !demo && !/\b(for (a|an|the|my|our) (\w+ )?(video|skit|sketch|scene|prank|episode|short)|about|with a|like a)\b/i.test(q) && q.split(/\s+/).length <= 6) {
          setMode('props'); aiSpoke.current = false
          // The AI's line only when it asks for the idea itself (not "Here are some props…" with nothing below it).
          say(/\?\s*$/.test(turn.reply) ? turn.reply : 'What\'s the video about? A scene, a character or a vibe is enough.'); setChips(nextSteps(turn.chips.length ? turn.chips : STARTERS.props)); return
        }
        if (turn.reply) say(turn.reply)
        return runHelpers(turn.query || q, false, 'props', turn.shoot)
      case 'help':
        markMe('help')
        setMsgs(x => [...x, { who: 'bot', text: turn.reply || 'Here\'s how.', guide: { steps: turn.steps, links: turn.links } }]); setChips(nextSteps(turn.chips)); return
      case 'plan': if (turn.reply) say(turn.reply); if (!plan) startPlan(); return
      case 'reply': say(turn.reply); setChips(nextSteps(turn.chips)); return
      default:
        // Shoots, returns, reports, gear…: the app's own facts decide the card (and win over the AI's words when they disagree).
        if (!localTurn(q, { intent: turn.action === 'take_gear' ? 'take-gear' : turn.action, text: turn.reply, shootId: turn.shoot }, true)) { say(turn.reply || 'On it. What would you like to do?'); setChips(nextSteps(turn.chips)) }
        else if (turn.chips.length) setChips(nextSteps(turn.chips))
    }
  }

  // The built-in answers (no AI). With `ai`, the AI already chose the intent and wrote a friendlier line, used unless
  // the facts say otherwise ("nothing to bring back", "no shoots", strike numbers). Returns false when it isn't one of these.
  // `anyStep`: the AI decided this message is about a shoot (cancel, move, return…) even in the middle of planning: show it anyway.
  function localTurn(q: string, ai?: { intent: string; text: string; shootId?: string }, anyStep = false): boolean {
    // Props only: the words never reach the time finder (the server would refuse anyway).
    if (demo && !helpOnly && !ai) {
      // Shoots, check-in, gear, returns… aren't open for them yet (chat QA, Nov 6: "im here" got prop ideas).
      const i0 = detectIntent(q)
      if ((i0 && !['greeting', 'thanks', 'ack', 'whoami', 'capabilities', 'upset', 'access', 'house'].includes(i0)) || cancelIntent(q, []) || isStatusQuestion(q)) {
        setMsgs(x => [...x, { who: 'bot', text: 'Booking and shoots aren\'t open for you yet, so I can\'t help with that one. Tell me about a video and I\'ll find props for it, or ask me how the app works.' }]); setChips(STARTERS.props.slice(0, 3)); return true
      }
      const r = routeMessage(q, { last: 'props', shoots: [] })
      if (!r.helpers.includes('props') && !r.helpers.includes('help')) { setMsgs(x => [...x, { who: 'bot', text: DEMO_NO_TIME }]); setChips(STARTERS.props); return true }
    }
    if (plan && !anyStep) return false
    const intent = ai?.intent ?? detectIntent(q)
    const say = (reply: string, extra: Msg[] = [], chips: string[] = [], fact = false) => {
      setChips(nextSteps(chips)); setMsgs(x => [...x, { who: 'bot', text: ai?.text && !fact ? ai.text : reply }, ...extra])
    }
    if (intent === 'greeting') { say(`Hey${first ? ` ${first}` : ''}! ${helpOnly ? 'Ask me how to do anything in the app and I\'ll show you where.' : demo ? 'Tell me about a video and I\'ll find props for it.' : 'What are you working on? I can find you a time at the houses or props for the shoot.'}`, [], defaultChips()); return true }
    if (intent === 'thanks') { say('Anytime! Have a great shoot.'); return true }
    // Honest, always (chat QA, Nov 6: the AI once said "far from it, I'm your friendly PA").
    if (intent === 'whoami') { say(`I'm the app's AI assistant, not a person. I can ${demo ? 'find props for your video ideas and explain how the app works' : helpOnly ? 'show you how anything in the app works' : 'find you a time to film, find props, check on your shoots and explain how the app works'}. For anything else, message the team directly.`, [], defaultChips(), true); return true }
    if (intent === 'ack') { say(ai?.text || 'No problem. I\'m here when you need me.', [], defaultChips(), true); return true }
    if (intent === 'confirm') { say('Yes to what? Tell me what you\'d like: a time to film, props for a video, or something about one of your shoots.', [], defaultChips(), true); return true }
    if (intent === 'capabilities') {
      say(demo ? 'Tell me a video idea and I\'ll find props from our closet that fit, scene by scene. Tap any prop to see it. I can also explain how the app works.'
        : helpOnly ? 'Ask me how to do anything in the app and I\'ll show you the steps and the screen.'
        : 'Here\'s what I can do:\n- **Book a time**: "Saturday at Cliff 1 at 5pm", "2 hours with Kyle this week"\n- **Props**: tell me the video idea\n- **Your shoots**: approved?, move, cancel, swap\n- **On the day**: check in, wrap, return gear', [], defaultChips(), true); return true
    }
    if (intent === 'upset') {
      say('Sorry it\'s being a pain. Tell me what you were trying to do and I\'ll get you there. If something in the app looks broken, send it to us with a screenshot.',
        [{ who: 'actions', items: [{ label: 'Report a problem', to: '#report' }] }], [], true); return true
    }
    if (intent === 'access') { say('I don\'t have door codes or keys. Message the equipment team (Maanik) directly and they\'ll get you in.', [], [], true); return true }
    if (demo || helpOnly) return false
    // On the day (chat QA, Nov 6): "im here", "running late", "we're done". The app knows today's shoot better than the AI.
    if (intent === 'checkin' || intent === 'done' || intent === 'late' || intent === 'house') {
      const nowS = nowStamp(), todays = (recent ?? []).filter(x => x.status === 'booked' && x.date >= addDaysLocal(today, -1) && x.to > addDaysLocal(today, -1)).sort((a, b) => a.from.localeCompare(b.from))
      const filming = todays.find(x => x.checkin && !x.wrap && x.from <= nowS && nowS < addMinutesLocal(x.to, 180))
      const open = todays.find(x => x.place !== 'offsite' && !x.checkin && checkinWindow(x, nowS, s) === 'open')
      const next = todays.find(x => x.date === today && nowS < x.to)
      const t = (st: string) => fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))
      if (intent === 'house') {
        say(open ? 'Thanks for flagging it. If the person before you left it like this, tap **Report it** when you check in (with a photo). For anything broken in the house, tell the equipment team (Maanik) so it\'s fixed.'
          : 'Thanks for flagging it. Tell the equipment team (Maanik) directly so it\'s sorted before the next shoot. If it was the person filming before you, you can report it when you check in.',
          open ? [{ who: 'now', shootId: open.id }] : [], [], true); return true
      }
      if (intent === 'done') {
        if (filming) { say('Nice work! What did you film? One line is enough.', [{ who: 'now', shootId: filming.id }], [], true); return true }
        if ((returns ?? []).length) { say('Done? Let\'s bring the gear and props back. A few taps and one photo.', [{ who: 'return' }], [], true); return true }
        say('Nice! Anything else I can line up for you?', [], defaultChips(), true); return true
      }
      if (intent === 'late') {
        if (!next) { say('You don\'t have a shoot today. Anything I can help with?', [], defaultChips(), true); return true }
        say(`No stress. ${next.place === 'offsite' ? 'Offsite shoots have no check-in.' : `Check in with a selfie when you get there: it stays open until **${t(next.to)}**. Checking in more than 15 minutes after **${t(next.from)}** is noted for the team.`} If you can't make it at all, cancel or swap it so someone else can use the slot.`, [], [], true); return true
      }
      // checkin
      if (filming) { say('You\'re checked in ✓ Tell me what you filmed when you wrap.', [{ who: 'now', shootId: filming.id }], [], true); return true }
      if (open) { say('You\'re up! Take the selfie to check in.', [{ who: 'now', shootId: open.id }], [], true); return true }
      if (next && next.place === 'offsite') { say('Offsite shoots don\'t need a check-in. Have a great shoot!', [], [], true); return true }
      if (next) { say(`Check-in opens at **${t(addMinutesLocal(next.from, -s.checkinBefore))}**, ${s.checkinBefore} minutes before your ${t(next.from)} slot. I'll show the selfie button here then.`, [], [], true); return true }
      say(upcoming.length ? 'You don\'t have a shoot today. Here are your next ones.' : 'You don\'t have a shoot today. Want to book one?', upcoming.length ? [{ who: 'status' }] : [], defaultChips(), true); return true
    }
    const sorted = [...upcoming].sort((a, b) => a.from.localeCompare(b.from))
    const pick = ai?.shootId ? sorted.find(x => x.id === ai.shootId) : undefined
    if (intent) {
      // A day that matches none of their shoots: say so instead of picking the first one (audit, Nov 5).
      const hit = findShoot(q, sorted.map(y => ({ id: y.id, date: y.date })), true)
      const wrongDay = !pick && !hit && namesADay(q) && sorted.length > 0
      const named = pick ?? sorted.find(x => x.id === hit) ?? (wrongDay ? undefined : sorted[0])
      const out = (returns ?? []).length > 0
      if (intent === 'return') {
        if (!out) { say('Nothing to bring back right now: everything on your name is already returned.', [], [], true); return true }
        say('Let\'s do it. A few taps and one photo.', [{ who: 'return' }]); return true
      }
      if (intent === 'report') {
        if (!out) { say('I don\'t see any gear or props out on your name right now. If something in the house or the gear room is broken, tell the equipment team (Maanik) so it\'s fixed before the next shoot.', [], [], true); return true }
        say('Thanks for flagging it. Pick the piece and say what happened; the team gets it right away.', [{ who: 'report', text: q }]); return true
      }
      if (intent === 'pickup') { say('Here\'s where your props are.', [{ who: 'pickup' }]); return true }
      if (intent === 'take-gear') {
        const live = sorted.filter(x => x.status === 'booked')
        // Owner, Nov 3: gear isn't reserved any more; it's taken on the shoot day (from an hour before).
        const now0 = live.find(x => gw(x).state === 'take'), later = live.find(x => gw(x).state === 'early' || gw(x).state === 'reserve')
        // "reserve the drone", "book the fx3": gear isn't held ahead (owner, Nov 3), so say that first.
        const ahead = gearOn ? '' : /\b(book|reserve|rent|hold|save)\b/i.test(q) ? 'Gear can\'t be reserved ahead: it\'s first come, first served on your shoot day. ' : ''
        if (now0) { say(`${ahead}Your shoot is on (${label(now0)}). Pick what you're taking, then tick every piece and take one photo.`, [{ who: 'actions', items: [{ label: 'Pick the gear', to: '/gear', shootId: now0.id }] }]); return true }
        if (later) { say(`${ahead}For ${label(later)}: take what's free from an hour before your shoot. Nothing to do yet.`, [], [], true); return true }
        say(`${ahead}Gear goes with a shoot. Book a time first, then take what you need on the day.`, [], ['Find me a time today', 'Earliest free slot'], true); return true
      }
      if (intent === 'move' || intent === 'swap') {
        if (!named && wrongDay) { say(`I don't see a shoot of yours that day. Your next ones: ${sorted.slice(0, 3).map(label).join('; ')}.`, [], [], true); return true }
        if (!named) { say('You don\'t have any shoots coming up to change. Want to book one?', [], mixed().slice(0, 2), true); return true }
        const free = named.status === 'requested' ? 'It\'s still a request, so you can move it freely.' : `Moving is free with ${s.noticeHours} hours' notice; closer than that, a swap with someone is the only way without a strike.`
        say(intent === 'swap' ? `Your shoot: ${label(named)}. Open it and tap "Swap with someone" to ask another creator to trade.` : `Your shoot: ${label(named)}. ${free}`,
          [{ who: 'actions', items: [{ label: intent === 'swap' ? 'Swap it' : 'Move it', to: `/schedule?shoot=${named.id}` }, ...(intent === 'move' ? [{ label: 'Shoot offsite instead', to: `/schedule?offsite=${named.date}` }] : [])] }]); return true
      }
      if (intent === 'offsite') { say('Shooting somewhere else? Pick the day, the hours and the address. It still goes to the schedule team.', [{ who: 'actions', items: [{ label: 'Book an offsite shoot', to: `/schedule?offsite=${today}` }] }]); return true }
      if (intent === 'strikes') {
        const paused = !!myStatus?.pausedUntil && myStatus.pausedUntil > today
        say(paused ? `Prop requests are paused until ${formatDay(myStatus!.pausedUntil!.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}. You can still book filming time and take gear. Ask the schedule team if this looks wrong.`
          : myStatus?.strikes ? `You have ${myStatus.strikes} strike${myStatus.strikes === 1 ? '' : 's'} in the last ${s.strikeDays} days. ${s.strikeCount} in that time pauses prop requests for ${s.pauseDays} days.`
          : 'No strikes. You\'re all good.', [], [], true); return true
      }
      if (intent === 'requests') { say('Everything you asked for, by shoot, with where each one is.', [{ who: 'actions', items: [{ label: 'My requests', to: '/requests' }] }]); return true }
    }
    // Cancelling a shoot, and "is my shoot approved?" (owner, Nov 2: type it, it gets done).
    const c = ai ? (ai.intent === 'cancel' ? { shootId: pick?.id } : null) : cancelIntent(q, sorted.map(x => ({ id: x.id, date: x.date })))
    // "Cancel my props request" is about props, not the house slot (audit, Nov 5): send them to their requests instead.
    if (c && /\b(props?|costumes?|request)\b/i.test(q) && !/\b(shoot|booking|slot|time)\b/i.test(q)) {
      say('Props requests are cancelled from My requests: open the request and tap Cancel. Your shoot stays booked.', [{ who: 'actions', items: [{ label: 'My requests', to: '/requests' }] }], [], true); return true
    }
    if (c) {
      if (!sorted.length) { say('You don\'t have any shoots coming up.', [], [], true); return true }
      say(c.shootId ? 'Cancel this one?' : 'Which shoot do you want to cancel?', [{ who: 'cancel', shootId: c.shootId }]); return true
    }
    if (ai ? ai.intent === 'status' : isStatusQuestion(q)) {
      if (!upcoming.length) { say('Nothing booked yet. Tell me when you want to film.', [], mixed().slice(0, 3), true); return true }
      say('Here are your shoots coming up.', [{ who: 'status' }], mixed().slice(0, 3)); return true
    }
    return false
  }

  // The prop finder, the time finder and the how-to guide (each its own server helper, same budget and safety box).
  // The AI's own line was just shown for this message: helpers skip their canned summary (owner, Nov 3: less boilerplate).
  const aiSpoke = useRef(false)
  // `fresh`: a standalone time request (from the AI), so the time finder starts over instead of adjusting the last search.
  async function runHelpers(q: string, more: boolean, force?: Helper, shootId?: string, fresh = false) {
    const route: Route = helpOnly ? { helpers: ['help'] } : demo ? (routeMessage(q, { last: mode, shoots: [] }).helpers[0] === 'help' && !more && force !== 'props' ? { helpers: ['help'] } : { helpers: ['props'] }) : force ? { helpers: [force], ...(shootId ? { shootId } : {}) } : more || plan?.step === 'props' ? { helpers: ['props'] }
      : plan?.step === 'time' ? { helpers: ['time'] }
      : routeMessage(q, { last: mode, shoots: upcoming.map(x => ({ id: x.id, date: x.date })) })
    const hs = route.helpers, both = hs.length > 1
    const target = demo ? undefined : route.shootId ?? shoot?.id
    const named = route.shootId && route.shootId !== shoot?.id ? upcoming.find(x => x.id === route.shootId) : undefined
    if (route.shootId) choose(route.shootId)
    // Offer "Meant … instead?" only when the chat just picked a direction (not on every follow-up, nor after the AI chose).
    const offer = !demo && !both && !force && !plan && !more && mode !== hs[0]
    setMode(hs[hs.length - 1]); markMe(hs[0])
    setChips([]); setBusy(true)
    if (named && !force) setMsgs(x => [...x, { who: 'bot' as const, text: `For your shoot (${label(named)}). I'll check what's free that day.` }])
    const next: string[][] = []
    for (const h of hs) {
      setThinking(h)
      next.push(h === 'props' ? await sendProps(q, more, target, offer) : h === 'help' ? await sendHelp(q) : await sendTime(q, offer, fresh))
    }
    // Both ran: a few follow-ups from each.
    setChips(both ? nextSteps([...next[0].filter(c => c !== TIME_CHIP).slice(0, 1), ...next[1]]) : next[0])
    setThinking(null); setBusy(false)
  }

  // Each helper returns its follow-up chips. `offerOther` adds "Meant a time instead?" under its answer.
  // `pre`: the answer was already fetched (Say it once: both helpers ran at the same time for one message).
  async function sendProps(q: string, more: boolean, shootId: string | undefined, offerOther: boolean, pre?: Promise<IdeaResult>): Promise<string[]> {
    const history = msgs.flatMap(x => x.who === 'me' && x.mode === 'props' && x.text !== MORE ? [x.text] : [])
    try {
      // "More like these" repeats the last real ask as a second look.
      const idea = more ? (history[history.length - 1] ?? q) : q
      const r = pre ? await pre : (await ideaToProps({
        idea, history: more ? history.slice(0, -1) : history, exclude: [...new Set([...shownIds, ...sentPropIds, ...sentGearIds])], ...(more ? { searched, more: true } : {}),
        ...(shootId && !demo ? { shootId } : {}),
      })).data
      // Gear isn't booked ahead (owner, Nov 3): never show gear picks, and never offer filming equipment as "make or find".
      const kept = { ...r, groups: r.groups.map(g => ({ ...g, picks: g.picks.filter(p => !shownIds.includes(p.id) && (p.kind === 'prop' ? itemById.has(p.id) : !demo && gearOn)) })).filter(g => g.picks.length),
        missing: gearOn ? r.missing : r.missing.filter(m => !isFilmGear(m.name)) }
      const found = kept.groups.length + kept.missing.length > 0
      // Nothing (new) found: offer a plain search for the same words, so the chat is never a dead end.
      const quiet = aiSpoke.current && found; aiSpoke.current = false
      // "Not a video idea" (owner, Nov 4: "it blocked me"): ask what they want instead of refusing.
      if (r.note && !found && !demo) {
        pendingSwitch.current = q
        setMsgs(x => [...x, { who: 'bot', text: plan ? withNote('Hmm, I didn\'t catch a video idea there. Want to keep going with props, book a time instead, or start over?') : 'What\'s the video about? A scene, a character or a vibe is enough, and I\'ll find props for it. (Or did you mean a time to film?)' }])
        if (!plan) setMode('props')
        return plan ? [KEEP_GOING, SWITCH_TIME, START_OVER] : [...STARTERS.props.slice(0, 2), SWITCH_TIME]
      }
      setMsgs(x => [...x, { who: 'bot', text: quiet ? '' : r.note || r.reply || (found ? 'Here\'s what we have for that.' : 'Nothing new fits that. Try another angle, or search the closet.'),
        ...(found ? { result: kept } : r.note ? {} : { search: q }), ...(offerOther && !more ? { alt: { q, to: 'time' as const } } : {}) }])
      const own = (r.chips ?? []).filter(c => !/^more like these$/i.test(c.trim()))
      for (const c of own) helperChips.current.set(c, 'props')
      const next = [...(plan?.step === 'props' ? [gearOn ? NEXT_GEAR : NEXT_REVIEW] : []), ...(found ? [MORE] : []), ...(found && !shootId && !plan && !demo ? [TIME_CHIP] : []), ...own]
      return nextSteps(next)
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

  async function sendTime(q: string, offerOther: boolean, fresh = false, pre?: Promise<TimeAskResult>): Promise<string[]> {
    try {
      const r = pre ? await pre : (await askForTime({ text: q, ...(previous && !fresh ? { previous } : {}) })).data
      setPrevious(r.ask)
      const quiet = aiSpoke.current && r.options.length > 0; aiSpoke.current = false
      // The chat's own short reaction already showed: keep only the facts that matter ("5 PM isn't free; closest times").
      const said = quiet ? r.notice ?? '' : r.reply
      setMsgs(x => [...x, ...(said ? [{ who: 'bot' as const, text: said, ...(offerOther && !quiet ? { alt: { q, to: 'props' as const } } : {}) }] : []), ...(r.options.length ? [{ who: 'options' as const, options: r.options }] : [])])
      // Follow-ups that change something (never "Evenings only" when it already is).
      const a = r.ask as { timeOfDay?: string; houses?: string[] }
      const one = (h: string) => a.houses?.length === 1 && a.houses[0] === h
      const next = r.choices?.length ? r.choices : (r.friends.length ? ['Anything on the weekend?', one('cliff2') ? '' : `Only ${s.houses.cliff2.name}`, 'Just me, 2 hours']
        : [one('cliff2') ? `Only ${s.houses.cliff1.name}` : `Only ${s.houses.cliff2.name}`, 'Anything earlier?', a.timeOfDay === 'evening' ? 'Mornings instead' : 'Evenings only']).filter(Boolean)
      // Nobody named (and not "just me"): offer the usual partner, once. The tap re-runs this search with them.
      const named = r.friends.length > 0 || (Array.isArray((r.ask as { people?: unknown }).people) && ((r.ask as { people: unknown[] }).people.length > 0))
      if (!r.choices?.length && r.options.length && !named && partners[0] && !/\b(just me|only me|alone|solo)\b/i.test(q)) next.unshift(`With ${partners[0].label}?`)
      if (r.waitlist && !r.choices?.length) { const c = `Tell me if ${fmtTime(r.waitlist.start)} opens`; waitChips.current.set(c, r.waitlist); next.unshift(c) }
      const shown = r.choices?.length ? next : nextSteps(next)
      for (const c of shown) helperChips.current.set(c, 'time')
      return shown
    } catch (e) { setMsgs(x => [...x, { who: 'bot', text: errorText(e) }]); return [] }
  }

  // Cliff 1 Thursdays/Saturdays need the filming guideline (owner, Nov 3): the option asks for the PDF first.
  const [guideFor, setGuideFor] = useState<string | null>(null)
  const [guide, setGuide] = useState<Guideline | null>(null)
  const optKey = (o: TimeAskResult['options'][number]) => `${o.date}-${o.place}-${o.start}`
  // `typed`: they typed the pick ("the 5pm one") instead of tapping, so say which one is being sent.
  async function book(o: TimeAskResult['options'][number], typed = false) {
    // The schedule team (owner, also in creator mode; equipment) never needs a guideline, like the server (audit, Nov 7).
    const team = role === 'owner' || role === 'equipment' || realRole === 'owner'
    if (!team && needsGuideline(o.date, o.place, profile.email, s) && !(guide && guideFor === optKey(o))) {
      // Nothing is sent yet: say why, and where to add it (audit, Nov 7: a typed pick said "Asking for…" and stopped).
      if (guideFor !== optKey(o) || typed) setMsgs(x => [...x, { who: 'bot', text: `${formatDay(o.date, { weekday: 'long' })}s at ${house(o.place)} need your filming guideline (PDF). Nothing is sent yet: add it under the time above, then tap **${asks ? 'Request' : 'Book'}**.` }])
      setGuideFor(optKey(o)); return
    }
    if (typed) setMsgs(x => [...x, { who: 'bot', text: `${asks ? 'Asking for' : 'Booking'} **${formatDay(o.date, { weekday: 'short' })} · ${house(o.place)} · ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}**…` }])
    setBusy(true)
    try {
      const friends = o.slots.filter(x => !x.me).map(x => x.email)
      const r = (await bookWithFriends({ place: o.place, date: o.date, start: o.start, friends, mySlots: o.slots.filter(x => x.me).length, ...(guide && guideFor === optKey(o) ? { guideline: guide } : {}) })).data
      setPrevious(undefined)   // booked: the next time search starts from scratch (no friends or house carried over)
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

  // ── Say it once, confirm once (owner, Nov 7) ──
  // Both finders run at the same time for the one message. When the best free time and some free props come back, one
  // card shows them with ONE "Do it". Anything that needs more (a guideline PDF, too late for props, nothing found)
  // shows the usual separate answers, from the same answers (no second AI call).
  const onceId = useRef(0)
  const updOnce = (id: number, patch: Partial<OncePlan>) => setMsgs(x => x.map(y => y.who === 'once' && y.id === id ? { ...y, ...patch } : y))
  const freeOnDay = (id: string, date: string) => {
    const i = itemById.get(id)
    if (!i || i.archived || i.condition === 'damaged') return 0
    return freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' }, bookings[id] ?? [], date, date, today, turnaround(i), settings)
  }
  async function planOnce(turn: ChatTurn, pair: { time: string; props: string }) {
    markMe('time'); setChips([])
    if (turn.reply) setMsgs(x => [...x, { who: 'bot', text: turn.reply }])
    setBusy(true); setThinking('time')
    const history = msgs.flatMap(x => x.who === 'me' && x.mode === 'props' && x.text !== MORE ? [x.text] : [])
    const tp = askForTime({ text: pair.time }).then(r => r.data)
    const ip = ideaToProps({ idea: pair.props, history, exclude: [...new Set([...shownIds, ...sentPropIds])] }).then(r => r.data)
    const [tr, ir] = await Promise.allSettled([tp, ip])
    setThinking(null); setBusy(false)
    const t = tr.status === 'fulfilled' ? tr.value : null, idea = ir.status === 'fulfilled' ? ir.value : null
    if (t) setPrevious(t.ask)
    const o = t?.options[0]
    const team = role === 'owner' || role === 'equipment' || realRole === 'owner'
    const owner = role === 'owner' || realRole === 'owner'
    const picks = o && idea ? topPicks(idea.groups, id => freeOnDay(id, o.date)) : []
    const skip = planSkip({ hasTime: !!o, timeNote: !!t?.notice || !!t?.waitlist, needsGuideline: !!o && !team && needsGuideline(o.date, o.place, profile.email, s),
      tooLateForProps: !!o && !owner && today > lastDayToBook(o.date, settings.leadTimeDays, settings), picks: picks.length })
    if (skip || !t || !idea || !o) return separate(pair, tp, ip, !!turn.reply)
    setMsgs(x => [...x, { who: 'once', id: ++onceId.current, o, picks, ticks: picks, idea: pair.props, notice: t.notice ?? '', time: t, props: idea,
      propsQuery: pair.props, timeQuery: pair.time, stage: 'ready' }])
  }
  // Today's two answers (times with Request buttons, then the props with ticks).
  async function separate(pair: { time: string; props: string }, tp: Promise<TimeAskResult>, ip: Promise<IdeaResult>, aiSaid: boolean) {
    setBusy(true)
    aiSpoke.current = aiSaid
    const a = await sendTime(pair.time, false, true, tp)
    aiSpoke.current = false; markMe('time')
    const b = await sendProps(pair.props, false, undefined, false, ip)
    setMode('props'); setBusy(false)
    setChips(nextSteps([...a.slice(0, 1), ...b]))
  }
  // "Change something": the card turns into the usual separate answers; the props still ticked stay ticked there.
  function changeOnce(m: OncePlan) {
    setMsgs(x => x.filter(y => !(y.who === 'once' && y.id === m.id)))
    setSel(x => [...new Set([...x, ...m.ticks.map(id => `p:${id}`)])]); setAddedTo('')
    void separate({ time: m.timeQuery, props: m.propsQuery }, Promise.resolve(m.time), Promise.resolve(m.props), false)
  }
  // "Do it" = the same taps as before, in order: ask for (or book) the time, then send the ticked props for that shoot.
  // Booking fails → nothing else is sent. Props fail → the time stays requested and "Send props" tries again.
  async function doOnce(m: OncePlan) {
    if (busy) return
    setBusy(true)
    let shootId = m.shootId
    if (!shootId) {
      updOnce(m.id, { stage: 'booking', error: undefined })
      try {
        const friends = m.o.slots.filter(x => !x.me)
        const r = (await bookWithFriends({ place: m.o.place, date: m.o.date, start: m.o.start, friends: friends.map(x => x.email), mySlots: m.o.slots.filter(x => x.me).length })).data
        shootId = r.shootIds[0]
        setPrevious(undefined)
        updOnce(m.id, { shootId, requested: r.status === 'requested', invited: friends.map(x => x.name.split(' ')[0]) })
      } catch (e) { updOnce(m.id, { stage: 'failed', error: errorText(e) }); setBusy(false); return }
    }
    if (!m.ticks.length) { updOnce(m.id, { stage: 'done', sent: 0 }); setBusy(false); return }
    updOnce(m.id, { stage: 'sending', error: undefined })
    try {
      await createReservation({ title: videoName(m.idea), notes: '', startDate: m.o.date, endDate: m.o.date, scheduleShootId: shootId,
        lines: m.ticks.map(itemId => ({ itemId, qty: 1 })), builds: [] })
      updOnce(m.id, { stage: 'done', sent: m.ticks.length })
    } catch (e) { updOnce(m.id, { stage: 'propsFailed', error: friendlyError(e, 'The props didn\'t go through.') }) } finally { setBusy(false) }
  }

  async function waitFor(c: string, w: { date: string; house: House; start: number }) {
    setMsgs(x => [...x, { who: 'me', text: c, mode: 'time' }]); setChips([]); setBusy(true)
    try {
      const r = (await joinWaitlist(w)).data
      bot(`You're on the list for **${formatDay(w.date, { weekday: 'short' })} · ${fmtTime(w.start)} at ${house(w.house)}**${r.position > 1 ? ` (#${r.position} in line)` : ''}. If it opens up, it's held for you for ${INVITE_HOLD_MINUTES} minutes and you get a notification. Leave the list from the bell on that time in the Calendar.`)
    } catch (e) { bot(errorText(e)) } finally { setBusy(false) }
  }

  // After booking a time here: brainstorm props for that shoot in the same chat (free/taken for its day).
  function propsFor(shootId: string) {
    choose(shootId); setMode('props'); setChips(STARTERS.props)
    bot('What\'s the video about? I\'ll find props we have and check they\'re free for that shoot.')
  }
  function askTime() { setMode('time'); setChips(STARTERS.time); bot(OPENERS.time) }

  function chip(c: string) {
    if (c === START_OVER) return restart()
    if (c === KEEP_GOING) { bot(plan?.step === 'time' ? 'Cool. When do you want to film, and for how long?' : 'Cool. What\'s the video about? A scene, a character or a vibe is enough.'); return }
    if (c === SWITCH_TIME || c === SWITCH_PROPS) {
      // Leave the plan and do what they asked, with the words they already typed.
      const last = pendingSwitch.current; pendingSwitch.current = ''
      setPlan(null); setSel([])
      if (last) return send(last, false, c === SWITCH_TIME ? 'time' : 'props')
      return c === SWITCH_TIME ? askTime() : (setMode('props'), bot('What\'s the video about?'))
    }
    if (c === NEXT_GEAR || c === SKIP_PROPS) return planGear()
    if (c === NEXT_REVIEW) return planReview()
    if (c === TIME_CHIP) return askTime()
    const w = waitChips.current.get(c)
    if (w) return waitFor(c, w)
    if (c === PROPS_CHIP) { const b = [...msgs].reverse().find(x => x.who === 'booked'); if (b && b.who === 'booked') propsFor(b.shootId); return }
    const h = c !== MORE ? helperChips.current.get(c) : undefined
    if (h) return send(c, false, h)
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
  const go = (to: string, state?: unknown) => { if (rec.current) stopTalk(); if (!page) onClose(); navigate(to, state ? { state } : undefined) }
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
    ? <button onClick={() => go(`/item/${k.slice(2)}`)} aria-label={`See ${name}`} className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-pt-border text-pt-text text-[22px]">›</button>
    : inBasket && !sel.includes(k)
    ? <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent/20 text-pt-accent" title="Already in your shoot">✓</span>
    : <button onClick={() => toggle(k)} aria-pressed={sel.includes(k)} aria-label={`${sel.includes(k) ? 'Untick' : 'Tick'} ${name}`}
        className={`w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 ${sel.includes(k) ? 'pop bg-[#BF9DFF] text-[#140f22]' : 'bg-pt-border text-pt-text text-[22px]'}`}>
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
                <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-[22px] bg-violet-500/10 shrink-0"><Icon name="tools" className="w-6 h-6 text-violet-300" /></span>
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

  // The one-card plan (Say it once). Gold "act" card: the time as the title, the props as photo rows with ticks, one "Do it".
  const renderOnce = (m: OncePlan) => {
    const o = m.o, when = `${formatDay(o.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}`
    const who = o.slots.length > 1 ? o.slots.map(x => `${x.me ? 'You' : x.name.split(' ')[0]} ${fmtTime(x.start)}`).join(' · ') : ''
    const verb = asks ? 'request' : 'book'
    const n = m.ticks.length, props = `${n} prop${n === 1 ? '' : 's'}`
    if (m.stage === 'done') {
      const time = m.requested ? 'Requested ✓' : 'Booked ✓'
      return (
        <ChatCard tone="good" icon="check" label={m.sent ? `${time} · ${m.sent} prop${m.sent === 1 ? '' : 's'} sent` : time} title={when}
          sub={[house(o.place), m.requested ? 'You\'ll get a notification when the schedule team approves it.' : '', m.invited?.length ? `${m.invited.join(' and ')}: their slot is held ${INVITE_HOLD_MINUTES} min for them to confirm.` : ''].filter(Boolean).join(' · ')}
          actions={<button onClick={() => go(`/schedule?shoot=${m.shootId}`)} className={primaryBtn}>Open the shoot</button>} />
      )
    }
    if (m.stage === 'propsFailed') {
      return (
        <ChatCard tone="warn" icon="alert" label={`Your time is ${m.requested ? 'requested' : 'booked'}`} title={when}
          sub={`Props weren't sent: ${m.error ?? 'try again.'}`}
          actions={<>
            <button disabled={busy} onClick={() => doOnce(m)} className={primaryBtn}>Send props</button>
            <button onClick={() => go(`/schedule?shoot=${m.shootId}`)} className={secondaryBtn}>Open the shoot</button>
          </>} />
      )
    }
    const working = m.stage === 'booking' || m.stage === 'sending'
    return (
      <ChatCard tone="act" icon="calendar" label={asks ? 'Ready to request' : 'Ready to book'} title={when} sub={[house(o.place), who].filter(Boolean).join(' · ')}
        actions={<>
          <button disabled={busy} onClick={() => doOnce(m)} className={primaryBtn}>
            {m.stage === 'booking' ? (asks ? 'Requesting…' : 'Booking…') : m.stage === 'sending' ? 'Sending props…' : m.stage === 'failed' ? 'Try again' : n ? 'Do it' : `${asks ? 'Request' : 'Book'} the time only`}</button>
          {!working && <button onClick={() => changeOnce(m)} className={secondaryBtn}>Change something</button>}
        </>}>
        {m.notice && <p className="text-[14px] text-amber-200 mb-2">{m.notice}</p>}
        <div className="space-y-2">
          {m.picks.map(id => {
            const it = itemById.get(id); if (!it) return null
            const on = m.ticks.includes(id)
            return (
              <div key={id} className={`flex items-center gap-3 rounded-2xl bg-black/25 p-2 ${on ? '' : 'opacity-60'}`}>
                <button onClick={() => go(`/item/${id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                  <span className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">{it.photos[0] && <img loading="lazy" decoding="async" src={thumbOf(it, it.photos[0])} alt="" className="w-full h-full object-cover" />}</span>
                  <span className="min-w-0"><b className="block text-[16px] truncate">{it.name}</b><span className="block text-xs text-green-300">Free that day</span></span>
                </button>
                <button disabled={working} aria-pressed={on} aria-label={`${on ? 'Untick' : 'Tick'} ${it.name}`}
                  onClick={() => updOnce(m.id, { ticks: on ? m.ticks.filter(x => x !== id) : [...m.ticks, id] })}
                  className={`w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 ${on ? 'bg-pt-accent text-stone-900' : 'bg-pt-border text-pt-text text-[22px]'}`}>{on ? '✓' : '+'}</button>
              </div>
            )
          })}
        </div>
        {m.error && <p className="text-[14px] text-red-300 mt-3">Nothing was sent: {m.error}</p>}
        {!m.error && <p className="text-[14px] text-pt-muted mt-3">{n ? `"Do it" will ${verb} this time, then send ${props} for "${videoName(m.idea)}" to the arts team.` : `Nothing ticked: "${asks ? 'Request' : 'Book'}" only ${verb}s the time.`}</p>}
      </ChatCard>
    )
  }

  const choice = (m: AssistantMode, icon: string, title: string, sub: string) => (
    <button onClick={() => m === 'plan' ? startPlan() : (setPlan(null), switchTo(m))} className="w-full flex items-center gap-3 p-4 rounded-[20px] text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] active:scale-[0.98] transition-transform">
      <span className="w-[42px] h-[42px] rounded-[13px] grid place-items-center text-[22px] bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">{icon}</span>
      <span className="flex-1 min-w-0"><b className="block text-base">{title}</b><span className="text-pt-muted text-[14px]">{sub}</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )

  // The empty chat (owner, Nov 3: "too busy… clean like the best apps"): a hello, then a short list of things to try.
  const welcome = page && !msgs.some(m => m.who === 'me') && !plan
  // One answer = everything the chat said since your last message (text, then its times / props / cards, then its chips),
  // shown as one block. What comes after a reply that's still typing waits until it has finished.
  const lastMe = msgs.map(m => m.who).lastIndexOf('me')
  const tail = { bot: lastMe < msgs.length - 1, open: msgs.slice(lastMe + 1).every(isDone) }
  const chipButtons = chips.map(c => {
    const special = c === MORE || c === TIME_CHIP || c === PROPS_CHIP || c === NEXT_GEAR || c === SKIP_PROPS || c === NEXT_REVIEW || c === SWITCH_TIME || c === SWITCH_PROPS
    return <button key={c} onClick={() => chip(c)} className={`shrink-0 inline-flex items-center gap-1 rounded-full px-3.5 min-h-[40px] text-[14px] ${special ? 'bg-[#BF9DFF]/15 text-[#CDB8FF] font-semibold' : 'bg-white/[0.06] text-pt-text'}`}>{c === MORE ? '✦ More like these' : c}</button>
  })
  function asTurns(els: (JSX.Element | null)[]) {
    const out: JSX.Element[] = []
    let turn: { key: number; kids: JSX.Element[] } | null = null, open = true
    const close = () => { if (turn) { const t = turn; out.push(<div key={`t${t.key}`} className="space-y-3">{t.kids}</div>) } turn = null }
    msgs.forEach((m, i) => {
      const el = els[i]
      if (m.who === 'me') { close(); open = true; if (el) out.push(el); return }
      if (!turn) turn = { key: i, kids: [] }
      if (!open) return
      if (el) turn.kids.push(el)
      if (!isDone(m)) open = false
    })
    // The newest answer ends with its next steps (no more than 2, chosen for what just happened).
    if (turn && open && chips.length > 0 && !busy && !welcome) (turn as { kids: JSX.Element[] }).kids.push(
      <div key="chips" className="fade-in -mx-5 px-5 flex gap-2 overflow-x-auto no-scrollbar" aria-label="Next steps">{chipButtons}</div>)
    close()
    return out
  }
  const nextShoot = [...upcoming].sort((a, b) => a.from.localeCompare(b.from))[0]
  // Starter cards (owner, Nov 3: "like the top apps"): concrete, about YOUR week, right above the typing box.
  const wd = (d: string) => WEEKDAY[new Date(d + 'T12:00:00').getDay()]
  const hasOut = (returns ?? []).length > 0
  // Shoot day (owner, Nov 3): "Take gear" is a starter card, not a card in the chat.
  const takeShoot = upcoming.find(x => x.status === 'booked' && gw(x).state === 'take')
  const propsShoot = [...upcoming].sort((a, b) => a.from.localeCompare(b.from)).find(x => today <= cutoffs(x).props && !x.checkin)
  type Sugg = { icon: IconName; title: string; sub: string; ai?: boolean; go: () => void }
  const sugg: (Sugg | false)[] = helpOnly || demo ? [] : [
    !!takeShoot && { icon: 'camera', title: 'Take gear', sub: 'Pick it, tick every piece, one photo', go: () => { choose(takeShoot.id); navigate('/gear') } },
    hasOut && { icon: 'box', title: 'Bring gear back', sub: 'A few taps, one photo', go: () => { send('I\'m returning everything') } },
    !!propsShoot && { icon: 'sparkle', ai: true, title: `Props for ${formatDay(propsShoot.date, { weekday: 'short' })}`, sub: `Ideas for that shoot · by ${formatDay(cutoffs(propsShoot).props)}`, go: () => { send(`Props for my ${wd(propsShoot.date)} shoot`) } },
    { icon: 'calendar', title: 'Book a time', sub: mixed()[0].replace(/^Book /, ''), go: () => { send(mixed()[0]) } },
    { icon: 'people', title: 'With a friend', sub: 'Back-to-back slots this week', go: () => { send('Find me 2 hours this week with a friend') } },
    { icon: 'sparkle', ai: true, title: 'Props for an idea', sub: STARTERS.props[1], go: () => { send(STARTERS.props[1]) } },
    { icon: 'list', ai: true, title: 'Plan my whole shoot', sub: 'Time and props', go: () => startPlan() },
    nextShoot ? { icon: 'check', title: 'Is it approved?', sub: 'Where your shoots are at', go: () => { send('Is my shoot approved?') } }
      : { icon: 'help', title: 'How does it work?', sub: 'Booking and props', go: () => { send('How does booking work?') } },
  ]
  const suggestions = sugg.filter((x): x is Sugg => !!x).slice(0, 6)


  return (
    <div className={page ? 'h-full bg-pt-bg flex flex-col' : `fixed inset-0 z-50 bg-pt-bg flex flex-col ${shown ? '' : 'hidden'}`} role={page ? 'main' : 'dialog'} aria-label={page ? 'Chat' : 'AI helper'}>
      <div className="pt-safe px-5 shrink-0">
        {page ? (
          <div className="flex items-center gap-2 py-2">
            <BrandMark className="w-7 h-7 text-white" title="" />
            <h1 className="font-display text-[28px] font-extrabold tracking-tight flex-1">Chat</h1>
            {(msgs.length > 2 || old.length > 0) && !busy && <button onClick={askRestart} className="tap text-pt-muted text-sm">New chat</button>}
          </div>
        ) : <>
        <div className="flex items-center justify-between py-3">
          <button onClick={onClose} className="text-pt-accent text-[16px]">‹ Back</button>
          {(msgs.length > 2 || old.length > 0) && !busy && <button onClick={askRestart} className="tap text-pt-muted text-sm">New chat</button>}
        </div>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>AI helper</h1>
        </>}
        {plan ? (
          <div className="flex gap-1.5 mt-1" aria-label="Plan my shoot steps">
            {STEPS.filter(x => gearOn || x[0] !== 'gear').map(([k, t], n, steps) => {
              const at = steps.findIndex(x => x[0] === plan.step), done = n < at, now = n === at
              return <span key={k} className="flex-1"><span className={`block h-1 rounded-full ${done || now ? 'bg-[#BF9DFF]' : 'bg-pt-border'}`} /><span className={`block text-xs mt-1 ${now ? 'text-pt-text font-semibold' : 'text-pt-muted'}`}>{done ? '✓ ' : ''}{t}</span></span>
            })}
          </div>
        ) : page ? null : <p className="text-pt-muted text-[14px]">{helpOnly ? 'Ask how anything in the app works.' : demo ? 'Prop ideas for your videos, from our real closet.' : <>Ideas from our real props and gear, and times that are actually free.{shoot ? ` Checking free or taken for ${label(shoot)}.` : ''}</>}</p>}
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 [mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)]">
        {old.length > 0 && (
          <div className="space-y-3" aria-label="Earlier in this chat">
            <div className="flex items-center gap-3 text-pt-muted text-xs" role="separator"><span className="h-px flex-1 bg-white/10" />Earlier<span className="h-px flex-1 bg-white/10" /></div>
            {old.map((m, i) => m.who === 'me'
              ? <p key={`o${i}`} className="ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[16px] text-pt-text bg-pt-accent/25 whitespace-pre-line">{m.text}</p>
              : <p key={`o${i}`} className="max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[16px] leading-snug text-pt-text/80 bg-white/[0.05] whitespace-pre-line">{m.text.replace(/\*\*/g, '')}</p>)}
            <div ref={nowRef} className="h-px bg-white/10" />
          </div>
        )}
        {welcome && (
          <div className="rise-in pt-1 pb-1">
            <h2 className="font-display text-[28px] leading-tight font-extrabold tracking-tight">{old.length ? (first ? `Welcome back, ${first}.` : 'Welcome back.') : first ? `Hi ${first}.` : 'Hi.'}</h2>
            <p className="text-pt-muted text-[16px]">What are we making today?</p>
          </div>
        )}
        {page && canBook && !demo && <ChatNow chatting={!welcome} onAsk={q => send(q, false, 'time', true)} onProps={id => propsFor(id)} />}
        {asTurns(msgs.map((m, i) => (page && i === 0 && m.who === 'bot') || (page && m.who === 'choose') ? null : m.who === 'me' ? (
          <p key={i} className="rise-in ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[16px] text-stone-900 bg-pt-accent">{m.text}</p>
        ) : m.who === 'bot' ? (
          <div key={i} className="space-y-3">
            {m.text && <TypeOut text={m.text} animate={!isDone(m)} onDone={() => textDone(m)} onGrow={follow}
              className="rise-in max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[16px] leading-snug bg-white/[0.07]" />}
            {isDone(m) && <div className="fade-in space-y-3 empty:hidden">
            {m.result?.fallback && <p className="text-pt-muted text-xs">Quick match: the AI was busy, so these are the closest props by name and tags.</p>}
            {m.guide && (m.guide.steps.length > 0 || m.guide.links.length > 0) && (
              <div className="rise-in space-y-2">
                {m.guide.steps.length > 0 && <ol className="max-w-[86%] list-decimal pl-9 space-y-1 text-[16px]">{m.guide.steps.map((st, k) => <li key={k}>{st}</li>)}</ol>}
                {m.guide.links.length > 0 && <div className="flex flex-wrap gap-2">{m.guide.links.map(l => (
                  <button key={l.path} onClick={() => go(l.path)} className="rounded-full px-4 min-h-[44px] text-[14px] font-semibold bg-pt-accent/15 text-pt-accent">Open {l.label} ›</button>))}</div>}
              </div>
            )}
            {m.result && renderResult(m.result)}
            {(m.retry || m.search) && i === lastBot && !busy && (
              <div className="flex flex-wrap gap-2">
                {m.retry && <button onClick={() => send(m.retry!)} className="rounded-full px-4 min-h-[44px] text-[14px] font-semibold bg-[#BF9DFF]/20 text-[#CDB8FF]">Try again</button>}
                {m.search && <button onClick={() => go(`/browse?q=${encodeURIComponent(m.search!.slice(0, 80))}`)} className="rounded-full px-4 min-h-[44px] text-[14px] font-semibold bg-pt-border">Search the closet for "{m.search.length > 24 ? `${m.search.slice(0, 24)}…` : m.search}"</button>}
              </div>
            )}
            {m.alt && i === lastBot && !busy && !plan && (
              <button onClick={() => send(m.alt!.q, false, m.alt!.to)} className="tap text-[14px] text-[#CDB8FF] underline underline-offset-2">
                {m.alt.to === 'time' ? 'Meant a time to film? Find one' : 'Meant props for this? Find some'}</button>
            )}
            </div>}
          </div>
        ) : m.who === 'choose' ? (
          <div key={i} className="rise-in space-y-2">
            {choice('plan', '✦', 'Plan my shoot with me', gearOn ? 'Time, props and gear, step by step. You check it all at the end' : 'Time and props, step by step. You check it all at the end')}
          </div>
        ) : m.who === 'options' ? (
          <div key={i} className="rise-in space-y-2">
            {m.options.map(o => (
              <div key={`${o.date}-${o.place}-${o.start}`} className="flex items-center gap-3 rounded-[18px] bg-pt-surface border border-pt-accent/40 px-4 py-3">
                <span className="w-12 text-center shrink-0"><span className="block text-xs text-pt-muted">{formatDay(o.date, { weekday: 'short' })}</span><b className="block font-display text-[22px] leading-none font-extrabold">{Number(o.date.slice(8))}</b></span>
                <span className="flex-1 min-w-0">
                  <b className="block">{house(o.place)} · {fmtSlot(o.start, o.slots.length * s.slotMinutes)}</b>
                  <span className="block text-pt-muted text-[14px]">{o.slots.map(x => `${x.me ? 'You' : x.name.split(' ')[0]} ${fmtTime(x.start)}`).join(' · ')}</span>
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
                <b className="block text-[16px]">{label(sh)}</b>
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
                    : <button disabled={free === 0} onClick={() => gearCart.setQty(b.id, 1)} aria-label={`Add ${b.name}`} className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-border text-pt-text text-[22px] disabled:opacity-30">+</button>}
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
              return <>{row('Props', props, 'None yet')}{builds.length > 0 && row('To make or find', builds, '')}{gearOn && row('Gear', gear, 'None')}</>
            })()}
            {openRequest && (cart.count > 0) ? (<>
              <button onClick={() => go(`/reservations/${openRequest.id}`, { add: { lines: cart.lines, builds: cart.builds.map(b => ({ description: b.description, qty: b.qty, ...(b.refPhoto ? { refPhoto: b.refPhoto } : {}) })) } })}
                className="w-full rounded-xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add the props to my sent request ›</button>
              <p className="text-pt-muted text-xs -mt-1">Your request is still "Requested", so these join it. You check it and tap Save.{gearOn && Object.keys(gearCart.lines).length ? ' Gear is sent on the Your shoot page.' : ''}</p>
              {gearOn && Object.keys(gearCart.lines).length > 0 && <button onClick={() => go('/reserve', { title: planIdea() })} className="w-full rounded-xl py-3 font-semibold bg-pt-border">Send the gear ›</button>}
            </>) : (
              <button onClick={() => go('/reserve', { title: planIdea() })} className="w-full rounded-xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Review &amp; send ›</button>
            )}
            <div className="flex gap-2">
              <button onClick={() => plan?.shootId && planProps(plan.shootId, plan.label)} className="flex-1 rounded-xl py-3 text-sm font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ More props</button>
              {gearOn && <button onClick={planGear} className="flex-1 rounded-xl py-3 text-sm font-semibold bg-pt-border">Gear</button>}
              <button onClick={() => go('/browse')} className="flex-1 rounded-xl py-3 text-sm font-semibold bg-pt-border">Browse all</button>
            </div>
          </div>
        ) : m.who === 'once' ? (
          <div key={i}>{renderOnce(m)}</div>
        ) : m.who === 'actions' ? (
          <div key={i} className="rise-in flex flex-wrap gap-2">{m.items.map((a, k) => (
            <button key={a.label} onClick={() => { if (a.shootId) choose(a.shootId); if (a.ask) send(a.ask); else if (a.to === '#report') bugReport.start(); else if (a.to === '#report-now') void bugReport.now(); else if (a.to) go(a.to) }}
              className={`rounded-xl px-4 min-h-[44px] font-semibold ${k === 0 ? 'bg-pt-accent text-stone-900' : 'bg-pt-border text-pt-text'}`}>{a.label}</button>))}
          </div>
        ) : m.who === 'return' ? (
          returns && returns.length ? <ReturnCard key={i} groups={returns} count={returns.reduce((n, g) => n + returnCount(g), 0)} label={label} onReturned={() => setMsgs(x => [...x.filter(y => y !== m), { who: 'bot', text: 'Returned ✓ The team will check it in. Thanks!' }])} /> : null
        ) : m.who === 'report' ? (
          returns && returns.length ? <ReportCard key={i} groups={returns} first={m.text} onSent={() => setMsgs(x => [...x.filter(y => y !== m), { who: 'bot', text: 'Reported ✓ The team knows. Keep using it carefully and bring it back as usual.' }])} /> : null
        ) : m.who === 'pickup' ? (
          <PickupList key={i} />
        ) : m.who === 'now' ? (
          (() => { const sh = (recent ?? []).find(x => x.id === m.shootId); return sh ? <ShootNow key={i} shoot={sh} /> : null })()
        ) : m.who === 'cancel' ? (
          <CancelCard key={i} shootId={m.shootId} shoots={[...upcoming].sort((a, b) => a.from.localeCompare(b.from))} label={label} />
        ) : m.who === 'status' ? (
          <div key={i} className="rise-in space-y-2">
            {[...upcoming].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 5).map(sh => (
              <button key={sh.id} onClick={() => go(`/schedule?shoot=${sh.id}`)} className="w-full flex items-center gap-3 text-left rounded-[18px] bg-pt-surface px-4 py-3">
                <b className="flex-1 min-w-0 text-[16px]">{label(sh)}</b>
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
              const expired = inv.status === 'pending' && inv.until <= nowStamp()   // studio time, like the hold (audit: UTC made every hold look over)
              const [txt, cls] = inv.status === 'accepted' ? ['Confirmed ✓', 'bg-green-500/15 text-green-400']
                : inv.status === 'pending' && !expired ? [`Held until ${fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))}`, 'bg-amber-400/15 text-amber-300']
                : ['Not confirmed', 'bg-pt-border text-pt-muted']
              return <div key={id} className="flex items-center justify-between text-sm"><span>{inv.toName} · {fmtTime(inv.start)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{txt}</span></div>
            })}
            {!plan && (sel.length > 0
              ? <button onClick={() => addTo(m.shootId, m.label)} className="w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold">Add the {sel.length} ticked to this shoot</button>
              : <button onClick={() => propsFor(m.shootId)} className="w-full rounded-xl py-3 font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ Find props for this shoot</button>)}
            {!plan && <button onClick={() => { choose(m.shootId); go('/browse') }} className="w-full rounded-xl py-3 font-semibold bg-pt-border">Browse props</button>}
          </div>
        ) : null))}
        {busy && <div role="status" aria-label="Thinking" className="rise-in flex items-center gap-3">
          <p className="w-fit flex items-center gap-1.5 rounded-[20px] rounded-bl-md px-4 py-4 bg-[#BF9DFF]/10"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></p>
          {thinking && <span className="text-pt-muted text-[14px]">{thinking === 'chat' ? '' : thinking === 'props' ? 'Looking through the props…' : thinking === 'help' ? 'Looking at how the app works…' : 'Checking the schedule…'}</span>}
        </div>}
        {addedTo && <p className="text-pt-accent text-sm text-center">Added to {addedTo} ✓ <button onClick={() => go('/reserve')} className="tap underline">Review it</button></p>}
        <div ref={end} />
      </div>

      <div className="shrink-0 px-4 pt-2 pb-safe bg-pt-bg">
        {sel.length > 0 && plan?.step === 'props' ? (
          <button onClick={planGear} className="w-full mb-3 rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} &amp; {gearOn ? 'go to gear' : 'review'} ›</button>
        ) : plan && plan.step !== 'time' && plan.step !== 'review' && sel.length === 0 ? null : sel.length > 0 ? (
          <button onClick={() => setPicking(true)} className="w-full mb-3 rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add {sel.length} to a shoot</button>
        ) : (cart.count + (gearOn ? gearCart.count : 0)) > 0 && results.length > 0 ? (
          <button onClick={() => go('/reserve')} className="w-full mb-3 rounded-2xl py-3 font-semibold text-pt-accent bg-pt-accent/10">Review your shoot · {cart.count + (gearOn ? gearCart.count : 0)}</button>
        ) : null}
        {welcome && suggestions.length > 0 && (
          <div className="-mx-4 px-4 scroll-px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory" aria-label="Suggestions">
            {suggestions.map(x => (
              <button key={x.title} onClick={x.go} className="snap-start shrink-0 w-[172px] rounded-2xl bg-pt-surface px-3.5 py-3 text-left">
                <span className={`flex items-center gap-1.5 text-[14px] font-semibold ${x.ai ? 'text-[#CDB8FF]' : 'text-pt-text'}`}>
                  <Icon name={x.icon} className={`w-4 h-4 shrink-0 ${x.ai ? 'text-[#BF9DFF]' : 'text-pt-accent'}`} /><span className="truncate">{x.title}</span></span>
                <span className="block mt-0.5 text-[14px] leading-snug text-pt-muted line-clamp-2">{x.sub}</span>
              </button>
            ))}
          </div>
        )}
        {chips.length > 0 && !busy && !welcome && !tail.bot && <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">{chipButtons}</div>}
        {listening && (
          <div className="mb-2 flex items-start gap-3 rounded-2xl bg-[#BF9DFF]/10 px-4 py-3 shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.4)]" aria-live="polite">
            <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden />
            <p className={`flex-1 min-w-0 text-[16px] ${heard ? 'text-pt-text' : 'text-[#CDB8FF]'}`}>{heard || 'Listening… just say it.'}</p>
            <button onClick={stopTalk} className="shrink-0 text-[#CDB8FF] text-sm font-semibold tap">Stop</button>
          </div>
        )}
        {micErr && <p className="mb-2 text-amber-300 text-xs">{micErr}</p>}
        <div className="pb-2">
          <div className="flex items-center gap-1 rounded-full bg-pt-surface pl-4 pr-1.5 focus-within:shadow-[inset_0_0_0_1px_rgba(191,157,255,0.55)]">
            <label htmlFor="aiAsk" className="sr-only">Message</label>
            <input id="aiAsk" value={text} onChange={e => setText(e.target.value.slice(0, 600))} onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder={listening ? 'Listening…' : helpOnly ? 'How do I…?' : demo ? 'Describe your video idea…' : plan?.step === 'time' ? 'When do you want to film?' : plan?.step === 'props' ? 'What\'s your video about?' : 'Message'}
              className="flex-1 min-w-0 bg-transparent py-3 text-base focus:outline-none focus:shadow-none" />
            {Speech && (listening || !text.trim()) && (
              <button onClick={talk} aria-label={listening ? 'Stop listening' : 'Talk'}
                className={`w-11 h-11 rounded-full grid place-items-center shrink-0 ${listening ? 'bg-red-500 text-white' : 'text-[#BF9DFF]'}`}>
                {listening
                  ? <span className="w-3.5 h-3.5 rounded-[3px] bg-white" aria-hidden />
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
              </button>
            )}
            {(text.trim() || !Speech) && (
              <button onClick={() => send()} disabled={!text.trim() || busy} aria-label="Send" className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-lg font-bold disabled:opacity-40">↑</button>
            )}
          </div>
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
                <span className="block text-pt-text text-[16px] font-semibold">{label(sh)}</span>
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
  const { realRole } = useSession()
  const [pick, setPick] = useState<string | undefined>(shootId)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')
  const sh = shoots.find(x => x.id === pick)
  if (done) return <p className="rise-in text-green-400 text-[16px] font-semibold">{done}</p>
  if (!sh) return (
    <div className="rise-in space-y-2">
      {shoots.slice(0, 5).map(x => <button key={x.id} onClick={() => setPick(x.id)} className="w-full text-left rounded-[18px] bg-pt-surface px-4 py-3 text-[16px] font-semibold">{label(x)}</button>)}
    </div>
  )
  const nowS = new Date().toLocaleString('sv-SE', { timeZone: 'America/Toronto' }).slice(0, 16).replace(' ', 'T')
  // The owner (also in creator mode) is the schedule team to the server: never a strike.
  const strike = realRole !== 'owner' && cancelCountsAsNoShow(sh, nowS, s)
  async function go() {
    setBusy(true); setErr('')
    try {
      await cancelShoot({ id: sh!.id, ...(strike ? { confirmNoShow: true } : {}) })
      setDone(sh!.status === 'requested' ? 'Request withdrawn ✓ The time is free again.' : 'Cancelled ✓ Props on it were cancelled too.')
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rise-in rounded-[18px] bg-pt-surface p-4 space-y-3">
      <b className="block text-[16px]">{label(sh)}</b>
      <p className={`text-[14px] ${strike ? 'text-red-300' : 'text-pt-muted'}`}>{sh.status === 'requested' ? 'It\'s still a request, so withdrawing it is free.'
        : strike ? `It's less than ${s.noticeHours} hours away, so cancelling now counts as a no-show (a strike). A swap with someone avoids that.` : 'Cancelling now is free. Props and gear on this shoot are cancelled too.'}</p>
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={go} className={`flex-1 rounded-xl py-3 font-bold disabled:opacity-40 ${strike ? 'bg-red-500/20 text-red-200' : 'bg-pt-accent text-stone-900'}`}>{busy ? 'Cancelling…' : sh.status === 'requested' ? 'Withdraw it' : strike ? 'Cancel anyway' : 'Yes, cancel it'}</button>
        <button disabled={busy} onClick={() => setDone('Kept ✓')} className="rounded-xl px-4 font-semibold bg-pt-border">Keep it</button>
      </div>
    </div>
  )
}

// Your own slot after booking in the chat: live, so it changes from "Waiting for OK" to "Approved ✓" — and to
// "Not approved", "Ran out", "Cancelled" or "Filmed ✓" later (the chat stays open for days; audit, Nov 7).
function BookedYou({ shootId }: { shootId: string }) {
  const sh = useShoot(shootId)
  if (sh === undefined) return null   // still loading
  const amber = 'bg-amber-400/15 text-amber-300', green = 'bg-green-500/15 text-green-400', red = 'bg-red-500/15 text-red-300', grey = 'bg-pt-border text-pt-muted'
  const over = !!sh && sh.status === 'booked' && sh.to <= nowStamp()
  const [txt, cls] = !sh || sh.status === 'cancelled' ? ['Cancelled', grey]
    : sh.status === 'denied' ? ['Not approved', red]
    : sh.status === 'expired' ? ['Ran out', grey]
    : sh.status === 'requested' ? ['Waiting for OK', amber]
    : over ? (sh.wrap || sh.checkin ? ['Filmed ✓', green] : ['Done', grey])
    : sh.moveRequest ? ['Move asked', amber]
    : ['Approved ✓', green]
  return <div className="flex items-center justify-between text-sm"><span>You</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{txt}</span></div>
}
