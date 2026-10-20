// App tour: a hands-on practice STORY that trains a new creator on the whole process (owner, Oct 20: "guide me there…
// show me how to navigate the UI… go through a bit of a story and explain why"). Nine chapters, each opened by a short
// "what's next and why" card, and you get everywhere with the real tabs and buttons (no teleporting):
//   1 Find your way around (tabs, ✦ AI)  2 Book your first shoot (with a friend → find it again: Home → your shoot card)
//   3 Add props and gear (from the shoot page: + Add → search → gear → review → send)
//   4 Check on your request (Back → Me → My requests → open → Change → Save → "ready" notification)
//   5 Try the AI (Me → ✦ AI → describe an idea → tick → ask for a time → Book → add the ticked to that new shoot)
//   6 When a friend invites you (notification → Confirm within the hold time)
//   7 Shoot day (notification → props pickup → My requests → gear pickup → "check-in open" notification → check in → wrap)
//   8 Bring it all back (Me → My requests → props return → gear return → checked in)
//   9 Turn on notifications (REAL: turnOnPush; required unless the phone can't yet, e.g. iPhone Safari before Add to Home Screen)
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
import { subscribeToGearBundles, type GearBundle } from '../services/gear'
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
import { markTourDone, savedStep, saveStep } from './tourState'

type Scene = 'welcome' | 'home' | 'find' | 'bookit' | 'booked' | 'home2' | 'shoot' | 'browse' | 'gear' | 'review' | 'sent'
  | 'me' | 'requests' | 'request' | 'chat' | 'invite' | 'pickup' | 'gearpickup' | 'checkin' | 'wrap' | 'return' | 'gearreturn'
  | 'notify' | 'rules' | 'done'
// A step: what's on screen (scene), what to use (target), the coach panel's text, and how you move on (a tap on the
// target, or Continue = next). hint = why Continue is greyed out. top = panel at the top. look = nothing dimmed (you're
// just looking around). notif = a pretend phone notification shows (tap it = the target 'notif').
interface Step { id: string; scene: Scene; part?: number; target?: string; title: ReactNode; body?: ReactNode; next?: string; hint?: string; skip?: boolean; top?: boolean; look?: boolean; notif?: string }

const START = 13 * 60, SLOT = 120, HOLD = INVITE_HOLD_MINUTES
// Same class strings as the real screens.
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'
const searchIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
const FREE = 'bg-green-500/90 text-stone-900'

export default function Tour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const name = profile.name || user.displayName || profile.email
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const items = useItems()
  const settings = useBookingSettings()
  const s = useScheduleSettings()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])

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
  const kit = bundles.find(b => b.kind !== 'extra' && !b.archived)
  const kitName = kit?.name ?? 'Camera kit'
  const kitPieces = kit?.pieces.length ? kit.pieces : [{ itemId: 'a', qty: 1, name: 'Camera body' }, { itemId: 'b', qty: 1, name: 'Lens' }, { itemId: 'c', qty: 2, name: 'Battery' }]
  const pieceLines = kitPieces.flatMap(p => Array.from({ length: Math.min(p.qty, 3) }, (_, u) => ({ key: `${p.itemId}|${u}`, name: p.name ?? 'Piece', unit: u + 1, of: p.qty }))).slice(0, 5)
  const pcs = kitPieces.reduce((n, p) => n + p.qty, 0)

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
  const [builds, setBuilds] = useState<{ description: string; qty: number }[]>([])
  const [buildDesc, setBuildDesc] = useState(''), [buildQty, setBuildQty] = useState(1), [showBuild, setShowBuild] = useState(false)
  const [idea, setIdea] = useState(''), [asked, setAsked] = useState(''), [timeAsk, setTimeAsk] = useState('')
  // The AI's answer: groups of {prop id, why} + things to make or find (null = not asked yet).
  const [aiResult, setAiResult] = useState<{ reply: string; groups: { title: string; picks: { id: string; why: string }[] }[]; missing: { name: string; why: string }[] } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiTicks, setAiTicks] = useState<string[]>([]), [aiBooked, setAiBooked] = useState(false), [aiAdded, setAiAdded] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({}), [editing, setEditing] = useState(false), [newBuild, setNewBuild] = useState('')
  const [over, setOver] = useState(false), [mess, setMess] = useState(false), [reportNote, setReportNote] = useState('')
  const [wrapText, setWrapText] = useState(''), [retNote, setRetNote] = useState('')

  // ── Chapter 9 is real: turn on notifications on this phone ──
  const [push, setPush] = useState<PushState>(() => { try { return pushState() } catch { return 'unsupported' } })
  const [pushBusy, setPushBusy] = useState(false), [pushMsg, setPushMsg] = useState('')
  const turnOn = () => { setPushBusy(true); setPushMsg(''); turnOnPush().then(setPush).catch(e => setPushMsg((e as Error).message || "That didn't work. Try again.")).finally(() => setPushBusy(false)) }

  const C = 'Continue'
  const intro = (n: number, scene: Scene, title: string, body: ReactNode): Step => ({ id: `part${n}`, scene, part: n, next: C, title,
    body: Array.isArray(body) ? <ul className="mt-1 space-y-1.5">{(body as string[]).map(x => <li key={x} className="flex gap-2"><span className="text-pt-accent">•</span><span>{x}</span></li>)}</ul> : body })
  const STEPS: Step[] = [
    { id: 'welcome', scene: 'welcome', title: '' },
    // 1 · Find your way around
    intro(1, 'home', 'Find your way around', ['Everything is under four tabs at the bottom', 'The ✦ AI helper is at the top of every screen', "Let's take a quick look"]),
    { id: 'tabs', scene: 'home', part: 1, target: 'tabbar', look: true, next: C, title: 'Four tabs take you everywhere',
      body: <ul className="space-y-1"><li><b className="text-pt-text">Home</b>: your next shoot and what it still needs</li><li><b className="text-pt-text">Book</b>: the schedule, to book a time</li><li><b className="text-pt-text">Browse</b>: every prop, costume and gear kit</li><li><b className="text-pt-text">Me</b>: your requests, profile and help</li></ul> },
    { id: 'aibtn', scene: 'home', part: 1, target: 'ai', look: true, next: C, title: '✦ AI is at the top of every screen', body: "It helps with prop ideas for a video and with finding a free time. You'll try it in chapter 5." },
    // 2 · Book your first shoot
    intro(2, 'home', 'Book your first shoot', 'Everything starts with a time. A shoot is a 2-hour slot at Cliff 1 or Cliff 2, on your own or back to back with friends. Props and gear get added to it after.'),
    { id: 'book', scene: 'home', part: 2, target: 'book', title: <>Tap <b>Book a shoot</b></>, body: 'You can also start from the Book tab.' },
    { id: 'friend1', scene: 'find', part: 2, target: 'who', next: C, hint: 'Pick + 1 friend or + 2 friends first', title: <>Tap <b>+ 1 friend</b> (or + 2)</>, body: 'For this practice, film with someone. Each of you gets your own 2-hour slot, one after the other.' },
    { id: 'friendname', scene: 'find', part: 2, target: 'friendzone', next: C, hint: friendCount > 1 ? 'Pick both friends first' : 'Pick a friend first', title: friendCount > 1 ? 'Find both friends' : 'Find your friend', body: "Tap the box, type a few letters of their name or channel, then tap them in the list. Nobody is told; it's practice." },
    { id: 'days', scene: 'find', part: 2, target: 'days', next: C, title: 'Pick a day, or keep Soonest', body: 'Soonest shows the next free times first. Tap a day to jump to it (swipe the row for more). A faded day has nothing free for all of you.' },
    { id: 'slot', scene: 'find', part: 2, target: 'slot', title: <>Tap a <b>house</b> to take that time</>, body: <>This time is free for everyone: you first, then {friendFirst}. Cliff 1 and Cliff 2 work the same.</> },
    { id: 'bookit', scene: 'bookit', part: 2, target: 'bookit', title: <>Tap <b>Book + invite</b></>, body: <>Your slot is booked now. {friendFirst} {friends.length > 1 ? 'each get' : 'gets'} a notification and {HOLD} minutes to confirm theirs.</> },
    { id: 'booked', scene: 'booked', part: 2, target: 'myslots', look: true, next: C, title: "You're booked", body: <>Here it is on the schedule, with {friendFirst}'s {friends.length > 1 ? 'slots' : 'slot'} held right after. Next, let's find your shoot again from Home.</> },
    { id: 'gohome', scene: 'booked', part: 2, target: 'nav-home', title: <>Tap <b>Home</b></>, body: 'Bottom left.' },
    { id: 'opencard', scene: 'home2', part: 2, target: 'shootcard', title: 'Tap your shoot', body: 'Your next shoot is always the big card on Home.' },
    { id: 'shootinfo', scene: 'shoot', part: 2, target: 'shootsheet', look: true, top: true, next: C, title: "This is your shoot's page",
      body: "When and where, then Booked → Checked in → Filmed. Under For this shoot: plan it with AI, and add props and gear. You'll check in here on the day too." },
    // 3 · Add props and gear
    intro(3, 'shoot', 'Add props and gear', "Now let's get what you need for it. You can add straight from your shoot's page: the closet opens with this shoot already picked."),
    { id: 'addprops', scene: 'shoot', part: 3, target: 'addprops', title: <>Tap <b>+ Add</b> next to Props &amp; costumes</> },
    { id: 'addingbar', scene: 'browse', part: 3, target: 'adding', look: true, next: C, title: 'This bar shows which shoot you\'re adding to', body: '"Free" on a photo means it\'s free that day. Tap Change to add to a different shoot.' },
    { id: 'search', scene: 'browse', part: 3, target: 'browsezone', next: C, hint: 'Add a prop first', title: 'Search, then tap + on a prop', body: <>Tap the search box, try <b>mask</b>, <b>hat</b> or <b>phone</b>, tap + on a prop you like, then Continue.</> },
    { id: 'geartab', scene: 'browse', part: 3, target: 'geartab', title: <>Tap <b>Gear</b></>, body: 'Cameras, lights and sound live on the Gear tab.' },
    { id: 'addgear', scene: 'gear', part: 3, target: 'gear-add', title: <>Tap <b>+</b> on the kit</>, body: "Gear comes as kits (one case, every piece), booked whole for your shoot's hours." },
    { id: 'reviewbar', scene: 'gear', part: 3, target: 'reviewbar', title: <>Tap <b>Review</b></>, body: 'You check everything before it goes to the teams.' },
    { id: 'name', scene: 'review', part: 3, target: 'name', next: C, hint: 'Type a name first', title: 'Name your video', body: "Tap the first box and type a name, so the teams know what it's for." },
    { id: 'make', scene: 'review', part: 3, target: 'make', title: <>Tap <b>+ Request something we don't have</b></>, body: <>For anything that isn't in the closet. The arts team makes or finds it; for this shoot they need to know by {formatDay(cut.builds)}.</> },
    { id: 'makeform', scene: 'review', part: 3, target: 'make', title: <>Describe it, then tap <b>Add request</b></>, body: 'e.g. "a fake birthday cake". Use − and + for how many.' },
    { id: 'send', scene: 'review', part: 3, target: 'send', title: <>Tap <b>Book props + gear</b></>, body: 'Props go to the arts team, gear to the equipment team. (Practice: nothing is sent.)' },
    // 4 · Check on your request
    intro(4, 'sent', 'Check on your request', ["It's with the arts team now", "Here's how to find it again any time", "You can change it until they start picking"]),
    { id: 'sent', scene: 'sent', part: 4, target: 'journey', next: C, title: 'This line shows where your props are', body: 'Requested → Being prepared → Ready → Collected → Returned → Checked in.' },
    { id: 'back', scene: 'sent', part: 4, target: 'back', title: <>Tap <b>‹ Back</b></>, body: "Let's find this again the way you would tomorrow." },
    { id: 'navme', scene: 'home2', part: 4, target: 'nav-me', title: <>Tap <b>Me</b></>, body: 'Your shoot on Home now has ✓ Time, Props and Gear. Everything you asked for lives on Me.' },
    { id: 'myreq', scene: 'me', part: 4, target: 'myrequests', title: <>Tap <b>My requests</b></> },
    { id: 'card', scene: 'requests', part: 4, target: 'card', look: true, next: C, title: 'One card per shoot', body: 'Its props and its gear, each with a bar showing where it is.' },
    { id: 'openreq', scene: 'requests', part: 4, target: 'propsrow', title: 'Tap your props request', body: 'To see it in full, or to change it.' },
    { id: 'change', scene: 'request', part: 4, target: 'changebtn', title: <>Tap <b>Change</b></>, body: 'You can change a request until the arts team starts picking it.' },
    { id: 'changeit', scene: 'request', part: 4, target: 'changebox', title: <>Change something, then <b>Save changes</b></>, body: 'Use − and + for amounts, × to take something out, or type something to make or find.' },
    { id: 'saved', scene: 'request', part: 4, target: 'addmore', look: true, next: C, title: 'Saved', body: 'Once the team starts picking, Change goes away. Then use + Add more to add to the same shoot.' },
    { id: 'packed', scene: 'request', part: 4, target: 'journey', next: C, notif: `Your props for ${title} are packed and ready ✓`, title: 'Your props are ready', body: 'You get a notification (top), and the line moves to Ready.' },
    // 5 · Try the AI
    intro(5, 'request', 'Try the AI', "Using AI you can get help planning a shoot, finding props that might suit your idea, or even finding a time to film when the schedule seems jam-packed. Let's use it to start a brand-new shoot."),
    { id: 'reqback', scene: 'request', part: 5, target: 'back', title: <>Tap <b>‹ Back</b></>, body: 'First, back to Me.' },
    { id: 'tome', scene: 'requests', part: 5, target: 'tome', title: <>Tap <b>‹ Me</b></> },
    { id: 'openai', scene: 'me', part: 5, target: 'ai', title: <>Tap <b>✦ AI</b></>, body: "It's at the top of every screen." },
    { id: 'aiask', scene: 'chat', part: 5, target: 'composer', title: 'Describe a video idea', body: <>It can be a complete thought, or just some inspiration (e.g. "something spooky in the woods"). Tap the box, type it, then tap <b>↑</b>.</> },
    { id: 'aipicks', scene: 'chat', part: 5, target: 'answer', top: true, next: C, hint: 'Tick at least one first', title: 'Tick the ones you like', body: 'Real props from our closet, grouped by scene, each with why it fits. Tap + on any you want.' },
    { id: 'aitime', scene: 'chat', part: 5, target: 'composer', title: 'Now ask for a time for them', body: <>Type when you'd like to film, e.g. "Friday evening, 2 hours", and tap <b>↑</b>. (Already booked a shoot? "Add to a shoot" puts them in it instead.)</> },
    { id: 'aioptions', scene: 'chat', part: 5, target: 'optbook', title: <>Tap <b>Book</b> on a time</>, body: 'It only offers times that are really free. (Practice: nothing is booked.)' },
    { id: 'aiadd', scene: 'chat', part: 5, target: 'aiaddbooked', title: <>Tap <b>Add the {aiTicks.length} ticked to this shoot</b></>, body: 'Your picks go into the new shoot.' },
    { id: 'aidone', scene: 'chat', part: 5, target: 'aiaddedmsg', look: true, next: C, title: 'A second shoot, with its props', body: "You'd review and send it, just like before. Ideas first and a time second, or the other way round: both work." },
    { id: 'aiback', scene: 'chat', part: 5, target: 'aiback', title: <>Tap <b>‹ Back</b></>, body: 'Back to Me.' },
    // 6 · When a friend invites you
    intro(6, 'me', 'When a friend invites you', [`A friend can save you the slot right after theirs`, `It's held for you for ${HOLD} minutes`, 'Confirm it, or it opens to everyone']),
    { id: 'invited', scene: 'me', part: 6, target: 'notif', notif: `${inviterFirst} invited you to film right after them, ${formatDay(inviteDay)}. Held for you for ${HOLD} minutes.`, title: 'Tap the notification', body: 'Pretend a friend just booked and invited you. Tapping it takes you straight to the schedule.' },
    { id: 'confirm', scene: 'invite', part: 6, target: 'invitebox', title: <>Tap <b>Confirm my slot</b></>, body: <>The slot after theirs is saved for you for {HOLD} minutes. Can't make it? You'd tap that instead, and it opens to everyone.</> },
    { id: 'confirmed', scene: 'invite', part: 6, target: 'myrow', look: true, next: C, title: "It's yours now", body: 'It shows as Yours on the schedule. That was a separate shoot; back to the one you booked first.' },
    // 7 · Shoot day
    intro(7, 'home2', 'Shoot day', ['Pick up your props at the prop room', 'Pick up your gear and tick every piece', 'Check in at the house, film, then wrap']),
    { id: 'pickupnotif', scene: 'home2', part: 7, target: 'notif', notif: `Shoot day! Your props for ${title} are ready to pick up.`, title: 'Tap the notification', body: 'Notifications take you straight to the right page.' },
    { id: 'sign', scene: 'pickup', part: 7, target: 'sign', title: <>Tap <b>I've got everything</b></>, body: 'At the prop room, check everything on the list is there. Only you can sign for your props.' },
    { id: 'pickback', scene: 'pickup', part: 7, target: 'back', title: <>Tap <b>‹ Back</b></>, body: 'Now the gear. It\'s on the same card in My requests.' },
    { id: 'opengear', scene: 'requests', part: 7, target: 'gearrow', title: 'Tap your gear', body: 'Gear is picked up from the equipment cage, from 30 minutes before your time.' },
    { id: 'pieces', scene: 'gearpickup', part: 7, target: 'pieces', next: C, hint: 'Tick (or mark missing) every piece first', title: 'Tick every piece in the case', body: "Something not there? Tap Missing? next to it, so it isn't blamed on you." },
    { id: 'gearsign', scene: 'gearpickup', part: 7, target: 'gearsign', title: <>Tap <b>Sign: I've got it</b></>, body: "From now until it's back, the kit is your responsibility." },
    { id: 'checkinnotif', scene: 'gearpickup', part: 7, target: 'notif', notif: `Check-in is open for your ${fmtTime(START)} shoot at ${house.name}.`, title: 'At the house: tap the notification', body: `Check-in opens ${s.checkinBefore} minutes before your time. (Your shoot card on Home has a Check in button too.)` },
    { id: 'setphoto', scene: 'checkin', part: 7, target: 'camera', next: C, skip: true, hint: 'Take a photo first (or skip)', title: 'Take a photo of the set', body: 'Tap Take photo. It opens your camera; tap the photo to retake it. (Practice: it stays on your phone.)' },
    { id: 'report', scene: 'checkin', part: 7, target: 'report', next: C, hint: 'Write what happened first', title: 'Any problem with the slot before you?', body: 'If they ran over or left a mess, tap it and write what happened. If not, just Continue.' },
    { id: 'checkin', scene: 'checkin', part: 7, target: 'checkin', title: <>Tap <b>Check in</b></>, body: "That's how the team knows you filmed." },
    { id: 'wrap', scene: 'wrap', part: 7, target: 'wrap', title: <>Type what you filmed, then tap <b>Wrap</b></>, body: "Do this when you're done shooting." },
    // 8 · Bring it all back
    intro(8, 'wrap', 'Bring it all back', ['Props go back the night of the shoot', 'Gear goes back in its case, batteries charging', 'One photo each, then the teams check it all in']),
    { id: 'gotome', scene: 'booked', part: 8, target: 'nav-me', title: <>Tap <b>Me</b></>, body: "That's a wrap: your slot shows Filmed. Returns start from your request on Me." },
    { id: 'myreq2', scene: 'me', part: 8, target: 'myrequests', title: <>Tap <b>My requests</b></> },
    { id: 'openret', scene: 'requests', part: 8, target: 'propsrow', title: 'Tap your props', body: 'It says Collected while they\'re with you.' },
    { id: 'retphoto', scene: 'return', part: 8, target: 'camera', next: C, skip: true, hint: 'Take a photo first (or skip)', title: "Photo of everything you're returning", body: 'All the props together, where you leave them. It protects you if anything is questioned later.' },
    { id: 'returned', scene: 'return', part: 8, target: 'returned', title: <>Tap <b>Confirm return</b></>, body: 'You can add a note first (where you left them).' },
    { id: 'retback', scene: 'return', part: 8, target: 'back', title: <>Tap <b>‹ Back</b></>, body: 'Now the gear.' },
    { id: 'opengearret', scene: 'requests', part: 8, target: 'gearrow', title: 'Tap your gear' },
    { id: 'gearphoto', scene: 'gearreturn', part: 8, target: 'camera', next: C, skip: true, hint: 'Take a photo first (or skip)', title: 'Photo of the gear case', body: 'Every piece back in its case and the batteries plugged in to charge, in one photo.' },
    { id: 'gearsend', scene: 'gearreturn', part: 8, target: 'gearsend', title: <>Tap <b>Send return</b></> },
    { id: 'gearback', scene: 'gearreturn', part: 8, target: 'back', title: <>Tap <b>‹ Back</b></> },
    { id: 'final', scene: 'requests', part: 8, target: 'card', look: true, next: C, title: 'Both returned', body: "Each team checks its part in; when both bars are full, you're done. Late returns pause new props and gear, so bring things back on time." },
    // 9 · Turn on notifications (real)
    intro(9, 'notify', 'Turn on notifications', ['This last step is real, not practice', `Friends' invites only wait ${HOLD} minutes`, "You'll hear when props are ready, and before your shoot"]),
    { id: 'notify', scene: 'notify', part: 9, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications', body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card). We\'ll remind you on Home.' : 'Tap the gold button, then Allow when your phone asks.' },
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
  const gearStatus = at('final') ? 'checked_in' : past('gearsend') ? 'returned' : past('gearsign') ? 'out' : 'held'
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
  const nGear = past('addgear') ? 1 : 0
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
        <RequestRow className="bg-pt-bg" label={`Gear · ${fmtSlot(START, SLOT)}`} onOpen={tap('gearrow')} l={{ id: 'g', kind: 'gear', title, status: gearStatus, count: 1 }} />
      </div>
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
    welcome: () => (
      <div className="min-h-full grid place-items-center text-center px-6 pt-safe">
        <div className="space-y-5 py-6">
          <BrandMark className="w-20 mx-auto text-white" title="" />
          <h1 className="font-display text-[28px] font-extrabold leading-tight">Welcome to Prime Capitol{first ? `, ${first}` : ''}!</h1>
          <p className="text-pt-muted text-[15px]">Let's walk through one shoot from start to finish: book it, get props and gear, film, and bring it all back. About 8 minutes, in 9 short chapters.</p>
          <div className="rounded-2xl bg-pt-surface shadow-hairline px-4 py-3 text-left space-y-2 text-[14px] text-pt-text">
            <p className="font-semibold">How it works</p>
            {[['search', 'The part you use next is outlined in gold.'], ['chat', 'A tip at the top or bottom says what to do, and why.'], ['hand', 'You do it yourself, with the real buttons and tabs. ‹ Back goes back a step.'], ['flask', "It's all practice: nothing is booked, sent or uploaded."], ['pause', "Close the app any time; you'll pick up where you left off."]].map(([i, t]) => (
              <p key={t} className="flex gap-2.5"><Icon name={i as IconName} className="w-5 h-5 text-pt-accent mt-px" /><span>{t}</span></p>
            ))}
          </div>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          {!required && <button onClick={onFinish} className="tap text-pt-muted text-sm">Not now</button>}
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
          <div className="grid grid-cols-2 gap-3">
            <div className="relative w-full h-full">
              <div className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
                <div className="relative aspect-square">
                  <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-full h-full" />
                  <span className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${FREE}`}>Free</span>
                  <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">{pcs} pcs</span>
                </div>
                <div className="px-3 pt-2 pb-3">
                  <p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{kitName}</p>
                  <p className="text-pt-muted text-xs truncate mt-0.5">{kit?.category ?? 'Camera'} · free {fmtHours(START, START + SLOT)}</p>
                </div>
              </div>
              <button {...T('gear-add')} onClick={tap('gear-add')} aria-label={`${nGear ? 'Remove' : 'Add'} ${kitName}`}
                className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${nGear ? 'bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{nGear ? '✓' : '+'}</button>
            </div>
          </div>
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
            <div className="flex items-baseline justify-between"><p className="text-pt-muted text-xs">Gear (1) · equipment team</p><span className="text-pt-accent text-sm">+ Add gear</span></div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              <div className="flex items-center gap-3 px-3 py-3">
                <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-12 h-12 rounded-xl shrink-0" />
                <div className="min-w-0 flex-1"><p className="text-pt-text text-sm font-medium truncate">{kitName}</p><p className="text-pt-muted text-xs">Bundle · {fmtHours(START, START + SLOT)}</p></div>
                <span className="text-pt-muted text-2xl px-2">×</span>
              </div>
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
            {st === 'requested' && (editing || step.id === 'changeit' ? (
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
            <div {...T('composer')} className="flex items-center gap-2 pb-2">
              <input value={idea} onChange={e => setIdea(e.target.value.slice(0, 200))} onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder="Your video idea, or when to film…"
                className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
              <button onClick={send} disabled={idea.trim().length < 3} aria-label="Send" className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-xl font-bold disabled:opacity-40">↑</button>
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
    return: () => (
      <div className="pb-12">
        {backBar(statusPill(past('returned') ? 'return_pending' : 'collected'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {titleBlock}{journey(past('returned') ? 'return_pending' : 'collected')}
          {past('returned') ? banner('green', 'Returned ✓', 'The arts team checks each prop in.') : (
            <>
              {banner('amber', 'Bring these back the night of the shoot', 'They count as late after 10 AM the next open day.')}
              <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
                <p className="text-pt-text font-semibold">Returning</p>
                {camTile('retphoto', "Photo of everything you're returning (required)", "Show all the props together where you're leaving them. This protects you if anything is questioned later.")}
                <textarea value={retNote} onChange={e => setRetNote(e.target.value.slice(0, 300))} rows={2} placeholder="Where did you leave them? Anything to flag? (optional)"
                  className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
                <div {...T('returned')} className="flex gap-2">
                  <span className="flex-1 grid place-items-center py-3 rounded-xl shadow-hairline text-pt-muted text-sm">Back</span>
                  <button onClick={tap('returned')} className="flex-[2] py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Confirm return</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    ),
    gearreturn: () => gearPage(past('gearsend') ? 'returned' : 'out', past('gearsend') ? banner('green', 'Returned ✓', 'The equipment team checks each piece in.') : (
      <section className="space-y-3">
        <div><h2 className="text-pt-text text-xl font-semibold tracking-tight">Return gear</h2><p className="text-pt-muted text-sm">Due back by {fmtTime(START + SLOT)} (late from {fmtTime(START + SLOT + 30)}).</p></div>
        <ol className="bg-pt-surface rounded-2xl px-4 py-3 space-y-1 text-[15px] text-pt-text list-decimal list-inside">
          <li>Put every piece back in its case.</li><li>Plug the batteries into the chargers on the shelf.</li><li>Take one photo that shows both.</li>
        </ol>
        {camTile('gearphoto', 'Return photo', 'Required: case packed, batteries charging')}
        <button {...T('gearsend')} onClick={tap('gearsend')} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Send return</button>
      </section>
    )),
    rules: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Good to know</h1>
        {[
          ['calendar', `Props from the closet: book ${settings.leadTimeDays} open days ahead. To make or find: ${settings.buildLeadDays}. Gear: ${GEAR_LEAD_TIME_DAYS}.`],
          ['people', `A friend's invite holds the slot for you for ${HOLD} minutes. Confirm it, or it opens to everyone.`],
          ['swap', `Moving or cancelling is free with ${s.noticeHours} hours' notice. Closer than that, swap with someone instead.`],
          ['camera', `Check in at the house: it opens ${s.checkinBefore} minutes before your time.`],
          ['stop', `No-shows and late cancels give a strike. ${s.strikeCount} in ${s.strikeDays} days pauses props and gear for ${s.pauseDays} days. Late returns block new props and gear.`],
          ['help', 'Forgot something? Me → Help, or Me → App tour to do this again.'],
        ].map(([i, t]) => <div key={t} className="flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4"><Icon name={i as IconName} className="w-6 h-6 text-pt-accent shrink-0" /><p className="text-[15px] text-pt-text">{t}</p></div>)}
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full grid place-items-center text-center px-6">
        <div className="space-y-5">
          <p className="text-7xl">🎉</p>
          <h1 className="font-display text-[28px] font-extrabold">You're ready!</h1>
          <p className="text-pt-muted text-[15px]">Book a time, add props and gear, follow your request, pick up, check in, bring it back. That's the whole thing.</p>
          <button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">{required ? 'Start using the app' : 'Done'}</button>
        </div>
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
  const inPart = STEPS.filter(x => x.part === step.part && !x.id.startsWith('part'))
  const stepInPart = inPart.findIndex(x => x.id === step.id) + 1
  const back = idx > 1 ? () => setIdx(n => { const m = Math.max(1, n - 1); if (required) saveStep(profile.email, m); return m }) : undefined
  const nextDisabled = (step.id === 'name' && video.trim().length < 2) || (step.id === 'report' && (over || mess) && reportNote.trim().length < 3)
    || (step.id === 'friend1' && friendCount === 0) || (step.id === 'friendname' && friends.length < friendCount)
    || (step.id === 'search' && added.length === 0) || (step.id === 'pieces' && !allTicked) || (step.id === 'aipicks' && aiTicks.length === 0)
    || (['setphoto', 'retphoto', 'gearphoto'].includes(step.id) && !photos[step.id]) || (step.id === 'notify' && push === 'off' && !pushMsg)

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
      {step.part && <Spotlight key={step.id} target={step.target} top={step.top} dim={!step.look} title={step.title} body={step.body} part={step.part}
        stepInPart={stepInPart || undefined} stepsInPart={stepInPart ? inPart.length : undefined} next={step.next} onNext={advance}
        nextDisabled={nextDisabled} disabledHint={step.hint} onBack={back} onSkip={step.skip && !photos[step.id] ? advance : undefined} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
