// App tour: a hands-on practice STORY with a guide character (owner, Oct 20: "fun and exciting… like Duolingo… lean into
// the story… nobody has used this before"). Welcome (what the app is for) → meet Cap (the Prime Capitol eagle) → 10 chapters (CHAPTERS in Fun.tsx), each opened by a ChapterCard with the badge
// just earned, plus 4 pop quizzes (QuizCard) so people learn instead of tapping Continue:
//   1 Find your way around  2 Book your first shoot (with a friend → find it again: Home → your shoot card)
//   3 Stock up for your shoot (+ Add → search → gear → review → send) + quiz  4 Keep tabs on it (Me → My requests → Change,
//   search the closet to add a prop, Save)
//   5 Meet the AI (idea → tick → ask a time → Book → add the ticked)  6 When a friend invites you + quiz
//   7 Pickup day (props sign, gear pieces) + quiz  8 Showtime (check in, report, wrap)  9 Bring it all back (Return everything: props + gear together, untick to keep one) + quiz
//   10 Stay in the loop (REAL: turnOnPush; required unless the phone can't yet). Then the cheat sheet and every badge.
// The coach (Spotlight) glides between targets; Cap's voice is warm and playful, short sentences, no emoji.
// Looks like the real app: scenes copy the real screens (CreatorHomeScreen, ScheduleScreen's FindSheet / GroupBookSheet /
// ShootSheet / OnTheDay / InviteAsk / SlotRow, HomeScreen + GearShopScreen, Assistant, ReserveScreen,
// ReservationDetailScreen + ChangeRequest, GearBookingScreen, AccountScreen, MyRequestsScreen) and reuse the pieces that
// can't send anything (BottomSheet locked, PieceChecklist, Pill, PhotoStrip, Avatar, RequestRow, BrandMark, GearArt).
// When one of those screens changes a lot, update its scene here too.
// SEALED (except chapter 9): nothing books anyone or sends a request. Server calls: the read-only list of creators' names
// (friend search) and the real AI helper for the video idea (~half a cent, counted in the AI budget; falls back to
// `ideaMatches` on the phone). Camera photos stay on the phone. The "find a time" options are made-up examples.
// Required once for creators (App.tsx TourGate; can pause and resume); anyone can replay it at /tour.
import { Icon, IconText, type IconName } from '../components/Icon'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, fmtSlot, listFilmingFriends, INVITE_HOLD_MINUTES } from '../services/schedule'
import { thumbOf } from '../services/itemShape'
import { ideaToProps } from '../services/ai'
import { pushState, turnOnPush, isIOS, type PushState } from '../services/push'
import { GearArt, Pill, PieceChecklist } from '../components/GearUi'
import { TAB_ICONS } from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import { PhotoStrip } from '../components/ProofPhotos'
import { RequestRow } from '../components/ShootNeeds'
import { STATUS_STYLES, JOURNEY } from '../lib/reservationLabels'
import type { ReservationStatus } from '../services/reservations'
import type { Item } from '../types'
import { formatDay } from '../lib/dates'
import { todayInStudio, addOpenDays, lastDayToBook } from '../../functions/src/booking'
import { GEAR_LEAD_TIME_DAYS, fmtTime, fmtHours } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { CHAPTERS, Cap, Confetti, ChapterCard, QuizCard, BadgeWall } from './Fun'
import { markTourDone, savedStep, saveStep } from './tourState'

type Scene = 'hello' | 'meet' | 'home' | 'find' | 'bookit' | 'booked' | 'home2' | 'shoot' | 'browse' | 'gear' | 'review' | 'sent'
  | 'me' | 'requests' | 'request' | 'chat' | 'invite' | 'pickup' | 'gearpickup' | 'checkin' | 'wrap' | 'returnall'
  | 'notify' | 'rules' | 'done'
// A step: what's on screen (scene), what to use (target), the coach panel's text, and how you move on (a tap on the
// target, or Continue = next). hint = why Continue is greyed out. top = panel at the top. look = nothing dimmed (you're
// just looking around). notif = a pretend phone notification shows (tap it = the target 'notif').
interface Step { id: string; scene: Scene; part?: number; target?: string; title: ReactNode; body?: ReactNode; next?: string; hint?: string; skip?: boolean; top?: boolean; look?: boolean; notif?: string
  quiz?: { q: ReactNode; options: string[]; correct: number; explain: ReactNode } }

const START = 13 * 60, SLOT = 120, HOLD = INVITE_HOLD_MINUTES
// The tour's gear room: what creators pick from in chapter 3 (practice only, not the real inventory).
interface PracticeGear { id: string; kind: 'bundle' | 'extra'; name: string; category: string; pieces: { name: string; qty: number }[]; offered?: number }
const PRACTICE_GEAR: PracticeGear[] = [
  { id: 'fx3', kind: 'bundle', name: 'Sony FX3 kit', category: 'Camera', pieces: [{ name: 'Sony FX3 body', qty: 1 }, { name: '24-70mm lens', qty: 1 }, { name: 'Battery', qty: 3 }, { name: 'CFexpress card', qty: 2 }, { name: 'Top handle', qty: 1 }] },
  { id: 'a7s', kind: 'bundle', name: 'Sony A7S III kit', category: 'Camera', pieces: [{ name: 'Sony A7S III body', qty: 1 }, { name: '24-70mm lens', qty: 1 }, { name: 'Battery', qty: 3 }, { name: 'SD card', qty: 2 }] },
  { id: 'mavic', kind: 'bundle', name: 'DJI Mavic Air drone', category: 'Drones', pieces: [{ name: 'Mavic Air drone', qty: 1 }, { name: 'Controller', qty: 1 }, { name: 'Drone battery', qty: 3 }, { name: 'Charging hub', qty: 1 }, { name: 'Spare propellers', qty: 1 }] },
  { id: 'mini5', kind: 'bundle', name: 'DJI Mini 5 drone', category: 'Drones', pieces: [{ name: 'Mini 5 drone', qty: 1 }, { name: 'Controller', qty: 1 }, { name: 'Drone battery', qty: 3 }, { name: 'Charger', qty: 1 }] },
  { id: 'bat', kind: 'extra', name: 'Extra camera battery', category: 'Power', pieces: [], offered: 6 },
  { id: 'led', kind: 'extra', name: 'LED panel light', category: 'Lighting', pieces: [], offered: 4 },
  { id: 'mic', kind: 'extra', name: 'Wireless mic (DJI Mic)', category: 'Audio', pieces: [], offered: 4 },
]
// Same class strings as the real screens.
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'
const searchIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
const FREE = 'bg-green-500/90 text-stone-900'
// Cap's examples, in the Stromedy style everyone at Prime Capitol shoots (owner, Oct 20).
const EX = { title: 'If You See This, RUN', idea: 'a prank where my roommate thinks the house is haunted', time: 'Friday evening, 2 hours' }

export default function Tour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const name = profile.name || user.displayName || profile.email
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const items = useItems()
  const settings = useBookingSettings()
  const s = useScheduleSettings()

  // ── Real props (read only), searched on the phone ──
  const all = useMemo(() => items.filter(i => i.collection === 'company' && i.photos?.length && !i.archived && i.condition !== 'damaged'), [items])
  const props = all.slice(0, 6)
  const hay = (i: Item) => [i.name, i.description, i.notes, ...(i.tags ?? []), ...(Array.isArray(i.searchWords) ? i.searchWords : [i.searchWords ?? ''])].join(' ').toLowerCase()
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''))
  const found = (q: string) => { const w = words(q); return w.length ? all.filter(i => w.every(x => hay(i).includes(x))) : [] }
  // Fallback for the AI step (owner, Oct 19: never pad with props that don't fit). Only props matching the idea's
  // meaningful words; rarer words count more; filler words and words matching a big part of the closet are ignored.
  const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'video', 'videos', 'prank', 'skit', 'sketch', 'scene', 'idea', 'shoot', 'film', 'filming', 'funny', 'goes', 'wrong', 'some', 'like', 'want', 'need', 'make', 'where', 'what', 'woods', 'house', 'room', 'friend', 'friends', 'people', 'guy', 'girl', 'day', 'night', 'time', 'something'])
  const ideaMatches = (q: string) => {
    const toks = [...new Set(words(q).filter(w => w.length > 2 && !STOP.has(w) && !STOP.has(`${w}s`)))]
    const sets = toks.map(w => ({ w, hits: all.filter(i => hay(i).includes(w)) })).filter(x => x.hits.length && x.hits.length <= Math.max(3, all.length * 0.25))
    const score = new Map<string, { item: Item; n: number; why: string }>()
    for (const { w, hits } of sets) for (const i of hits) {
      const prev = score.get(i.id), add = 1 / Math.log(2 + hits.length)
      score.set(i.id, { item: i, n: (prev?.n ?? 0) + add, why: prev?.why ?? w })
    }
    const picks = [...score.values()].sort((a, b) => b.n - a.n).slice(0, 4)
    return { picks, main: picks.length ? '' : toks[0] ?? '' }   // main = when nothing fits, offered as make-or-find
  }
  const [query, setQuery] = useState('')
  const shown = query.trim() ? found(query).slice(0, 8) : props
  const [added, setAdded] = useState<string[]>([])   // props added to your first shoot by searching
  const picked = added.map(id => all.find(i => i.id === id)).filter((x): x is Item => !!x)
  // ── Practice gear (owner, Oct 20): two camera kits, two drones, add-ons. Nothing real is booked. ──
  const [gearPick, setGearPick] = useState<Record<string, number>>({})
  const chosen = PRACTICE_GEAR.filter(g => (gearPick[g.id] ?? 0) > 0)
  const gearCount = chosen.length
  const hasCamera = chosen.some(g => g.category === 'Camera')
  const gearNames = chosen.map(g => g.kind === 'extra' && gearPick[g.id] > 1 ? `${g.name} ×${gearPick[g.id]}` : g.name).join(', ') || 'Camera kit'
  // Pickup checklist: each piece of the kits you picked, plus the add-ons (one line each, at most 6, to keep it short).
  const pieceLines = chosen.flatMap(g => g.kind === 'bundle'
    ? g.pieces.map(p => ({ key: `${g.id}|${p.name}`, name: p.qty > 1 ? `${p.name} ×${p.qty}` : p.name, unit: 1, of: 1 }))
    : [{ key: g.id, name: gearPick[g.id] > 1 ? `${g.name} ×${gearPick[g.id]}` : g.name, unit: 1, of: 1 }]).slice(0, 6)

  // ── Your friends: typed and picked from the real list of creators (names only; nobody is booked or told) ──
  const [people, setPeople] = useState<{ email: string; name: string }[] | null>(null)
  useEffect(() => { listFilmingFriends({}).then(r => setPeople(r.data.people.filter(p => p.email !== profile.email))).catch(() => setPeople([])) }, [profile.email])
  const [friendQ, setFriendQ] = useState('')
  const [friendCount, setFriendCount] = useState(0)   // + 1 friend / + 2 friends
  const [friends, setFriends] = useState<{ email: string; name: string }[]>([])
  const firstOf = (n: string) => n.split(' ')[0]
  const friendFirst = friends.map(f => firstOf(f.name)).join(' and ') || 'Sam'
  const friend = friends[0] ?? null   // the one who "invites you" in chapter 6
  const inviterFirst = friend ? firstOf(friend.name) : 'Sam'

  // ── The pretend shoot: Cliff 1, 1–3 PM, on the day you pick (five open days out by default) ──
  const today = todayInStudio()
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const day = pickedDay ?? addOpenDays(today, 5, settings)
  const strip = Array.from({ length: 6 }, (_, n) => addOpenDays(today, n + 4, settings))   // the first one shows as full
  const house = s.houses.cliff1
  const shootLabel = `${house.name} · ${formatDay(day)} · ${fmtSlot(START, SLOT)}`
  const longDay = formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })
  const cut = { props: lastDayToBook(day, settings.leadTimeDays, settings), builds: lastDayToBook(day, settings.buildLeadDays, settings), gear: lastDayToBook(day, GEAR_LEAD_TIME_DAYS, settings) }
  const inviteDay = addOpenDays(today, 7, settings)   // the day your friend invites you to (another shoot)
  const aiDay = addOpenDays(today, 8, settings)       // the new shoot booked with the AI

  // ── Everything you type ──
  const [video, setVideo] = useState('')
  const title = video.trim() || 'My practice video'
  const ex = EX
  const [builds, setBuilds] = useState<{ description: string; qty: number }[]>([])
  const [buildDesc, setBuildDesc] = useState(''), [buildQty, setBuildQty] = useState(1), [showBuild, setShowBuild] = useState(false)
  const [idea, setIdea] = useState(''), [asked, setAsked] = useState(''), [timeAsk, setTimeAsk] = useState('')
  // The AI's answer: groups of {prop id, why} + things to make or find (null = not asked yet).
  const [aiResult, setAiResult] = useState<{ reply: string; groups: { title: string; picks: { id: string; why: string }[] }[]; missing: { name: string; why: string }[] } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiTicks, setAiTicks] = useState<string[]>([]), [aiBooked, setAiBooked] = useState(false), [aiAdded, setAiAdded] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({}), [editing, setEditing] = useState(false), [newBuild, setNewBuild] = useState('')
  const [changeQ, setChangeQ] = useState(''), [changeAdded, setChangeAdded] = useState(0)
  const [over, setOver] = useState(false), [mess, setMess] = useState(false), [reportNote, setReportNote] = useState('')
  const [wrapText, setWrapText] = useState(''), [retNote, setRetNote] = useState(''), [retOff, setRetOff] = useState<string[]>([])

  // ── Chapter 9 is real: turn on notifications on this phone ──
  const [push, setPush] = useState<PushState>(() => { try { return pushState() } catch { return 'unsupported' } })
  const [pushBusy, setPushBusy] = useState(false), [pushMsg, setPushMsg] = useState('')
  const turnOn = () => { setPushBusy(true); setPushMsg(''); turnOnPush().then(setPush).catch(e => setPushMsg((e as Error).message || "That didn't work. Try again.")).finally(() => setPushBusy(false)) }

  const C = 'Continue'
  // Chapter openers: full-screen ChapterCard (Fun.tsx). Quizzes: QuizCard. Everything else: the coach (Spotlight).
  const intro = (n: number, scene: Scene, body: ReactNode): Step => ({ id: `part${n}`, scene, part: n, title: CHAPTERS[n - 1].name, body })
  const ul = (rows: [string, string][]) => <ul className="mt-1 space-y-1">{rows.map(([b, t]) => <li key={b}><b className="text-stone-900">{b}</b>: {t}</li>)}</ul>
  const sameCut = cut.builds === cut.props
  const STEPS: Step[] = [
    { id: 'hello', scene: 'hello', title: '' },
    { id: 'meet', scene: 'meet', title: '' },
    // 1 · Find your way around
    intro(1, 'home', 'Quick lay of the land before the fun stuff. Two things you will use every single day.'),
    { id: 'tabs', scene: 'home', part: 1, target: 'tabbar', look: true, next: C, title: 'These four tabs are your whole world',
      body: ul([['Home', 'your next shoot and what it still needs'], ['Book', 'grab a time at the house'], ['Browse', 'every prop, costume and gear kit'], ['Me', 'your requests, profile and help']]) },
    { id: 'aibtn', scene: 'home', part: 1, target: 'ai', look: true, next: C, title: "See this purple button? That's the AI", body: "It finds props for a video idea, or a free time to film. We'll take it for a spin in chapter 5." },
    // 2 · Book your first shoot
    intro(2, 'home', "Every great video starts with a time slot. Let's grab one at the house, and bring a friend along for the ride."),
    { id: 'book', scene: 'home', part: 2, target: 'book', title: <>Tap <b>Book a shoot</b></>, body: 'This is where every shoot starts. (The Book tab works too.)' },
    { id: 'friend1', scene: 'find', part: 2, target: 'who', next: C, hint: 'Pick + 1 friend or + 2 friends first', title: <>Who's filming? Tap <b>+ 1 friend</b></>, body: "Let's make it a collab. Each of you gets your own 2-hour slot, back to back." },
    { id: 'friendname', scene: 'find', part: 2, target: 'friendzone', next: C, hint: friendCount > 1 ? 'Pick both friends first' : 'Pick a friend first', title: friendCount > 1 ? 'Now find your two friends' : 'Now find your friend', body: "Tap the box and type a few letters of their name or channel. Nobody gets a message, it's practice." },
    { id: 'days', scene: 'find', part: 2, target: 'days', next: C, title: 'Pick a day, or keep Soonest', body: 'Soonest shows the next free times first. Faded days are full for all of you.' },
    { id: 'slot', scene: 'find', part: 2, target: 'slot', title: <>Tap a <b>house</b> to grab that time</>, body: <>Free for everyone: you first, then {friendFirst}. Cliff 1 or Cliff 2, your call.</> },
    { id: 'bookit', scene: 'bookit', part: 2, target: 'bookit', title: <>Lock it in: tap <b>Book + invite</b></>, body: <>Your slot is yours right away. {friendFirst} {friends.length > 1 ? 'each get' : 'gets'} a ping and {HOLD} minutes to confirm.</> },
    { id: 'booked', scene: 'booked', part: 2, target: 'myslots', look: true, next: C, title: "Boom. You're on the schedule", body: <>There you are, with {friendFirst}'s {friends.length > 1 ? 'slots' : 'slot'} held right after. Now let's find it again, the way you will tomorrow.</> },
    { id: 'gohome', scene: 'booked', part: 2, target: 'nav-home', title: <>Tap <b>Home</b></>, body: 'Bottom left. Home always shows what is coming up.' },
    { id: 'opencard', scene: 'home2', part: 2, target: 'shootcard', title: 'Tap your shoot', body: 'Your next shoot is always the big gold card. Hard to miss.' },
    { id: 'shootinfo', scene: 'shoot', part: 2, target: 'shootsheet', look: true, top: true, next: C, title: "Welcome to your shoot's page", body: "Date, time, house, and a checklist of what it still needs. On the day, you'll check in right here too." },
    // 3 · Stock up for your shoot
    intro(3, 'shoot', 'Props, costumes, cameras, lights. Pick what you need and send it to the teams in one go. Like shopping, but free.'),
    { id: 'addprops', scene: 'shoot', part: 3, target: 'addprops', title: <>Tap <b>+ Add</b> next to Props &amp; costumes</>, body: 'The closet opens with this shoot already picked, so everything lands in the right place.' },
    { id: 'addingbar', scene: 'browse', part: 3, target: 'adding', look: true, next: C, title: "This bar shows which shoot you're shopping for", body: '"Free" on a photo means it is free that day. Tap Change to switch shoots.' },
    { id: 'search', scene: 'browse', part: 3, target: 'browsezone', next: C, hint: 'Add a prop first', title: 'Search the closet and tap + on something', body: <>Try <b>mask</b>, <b>hat</b> or <b>phone</b>. Add as many as you like, then Continue.</> },
    { id: 'geartab', scene: 'browse', part: 3, target: 'geartab', title: <>Now the gear. Tap <b>Gear</b></>, body: 'Cameras, lights and sound live here.' },
    { id: 'addgear', scene: 'gear', part: 3, target: 'gearkits', top: true, next: C, hint: 'Add a camera kit first', title: <>Pick a camera: tap <b>+</b> on the FX3 or the A7S</>, body: "Each kit is one case with every piece inside, booked for your shoot's hours. Want aerial shots? Add the Mavic Air or the Mini 5 too." },
    { id: 'addextras', scene: 'gear', part: 3, target: 'gearextras', next: C, title: 'Need add-ons? Use + and −', body: 'Extra batteries, lights or a wireless mic go on top of your kit. None needed? Just Continue.' },
    { id: 'reviewbar', scene: 'gear', part: 3, target: 'reviewbar', title: <>Tap <b>Review</b></>, body: 'Quick check before it goes to the teams.' },
    { id: 'name', scene: 'review', part: 3, target: 'name', next: C, hint: 'Type a name first', title: 'Give your video a name', body: <>Go full Stromedy, like "{ex.title}". The teams will know exactly which shoot it is.</> },
    { id: 'make', scene: 'review', part: 3, target: 'make', title: "Need something that's not in the closet?", body: <>Tap <b>+ Request something we don't have</b>. The arts team will make or find it. Just ask by {formatDay(cut.builds)}.</> },
    { id: 'makeform', scene: 'review', part: 3, target: 'make', title: <>Describe it, then tap <b>Add request</b></>, body: 'e.g. "a fake birthday cake" or "a pirate hat". Use − and + for how many.' },
    { id: 'send', scene: 'review', part: 3, target: 'send', title: <>Send it: tap <b>Book props + gear</b></>, body: "Props go to the arts team, gear to the equipment team. (Practice, so nothing's really sent.)" },
    { id: 'quiz3', scene: 'sent', part: 3, title: '', quiz: {
      q: <>Pop quiz! Your shoot is on {formatDay(day)}. What's the last day to ask the arts team to <b>make something new</b>?</>,
      options: [formatDay(sameCut ? day : cut.props), `${formatDay(cut.builds)}${cut.builds === today ? ' (today!)' : ''}`, 'The morning of the shoot'], correct: 1,
      explain: <>New things need {settings.buildLeadDays} open days of notice.{sameCut ? '' : <> Props already in the closet can wait until {formatDay(cut.props)}.</>}</> } },
    // 4 · Keep tabs on it
    intro(4, 'sent', 'You sent it, now what? Here is where you watch it get packed, and change your mind if you need to.'),
    { id: 'sent', scene: 'sent', part: 4, target: 'journey', next: C, title: "That line is your request's journey", body: 'Requested, being prepared, ready, collected, returned, checked in. It moves as the team works.' },
    { id: 'back', scene: 'sent', part: 4, target: 'back', title: <>Tap <b>Back</b></>, body: "Let's find this again the way you would tomorrow." },
    { id: 'navme', scene: 'home2', part: 4, target: 'nav-me', title: <>Tap <b>Me</b></>, body: 'Everything you asked for lives here. (Spot the ticks on your Home card? Time, props, gear: done.)' },
    { id: 'myreq', scene: 'me', part: 4, target: 'myrequests', title: <>Tap <b>My requests</b></>, body: 'One card per shoot, with its props and gear together.' },
    { id: 'openreq', scene: 'requests', part: 4, target: 'propsrow', title: 'Tap your props request', body: 'To see it in full, or to change it.' },
    { id: 'change', scene: 'request', part: 4, target: 'changebtn', title: <>Changed your mind? Tap <b>Change</b></>, body: 'You can edit it until the arts team starts picking.' },
    { id: 'changeadd', scene: 'request', part: 4, target: 'changesearch', next: C, hint: 'Add a prop from the search first', title: 'Forgot something? Search the closet', body: <>Type in the search box (try <b>mask</b> or <b>hat</b>) and tap <b>+ Add</b>. It joins this request.</> },
    { id: 'changeit', scene: 'request', part: 4, target: 'changebox', top: true, title: <>Tweak it, then <b>Save changes</b></>, body: '− and + for amounts, × to take something out, or type a new thing to make.' },
    { id: 'saved', scene: 'request', part: 4, target: 'addmore', look: true, next: C, title: 'Saved!', body: 'Once the team starts picking, Change disappears. You can still use + Add more for this shoot.' },
    { id: 'packed', scene: 'request', part: 4, target: 'journey', next: C, notif: `Your props for ${title} are packed and ready ✓`, title: 'Ding! Your props are ready', body: "You get a notification, and the line jumps to Ready. That's your cue to pick up." },
    // 5 · Meet the AI
    intro(5, 'request', "Using AI you can plan a shoot, find props that suit your idea, or find a free time when the schedule looks jam-packed. Let's start a brand-new shoot with it."),
    { id: 'reqback', scene: 'request', part: 5, target: 'back', title: <>Tap <b>Back</b></>, body: "Let's head back to Me." },
    { id: 'tome', scene: 'requests', part: 5, target: 'tome', title: <>Tap <b>‹ Me</b></> },
    { id: 'openai', scene: 'me', part: 5, target: 'ai', title: <>Tap the <b>✦ AI</b> button</>, body: "It's in the top corner of every main screen." },
    { id: 'aiask', scene: 'chat', part: 5, target: 'composer', title: 'Pitch it your video idea', body: <>A full plan or just a vibe. Tap the suggestion or type your own, then tap <b>↑</b>.</> },
    { id: 'aipicks', scene: 'chat', part: 5, target: 'answer', top: true, next: C, hint: 'Tick at least one first', title: 'Tick the ones you like', body: 'Real props from our closet, grouped by scene, each with a reason it fits.' },
    { id: 'aitime', scene: 'chat', part: 5, target: 'composer', title: 'Now ask it for a time', body: <>Tap the suggestion or say when you'd like to film, then tap <b>↑</b>.</> },
    { id: 'aioptions', scene: 'chat', part: 5, target: 'optbook', title: <>Tap <b>Book</b> on a time</>, body: 'It only suggests times that are actually free.' },
    { id: 'aiadd', scene: 'chat', part: 5, target: 'aiaddbooked', title: <>Tap <b>Add the {aiTicks.length} ticked to this shoot</b></>, body: 'Your picks jump straight into the new shoot.' },
    { id: 'aidone', scene: 'chat', part: 5, target: 'aiaddedmsg', look: true, next: C, title: 'Two shoots planned. Look at you go', body: 'Idea first then a time, or a time first then props. Both work, whatever suits your brain.' },
    { id: 'aiback', scene: 'chat', part: 5, target: 'aiback', title: <>Tap <b>Back</b></>, body: 'Back to Me.' },
    // 6 · When a friend invites you
    intro(6, 'me', <>Your friends can save you the slot right after theirs. You get {HOLD} minutes to claim it, so no snoozing.</>),
    { id: 'invited', scene: 'me', part: 6, target: 'notif', notif: `${inviterFirst} invited you to film right after them, ${formatDay(inviteDay)}. Held for you for ${HOLD} minutes.`, title: 'Ooh, an invite. Tap it', body: <>Pretend {inviterFirst} just booked and saved you the next slot. Tapping takes you straight there.</> },
    { id: 'confirm', scene: 'invite', part: 6, target: 'invitebox', title: <>Tap <b>Confirm my slot</b></>, body: <>It's held just for you for {HOLD} minutes. Can't make it? Tap that instead and it opens to everyone.</> },
    { id: 'confirmed', scene: 'invite', part: 6, target: 'myrow', look: true, next: C, title: "It's yours", body: 'It shows as Yours on the schedule. That was a different shoot, so now back to your first one.' },
    { id: 'quiz6', scene: 'invite', part: 6, title: '', quiz: {
      q: 'A friend saves you the slot after theirs. How long do you have to confirm?', options: ['24 hours', `${HOLD} minutes`, 'Until they cancel'], correct: 1,
      explain: <>After {HOLD} minutes it opens to everyone, so confirm fast.</> } },
    // 7 · Pickup day
    intro(7, 'home2', "It's shoot day! First stop the prop room, then the gear cage. Let's go pick it all up."),
    { id: 'pickupnotif', scene: 'home2', part: 7, target: 'notif', notif: `Shoot day! Your props for ${title} are ready to pick up.`, title: 'Tap the notification', body: 'Notifications always take you to the right page.' },
    { id: 'sign', scene: 'pickup', part: 7, target: 'sign', title: <>Got everything? Tap <b>I've got everything</b></>, body: 'Check the list at the prop room first. Only you can sign for your props.' },
    { id: 'pickback', scene: 'pickup', part: 7, target: 'back', title: <>Tap <b>Back</b></>, body: "Now the gear. It's on the same card." },
    { id: 'opengear', scene: 'requests', part: 7, target: 'gearrow', title: 'Tap your gear', body: 'Pick it up from the equipment cage, from 30 minutes before your time.' },
    { id: 'pieces', scene: 'gearpickup', part: 7, target: 'pieces', top: true, next: C, hint: 'Tick (or mark missing) every piece first', title: 'Tick every piece in the case', body: 'Something not there? Tap Missing? next to it, so nobody blames you.' },
    { id: 'gearsign', scene: 'gearpickup', part: 7, target: 'gearsign', title: <>Tap <b>Sign: I've got it</b></>, body: "From here until it's back, the kit is in your hands." },
    { id: 'quiz7', scene: 'gearpickup', part: 7, title: '', quiz: {
      q: 'You open the gear case and the spare battery is missing. What do you do?', options: ["Sign anyway, it's probably fine", 'Tap Missing? before signing', 'Text the team about it later'], correct: 1,
      explain: 'Once you sign, the whole kit is yours. Marking it missing first keeps your record clean.' } },
    // 8 · Showtime
    intro(8, 'gearpickup', "You're at the house. Check in, film your thing, then wrap. Quiet on set!"),
    { id: 'checkinnotif', scene: 'gearpickup', part: 8, target: 'notif', notif: `Check-in is open for your ${fmtTime(START)} shoot at ${house.name}.`, title: 'Check-in is open. Tap the notification', body: `It opens ${s.checkinBefore} minutes before your time. (Your Home card has a Check in button too.)` },
    { id: 'setphoto', scene: 'checkin', part: 8, target: 'camera', next: C, skip: true, hint: 'Take a photo first (or skip)', title: 'Snap a photo of the set', body: 'Tap Take photo. It opens your camera, and the photo stays on your phone.' },
    { id: 'report', scene: 'checkin', part: 8, target: 'report', next: C, hint: 'Say what happened first', title: 'Anything off with the slot before you?', body: 'Ran over or left a mess? Tap it and say what happened. All good? Just Continue.' },
    { id: 'checkin', scene: 'checkin', part: 8, target: 'checkin', title: <>Tap <b>Check in</b></>, body: 'That is how the team knows you showed up.' },
    { id: 'wrap', scene: 'wrap', part: 8, target: 'wrap', title: <>Done filming? Say what you shot, then <b>Wrap</b></>, body: "Type a few words, then tap Wrap. It's a wrap, literally." },
    // 9 · Bring it all back
    intro(9, 'wrap', "That's a wrap! Bring everything back so the next creator gets it in one piece."),
    { id: 'gotome', scene: 'booked', part: 9, target: 'nav-me', title: <>Tap <b>Me</b></>, body: 'Your slot now says Filmed. Returns start from your request on Me.' },
    { id: 'myreq2', scene: 'me', part: 9, target: 'myrequests', title: <>Tap <b>My requests</b></> },
    { id: 'returnall', scene: 'requests', part: 9, target: 'returnall', title: <>Tap <b>Return everything</b></>, body: 'Props and gear usually go back together, so it is one step for both.' },
    { id: 'retlist', scene: 'returnall', part: 9, target: 'retlist', next: C, hint: 'Tick both back to return them together', title: 'Everything starts ticked', body: <>Keeping something for later? Tap it to untick it, and return it on its own from My requests. Try it, then tick it back.</> },
    { id: 'retphoto', scene: 'returnall', part: 9, target: 'camera', next: C, skip: true, hint: 'Take a photo first (or skip)', title: 'One photo of it all', body: "Props together, gear in its case, batteries charging. It's your receipt if anything is questioned." },
    { id: 'returned', scene: 'returnall', part: 9, target: 'returned', title: <>Tap <b>Return all 2</b></>, body: 'Add a note first if it helps (where you left the props).' },
    { id: 'seereq', scene: 'returnall', part: 9, target: 'seereq', title: <>Tap <b>See my requests</b></> },
    { id: 'final', scene: 'requests', part: 9, target: 'card', look: true, next: C, title: 'Both on their way home', body: 'Each team checks its part in. When both bars are full, you are done.' },
    { id: 'quiz9', scene: 'requests', part: 9, title: '', quiz: {
      q: 'When do props need to come back?', options: ['The night of the shoot', 'Within a week', 'Whenever, no rush'], correct: 0,
      explain: 'They count as late from 10 AM the next open day, and late returns pause new props and gear.' } },
    // 10 · Stay in the loop (real)
    intro(10, 'notify', "Last one, and this one is for real: turn on notifications so you never miss an invite, a pickup or a reminder."),
    { id: 'notify', scene: 'notify', part: 10, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications', body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card). Home will remind you.' : "Tap the gold button, then Allow when your phone asks. We won't spam you, promise." },
    { id: 'rules', scene: 'rules', title: '' },
    { id: 'done', scene: 'done', title: '' },
  ]
  const [idx, setIdx] = useState(() => required ? Math.min(savedStep(profile.email), STEPS.length - 1) : 0)
  const step = STEPS[idx]
  const I = (id: string) => STEPS.findIndex(x => x.id === id)
  const past = (id: string) => idx > I(id)
  const at = (id: string) => idx >= I(id)
  const advance = () => setIdx(n => { const m = Math.min(n + 1, STEPS.length - 1); if (required) saveStep(profile.email, m); return m })
  // A tap only counts when it's the highlighted thing (everything else is ignored by the spotlight anyway).
  const tap = (t: string) => () => { if (step.target === t) advance() }
  const T = (t: string) => ({ 'data-tour': t })

  // ── Actions you do yourself ──
  const [flash, setFlash] = useState(false)
  const bookIt = () => { if (step.target !== 'bookit' || flash) return; setFlash(true); setTimeout(() => { setFlash(false); advance() }, 650) }
  const pickCount = (n: number) => { if (step.id !== 'friend1') return; setFriendCount(n); setFriends(f => f.slice(0, n)) }
  const pickFriend = (p: { email: string; name: string }) => { if (step.id !== 'friendname') return; setFriends(f => f.some(x => x.email === p.email) || f.length >= friendCount ? f : [...f, p]); setFriendQ('') }
  const dropFriend = (email: string) => { if (step.id === 'friendname') setFriends(f => f.filter(x => x.email !== email)) }
  const pickDay = (d: string) => { if (step.id === 'days') setPickedDay(d) }
  const addProp = (id: string) => { if (step.id === 'search') setAdded(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]) }
  const addBuild = () => { if (step.id !== 'makeform' || !buildDesc.trim()) return; setBuilds(b => [...b, { description: buildDesc.trim(), qty: buildQty }]); setShowBuild(false); setBuildDesc(''); advance() }
  const send = () => {
    if (step.target !== 'composer' || idea.trim().length < 3) return
    const q = idea.trim()
    if (step.id === 'aiask') { setAsked(q); askAi(q) } else setTimeAsk(q)
    setIdea(''); advance()
  }
  // Real AI first; on the phone if it fails or finds nothing.
  const askAi = (q: string) => {
    const local = () => {
      const { picks, main } = ideaMatches(q)
      return { reply: picks.length ? "Here's what we have for that." : "We don't have much for that in the closet. The arts team can make or find it.",
        groups: picks.length ? [{ title: 'For your idea', picks: picks.map(p => ({ id: p.item.id, why: `Matches “${p.why}”` })) }] : [],
        missing: main ? [{ name: `Something for the ${main}`, why: 'The arts team can make or find it' }] : [] }
    }
    setAiBusy(true)
    ideaToProps({ idea: q }).then(r => {
      const known = new Set(items.map(i => i.id))
      const groups = r.data.groups.map(g => ({ title: g.title, picks: g.picks.filter(x => x.kind === 'prop' && known.has(x.id)).map(x => ({ id: x.id, why: x.why })) })).filter(g => g.picks.length)
      setAiResult(groups.length || r.data.missing.length ? { reply: r.data.note || r.data.reply || "Here's what we have for that.", groups, missing: r.data.missing.slice(0, 3) } : local())
    }).catch(() => setAiResult(local())).finally(() => setAiBusy(false))
  }
  const aiTick = (id: string) => { if (step.id === 'aipicks') setAiTicks(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]) }
  const startChange = () => { if (step.id !== 'change') return; setQty(Object.fromEntries(picked.map(p => [p.id, 1]))); setEditing(true); advance() }
  const saveChange = () => {
    if (step.id !== 'changeit') return
    setAdded(a => a.filter(id => (qty[id] ?? 1) > 0))
    if (newBuild.trim()) setBuilds(b => [...b, { description: newBuild.trim(), qty: 1 }])
    setNewBuild(''); setEditing(false); advance()
  }

  // Camera photos: shown back, never uploaded, freed when the tour closes.
  const [photos, setPhotos] = useState<Record<string, string>>({})
  useEffect(() => () => { Object.values(photos).forEach(u => URL.revokeObjectURL(u)) }, [photos])
  const cam = useRef<HTMLInputElement>(null)
  const shot = (f?: File) => { if (!f) return; setPhotos(p => ({ ...p, [step.id]: URL.createObjectURL(f) })) }   // retake by tapping the photo; Continue moves on
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const allTicked = pieceLines.every(l => ticked.has(l.key) || missing.has(l.key))
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }
  const finish = () => { markTourDone(profile.email); onFinish() }

  // Where things are, from the step you're on.
  const propsStatus: ReservationStatus = at('final') ? 'returned' : past('returned') ? 'return_pending' : past('sign') ? 'collected' : at('packed') ? 'packed' : 'requested'
  const gearStatus = at('final') ? 'checked_in' : past('returned') ? 'returned' : past('gearsign') ? 'out' : 'held'
  const STATUS_WORD: Record<string, string> = { requested: 'Requested', packed: 'Packed & ready', collected: 'Collected', return_pending: 'Returned, being checked' }
  const propCount = picked.length + builds.length

  // ── Pieces copied from the real screens ──
  const thumb = (i: Item | undefined) => i?.photos?.[0] ? thumbOf(i, i.photos[0]) : undefined
  const aiPill = (t?: string) => (
    <button {...(t ? T(t) : {})} onClick={t ? tap(t) : undefined} aria-label="Ask the AI"
      className="shrink-0 h-11 rounded-full pl-3 pr-4 flex items-center gap-1.5 text-[14px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">
      <span className="text-[16px] leading-none">✦</span>AI
    </button>
  )
  const roundHelp = <span className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-muted text-lg">?</span>
  const backBar = (right?: ReactNode, mid?: string) => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
      <button {...T('back')} onClick={tap('back')} className="text-pt-text text-base font-medium py-1">‹ Back</button>
      {mid && <h1 className="font-display text-xl text-pt-text">{mid}</h1>}
      {right ?? <div className="w-12" />}
    </div>
  )
  const banner = (tone: 'green' | 'amber', heading: string, body: ReactNode) => (
    <div className={`border rounded-xl px-4 py-3 ${tone === 'green' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
      <p className="font-medium">{heading}</p><p className="text-pt-text/80 text-sm mt-0.5">{body}</p>
    </div>
  )
  const statusPill = (st: ReservationStatus) => <span className={`text-xs px-3 py-1 rounded-full ${STATUS_STYLES[st]}`}>{STATUS_WORD[st]}</span>
  const journey = (st: ReservationStatus) => {
    const n = JOURNEY.findIndex(j => j.status === st)
    return (
      <div {...T('journey')} className="flex items-start">
        {JOURNEY.map((j, i) => (
          <div key={j.status} className="flex-1 flex flex-col items-center text-center">
            <div className="flex items-center w-full">
              <div className={`flex-1 h-0.5 ${i === 0 ? 'opacity-0' : i <= n ? 'bg-pt-accent' : 'bg-pt-border'}`} />
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${i < n ? 'bg-pt-accent' : i === n ? 'bg-pt-accent ring-4 ring-pt-accent/30' : 'bg-pt-border'}`} />
              <div className={`flex-1 h-0.5 ${i === JOURNEY.length - 1 ? 'opacity-0' : i < n ? 'bg-pt-accent' : 'bg-pt-border'}`} />
            </div>
            <span className={`text-xs mt-1 leading-tight ${i === n ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>{j.label}</span>
          </div>
        ))}
      </div>
    )
  }
  const titleBlock = <div><h1 className="font-display text-2xl text-pt-text leading-tight">{title}</h1><p className="text-pt-text mt-1"><IconText name="calendar">{formatDay(day)}</IconText></p></div>
  // The request page's "Props" list (ContentsList).
  const contents = (done: boolean) => (
    <div><p className="text-pt-muted text-xs mb-2">Props</p>
      <div className="space-y-2">
        {picked.map(p => (
          <div key={p.id} className="w-full flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3 text-left">
            <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate text-pt-text">{p.name}</p>{done && <p className="text-green-400 text-xs">✓ Picked</p>}</div>
            <span className="text-pt-text font-semibold">×{qty[p.id] ?? 1}</span>
          </div>
        ))}
        {builds.map((b, n) => (
          <div key={n} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-3">
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 shrink-0 flex items-center justify-center text-xl"><Icon name="tools" className="w-6 h-6 text-violet-300" /></div>
            <div className="flex-1 min-w-0"><p className="text-sm text-pt-text">{b.description}</p><p className={`text-xs ${done ? 'text-green-400' : 'text-violet-300'}`}>{done ? '✓ Ready' : 'To build or source'} · ×{b.qty}</p></div>
          </div>
        ))}
      </div>
    </div>
  )
  const shootLink = (other: 'gear' | 'props') => (
    <div className="w-full flex items-center justify-between bg-pt-surface rounded-2xl px-4 py-3 text-[15px]">
      <span className="text-pt-text">Also in this shoot: {other} (1)</span><span className="text-pt-accent">Open ›</span>
    </div>
  )
  // The tile from ItemCard (the real Browse grid), with its + quick add.
  const tile = (i: Item) => {
    const on = added.includes(i.id)
    return (
      <div key={i.id} className="relative w-full h-full">
        <div className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
          <div className="relative aspect-square bg-pt-border flex items-center justify-center">
            {thumb(i) ? <img src={thumb(i)} alt={i.name} className="w-full h-full object-cover" /> : <span className="text-3xl">🎭</span>}
            <span className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${FREE}`}>Free</span>
            {i.quantity > 1 && <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">×{i.quantity}</span>}
          </div>
          <div className="px-3 pt-2 pb-3"><p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{i.name}</p></div>
        </div>
        <button onClick={() => addProp(i.id)} aria-label={`${on ? 'Remove' : 'Add'} ${i.name}`}
          className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${on ? 'bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{on ? '✓' : '+'}</button>
      </div>
    )
  }
  const browseHeader = (gear: boolean) => (
    <>
      <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><BrandMark className="w-10 text-pt-text" title="" /><span className="flex-1">Browse</span>{aiPill()}</h1>
      <div className="mb-3 flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
        <span className={`flex-1 py-2 rounded-lg text-sm text-center ${!gear ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Props &amp; costumes</span>
        <button {...T('geartab')} onClick={tap('geartab')} className={`flex-1 py-2 rounded-lg text-sm ${gear ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Gear</button>
      </div>
      <div className="relative">{searchIcon}{gear
        ? <div className={`${input} pl-10 text-pt-muted`}>Search cameras, lights, sound…</div>
        : <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search props, costumes, set dressing…" enterKeyHint="search" className={`${input} pl-10 pr-10 text-base`} />}
        {!gear && query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none">×</button>}
      </div>
    </>
  )
  const addingTo = (kind: 'props' | 'gear' | 'shoot') => (
    <div {...(kind === 'props' ? T('adding') : {})} className="w-full min-h-[52px] flex items-center gap-3 py-3 px-4 rounded-2xl text-left text-sm bg-pt-accent/10 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.45)]">
      <span className="flex-1 min-w-0">
        <span className="block text-pt-muted text-xs">Adding to</span>
        <span className="block text-pt-text truncate">{shootLabel}</span>
        <span className="block text-xs text-pt-muted">{kind === 'shoot' ? `Props by ${formatDay(cut.props)} · new props by ${formatDay(cut.builds)} · gear by ${formatDay(cut.gear)}` : `Add ${kind} by ${formatDay(kind === 'props' ? cut.props : cut.gear)}`}</span>
      </span>
      <span className="text-pt-accent text-xs shrink-0 tap">Change</span>
    </div>
  )
  const nGear = gearCount
  const basket = (propCount + nGear > 0) && (
    <div className="sticky bottom-3 px-4">
      <button {...T('reviewbar')} onClick={tap('reviewbar')} className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-4 font-semibold shadow-gold">
        <span>Your shoot · {[propCount && `${propCount} prop${propCount !== 1 ? 's' : ''}`, nGear && `${nGear} gear`].filter(Boolean).join(' · ')}</span><span>Review</span>
      </button>
    </div>
  )
  // The Schedule screen (behind the booking sheets, and the day view).
  const scheduleHeader = (dayStrip?: string) => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
      <div className="flex items-end justify-between py-2 gap-2"><h1 className="font-display text-[34px] text-pt-text">Schedule</h1><div className="flex gap-2 pb-0.5">{aiPill()}{roundHelp}</div></div>
      <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
        {[house.name, s.houses.cliff2.name, 'Offsite'].map((h, n) => <span key={h} className={`flex-1 py-2 rounded-[10px] text-sm text-center ${n === 0 ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h}</span>)}
      </div>
      {dayStrip && (
        <div className="flex gap-2 overflow-hidden pt-3 pb-1">
          {Array.from({ length: 7 }, (_, n) => addOpenDays(today, n + 4, settings)).map(d => (
            <span key={d} className={`shrink-0 w-12 rounded-2xl min-h-[56px] flex flex-col items-center justify-center ${d === dayStrip ? 'bg-pt-accent text-stone-900 shadow-gold' : 'bg-pt-surface text-pt-text'}`}>
              <span className="text-xs leading-none">{formatDay(d, { weekday: 'short' })}</span><span className="text-[17px] font-semibold leading-tight mt-1">{Number(d.slice(8))}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
  // One row of the real schedule (SlotRow).
  type Row = { t: number; title: ReactNode; sub?: ReactNode; pill?: ReactNode; cls: string; face?: ReactNode }
  const slotRow = (r: Row) => (
    <div key={r.t} className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border ${r.cls}`}>
      <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums whitespace-nowrap">{fmtSlot(r.t, SLOT)}</span>
      {r.face}
      <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text truncate">{r.title}</span>{r.sub && <span className="block text-pt-muted text-xs truncate">{r.sub}</span>}</span>
      {r.pill}
    </div>
  )
  const freeRow = (t: number): Row => ({ t, title: <span className="text-pt-accent">Free</span>, cls: 'bg-pt-surface border-pt-accent/35' })
  const sheet = (heading: string, body: ReactNode) => <>{scheduleHeader()}<BottomSheet open locked onClose={() => {}} title={heading}>{body}</BottomSheet></>
  const homeHeader = (
    <div className="pt-safe px-5">
      <div className="flex items-center justify-between py-3">
        <span className="flex items-center gap-2 text-pt-text"><BrandMark className="w-9" title="Prime Capitol" /><b className="text-xs font-extrabold tracking-[0.28em]">PRIME CAPITOL</b></span>
        <span className="flex items-center gap-3">{aiPill(step.scene === 'home' || step.scene === 'home2' ? 'ai' : undefined)}{roundHelp}<Avatar email={profile.email} name={name} size={34} /></span>
      </div>
      <p className="text-pt-muted text-xs font-semibold mt-1">{formatDay(today, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
      <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">{first ? `Hey ${first}` : 'Home'}</h1>
    </div>
  )
  const searchAndAi = (
    <>
      <div className="flex items-center gap-2 bg-pt-surface rounded-[14px] pl-4 pr-2 py-2">
        <span className="flex-1 flex items-center gap-3 py-2 text-pt-muted text-left min-w-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="truncate">Search props, costumes, gear</span>
        </span>
      </div>
      <div className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF]">
        <span className="text-[#BF9DFF]">✦</span><span className="flex-1 min-w-0 truncate">Ask AI: props for an idea, or a time to film</span><span className="text-pt-muted">›</span>
      </div>
    </>
  )
  const homeStep = (t: string, done: boolean, doneText: string, by: string) => (
    <div className="bg-black/35 rounded-2xl p-3 flex flex-col gap-1 min-w-0">
      <span className={`w-[26px] h-[26px] rounded-full grid place-items-center text-sm font-extrabold ${done ? 'bg-pt-accent text-stone-900' : 'border-2 border-dashed border-pt-accent text-pt-accent'}`}>{done ? '✓' : '+'}</span>
      <b className="text-sm">{t}</b><span className="text-xs text-pt-muted truncate">{done ? doneText : `By ${formatDay(by)}`}</span>
    </div>
  )
  const sentAll = past('send')
  const shootDay = at('part7')   // chapter 7 on: it's the day of the shoot
  const nextShootCard = (
    <button {...T('shootcard')} onClick={tap('shootcard')} className="relative overflow-hidden w-full text-left rounded-[28px] p-5 border border-pt-accent/35"
      style={{ background: 'radial-gradient(120% 90% at 100% 0%, rgba(235,211,153,.28), transparent 55%), linear-gradient(160deg, #2b2416, #141210 70%)' }}>
      <BrandMark className="absolute -right-10 top-4 w-56 text-white/[0.06] pointer-events-none" title="" />
      <span className="relative flex items-center justify-between">
        <span className="text-xs font-semibold text-[#EBD399]">Next shoot</span>
        <span className="text-xs font-semibold rounded-full px-3 py-2 bg-pt-accent/20 text-[#EBD399]">{shootDay ? 'today' : 'soon'}</span>
      </span>
      <span className="relative block font-display text-[44px] leading-[0.95] font-extrabold tracking-tighter mt-2">{formatDay(day)}</span>
      <span className="relative block text-[17px] font-semibold mt-1">{house.name} · {fmtSlot(START, SLOT)}</span>
      <span className="relative grid grid-cols-3 gap-2 my-4">{homeStep('Time', true, 'Booked', today)}{homeStep('Props', sentAll, 'Requested', cut.props)}{homeStep('Gear', sentAll, 'Held', cut.gear)}</span>
      <span className="relative block w-full text-center rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">{shootDay ? 'Check in' : 'Open this shoot'}</span>
    </button>
  )
  // The top of the real "Your shoot" sheet (ShootSheet): who, when, where, and the Booked → Filmed line.
  const shootTop = (stage: number) => (
    <div {...T('shoottop')} className="space-y-3">
      <div className="flex items-start gap-3">
        <Avatar email={profile.email} name={name} size={44} ring />
        <div className="min-w-0">
          <p className="text-pt-text font-semibold">{longDay} · {fmtSlot(START, SLOT)}</p>
          <p className="text-pt-muted text-sm">{house.name} · {house.address}</p>
          <div className="flex gap-2 mt-2"><Pill tone="free">{stage >= 3 ? 'Filmed' : stage >= 2 ? 'Checked in' : 'Booked'}</Pill></div>
        </div>
      </div>
      <div>
        <div className="flex gap-1">{[1, 2, 3].map(n => <span key={n} className={`flex-1 h-1 rounded-full ${stage >= n ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
        <div className="flex justify-between text-xs text-pt-muted mt-1"><span>Booked</span><span>Checked in</span><span>Filmed</span></div>
      </div>
    </div>
  )
  // ProofPhotos' camera tile (the real one uploads; this one keeps the photo on the phone).
  const camTile = (key: string, label: string, hint?: string) => {
    const photo = photos[key]
    return (
      <div className="space-y-2">
        <p className="text-pt-text text-sm font-medium">{label}</p>
        {hint && <p className="text-pt-muted text-xs">{hint}</p>}
        <div className="grid grid-cols-3 gap-2">
          {photo ? <button {...(step.id === key ? T('camera') : {})} onClick={() => step.id === key && cam.current?.click()} aria-label="Retake photo" className="relative aspect-square rounded-xl overflow-hidden bg-pt-border"><img src={photo} alt="" className="w-full h-full object-cover" />{step.id === key && <span className="absolute bottom-1 inset-x-1 text-center text-xs font-semibold rounded-md bg-black/60 text-white py-0.5">Retake</span>}</button>
            : <button {...T('camera')} onClick={() => step.target === 'camera' && cam.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-pt-accent/60 text-pt-accent text-sm flex flex-col items-center justify-center gap-1">
                <Icon name="camera" className="w-7 h-7" />Take photo</button>}
        </div>
        <p className="text-pt-muted text-xs">{photo ? 'Practice: this photo stays on your phone and is never uploaded.' : 'Opens your camera: take the photo now, on the spot.'}</p>
      </div>
    )
  }
  const notification = (text: string) => (
    <div {...T('notif')} onClick={tap('notif')} className="fixed top-3 inset-x-3 z-[65] rounded-[20px] bg-pt-raised/95 shadow-float px-4 py-3 flex items-center gap-3 cursor-pointer" style={{ marginTop: 'env(safe-area-inset-top)' }}>
      <span className="w-9 h-9 rounded-xl bg-black grid place-items-center shrink-0"><BrandMark className="w-6 text-white" title="" /></span>
      <span className="flex-1 min-w-0"><b className="block text-sm">Prime Capitol <span className="font-normal text-pt-muted">· now</span></b><span className="block text-sm">{text}</span></span>
    </div>
  )
  const requestsHeader = (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
      <button {...T('tome')} onClick={tap('tome')} className="block text-pt-accent text-[17px] py-1">‹ Me</button>
      <h1 className="font-display text-[34px] text-pt-text py-1">My requests</h1>
      <div className="flex gap-2"><span className="px-3 py-1 rounded-full text-sm bg-pt-accent text-stone-900 font-medium">Upcoming (1)</span><span className="px-3 py-1 rounded-full text-sm bg-pt-surface shadow-hairline text-pt-muted">Past</span></div>
    </div>
  )
  // The request card from My requests.
  const requestsCard = (
    <div {...T('card')} className="bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
      <div className="w-full flex items-center gap-3 text-left px-1">
        <span className="w-12 shrink-0 text-center"><span className="block text-xs font-semibold text-pt-accent">{formatDay(day, { weekday: 'short' }).toUpperCase()}</span><span className="block text-[22px] font-bold leading-none text-pt-text">{Number(day.slice(8))}</span></span>
        <span className="flex-1 min-w-0"><b className="block text-pt-text text-[15px] truncate">{shootLabel}</b><span className="block text-pt-muted text-xs truncate">{title}</span></span>
        <span className="text-pt-muted">›</span>
      </div>
      <div {...T('propsrow')}>
        <RequestRow className="bg-pt-bg" label="Props & costumes" onOpen={tap('propsrow')} l={{ id: 'p', kind: 'props', title, status: propsStatus, count: propCount }} />
      </div>
      <div {...T('gearrow')}>
        <RequestRow className="bg-pt-bg" label={`Gear · ${fmtSlot(START, SLOT)}`} onOpen={tap('gearrow')} l={{ id: 'g', kind: 'gear', title, status: gearStatus, count: Math.max(1, gearCount) }} />
      </div>
      {at('returnall') && !past('returned') && <button {...T('returnall')} onClick={tap('returnall')} className="w-full rounded-lg py-3 text-sm font-semibold text-stone-900 bg-pt-accent shadow-gold">Return everything</button>}
      {!at('part7') && <div className="w-full rounded-lg py-3 text-sm font-semibold text-pt-accent bg-pt-accent/10 text-center">+ Add props or gear <span className="font-normal text-pt-muted">· by {formatDay(cut.gear)}</span></div>}
    </div>
  )
  // Chapter 9 (real): the Me screen's notifications card.
  const notifyCard = (
    <div {...T('notifycard')} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent text-lg"><Icon name="bell" className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0"><b className="block text-pt-text">Notifications</b><span className="block text-pt-muted text-xs">Invites, props ready, shoot reminders, things due back</span></span>
      </div>
      {push === 'on' ? <p className="text-green-400 font-semibold">✓ Notifications are on</p>
        : push === 'off' ? <button disabled={pushBusy} onClick={turnOn} className={btnGold}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
        : push === 'needs-install' ? (
          <ol className="space-y-2 text-[14px] text-pt-text list-decimal list-inside">
            <li>Tap <b>Share</b> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b>, then Add</li>
            <li>Open <b>Prime Capitol</b> from your Home Screen</li><li>Me → Notifications → <b>Turn on</b></li>
          </ol>
        ) : push === 'blocked' ? <p className="text-pt-muted text-sm">Notifications are blocked for this app. {isIOS() ? 'iPhone Settings → Notifications → Prime Capitol → Allow Notifications.' : 'Tap the lock or ⓘ next to the web address → Notifications → Allow.'}</p>
        : <p className="text-pt-muted text-sm">This browser can't show notifications. Open the app on your phone to turn them on.</p>}
      {pushMsg && <p className="text-amber-300 text-xs">Couldn't turn them on: {pushMsg} You can try again later from Me → Notifications.</p>}
    </div>
  )
  const meScreen = (
    <div className="pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><span className="flex-1">Me</span>{aiPill('ai')}</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 flex items-center gap-4">
          <span className="relative"><Avatar email={profile.email} name={name} size={72} /><span className="absolute -bottom-1 -right-1 bg-pt-accent text-stone-900 rounded-full w-7 h-7 grid place-items-center text-sm">✎</span></span>
          <span className="min-w-0"><b className="block text-pt-text truncate">{name}</b><span className="block text-pt-muted text-xs truncate">{profile.email}</span><span className="block text-pt-accent text-sm">Creator</span></span>
        </div>
        {step.scene === 'notify' && notifyCard}
        <div className="rounded-2xl p-4 text-sm bg-pt-surface shadow-hairline"><p className="text-pt-text font-semibold">No strikes</p><p className="text-pt-muted">Strikes come from no-shows, late cancels and upheld reports.</p></div>
        <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06]">
          {[['My requests', 'Props and gear for each shoot, and where they are'], ['Help', 'How do I…? Booking, props, gear, check-in, sign-in'], ['App tour', 'Practise booking a shoot again, step by step'], ['How it works', 'Slots, cutoffs, check-ins, strikes']].map(([t, d], n) => (
            <button key={t} {...(n === 0 ? T('myrequests') : {})} onClick={n === 0 ? tap('myrequests') : undefined} className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <span className="flex-1 min-w-0"><span className="block text-pt-text">{t}</span><span className="block text-pt-muted text-xs">{d}</span></span><span className="text-pt-muted">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const scenes: Record<Scene, () => ReactNode> = {
    hello: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          <div className="chapter-rise relative self-center"><span className="absolute inset-0 rounded-full blur-2xl bg-pt-accent/25" /><BrandMark className="relative w-28 text-white" title="" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '100ms' }}>Welcome to Prime Capitol{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '170ms' }}>Your home base for every shoot. No more chasing people in the group chat: it's all right here.</p>
          </div>
          <div className="space-y-3">
            {([['calendar', 'Book time at the house in a couple of taps'], ['basket', 'Grab props, costumes and gear, ready when you arrive'], ['sparkle', 'An AI helper for prop ideas and free times']] as [IconName, string][]).map(([i, t], n) => (
              <div key={t} className="chapter-rise flex items-center gap-3.5" style={{ animationDelay: `${240 + n * 70}ms` }}>
                <span className="w-11 h-11 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent shrink-0"><Icon name={i} className="w-5 h-5" /></span>
                <span className="text-[16px] text-pt-text">{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="chapter-rise space-y-2 pb-4" style={{ animationDelay: '480ms' }}>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Show me around</button>
          {!required && <button onClick={onFinish} className="w-full py-2 text-pt-muted text-[15px]">Not now</button>}
        </div>
      </div>
    ),
    meet: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe">
        <div className="flex-1 flex flex-col justify-center gap-5 py-8">
          <div className="flex items-end gap-3">
            <Cap size={84} className="cap-bob" />
            <div className="coach-in relative rounded-[22px] rounded-bl-md bg-[#F6F1E6] text-stone-900 px-4 py-3 mb-6">
              <p className="text-[20px] font-bold leading-snug">Hey, I'm Cap!</p>
              <p className="text-[15px] text-stone-600">Your guide for the next few minutes.</p>
            </div>
          </div>
          <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/90" style={{ animationDelay: '150ms' }}>We're going to run one practice shoot together, start to finish. You tap the real buttons, but nothing actually gets booked. Pinky promise.</p>
          <div className="chapter-rise grid grid-cols-3 gap-2 text-center" style={{ animationDelay: '220ms' }}>
            {[['10', 'short chapters'], ['8', 'minutes, ish'], [String(CHAPTERS.length), 'badges to collect']].map(([n, t]) => (
              <div key={t} className="rounded-2xl bg-pt-surface py-3"><p className="font-display text-[28px] font-extrabold text-pt-accent leading-none">{n}</p><p className="text-[13px] text-pt-muted mt-1">{t}</p></div>
            ))}
          </div>
          <div className="chapter-rise space-y-2.5" style={{ animationDelay: '290ms' }}>
            {([['hand', 'When I point at something, tap the glowing part'], ['restore', 'Lost? Back takes you one step back'], ['pause', "Close the app any time, I'll save your spot"]] as [IconName, string][]).map(([i, t]) => (
              <p key={t} className="flex items-center gap-3 text-[15px] text-pt-text/85"><Icon name={i} className="w-5 h-5 text-pt-accent" />{t}</p>
            ))}
          </div>
        </div>
        <div className="space-y-2 pb-4">
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Let's do this</button>
          <button onClick={back} className="w-full py-2 text-pt-muted text-[15px]">Back</button>
        </div>
      </div>
    ),
    home: () => (
      <div className="pb-10">
        {homeHeader}
        <div className="px-5 mt-4 space-y-4">
          <div className="bg-pt-surface rounded-[28px] p-5 text-center space-y-3">
            <p className="text-pt-text text-lg font-semibold">No shoots booked</p>
            <p className="text-pt-muted text-sm">Book a time at {house.name}, {s.houses.cliff2.name} or somewhere else, then add props and gear to it.</p>
            <button {...T('book')} onClick={tap('book')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book a shoot</button>
          </div>
          {searchAndAi}
        </div>
      </div>
    ),
    find: () => {
      const term = friendQ.trim().toLowerCase()
      const matches = term ? (people ?? []).filter(p => p.name.toLowerCase().includes(term) && !friends.some(f => f.email === p.email)).slice(0, 6) : []
      const need = friends.length < friendCount
      return sheet('Book a shoot', (
        <>
          <p className="text-pt-muted text-xs mb-2">Who's filming?</p>
          <div {...T('who')} className="flex bg-pt-bg rounded-full p-1 gap-1">
            {['Just me', '+ 1 friend', '+ 2 friends'].map((l, n) => (
              <button key={l} onClick={() => pickCount(n)} className={`flex-1 rounded-full min-h-[40px] text-sm ${friendCount === n ? 'bg-pt-accent text-stone-900 font-semibold shadow-gold' : 'text-pt-text'}`}>{l}</button>
            ))}
          </div>
          {friendCount > 0 && (
            <div {...T('friendzone')} className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {friends.map(f => (
                  <button key={f.email} onClick={() => dropFriend(f.email)} className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline"><Avatar email={f.email} name={f.name} size={32} />{firstOf(f.name)}<span className="text-pt-muted">×</span></button>
                ))}
              </div>
              {need && at('friendname') && (
                <div className="bg-pt-bg rounded-xl p-2">
                  <input type="search" value={friendQ} onChange={e => setFriendQ(e.target.value)} placeholder={friends.length ? 'Search for your second friend' : 'Search by name or channel'} className={field} />
                  <div className="max-h-48 overflow-y-auto mt-1">
                    {term && people === null && <p className="text-pt-muted text-sm p-2">Loading…</p>}
                    {term && people !== null && matches.length === 0 && <p className="text-pt-muted text-sm p-2">No one called "{friendQ.trim()}".</p>}
                    {matches.map(p => (
                      <button key={p.email} onClick={() => pickFriend(p)} className="w-full flex items-center gap-3 p-2 rounded-lg text-left">
                        <Avatar email={p.email} name={p.name} size={32} />
                        <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm truncate">{p.name}</span></span>
                      </button>
                    ))}
                    {term && people !== null && matches.length === 0 && (
                      <button onClick={() => pickFriend(friends.some(f => f.email === 'practice-1') ? { email: 'practice-2', name: 'Alex (practice)' } : { email: 'practice-1', name: 'Sam (practice)' })} className="w-full text-left p-2 text-pt-accent text-sm">Practise with "{friends.some(f => f.email === 'practice-1') ? 'Alex' : 'Sam'}" instead ›</button>
                    )}
                  </div>
                </div>
              )}
              <p className="text-pt-muted text-xs">{!need ? `You book your slot; ${friends.length > 1 ? 'theirs are' : 'theirs is'} held for ${HOLD} minutes for them to confirm.` : 'Each of you gets a 2-hour slot, back to back. Pick who, or they can book the next slot themselves.'}</p>
            </div>
          )}
          <div {...T('days')} className="mt-5 -mx-6 px-6 flex gap-2 overflow-x-auto no-scrollbar">
            <button onClick={() => step.id === 'days' && setPickedDay(null)} className={`shrink-0 rounded-2xl px-4 min-h-[56px] grid place-items-center text-sm font-semibold ${pickedDay ? 'bg-pt-bg text-pt-text' : 'bg-pt-accent text-stone-900 shadow-gold'}`}>Soonest</button>
            {strip.map((d, n) => (
              <button key={d} onClick={n === 0 ? undefined : () => pickDay(d)} aria-label={formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                className={`shrink-0 w-12 rounded-2xl min-h-[56px] flex flex-col items-center justify-center ${pickedDay === d ? 'bg-pt-accent text-stone-900 shadow-gold' : n === 0 ? 'bg-pt-bg text-pt-muted/50' : 'bg-pt-bg text-pt-text'}`}>
                <span className="text-xs leading-none">{formatDay(d, { weekday: 'short' })}</span><span className="text-[17px] font-semibold leading-tight mt-1">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            <p className="text-pt-text text-[20px] font-semibold tracking-heading mb-3">{longDay}</p>
            <div className="space-y-2">
              {[START, START + SLOT * 2, START + SLOT * 3].map((t, n) => (
                <div key={t} {...(n === 0 ? T('slot') : {})} className="flex items-center gap-2 bg-pt-bg rounded-xl p-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-pt-text font-semibold">{fmtSlot(t, (1 + friendCount) * SLOT)}</span>
                    {friendCount > 0 && <span className="block text-pt-muted text-xs truncate">You {fmtSlot(t, SLOT)}{friends.length ? ` · then ${friends.map(f => firstOf(f.name)).join(', ')}` : ''}</span>}
                  </span>
                  {[house.name, s.houses.cliff2.name].map(h => <button key={h} onClick={n === 0 ? tap('slot') : undefined} className="bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[40px] text-sm shadow-gold shrink-0">{h}</button>)}
                </div>
              ))}
            </div>
          </div>
        </>
      ))
    },
    bookit: () => sheet('Book back to back', (
      <>
        <p className="text-pt-muted text-sm">{longDay} · {house.name}</p>
        <div className="mt-4 space-y-2">
          {[{ email: profile.email, label: 'You', note: 'Booked', who: name }, ...(friends.length ? friends : [{ email: 'practice-1', name: 'Sam' }]).map(f => ({ email: f.email, label: f.name, note: `Held ${HOLD} min`, who: f.name }))].map((p, i) => (
            <div key={i} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
              <Avatar email={p.email} name={p.who} size={36} />
              <span className="flex-1 min-w-0"><span className="block text-pt-text font-semibold truncate">{p.label}</span><span className="block text-pt-muted text-xs">{fmtSlot(START + i * SLOT, SLOT)}</span></span>
              <span className={`text-xs ${i === 0 ? 'text-pt-accent' : 'text-amber-300'}`}>{p.note}</span>
            </div>
          ))}
        </div>
        <p className="text-pt-muted text-xs mt-4">{friendFirst} {friends.length > 1 ? 'get' : 'gets'} a notification to confirm. If they don't within {HOLD} minutes, the slot opens to everyone.</p>
        <button {...T('bookit')} onClick={bookIt} className={`mt-5 ${btnGold} ${flash ? 'booked-flash' : ''}`}>{flash ? 'Booked ✓' : `Book + invite ${friends.length > 1 ? 'them' : friendFirst}`}</button>
      </>
    )),
    booked: () => { const filmed = past('wrap'); return (
      <div className="pb-8">
        {scheduleHeader(day)}
        <div className="px-4 pt-3 space-y-2">
          <p className="text-pt-accent text-sm text-center py-1">{filmed ? 'Filmed ✓' : 'Booked ✓'}</p>
          {slotRow(freeRow(START - SLOT))}
          <div {...T('myslots')} className="space-y-2">
            {slotRow({ t: START, title: 'You', sub: filmed ? `Filmed “${wrapText.trim() || title}”` : undefined, pill: <Pill tone="info">{filmed ? 'Filmed' : 'Yours'}</Pill>, cls: 'bg-pt-accent/10 border-pt-accent', face: <Avatar email={profile.email} name={name} ring /> })}
            {(friends.length ? friends : [{ email: 'practice-1', name: 'Sam' }]).map((f, i) => slotRow(filmed
              ? { t: START + (i + 1) * SLOT, title: f.name, sub: 'Your collab', cls: 'bg-pt-surface border-transparent', face: <Avatar email={f.email} name={f.name} /> }
              : { t: START + (i + 1) * SLOT, title: <span className="text-amber-300">Held for {firstOf(f.name)}</span>,
              sub: `Your collab · opens at ${fmtTime(START + 20)} if not confirmed`, pill: <Pill tone="warn">Held</Pill>, cls: 'bg-amber-400/[0.06] border-dashed border-amber-400/50', face: <Avatar email={f.email} name={f.name} /> }))}
          </div>
          {slotRow(freeRow(START + (1 + Math.max(1, friends.length)) * SLOT))}
        </div>
      </div>
    ) },
    home2: () => <div className="pb-10">{homeHeader}<div className="px-5 mt-4 space-y-4">{nextShootCard}{searchAndAi}</div></div>,
    shoot: () => sheet('Your shoot', (
      <div {...T('shootsheet')} className="space-y-3">
        {shootTop(1)}
        <div className="space-y-2">
          <p className="text-pt-muted text-xs">For this shoot</p>
          <div className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)]">
            <span className="w-9 h-9 rounded-xl grid place-items-center bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">✦</span>
            <span className="flex-1 min-w-0"><b className="block text-sm text-pt-text">Plan it with AI</b><span className="text-pt-muted text-xs">Props for your idea and the gear that's free, then you check it</span></span>
            <span className="text-pt-muted">›</span>
          </div>
          {([['Props & costumes', cut.props, `new props by ${formatDay(cut.builds)}`, 'addprops'], ['Gear', cut.gear, '', '']] as const).map(([t, by, extra, tg]) => (
            <div key={t} className="bg-pt-bg rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-pt-text font-semibold">{t}</p><p className="text-pt-muted text-xs">Add by {formatDay(by)}{extra ? ` · ${extra}` : ''}</p></div>
                <button {...(tg ? T(tg) : {})} onClick={tg ? tap(tg) : undefined} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm">+ Add</button>
              </div>
              <p className="text-pt-muted text-xs">Nothing yet.</p>
            </div>
          ))}
        </div>
      </div>
    )),
    browse: () => (
      <div {...T('browsezone')}>
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          {browseHeader(false)}
          <div className="flex gap-2 mt-3 overflow-hidden">
            {['All', 'Prop', 'Costume', 'Set Dressing', 'Tech props'].map((c, n) => <span key={c} className={`shrink-0 px-3 py-1 rounded-full text-sm ${n === 0 ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{c}</span>)}
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <span className="bg-pt-surface border border-pt-border rounded-lg px-3 py-2 text-sm text-pt-muted">Any status ▾</span>
            <span className="text-pt-muted text-xs">{query.trim() ? found(query).length : all.length} props</span>
          </div>
          <div className="mt-3">{addingTo('props')}</div>
        </div>
        <div className="px-4 pt-1">
          {query.trim() && shown.length === 0 && <p className="text-pt-muted text-sm text-center py-6">Nothing called "{query.trim()}". Try another word, like mask, hat or phone.</p>}
          <div className="grid grid-cols-2 gap-3">{shown.map(tile)}</div><div className="h-20" />
        </div>
        {basket}
      </div>
    ),
    gear: () => (
      <>
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          {browseHeader(true)}
          <div className="mt-3 space-y-2">
            {addingTo('gear')}
            <div className="bg-pt-surface rounded-2xl p-3"><div className="grid gap-2 grid-cols-2">
              {[['Gear from', fmtTime(START)], ['Until', fmtTime(START + SLOT)]].map(([l, v]) => <span key={l} className="space-y-1 min-w-0"><span className="block text-pt-muted text-xs">{l}</span><span className="block w-full bg-pt-bg border border-pt-border rounded-xl px-2.5 py-2 text-pt-text text-[15px]">{v}</span></span>)}
            </div></div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-baseline justify-between"><h2 className="text-pt-text text-xl font-semibold tracking-tight">Bundles</h2><span className="text-pt-muted text-xs">Booked as a whole</span></div>
          <div {...T('gearkits')} className="grid grid-cols-2 gap-3">
            {PRACTICE_GEAR.filter(g => g.kind === 'bundle').map(g => {
              const on = (gearPick[g.id] ?? 0) > 0, can = step.id === 'addgear'
              return (
                <div key={g.id} className="relative w-full h-full">
                  <div className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
                    <div className="relative aspect-square">
                      <GearArt category={g.category} className="w-full h-full" />
                      <span className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${FREE}`}>Free</span>
                      <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">{g.pieces.reduce((n, p) => n + p.qty, 0)} pcs</span>
                    </div>
                    <div className="px-3 pt-2 pb-3">
                      <p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{g.name}</p>
                      <p className="text-pt-muted text-xs truncate mt-0.5">{g.category === 'Drones' ? 'Drone' : g.category} · free {fmtHours(START, START + SLOT)}</p>
                    </div>
                  </div>
                  <button onClick={() => can && setGearPick(p => ({ ...p, [g.id]: on ? 0 : 1 }))} aria-label={`${on ? 'Remove' : 'Add'} ${g.name}`}
                    className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${on ? 'bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{on ? '✓' : '+'}</button>
                </div>
              )
            })}
          </div>
          <section {...T('gearextras')} className="space-y-3 pt-3">
            <div className="flex items-baseline justify-between"><h2 className="text-pt-text text-xl font-semibold tracking-tight">Add-on extras</h2><span className="text-pt-muted text-xs">Pick how many</span></div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {PRACTICE_GEAR.filter(g => g.kind === 'extra').map(x => {
                const n = gearPick[x.id] ?? 0, can = step.id === 'addextras', f = x.offered ?? 0
                return (
                  <div key={x.id} className="flex items-center gap-3 px-3 py-3">
                    <GearArt category={x.category} className="w-11 h-11 rounded-xl shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-pt-text text-[15px] truncate">{x.name}</p>
                      <p className="text-xs text-pt-muted">{f} free for your hours</p>
                    </div>
                    <div className="flex items-center rounded-xl overflow-hidden bg-pt-bg shadow-hairline shrink-0">
                      <button onClick={() => can && setGearPick(p => ({ ...p, [x.id]: n - 1 }))} disabled={n === 0} aria-label={`One less ${x.name}`} className="w-11 h-11 text-pt-text text-lg disabled:opacity-30">−</button>
                      <span className="w-7 text-center text-pt-text font-semibold tabular-nums">{n}</span>
                      <button onClick={() => can && setGearPick(p => ({ ...p, [x.id]: n + 1 }))} disabled={n >= f} aria-label={`One more ${x.name}`} className="w-11 h-11 text-pt-text text-lg disabled:opacity-30">+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
          <div className="h-20" />
        </div>
        {basket}
      </>
    ),
    review: () => (
      <div className="pb-[calc(9rem+env(safe-area-inset-bottom))]">
        {backBar(undefined, 'Your shoot')}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {addingTo('shoot')}
          <div {...T('name')} className="space-y-3">
            <input value={video} onChange={e => setVideo(e.target.value.slice(0, 120))} placeholder="Shoot or video name *" className={input} />
            <div className={`${input} text-pt-muted min-h-[72px]`}>Anything the arts department should know (optional)</div>
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2"><p className="text-pt-muted text-xs">Props ({picked.length}) · arts department</p><span className="text-pt-accent text-sm">+ Add props</span></div>
            <div className="space-y-2">
              {picked.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3">
                  <span className="w-14 h-14 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</span>
                  <div className="flex-1 min-w-0"><p className="text-pt-text text-sm font-medium truncate">{p.name}</p><p className="text-green-400 text-xs">Free</p></div>
                  <span className="text-pt-muted text-2xl px-2">×</span>
                </div>
              ))}
            </div>
          </div>
          <div {...T('make')}>
            <p className="text-pt-muted text-xs mb-2">To build or source ({builds.length})</p>
            <div className="space-y-2">
              {builds.map((b, n) => (
                <div key={n} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-3">
                  <div className="w-14 h-14 rounded-xl bg-violet-500/10 shrink-0 flex items-center justify-center text-2xl"><Icon name="tools" className="w-6 h-6 text-violet-300" /></div>
                  <div className="flex-1 min-w-0"><p className="text-pt-text text-sm">{b.description}</p><p className="text-violet-300 text-xs">To build or source · ×{b.qty}</p></div>
                  <span className="text-pt-muted text-2xl px-2">×</span>
                </div>
              ))}
            </div>
            {showBuild || step.id === 'makeform' ? (
              <div className="mt-2 bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-3">
                <textarea value={buildDesc} onChange={e => setBuildDesc(e.target.value.slice(0, 500))} rows={2} placeholder="What do you need? e.g. Half-eaten birthday cake, chocolate" className={`${input} resize-none`} />
                <div className="flex items-center gap-3">
                  <span className="text-pt-muted text-sm">How many?</span>
                  <button onClick={() => setBuildQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">−</button>
                  <span className="text-pt-text w-6 text-center">{buildQty}</span>
                  <button onClick={() => setBuildQty(q => Math.min(20, q + 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">+</button>
                </div>
                <div className="flex gap-2">
                  <span className="flex-1 grid place-items-center py-3 rounded-xl shadow-hairline text-pt-muted text-sm">Cancel</span>
                  <button onClick={addBuild} disabled={!buildDesc.trim()} className="flex-1 py-3 rounded-xl bg-violet-500 text-white text-sm font-semibold disabled:opacity-40">Add request</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { if (step.id === 'make') { setShowBuild(true); advance() } }} className="mt-2 w-full py-3 rounded-2xl border border-dashed border-violet-500/60 text-violet-300 text-sm font-medium">+ Request something we don't have</button>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between"><p className="text-pt-muted text-xs">Gear ({gearCount}) · equipment team</p><span className="text-pt-accent text-sm">+ Add gear</span></div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {chosen.map(g => (
                <div key={g.id} className="flex items-center gap-3 px-3 py-3">
                  <GearArt category={g.category} className="w-12 h-12 rounded-xl shrink-0" />
                  <div className="min-w-0 flex-1"><p className="text-pt-text text-sm font-medium truncate">{g.name}{g.kind === 'extra' ? ` ×${gearPick[g.id]}` : ''}</p><p className="text-pt-muted text-xs">{g.kind === 'bundle' ? 'Bundle' : 'Add-on'} · {fmtHours(START, START + SLOT)}</p></div>
                  <span className="text-pt-muted text-2xl px-2">×</span>
                </div>
              ))}
            </div>
            <p className="text-pt-muted text-xs leading-snug px-1">Gear: pick up {formatDay(day)} at {fmtTime(START)} from the equipment cage; back by {fmtTime(START + SLOT)}. Return photo required.</p>
          </div>
        </div>
        <div className="fixed bottom-0 inset-x-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
          <button {...T('send')} onClick={tap('send')} className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg mb-3 shadow-gold">Book props + gear</button>
        </div>
      </div>
    ),
    sent: () => (
      <div className="pb-12">
        {backBar(statusPill('requested'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {banner('green', "You're booked ✓", "These props are held for your dates. You'll see the status change here as the arts department gets them ready.")}
          {titleBlock}{shootLink('gear')}{journey('requested')}{contents(false)}
        </div>
      </div>
    ),
    me: () => meScreen,
    notify: () => meScreen,
    requests: () => <div className="pb-6">{requestsHeader}<div className="px-4 space-y-3">{requestsCard}</div></div>,
    request: () => {
      const st: ReservationStatus = at('packed') ? 'packed' : 'requested'
      const box = 'w-9 h-9 text-pt-text text-xl disabled:opacity-30'
      return (
        <div className="pb-12">
          {backBar(statusPill(st))}
          <div className="px-4 pt-4 pb-8 space-y-6">
            {past('changeit') && st === 'requested' && banner('green', 'Changed ✓', 'The arts department sees your new list straight away.')}
            {titleBlock}{shootLink('gear')}{journey(st)}{contents(false)}
            {st === 'requested' && (editing || step.id === 'changeit' || step.id === 'changeadd' ? (
              <div {...T('changebox')} className="bg-pt-surface border border-pt-accent/40 rounded-2xl p-3 space-y-3">
                <p className="text-pt-text font-semibold">Change your request</p>
                {picked.map(p => {
                  const n = qty[p.id] ?? 1
                  return (
                    <div key={p.id} className={`flex items-center gap-3 ${n ? '' : 'opacity-40'}`}>
                      <div className="w-11 h-11 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</div>
                      <p className={`flex-1 min-w-0 text-sm truncate ${n ? 'text-pt-text' : 'line-through text-pt-muted'}`}>{p.name}</p>
                      {n > 0 ? (
                        <>
                          <div className="flex items-center rounded-xl bg-pt-bg shadow-hairline shrink-0">
                            <button className={box} disabled={n <= 1} onClick={() => setQty({ ...qty, [p.id]: n - 1 })} aria-label="One less">−</button>
                            <span className="w-7 text-center text-pt-text font-semibold tabular-nums">{n}</span>
                            <button className={box} disabled={n >= Math.max(1, p.quantity)} onClick={() => setQty({ ...qty, [p.id]: n + 1 })} aria-label="One more">+</button>
                          </div>
                          <button onClick={() => setQty({ ...qty, [p.id]: 0 })} aria-label={`Remove ${p.name}`} className="text-pt-muted text-2xl w-7">×</button>
                        </>
                      ) : <button onClick={() => setQty({ ...qty, [p.id]: 1 })} className="text-pt-accent text-sm tap">Put back</button>}
                    </div>
                  )
                })}
                <div {...T('changesearch')} className="space-y-2 pt-1">
                  <div className="relative">{searchIcon}
                    <input value={changeQ} onChange={e => setChangeQ(e.target.value)} placeholder="Search the closet to add a prop" enterKeyHint="search" aria-label="Search props to add"
                      className="w-full bg-pt-bg border border-pt-border rounded-xl pl-10 pr-3 py-2.5 text-pt-text text-sm focus:outline-none focus:border-pt-accent" />
                  </div>
                  {changeQ.trim().length >= 2 && (() => {
                    const hits = found(changeQ).filter(i => !added.includes(i.id)).slice(0, 4)
                    return hits.length ? hits.map(it => (
                      <div key={it.id} className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(it) && <img src={thumb(it)} alt="" className="w-full h-full object-cover" />}</div>
                        <p className="flex-1 min-w-0 text-sm truncate text-pt-text">{it.name}</p>
                        <button onClick={() => { setAdded(a => [...a, it.id]); setQty(q => ({ ...q, [it.id]: 1 })); setChangeQ(''); setChangeAdded(n => n + 1) }} className="shrink-0 bg-pt-accent/15 text-pt-accent font-semibold rounded-xl px-3 py-2 text-sm">+ Add</button>
                      </div>
                    )) : <p className="text-pt-muted text-sm">Nothing matches "{changeQ.trim()}". Try mask or hat.</p>
                  })()}
                </div>
                <input value={newBuild} onChange={e => setNewBuild(e.target.value.slice(0, 200))} placeholder="Something we don't have (make or find)"
                  className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent" />
                <div className="flex gap-2">
                  <span className="flex-1 grid place-items-center bg-pt-border text-pt-text rounded-xl py-3">Never mind</span>
                  <button onClick={saveChange} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Save changes</button>
                </div>
                <p className="text-pt-muted text-xs">You can change this until the arts department starts picking.</p>
              </div>
            ) : (
              <div className="flex gap-2">
                <button {...T('changebtn')} onClick={startChange} className="flex-1 bg-pt-surface shadow-hairline text-pt-text font-semibold rounded-xl py-3">Change</button>
                <span {...T('addmore')} className="flex-1 grid place-items-center bg-pt-surface shadow-hairline text-pt-text font-semibold rounded-xl py-3">+ Add more</span>
              </div>
            ))}
          </div>
        </div>
      )
    },
    chat: () => {
      const itemById = new Map(items.map(i => [i.id, i]))
      const tickBtn = (k: string, label: string) => aiAdded && aiTicks.includes(k)
        ? <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-accent/20 text-pt-accent">✓</span>
        : <button onClick={() => aiTick(k)} aria-pressed={aiTicks.includes(k)} aria-label={`${aiTicks.includes(k) ? 'Untick' : 'Tick'} ${label}`}
            className={`w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 ${aiTicks.includes(k) ? 'bg-[#BF9DFF] text-[#140f22]' : 'bg-pt-border text-pt-text text-xl'}`}>{aiTicks.includes(k) ? '✓' : '+'}</button>
      const aiLabel = `${s.houses.cliff1.name} · ${formatDay(aiDay)} · ${fmtSlot(17 * 60, SLOT)}`
      const bubbleMe = (t: string) => <p className="ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent shadow-gold">{t}</p>
      const bubbleAi = (t: ReactNode) => <p className="max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">{t}</p>
      return (
        <div className="min-h-full flex flex-col">
          <div className="pt-safe px-5 shrink-0">
            <div className="flex items-center justify-between py-3"><button {...T('aiback')} onClick={tap('aiback')} className="text-pt-accent text-[17px]">‹ Back</button></div>
            <h1 className="font-display text-[28px] font-extrabold tracking-tight flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>AI helper</h1>
            <p className="text-pt-muted text-[13px]">Ideas from our real props and gear, and times that are actually free.</p>
          </div>
          <div className="flex-1 px-5 py-4 space-y-3">
            {bubbleAi(<>Hi{first ? ` ${first}` : ''}! Tell me your video idea, or when you want to film, or both. I'll find the props we have and the times that are free.</>)}
            {asked && (
              <>
                {bubbleMe(asked)}
                <div {...T('answer')} className="space-y-3">
                  {aiBusy || !aiResult ? (
                    <div role="status" className="flex items-center gap-3">
                      <p className="w-fit flex items-center gap-1.5 rounded-[20px] rounded-bl-md px-4 py-4 bg-[#BF9DFF]/10"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></p>
                      <span className="text-pt-muted text-[13px]">Looking through the props…</span>
                    </div>
                  ) : (
                    <>
                      {bubbleAi(aiResult.reply)}
                      {aiResult.groups.map(g => (
                        <div key={g.title} className="space-y-2">
                          <p className="text-pt-muted text-xs font-semibold">{g.title}</p>
                          {g.picks.map(({ id, why }) => {
                            const p = itemById.get(id)!
                            return (
                              <div key={id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                                <span className="w-[52px] h-[52px] rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</span>
                                <span className="flex-1 min-w-0"><b className="block text-sm truncate">{p.name}</b><span className="block text-xs text-[#CDB8FF]">{why}</span><span className="block text-xs text-pt-muted">Check it ›</span></span>
                                {tickBtn(id, p.name)}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                      {aiResult.missing.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-pt-muted text-xs font-semibold">We don't have it</p>
                          {aiResult.missing.map(m => (
                            <div key={m.name} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                              <span className="w-[52px] h-[52px] rounded-xl grid place-items-center text-2xl bg-violet-500/10 shrink-0"><Icon name="tools" className="w-6 h-6 text-violet-300" /></span>
                              <span className="flex-1 min-w-0"><b className="block text-sm">{m.name}</b><span className="block text-xs text-[#CDB8FF]">{m.why || 'The arts team can make or find it'}</span></span>
                              {tickBtn(`b:${m.name}`, m.name)}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            {timeAsk && (
              <>
                {bubbleMe(timeAsk)}
                {bubbleAi('Here are times that are free. Soonest first.')}
                <div className="space-y-2">
                  {[aiDay, addOpenDays(today, 9, settings)].map((d, n) => (
                    <div key={d} className="flex items-center gap-3 rounded-[18px] bg-pt-surface border border-pt-accent/40 px-4 py-3">
                      <span className="w-12 text-center shrink-0"><span className="block text-xs text-pt-muted">{formatDay(d, { weekday: 'short' })}</span><b className="block font-display text-[22px] leading-none font-extrabold">{Number(d.slice(8))}</b></span>
                      <span className="flex-1 min-w-0"><b className="block">{n ? s.houses.cliff2.name : s.houses.cliff1.name} · {fmtSlot(17 * 60, SLOT)}</b><span className="block text-pt-muted text-[13px]">You {fmtTime(17 * 60)}</span></span>
                      <button {...(n === 0 ? T('optbook') : {})} onClick={() => { if (n === 0 && step.id === 'aioptions') { setAiBooked(true); advance() } }} className="shrink-0 rounded-xl px-4 py-2 font-bold text-stone-900 bg-pt-accent shadow-gold">Book</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {aiBooked && (
              <>
                {bubbleAi('Booked.')}
                <div className="rounded-[18px] bg-pt-surface border border-pt-accent/40 p-4 space-y-3">
                  <p className="font-semibold">{aiLabel}</p>
                  {!aiAdded
                    ? <button {...T('aiaddbooked')} onClick={() => { if (step.id === 'aiadd') { setAiAdded(true); advance() } }} className="w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold">Add the {aiTicks.length} ticked to this shoot</button>
                    : <p {...T('aiaddedmsg')} className="text-pt-accent text-sm">Added to {aiLabel} ✓ <span className="underline">Review it</span></p>}
                </div>
              </>
            )}
          </div>
          <div className="shrink-0 border-t border-pt-border px-5 pt-3 pb-safe bg-pt-bg">
            {aiTicks.length > 0 && !aiBooked && <span className="block w-full mb-3 rounded-2xl py-4 font-bold text-center text-stone-900 bg-pt-accent/60">Add {aiTicks.length} to a shoot</span>}
            <div {...T('composer')} className="pb-2">
              {(step.id === 'aiask' || step.id === 'aitime') && !idea && (
                <button onClick={() => setIdea(step.id === 'aiask' ? ex.idea : ex.time)} className="mb-2 max-w-full truncate rounded-full px-4 py-2 text-[14px] bg-[#BF9DFF]/15 text-[#CDB8FF]">Try: "{step.id === 'aiask' ? ex.idea : ex.time}"</button>
              )}
              <div className="flex items-center gap-2">
              <input value={idea} onChange={e => setIdea(e.target.value.slice(0, 200))} onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder="Your video idea, or when to film…"
                className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
              <button onClick={send} disabled={idea.trim().length < 3} aria-label="Send" className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-xl font-bold disabled:opacity-40">↑</button>
              </div>
            </div>
          </div>
        </div>
      )
    },
    invite: () => {
      const done = past('confirm')
      return (
        <div className="pb-8">
          {scheduleHeader(inviteDay)}
          <div className="px-4 pt-3 space-y-2">
            {!done ? (
              <div {...T('invitebox')} className="rounded-2xl p-4 border border-amber-400/40 bg-amber-400/10 space-y-2">
                <p className="text-pt-text text-[15px]"><b>{friend?.name ?? 'Sam'}</b> invited you to film right after them: <b>{formatDay(inviteDay)} · {house.name} · {fmtSlot(START + SLOT, SLOT)}</b>.</p>
                <p className="text-amber-200 text-sm">Held for you for {HOLD} minutes.</p>
                <div className="flex gap-2">
                  <span className="flex-1 grid place-items-center bg-pt-border text-pt-text rounded-xl py-3">Can't make it</span>
                  <button onClick={tap('invitebox')} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Confirm my slot</button>
                </div>
              </div>
            ) : <p className="text-pt-accent text-sm text-center py-2">Confirmed ✓ It's your shoot now.</p>}
            {slotRow(freeRow(START - SLOT))}
            {slotRow({ t: START, title: friend?.name ?? 'Sam', cls: 'bg-pt-surface border-transparent', face: <Avatar email={friend?.email ?? 'friend'} name={friend?.name ?? 'Sam'} /> })}
            <div {...T('myrow')}>
              {slotRow(done ? { t: START + SLOT, title: 'You', pill: <Pill tone="info">Yours</Pill>, cls: 'bg-pt-accent/10 border-pt-accent', face: <Avatar email={profile.email} name={name} ring /> }
                : { t: START + SLOT, title: <span className="text-amber-300">Held for you</span>, sub: `${inviterFirst}'s collab · confirm above`, pill: <Pill tone="warn">Held</Pill>, cls: 'bg-amber-400/[0.06] border-dashed border-amber-400/50', face: <Avatar email={profile.email} name={name} /> })}
            </div>
            {slotRow(freeRow(START + SLOT * 2))}
          </div>
        </div>
      )
    },
    pickup: () => (
      <div className="pb-12">
        {backBar(statusPill(past('sign') ? 'collected' : 'packed'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {titleBlock}{journey(past('sign') ? 'collected' : 'packed')}{contents(true)}
          {picked.length > 0 && <div><p className="text-pt-muted text-xs mb-2">Packed · {formatDay(today)}</p><PhotoStrip urls={picked.flatMap(p => { const t = thumb(p); return t ? [t] : [] })} title="What was packed" /></div>}
          {past('sign') ? banner('green', 'Collected: you confirmed everything ✓', `Signed by you, ${formatDay(day)}`) : (
            <div className="bg-pt-accent/10 border border-pt-accent/50 rounded-2xl p-4 space-y-3">
              <p className="text-pt-accent font-semibold text-lg">Ready for pickup!</p>
              <p className="text-pt-text text-sm">When you collect, check you have everything below, then sign off. This confirms what you took.</p>
              <ul className="space-y-1">{picked.map(p => <li key={p.id} className="text-pt-text text-sm">☐ {p.name} <strong>×{qty[p.id] ?? 1}</strong></li>)}{builds.map((b, n) => <li key={n} className="text-pt-text text-sm">☐ {b.description} <strong>×{b.qty}</strong></li>)}</ul>
              <div className="space-y-2">
                <button {...T('sign')} onClick={tap('sign')} className="w-full py-4 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">✓ I've got everything</button>
                <span className="block w-full py-3 rounded-xl shadow-hairline text-pt-text text-sm text-center">Something's missing or wrong</span>
              </div>
            </div>
          )}
        </div>
      </div>
    ),
    gearpickup: () => gearPage(past('gearsign') ? 'out' : 'held', past('gearsign') ? banner('green', "Picked up ✓", "It's yours until you bring it back.") : (
      <section className="space-y-3">
        <div><h2 className="text-pt-text text-xl font-semibold tracking-tight">Pick up</h2><p className="text-pt-muted text-sm">Open the case and tick what's there. Tap "Missing?" for anything that isn't.</p></div>
        <div {...T('pieces')}>
          <PieceChecklist lines={pieceLines} ticked={ticked} missing={missing}
            onTick={k => { if (step.id !== 'pieces') return; setTicked(t => toggle(t, k)); setMissing(m => { const n = new Set(m); n.delete(k); return n }) }}
            onMissing={k => { if (step.id === 'pieces') setMissing(m => toggle(m, k)) }} />
        </div>
        {missing.size > 0 && <p className="text-red-200 text-sm bg-red-500/10 rounded-xl px-4 py-3">{missing.size} piece{missing.size > 1 ? 's' : ''} reported missing <b>before you took it</b>. The equipment team will see it, and it goes on the record of whoever had it last.</p>}
        <p className="text-amber-200 text-sm">Report anything missing now. Once you sign, the gear is your responsibility until it's back.</p>
        <button {...T('gearsign')} onClick={tap('gearsign')} disabled={!allTicked} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Sign: I've got it</button>
        {!allTicked && <p className="text-pt-muted text-xs text-center">Tick every piece, or mark it missing, to sign.</p>}
      </section>
    )),
    checkin: () => sheet('Your shoot', (
      <div className="space-y-3">
        {shootTop(1)}
        <div className="bg-pt-bg rounded-xl p-3 space-y-3">
          <p className="text-pt-text font-semibold">You're up: check in</p>
          {camTile('setphoto', 'Photo of the set', 'Opens your camera')}
          <div {...T('report')} className="space-y-2">
            <p className="text-pt-muted text-sm">The slot before you: <b className="text-pt-text">another creator</b>. Anything wrong? The team reviews every report.</p>
            <div className="flex flex-wrap gap-2">
              {([['Ran over into my time', over, setOver], ['House left a mess', mess, setMess]] as const).map(([x, on, set]) => (
                <button key={x} onClick={() => step.id === 'report' && set(!on)} className={`px-3 py-2 rounded-full text-sm border ${on ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-surface text-pt-text'}`}>{x}</button>
              ))}
            </div>
            {(over || mess) && <textarea value={reportNote} onChange={e => setReportNote(e.target.value.slice(0, 300))} rows={2} placeholder="What happened? e.g. They were still packing up at 1:20, dishes left in the sink" className={field} />}
            {mess && <p className="text-pt-muted text-xs">In the real app you'd also add photos of the mess.</p>}
          </div>
          <button {...T('checkin')} onClick={tap('checkin')} className={btnGold}>{over || mess ? 'Check in and send report' : 'Check in'}</button>
        </div>
      </div>
    )),
    wrap: () => sheet('Your shoot', (
      <div className="space-y-3">
        {shootTop(past('wrap') ? 3 : 2)}
        <div className="bg-pt-bg rounded-xl p-3 space-y-2">
          <p className="text-pt-text text-sm">Checked in {fmtTime(START - 5)}{past('wrap') ? ` · filmed “${wrapText.trim() || title}”` : ''}</p>
          {photos.setphoto && <div><p className="text-pt-muted text-xs mb-2">Set photo</p><img src={photos.setphoto} alt="" className="w-24 h-24 rounded-xl object-cover" /></div>}
          {!past('wrap') && (
            <div {...T('wrap')} className="flex gap-2">
              <input value={wrapText} onChange={e => setWrapText(e.target.value.slice(0, 120))} placeholder="What did you film?" className={field} />
              <button onClick={tap('wrap')} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4">Wrap</button>
            </div>
          )}
        </div>
      </div>
    )),
    // The real ReturnAllScreen: tick what's coming back, one photo, one button.
    returnall: () => (
      <div className="pb-10">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2"><span className="block text-pt-accent text-[17px] py-1">‹ Back</span></div>
        {past('returned') ? (
          <div className="px-4 pt-10 text-center space-y-4">
            <span className="mx-auto w-16 h-16 rounded-full bg-green-600 text-white grid place-items-center text-3xl">✓</span>
            <h1 className="font-display text-[28px] text-pt-text">All returned</h1>
            <p className="text-pt-muted text-[15px]">Thanks! Each team will check everything in. You'll see it on My requests.</p>
            <button {...T('seereq')} onClick={tap('seereq')} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">See my requests</button>
          </div>
        ) : (
          <div className="px-4 space-y-6">
            <div><h1 className="font-display text-[34px] text-pt-text">Return everything</h1><p className="text-pt-muted text-[15px]">{shootLabel}</p></div>
            <section {...T('retlist')} className="space-y-2">
              <h2 className="text-pt-text text-lg font-semibold">What you're bringing back</h2>
              {([['props', `Props & costumes · ${propCount}`, [...picked.map(p => p.name), ...builds.map(b => b.description)].join(', ')], ['gear', `Gear · ${fmtSlot(START, SLOT)}`, gearNames]] as const).map(([k, head, detail]) => {
                const on = !retOff.includes(k)
                return (
                  <button key={k} onClick={() => step.id === 'retlist' && setRetOff(o => on ? [...o, k] : o.filter(x => x !== k))} aria-pressed={on}
                    className="w-full flex items-start gap-3 bg-pt-surface shadow-hairline rounded-2xl px-4 py-3 text-left">
                    <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full grid place-items-center text-sm font-bold ${on ? 'bg-pt-accent text-stone-900' : 'shadow-[inset_0_0_0_2px_#3A3A3C]'}`}>{on ? '✓' : ''}</span>
                    <span className="min-w-0 flex-1">
                      <b className={`block text-[15px] ${on ? 'text-pt-text' : 'text-pt-muted'}`}>{head}</b>
                      <span className="block text-pt-muted text-xs line-clamp-2">{detail}</span>
                      {!on && <span className="block text-pt-muted text-xs mt-1">Keeping it for now. Return it later from My requests.</span>}
                    </span>
                  </button>
                )
              })}
              <p className="text-pt-muted text-xs px-1">Bringing something back later? Untick it.</p>
            </section>
            <section className="space-y-3">
              <h2 className="text-pt-text text-lg font-semibold">Before you go</h2>
              <ol className="bg-pt-surface rounded-2xl px-4 py-3 space-y-1 text-[15px] text-pt-text list-decimal list-inside">
                <li>Put everything together where you're leaving it.</li><li>Every piece of gear back in its case.</li>
                <li>Batteries plugged into the chargers on the shelf.</li><li>Take one photo that shows it all.</li>
              </ol>
              {camTile('retphoto', 'Photo of everything (required)', 'It protects you if anything is questioned later.')}
              <textarea value={retNote} onChange={e => setRetNote(e.target.value.slice(0, 300))} rows={2} placeholder="Where did you leave the props? Anything to flag? (optional)"
                className="w-full bg-pt-surface rounded-xl px-3 py-2 text-pt-text placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent resize-none" />
              <button {...T('returned')} onClick={tap('returned')} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Return all 2</button>
            </section>
          </div>
        )}
      </div>
    ),
    rules: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Your cheat sheet</h1>
        <div className="flex items-center gap-3"><Cap size={36} /><p className="text-[15px] text-pt-text/85">The few rules worth remembering. It's all in Me → Help too.</p></div>
        {[
          ['calendar', `Props from the closet: book ${settings.leadTimeDays} open days ahead. To make or find: ${settings.buildLeadDays}. Gear: ${GEAR_LEAD_TIME_DAYS}.`],
          ['people', `A friend's invite holds the slot for you for ${HOLD} minutes. Confirm it, or it opens to everyone.`],
          ['swap', `Moving or cancelling is free with ${s.noticeHours} hours' notice. Closer than that, swap with someone instead.`],
          ['camera', `Check in at the house: it opens ${s.checkinBefore} minutes before your time.`],
          ['stop', `No-shows and late cancels give a strike. ${s.strikeCount} in ${s.strikeDays} days pauses props and gear for ${s.pauseDays} days. Late returns block new props and gear.`],
          ['help', 'Forgot something? Me → Help, or Me → App tour to do this again.'],
        ].map(([i, t], n) => <div key={t} className="chapter-rise flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4" style={{ animationDelay: `${n * 60}ms` }}><Icon name={i as IconName} className="w-6 h-6 text-pt-accent shrink-0" /><p className="text-[16px] text-pt-text">{t}</p></div>)}
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8 text-center">
          <div className="relative self-center"><Confetti count={40} /><Cap size={96} className="cap-bob" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '120ms' }}>You're officially ready{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '190ms' }}>You booked a shoot, stocked it, filmed it and brought it all back. Honestly, that's the whole app.</p>
          </div>
          <BadgeWall />
        </div>
        <div className="pb-4"><button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">{required ? "Let's make something" : 'Done'}</button></div>
      </div>
    ),
  }

  // The real gear booking page (GearBookingScreen) around its pickup or return section.
  function gearPage(st: 'held' | 'out' | 'returned', body: ReactNode) {
    const n = { held: 0, out: 1, returned: 2 }[st]
    return (
      <div className="pb-10">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-2 py-2 flex items-center"><button {...T('back')} onClick={tap('back')} className="text-pt-accent text-[17px] px-2 py-1">‹ Back</button></div>
        <div className="px-4 space-y-4">
          <div className="space-y-1">
            <div className="flex gap-2"><Pill tone={st === 'held' ? 'info' : st === 'out' ? 'warn' : 'free'}>{st === 'held' ? 'Held' : st === 'out' ? 'Out' : 'Returned'}</Pill></div>
            <h1 className="font-display text-[34px] text-pt-text leading-tight">{title}</h1>
            <p className="text-pt-muted">{formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtHours(START, START + SLOT)}</p>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map(i => <div key={i} className={`h-1.5 rounded-full ${i <= n ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
            <div className="grid grid-cols-4 gap-1 text-xs text-center">{['Held', 'Picked up', 'Returned', 'Checked in'].map((x, i) => <span key={x} className={i === n ? 'text-pt-accent' : 'text-pt-muted'}>{x}</span>)}</div>
          </div>
          {shootLink('props')}
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {[['Pick up', `${formatDay(day)} · ${fmtTime(START)}`], ['Back by', fmtTime(START + SLOT)], ['Where', 'Equipment cage']].map(([a, b]) => <div key={a} className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">{a}</span><span className="text-pt-text">{b}</span></div>)}
          </div>
          {body}
        </div>
      </div>
    )
  }

  // Which tab is lit (as in the real app). Full-screen pages (review, request pages, AI) have no tab bar.
  const TAB: Partial<Record<Scene, string>> = { home: 'Home', home2: 'Home', find: 'Book', bookit: 'Book', booked: 'Book', shoot: 'Book', invite: 'Book', checkin: 'Book', wrap: 'Book', browse: 'Browse', gear: 'Browse', me: 'Me', notify: 'Me', requests: 'Me' }
  const lit = TAB[step.scene]
  // Progress within the part (intro cards don't count).
  const inPart = STEPS.filter(x => x.part === step.part && !x.id.startsWith('part') && !x.quiz)
  const stepInPart = inPart.findIndex(x => x.id === step.id) + 1
  const back = idx > 0 ? () => setIdx(n => { const m = Math.max(0, n - 1); if (required) saveStep(profile.email, m); return m }) : undefined
  const nextDisabled = (step.id === 'name' && video.trim().length < 2) || (step.id === 'report' && (over || mess) && reportNote.trim().length < 3)
    || (step.id === 'friend1' && friendCount === 0) || (step.id === 'friendname' && friends.length < friendCount)
    || (step.id === 'search' && added.length === 0) || (step.id === 'changeadd' && changeAdded === 0) || (step.id === 'retlist' && retOff.length > 0) || (step.id === 'addgear' && !hasCamera) || (step.id === 'pieces' && !allTicked) || (step.id === 'aipicks' && aiTicks.length === 0)
    || (['setphoto', 'retphoto'].includes(step.id) && !photos[step.id]) || (step.id === 'notify' && push === 'off' && !pushMsg)

  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="App tour (practice)">
      <div className="flex-1 overflow-y-auto">{scenes[step.scene]()}</div>
      {lit && (
        <nav {...T('tabbar')} className="shrink-0 flex bg-black/80 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1)] pb-tabbar">
          {['Home', 'Book', 'Browse', 'Me'].map(t => (
            <button key={t} {...T(`nav-${t.toLowerCase()}`)} onClick={tap(`nav-${t.toLowerCase()}`)}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs ${lit === t ? 'text-pt-accent' : 'text-pt-muted'}`}>
              {TAB_ICONS[t]}<span>{t}</span>
            </button>
          ))}
        </nav>
      )}
      {step.notif && notification(step.notif)}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { shot(e.target.files?.[0]); e.target.value = '' }} />
      {step.id.startsWith('part') && <ChapterCard key={step.id} n={step.part!} body={step.body} onGo={advance} onBack={back} />}
      {step.quiz && <QuizCard key={step.id} part={step.part!} {...step.quiz} onDone={advance} onBack={back} />}
      {step.part && !step.id.startsWith('part') && !step.quiz && <Spotlight stepKey={step.id} target={step.target} top={step.top} dim={!step.look} title={step.title} body={step.body} part={step.part}
        stepInPart={stepInPart || undefined} stepsInPart={stepInPart ? inPart.length : undefined} next={step.next} onNext={advance}
        nextDisabled={nextDisabled} disabledHint={step.hint} onBack={back} onSkip={step.skip && !photos[step.id] ? advance : undefined} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
