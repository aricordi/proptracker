// Gear team tour (owner, Oct 20: "a tutorial just like this but for the gear department… the story of their
// responsibilities"). Same coach, chapter cards, quizzes and badges as the creator tour (Spotlight + Fun.tsx), with
// GEAR_CHAPTERS:
//   1 Find your way around (5 tabs: Queue / Schedule / Bundles / All gear / Admin, a look at the Admin menu)  2 Stock the shelves (All gear → + Add gear → name, type, serial → Save)
//   3 Build a kit (Bundles → + Bundle → name → pieces → Save; add-on extras) + quiz  4 Run the queue (Today / Out /
//   To check in…, open a booking, decline with a reason)  5 Hand it over (the pickup check: tick every piece, Missing?,
//   sign) + quiz  6 Check it back in (late, To check in, return photo, tick, damage note, Checked in)
//   7 The paper trail (Problems, History, Found it, broken pieces) + quiz  8 Run the schedule (book or block a slot,
//   move/cancel with no strike, Schedule team: check-ins, reports, creators/pauses) + quiz  9 Stay in the loop (REAL).
// Scenes copy the real screens (GearBookingsScreen, GearBookingScreen, GearItemsScreen + ItemSheet, GearBundlesScreen,
// GearBundleEditScreen, ScheduleScreen SlotRow + TeamSlotSheet + ShootSheet, ScheduleTeamScreen, AccountScreen).
// When one of those screens changes a lot, update its scene here too.
// SEALED: practice data only (made-up gear, bookings and people). Nothing is saved, booked or sent, except turning on
// notifications in chapter 9 and marking the tour done. Required once for the equipment team (App.tsx TourGate);
// anyone on the gear side can replay it at /tour/gear.
import { useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useScheduleSettings, fmtSlot } from '../services/schedule'
import { pushState, turnOnPush, isIOS, type PushState } from '../services/push'
import { GearArt, Pill, PieceChecklist } from '../components/GearUi'
import { TAB_ICONS } from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { fmtTime, fmtHours } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { Cap, Confetti, ChapterCard, QuizCard, BadgeWall, type Chapter } from './Fun'
import { markTourDone, savedStep, saveStep } from './tourState'

export const GEAR_CHAPTERS: Chapter[] = [
  { name: 'Find your way around', badge: 'Explorer', icon: 'search' },
  { name: 'Stock the shelves', badge: 'Stocked', icon: 'box' },
  { name: 'Build a kit', badge: 'Kit builder', icon: 'tools' },
  { name: 'Run the queue', badge: 'Queue boss', icon: 'clock' },
  { name: 'Hand it over', badge: 'Handed off', icon: 'handshake' },
  { name: 'Check it back in', badge: 'Checked in', icon: 'check' },
  { name: 'The paper trail', badge: 'Detective', icon: 'eye' },
  { name: 'Run the schedule', badge: 'Scheduler', icon: 'calendar' },
  { name: 'Stay in the loop', badge: 'In the loop', icon: 'bell' },
]

type Scene = 'hello' | 'meet' | 'queue' | 'booking' | 'items' | 'itemsheet' | 'bundles' | 'bundleedit' | 'schedule' | 'slotsheet'
  | 'shootsheet' | 'team' | 'admin' | 'notify' | 'rules' | 'done'
type Tab = 'Queue' | 'Schedule' | 'Bundles' | 'All gear' | 'Admin'
interface Step { id: string; scene: Scene; part?: number; target?: string; title: ReactNode; body?: ReactNode; next?: string; hint?: string; top?: boolean; look?: boolean
  quiz?: { q: ReactNode; options: string[]; correct: number; explain: ReactNode } }

// Practice stock (made up). `inB` = how many are already in other bundles or extras.
interface Piece { id: string; name: string; category: string; have: number; inB: number; serial?: string }
const STOCK: Piece[] = [
  { id: 'a7s', name: 'Sony A7S III body', category: 'Camera', have: 1, inB: 1, serial: 'A7S-0042' },
  { id: 'lens', name: '24-70mm lens', category: 'Lens', have: 3, inB: 1 },
  { id: 'bat', name: 'Camera battery', category: 'Power', have: 10, inB: 3 },
  { id: 'card', name: 'CFexpress card', category: 'Other', have: 4, inB: 0 },
  { id: 'handle', name: 'Top handle', category: 'Grip', have: 2, inB: 0 },
  { id: 'mic', name: 'Wireless mic (DJI Mic)', category: 'Audio', have: 4, inB: 4 },
  { id: 'mini5', name: 'DJI Mini 5 drone', category: 'Drones', have: 1, inB: 1, serial: 'MINI5-118' },
]
const CATS = ['Camera', 'Lens', 'Lighting', 'Audio', 'Drones', 'Power', 'Grip', 'Monitors', 'Other']
const START = 13 * 60, END = 15 * 60
const field = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent'
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'

export default function GearTour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const name = profile.name || user.displayName || profile.email
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const s = useScheduleSettings()
  const today = todayInStudio()
  const tomorrow = addDays(today, 1)

  // ── What you type and pick ──
  const [itemName, setItemName] = useState(''), [itemCat, setItemCat] = useState('Camera'), [serial, setSerial] = useState('')
  const newPiece: Piece = { id: 'new', name: itemName.trim() || 'Sony FX3 body', category: itemCat, have: 1, inB: 0, serial: serial.trim() || undefined }
  const [bundleName, setBundleName] = useState('')
  const kitName = bundleName.trim() || 'Sony FX3 kit'
  const [pick, setPick] = useState<Record<string, number>>({})
  const stock = [newPiece, ...STOCK]
  const kitPieces = stock.filter(p => (pick[p.id] ?? 0) > 0).map(p => ({ ...p, qty: pick[p.id] }))
  const pieceCount = kitPieces.reduce((n, p) => n + p.qty, 0)
  const [declineWhy, setDeclineWhy] = useState('')
  const [checkNote, setCheckNote] = useState('')
  const [blockType, setBlockType] = useState('cleaners'), [blockNote, setBlockNote] = useState('')
  const [decided, setDecided] = useState(false), [found, setFound] = useState(false)
  // The kit going out in the story: the one you built (every piece once, so the checklist stays short).
  const lines = (kitPieces.length ? kitPieces : [{ ...newPiece, qty: 1 }, { ...STOCK[1], qty: 1 }, { ...STOCK[2], qty: 2 }])
    .map(p => ({ key: p.id, name: p.qty > 1 ? `${p.name} ×${p.qty}` : p.name, unit: 1, of: 1 }))
  const [ticked, setTicked] = useState<Set<string>>(new Set()), [missing, setMissing] = useState<Set<string>>(new Set())
  const [inTicked, setInTicked] = useState<Set<string>>(new Set()), [inMissing, setInMissing] = useState<Set<string>>(new Set())
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }
  const allOut = lines.every(l => ticked.has(l.key) || missing.has(l.key))
  const allIn = lines.every(l => inTicked.has(l.key) || inMissing.has(l.key))
  const missingName = lines.find(l => missing.has(l.key))?.name

  // ── Chapter 9 is real: notifications on this phone ──
  const [push, setPush] = useState<PushState>(() => { try { return pushState() } catch { return 'unsupported' } })
  const [pushBusy, setPushBusy] = useState(false), [pushMsg, setPushMsg] = useState('')
  const turnOn = () => { setPushBusy(true); setPushMsg(''); turnOnPush().then(setPush).catch(e => setPushMsg((e as Error).message || "That didn't work. Try again.")).finally(() => setPushBusy(false)) }

  const C = 'Continue'
  const intro = (n: number, scene: Scene, body: ReactNode): Step => ({ id: `part${n}`, scene, part: n, title: GEAR_CHAPTERS[n - 1].name, body })
  const ul = (rows: [string, string][]) => <ul className="mt-1 space-y-1">{rows.map(([b, t]) => <li key={b}><b className="text-stone-900">{b}</b>: {t}</li>)}</ul>
  const STEPS: Step[] = [
    { id: 'hello', scene: 'hello', title: '' },
    { id: 'meet', scene: 'meet', title: '' },
    // 1 · Find your way around
    intro(1, 'queue', "This is your corner of Prime Capitol. Five tabs, one job: the right gear, in the right hands, back in one piece."),
    { id: 'tabs', scene: 'queue', part: 1, target: 'tabbar', look: true, next: C, title: 'Your five tabs',
      body: ul([['Queue', 'who picks up what, and what is due back'], ['Schedule', 'the house calendar'], ['Bundles', 'the kits creators can book'], ['All gear', 'every piece you own'], ['Admin', 'everything else, like the arts department has']]) },
    { id: 'toadmin', scene: 'queue', part: 1, target: 'nav-admin', title: <>Peek at <b>Admin</b></> },
    { id: 'adminlook', scene: 'admin', part: 1, target: 'adminlist', look: true, next: C, title: 'Your Admin menu',
      body: 'Schedule team, schedule settings, the Google Calendar import, help, this tour again, and your account. Same idea as the arts department.' },
    { id: 'toitems', scene: 'admin', part: 1, target: 'nav-allgear', title: <>Start with the shelves: tap <b>All gear</b></> },
    // 2 · Stock the shelves
    intro(2, 'items', 'Every lens, battery and drone lives in All gear. If it isn\'t in here, it doesn\'t exist (as far as the app knows).'),
    { id: 'itemslook', scene: 'items', part: 2, target: 'itemlist', look: true, next: C, title: 'Every piece you own, by type',
      body: <>The number on the right is how many you have. <b>Loose</b> means it isn't in a kit yet, so creators can't book it.</> },
    { id: 'additem', scene: 'items', part: 2, target: 'addgear', title: <>Tap <b>+ Add gear</b></>, body: "Let's add a brand new camera." },
    { id: 'itemform', scene: 'itemsheet', part: 2, target: 'itemform', top: true, next: C, hint: 'Type a name first', title: 'Name it and pick its type',
      body: <>Try <b>Sony FX3 body</b>. Cameras and drones get a <b>serial number</b> (then it counts as one). Value is staff only, for when something goes missing.</> },
    { id: 'itemsave', scene: 'itemsheet', part: 2, target: 'itemsave', title: <>Tap <b>Save</b></> },
    { id: 'itemnew', scene: 'items', part: 2, target: 'newitem', next: C, title: "There it is, '1 loose'", body: "It's on the shelf, but creators can't see it yet. Time to put it in a kit." },
    // 3 · Build a kit
    intro(3, 'items', "Creators never book loose pieces. They book kits: one case, every piece inside, booked as a whole."),
    { id: 'tobundles', scene: 'items', part: 3, target: 'nav-bundles', title: <>Tap <b>Bundles</b></> },
    { id: 'bundleslook', scene: 'bundles', part: 3, target: 'bundlelist', look: true, next: C, title: 'What creators can book',
      body: ul([['Bundles', 'a case booked whole, never split'], ['Add-on extras', 'one kind of piece (spare batteries, mics), creators pick how many']]) },
    { id: 'newbundle', scene: 'bundles', part: 3, target: 'newbundle', title: <>Tap <b>+ Bundle</b></> },
    { id: 'bundlename', scene: 'bundleedit', part: 3, target: 'bundlename', next: C, hint: 'Type a name first', title: 'Name the kit', body: <>Something creators recognise, like <b>Sony FX3 kit</b>. Add a photo of the case in real life.</> },
    { id: 'bundlepieces', scene: 'bundleedit', part: 3, target: 'pieces', top: true, next: C, hint: 'Add at least 2 pieces', title: <>Fill the case with <b>+</b></>,
      body: <>Add your new camera, a lens, a few batteries. "Still free" shows what isn't in another kit.</> },
    { id: 'bundlesave', scene: 'bundleedit', part: 3, target: 'bundlesave', title: <>Tap <b>Save bundle</b></> },
    { id: 'bundlenew', scene: 'bundles', part: 3, target: 'newkit', next: C, title: 'Your kit is live', body: <>Creators can book <b>{kitName}</b> right away. Need to change it later? Tap it. Its pieces are locked while it's booked or out.</> },
    { id: 'quiz3', scene: 'bundles', part: 3, title: '', quiz: {
      q: 'Can one camera battery sit in two bundles at once?', options: ['Yes, they share it', 'No, one bundle or extra at a time', 'Only on weekends'], correct: 1,
      explain: 'A piece lives in one place at a time, so a kit can never be promised twice. Archiving a bundle frees its pieces again.' } },
    // 4 · Run the queue
    intro(4, 'bundles', "Creators book gear themselves, instantly. Your queue is where you see it all coming and going."),
    { id: 'tobookings', scene: 'bundles', part: 4, target: 'nav-queue', title: <>Tap <b>Queue</b></> },
    { id: 'queuetabs', scene: 'queue', part: 4, target: 'queuetabs', look: true, next: C, title: 'Your queue, in five piles',
      body: ul([['Today', 'pickups today and gear due back'], ['Out', 'with a creator (late first)'], ['To check in', 'returned, waiting for you'], ['Upcoming', 'held for later'], ['Past', 'done']]) },
    { id: 'openheld', scene: 'queue', part: 4, target: 'heldcard', title: "Tap Riley's booking", body: 'Picking up today at 1 PM.' },
    { id: 'heldlook', scene: 'booking', part: 4, target: 'bookinghead', look: true, next: C, title: 'Booked, held, no approval needed',
      body: "Creators get an instant hold within the rules (2 open days' notice, nothing double-booked). You only step in when something's wrong." },
    { id: 'declineopen', scene: 'booking', part: 4, target: 'decline', title: <>Can't do it? Tap <b>Decline</b></>, body: 'Say the drone is in for repair.' },
    { id: 'declinewhy', scene: 'booking', part: 4, target: 'decline', top: true, next: C, hint: 'Write a reason first', title: 'Always say why, and offer another option',
      body: <>e.g. <b>"The FX3 is in for repair, try the A7S kit."</b> They get a ping with your words. (Practice: we'll keep this booking.)</> },
    // 5 · Hand it over
    intro(5, 'booking', "1 PM. Riley's at the cage. Here's how a kit leaves the room without anyone getting blamed for something they didn't do."),
    { id: 'pickuplook', scene: 'booking', part: 5, target: 'pickupinfo', look: true, next: C, title: 'Pickup opens 30 minutes before',
      body: "The creator opens the case and ticks every piece on their own phone, then signs. You can do it with them, on yours. Shared gear (friends filming back to back) is one booking: any of them can pick it up and return it, and at the return they tick who used it. Only those people are responsible." },
    { id: 'pieces', scene: 'booking', part: 5, target: 'pieces', top: true, next: C, hint: 'Mark one piece Missing?, then tick the rest', title: 'Tick every piece. Mark one Missing?',
      body: "Pretend one piece isn't in the case: tap Missing? next to it. Then tick the rest." },
    { id: 'gearsign', scene: 'booking', part: 5, target: 'gearsign', title: <>Tap <b>Sign: I've got it</b></>, body: 'From here until it comes back, the kit is theirs.' },
    { id: 'outlook', scene: 'booking', part: 5, target: 'problems', look: true, next: C, title: 'Missing at pickup is flagged right away',
      body: "You get a ping, the kit shows a warning, and it goes on the record of whoever had it last. Not on Riley." },
    { id: 'quiz5', scene: 'booking', part: 5, title: '', quiz: {
      q: "Riley opens the case and the top handle isn't there. What should happen?", options: ['Sign anyway and mention it later', 'Tap Missing? before signing', 'Cancel the shoot'], correct: 1,
      explain: "Missing before signing is on the last person who had it. After signing, it's on the one who signed." } },
    // 6 · Check it back in
    intro(6, 'queue', "3 PM. Riley's done filming. Gear comes back, and you make sure it's all there before the next person needs it."),
    { id: 'outtab', scene: 'queue', part: 6, target: 'latecard', look: true, next: C, title: 'Late = 30 minutes after the booked end',
      body: "A red ring and a Late pill. Late creators can't book more gear until it's back, and they get a reminder. Gear can also be handed straight to another creator: that booking ends and theirs starts, and they tick every piece at their pickup." },
    { id: 'tocheckin', scene: 'queue', part: 6, target: 'tab-checkin', title: <>Tap <b>To check in</b></> },
    { id: 'opencheckin', scene: 'queue', part: 6, target: 'retcard', title: "Tap Riley's return" },
    { id: 'retphoto', scene: 'booking', part: 6, target: 'retphoto', look: true, next: C, title: 'Their return photo',
      body: "Everything in the case, batteries plugged in to charge. The stamp shows when it was really taken, so old photos can't be reused." },
    { id: 'checkpieces', scene: 'booking', part: 6, target: 'pieces', top: true, next: C, hint: 'Tick (or mark missing) every piece first', title: 'Tick every piece back in', body: 'Same as pickup. No time before the next pickup? The next creator\'s pickup check covers it.' },
    { id: 'checknote', scene: 'booking', part: 6, target: 'checknote', next: C, title: 'Anything damaged? Write it down',
      body: <>e.g. <b>"lens cap scratched"</b>. The note stays on this booking, with who had it. Nothing to report? Just Continue.</> },
    { id: 'checkedin', scene: 'booking', part: 6, target: 'checkedin', title: <>Tap <b>Checked in</b></> },
    // 7 · The paper trail
    intro(7, 'booking', "Something went missing? Scratched lens? The app remembers who had what, and when. Here's where to look."),
    { id: 'problems', scene: 'booking', part: 7, target: 'problems', look: true, next: C, title: 'Problems: what went wrong',
      body: "Missing at pickup, missing at check-in, and \"reported missing by the next person who picked it up\" on the previous holder's booking." },
    { id: 'history', scene: 'booking', part: 7, target: 'history', look: true, next: C, title: 'History: every step, with a time',
      body: 'Held, picked up (signed), returned (on time or late), checked in, and your note. That is your audit trail for this kit.' },
    { id: 'back7', scene: 'booking', part: 7, target: 'back', title: <>Tap <b>‹ Back</b></> },
    { id: 'tobundles7', scene: 'queue', part: 7, target: 'nav-bundles', title: <>Now tap <b>Bundles</b></>, body: 'That missing piece shows up there too.' },
    { id: 'foundit', scene: 'bundles', part: 7, target: 'missingbox', title: <>It turned up? Tap <b>Found it</b></>, body: "Until then the kit stays bookable, with a warning so creators know." },
    { id: 'broken', scene: 'bundles', part: 7, target: 'newkit', look: true, next: C, title: 'Broken for good?',
      body: <>Tap the kit and take the piece out, then archive the piece in <b>All gear</b> ("we no longer have it"). The record of who had it stays.</> },
    { id: 'quiz7', scene: 'bundles', part: 7, title: '', quiz: {
      q: 'Where do you check who had a kit, and when?', options: ["The booking's History", 'Ask around the studio', "You can't"], correct: 0,
      explain: 'Every gear booking keeps its History and Problems, so you can always trace a piece back to who had it.' } },
    // 8 · Run the schedule
    intro(8, 'bundles', "You also keep the house calendar running: cleaners, events, last-minute changes, and making sure people actually showed up."),
    { id: 'toschedule', scene: 'bundles', part: 8, target: 'nav-schedule', title: <>Tap <b>Schedule</b></> },
    { id: 'schedlook', scene: 'schedule', part: 8, target: 'slots', look: true, next: C, title: 'The house, slot by slot',
      body: 'Creators book themselves, instantly. You see everyone, and you can book or block any free slot.' },
    { id: 'freeslot', scene: 'schedule', part: 8, target: 'freeslot', title: <>Tap the slot that says <b>Free · book or block</b></> },
    { id: 'slotlook', scene: 'slotsheet', part: 8, target: 'bookfor', look: true, next: C, title: '"Book this slot…" = for a creator',
      body: "Someone asked you to book them? Do it here. Priority days and the one-slot-a-day limit don't stop you." },
    { id: 'blockit', scene: 'slotsheet', part: 8, target: 'blockform', top: true, next: C, title: 'Or block it',
      body: 'Pick why (cleaners, maintenance, event, external rental) and add a note. Nobody can book blocked time.' },
    { id: 'blockbtn', scene: 'slotsheet', part: 8, target: 'blockbtn', title: <>Tap <b>Block this slot</b></> },
    { id: 'openshoot', scene: 'schedule', part: 8, target: 'bookedslot', title: "Now tap Riley's shoot", body: 'Plans change. Here\'s how you move one.' },
    { id: 'shootlook', scene: 'shootsheet', part: 8, target: 'teamactions', look: true, next: C, title: 'Move or cancel, no strike',
      body: "When the team moves or cancels a shoot, it never counts against the creator. They get a ping. (Practice: nothing changes.)" },
    { id: 'closeshoot', scene: 'shootsheet', part: 8, target: 'closeshoot', title: <>Tap <b>Done</b></> },
    { id: 'toteam', scene: 'schedule', part: 8, target: 'teamicon', title: 'Tap the team button', body: 'Top right, the two people.' },
    { id: 'checkins', scene: 'team', part: 8, target: 'decide', title: <>No check-in from Jordan. Tap <b>They filmed</b></>,
      body: `No check-in by the end of a slot? They get ${s.explainHours} hours to explain, then you decide: they filmed, or no-show (a strike).` },
    { id: 'toreports', scene: 'team', part: 8, target: 'tab-reports', title: <>Tap <b>Reports</b></> },
    { id: 'reports', scene: 'team', part: 8, target: 'teamlist', look: true, next: C, title: 'Reports from the next creator',
      body: 'Ran over, left a mess. Read it, look at the photos, then Dismiss, or uphold it to give a strike.' },
    { id: 'tocreators', scene: 'team', part: 8, target: 'tab-creators', title: <>Tap <b>Creators</b></> },
    { id: 'creators', scene: 'team', part: 8, target: 'teamlist', look: true, next: C, title: 'Who shows up',
      body: `Filmed vs booked over ${s.strikeDays} days. ${s.strikeCount} strikes pause props and gear for ${s.pauseDays} days. Tap Paused · Lift if it was a mistake.` },
    { id: 'quiz8', scene: 'team', part: 8, title: '', quiz: {
      q: "The house floods and you cancel Riley's shoot. Does Riley get a strike?", options: ['Yes', 'No, team cancels never count', 'Only if it was a Thursday'], correct: 1,
      explain: 'Strikes are only for no-shows, late cancels by the creator, and reports you uphold.' } },
    // 9 · Stay in the loop (real)
    intro(9, 'team', "Last one, and it's real: turn on notifications so you hear about new bookings, returns, missing pieces and reports."),
    { id: 'toadmin9', scene: 'schedule', part: 9, target: 'nav-admin', title: <>Tap <b>Admin</b></> },
    { id: 'toaccount', scene: 'admin', part: 9, target: 'myaccount', title: <>Tap <b>My account</b></> },
    { id: 'notify', scene: 'notify', part: 9, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications',
      body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card).' : 'Tap the gold button, then Allow when your phone asks.' },
    { id: 'rules', scene: 'rules', title: '' },
    { id: 'done', scene: 'done', title: '' },
  ]
  const [idx, setIdx] = useState(() => required ? Math.min(savedStep(profile.email), STEPS.length - 1) : 0)
  const step = STEPS[idx]
  const I = (id: string) => STEPS.findIndex(x => x.id === id)
  const past = (id: string) => idx > I(id)
  const at = (id: string) => idx >= I(id)
  const advance = () => setIdx(n => { const m = Math.min(n + 1, STEPS.length - 1); if (required) saveStep(profile.email, m); return m })
  const back = idx > 0 ? () => setIdx(n => { const m = Math.max(0, n - 1); if (required) saveStep(profile.email, m); return m }) : undefined
  const tap = (t: string) => () => { if (step.target === t) advance() }
  const T = (t: string) => ({ 'data-tour': t })
  const finish = () => { if (required) markTourDone(profile.email); onFinish() }

  // ── Where the story is ──
  const kitStatus = past('checkedin') ? 'checked_in' : at('opencheckin') ? 'returned' : past('gearsign') ? 'out' : 'held'
  const kitLabel = { held: 'Held', out: 'Out', returned: 'Returned', checked_in: 'Checked in' }[kitStatus]
  const kitTone = ({ held: 'info', out: 'warn', returned: 'free', checked_in: 'free' } as const)[kitStatus]
  const missingShown = past('pieces') && missing.size > 0
  const blocked = past('blockbtn')

  const header = (title: string, right?: ReactNode) => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
      <h1 className="font-display text-[34px] text-pt-text flex-1">{title}</h1>{right}
    </div>
  )
  const stepper = (n: number, max: number, on: (d: number) => void, label: string) => (
    <div className="flex items-center shadow-hairline rounded-lg overflow-hidden shrink-0">
      <button onClick={() => on(-1)} disabled={n === 0} aria-label={`One less ${label}`} className="w-11 h-11 bg-pt-surface text-pt-text disabled:opacity-30">−</button>
      <span className="w-8 text-center text-pt-text tabular-nums font-semibold">{n}</span>
      <button onClick={() => on(1)} disabled={n >= max} aria-label={`One more ${label}`} className="w-11 h-11 bg-pt-surface text-pt-text disabled:opacity-30">+</button>
    </div>
  )
  const queueCard = (o: { t: string; who: string; when: string; what: string; pill: ReactNode; late?: boolean; target?: string }) => (
    <button key={o.t + o.who + o.when} {...(o.target ? T(o.target) : {})} onClick={o.target ? tap(o.target) : undefined}
      className={`w-full text-left bg-pt-surface rounded-2xl p-4 space-y-1 ${o.late ? 'ring-1 ring-red-400/60' : ''}`}>
      <div className="flex items-center justify-between gap-2"><p className="text-pt-text font-semibold truncate">{o.t}</p><div className="flex gap-1 shrink-0">{o.pill}</div></div>
      <p className="text-pt-muted text-sm">{o.when} · {o.who}</p>
      <p className="text-pt-muted text-xs truncate">{o.what}</p>
    </button>
  )
  const kitWhat = kitName
  const notifyCard = (
    <div {...T('notifycard')} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent"><Icon name="bell" className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0"><b className="block text-pt-text">Notifications</b><span className="block text-pt-muted text-xs">New gear bookings, returns, missing pieces, reports</span></span>
      </div>
      {push === 'on' ? <p className="text-green-400 font-semibold">✓ Notifications are on</p>
        : push === 'off' ? <button disabled={pushBusy} onClick={turnOn} className={btnGold}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
        : push === 'needs-install' ? (
          <ol className="space-y-2 text-[14px] text-pt-text list-decimal list-inside">
            <li>Tap <b>Share</b> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b>, then Add</li>
            <li>Open <b>Prime Capitol</b> from your Home Screen</li><li>Admin → My account → <b>Turn on</b></li>
          </ol>
        ) : push === 'blocked' ? <p className="text-pt-muted text-sm">Notifications are blocked for this app. {isIOS() ? 'iPhone Settings → Notifications → Prime Capitol → Allow Notifications.' : 'Tap the lock or ⓘ next to the web address → Notifications → Allow.'}</p>
        : <p className="text-pt-muted text-sm">This browser can't show notifications. Open the app on your phone to turn them on.</p>}
      {pushMsg && <p className="text-amber-300 text-xs">Couldn't turn them on: {pushMsg} You can try again later from Admin → My account.</p>}
    </div>
  )
  const slotRow = (start: number, kind: 'free' | 'booked' | 'block' | 'mine', who?: string, target?: string) => {
    const cls = kind === 'free' ? 'bg-pt-surface border-pt-accent/35' : kind === 'block' ? 'bg-[repeating-linear-gradient(135deg,#1C1C1E_0_8px,#232325_8px_16px)] border-transparent' : 'bg-pt-surface border-transparent'
    return (
      <button key={start} {...(target ? T(target) : {})} onClick={target ? tap(target) : undefined} className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border ${cls}`}>
        <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums whitespace-nowrap">{fmtSlot(start, s.slotMinutes)}</span>
        {kind === 'booked' && <Avatar name={who!} />}
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-pt-text truncate">{kind === 'free' ? <span className="text-pt-accent">Free · book or block</span> : kind === 'block' ? (blockNote.trim() || { cleaners: 'Cleaners', maintenance: 'Maintenance', event: 'Event', rental: 'External rental' }[blockType]) : who}</span>
        </span>
        {kind === 'block' && <Pill tone="muted">Blocked</Pill>}
      </button>
    )
  }

  const pieceList = (out: boolean) => (
    <div {...T('pieces')}>
      <PieceChecklist lines={lines} ticked={out ? ticked : inTicked} missing={out ? missing : inMissing}
        onTick={k => { if (out ? step.id !== 'pieces' : step.id !== 'checkpieces') return
          if (out) { setTicked(t => toggle(t, k)); setMissing(m => { const n = new Set(m); n.delete(k); return n }) } else { setInTicked(t => toggle(t, k)); setInMissing(m => { const n = new Set(m); n.delete(k); return n }) } }}
        onMissing={k => { if (out && step.id === 'pieces') setMissing(m => toggle(m, k)); if (!out && step.id === 'checkpieces') setInMissing(m => toggle(m, k)) }} />
    </div>
  )

  const scenes: Record<Scene, () => ReactNode> = {
    hello: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          <div className="chapter-rise relative self-center"><span className="absolute inset-0 rounded-full blur-2xl bg-pt-accent/25" /><BrandMark className="relative w-28 text-white" title="" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '100ms' }}>Welcome to the gear room{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '170ms' }}>Every camera, light and drone at Prime Capitol goes through you. This app keeps track of all of it, so you don't have to remember.</p>
          </div>
          <div className="space-y-3">
            {([['box', 'Every piece of gear, and which kit it lives in'], ['clock', 'A queue of who picks up what, and when it is due back'], ['calendar', 'The house calendar, when it needs a human']] as [IconName, string][]).map(([i, t], n) => (
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
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          <div className="chapter-rise self-center"><Cap size={88} className="cap-bob" /></div>
          <div className="space-y-3 text-center">
            <h1 className="chapter-rise font-display text-[30px] leading-tight font-extrabold" style={{ animationDelay: '100ms' }}>Hi, I'm Cap.</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '170ms' }}>I'll walk you through a day in the gear room: stocking the shelves, building kits, handing them out, checking them back in, and keeping the calendar honest.</p>
          </div>
          <div className="chapter-rise grid grid-cols-3 gap-2 text-center" style={{ animationDelay: '240ms' }}>
            {[[String(GEAR_CHAPTERS.length), 'chapters'], ['~7', 'minutes'], [String(GEAR_CHAPTERS.length), 'badges']].map(([n, l]) => <div key={l} className="rounded-2xl bg-pt-surface shadow-hairline py-3"><b className="block text-[24px] text-pt-accent">{n}</b><span className="text-pt-muted text-sm">{l}</span></div>)}
          </div>
          <p className="chapter-rise text-[15px] text-pt-muted text-center" style={{ animationDelay: '300ms' }}>It's all practice: made-up gear and people. Nothing you do here changes the real inventory. Tap what glows, and Back if you miss something.</p>
        </div>
        <div className="chapter-rise space-y-2 pb-4" style={{ animationDelay: '360ms' }}>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          <button onClick={back} className="w-full py-2 text-pt-muted text-[15px]">Back</button>
        </div>
      </div>
    ),
    queue: () => {
      const tab = at('tocheckin') && past('tocheckin') && !past('opencheckin') ? 'checkin' : at('outtab') && !past('tocheckin') ? 'out' : 'today'
      const tabs: [string, string][] = [['today', 'Today (2)'], ['out', `Out (${past('gearsign') ? 2 : 1})`], ['checkin', `To check in (${past('opencheckin') ? 0 : at('outtab') ? 1 : 0})`], ['upcoming', 'Upcoming'], ['past', 'Past']]
      return (
        <div className="pb-6">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
            <div className="py-2"><h1 className="font-display text-[34px] text-pt-text">Gear queue</h1></div>
            <div {...T('queuetabs')} className="flex gap-2 overflow-x-auto no-scrollbar">
              {tabs.map(([v, l]) => <button key={v} {...T(`tab-${v}`)} onClick={tap(`tab-${v}`)} className={`shrink-0 px-3 py-1 rounded-full text-sm ${tab === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>)}
            </div>
          </div>
          <div className="p-4 space-y-2">
            {tab === 'today' && <>
              {queueCard({ t: 'If You See This, RUN', who: 'Riley', when: past('opencheckin') ? `Due back ${fmtTime(END)}` : `Pickup ${fmtTime(START)}`, what: kitWhat, pill: <Pill tone={kitTone}>{kitLabel}</Pill>, target: 'heldcard' })}
              {queueCard({ t: 'Ghost Hunt at 3 AM', who: 'Jordan', when: `Due back ${fmtTime(17 * 60)}`, what: 'DJI Mini 5 drone, 2× Extra camera battery', pill: <Pill tone="warn">Out</Pill> })}
            </>}
            {tab === 'out' && <>
              <div {...T('latecard')}>{queueCard({ t: 'My Roommate Is A Spy', who: 'Sam', when: `${formatDay(today)} · ${fmtHours(10 * 60, 12 * 60)}`, what: 'Sony A7S III kit', pill: <><Pill tone="taken">Late</Pill><Pill tone="warn">Out</Pill></>, late: true })}</div>
              {queueCard({ t: 'If You See This, RUN', who: 'Riley', when: `${formatDay(today)} · ${fmtHours(START, END)}`, what: kitWhat, pill: <>{missingShown && <Pill tone="warn">⚠ Missing reported</Pill>}<Pill tone="warn">Out</Pill></> })}
            </>}
            {tab === 'checkin' && queueCard({ t: 'If You See This, RUN', who: 'Riley', when: `${formatDay(today)} · ${fmtHours(START, END)}`, what: kitWhat, pill: <Pill tone="free">Returned</Pill>, target: 'retcard' })}
          </div>
        </div>
      )
    },
    booking: () => {
      const n = { held: 0, out: 1, returned: 2, checked_in: 3 }[kitStatus]
      const pickupOpen = kitStatus === 'held' && at('pickuplook')
      return (
        <div className="pb-10">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-2 py-2 flex items-center"><button {...T('back')} onClick={tap('back')} className="text-pt-accent text-[17px] px-2 py-1">‹ Back</button></div>
          <div className="px-4 space-y-4">
            <div {...T('bookinghead')} className="space-y-3">
              <div className="space-y-1">
                <div className="flex gap-2"><Pill tone={kitTone}>{kitLabel}</Pill></div>
                <h1 className="font-display text-[34px] text-pt-text leading-tight">If You See This, RUN</h1>
                <p className="text-pt-muted">{formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtHours(START, END)}</p>
                <p className="text-pt-muted text-sm">Booked by Riley</p>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map(i => <div key={i} className={`h-1.5 rounded-full ${i <= n ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
                <div className="grid grid-cols-4 gap-1 text-xs text-center">{['Held', 'Picked up', 'Returned', 'Checked in'].map((x, i) => <span key={x} className={i === n ? 'text-pt-accent' : 'text-pt-muted'}>{x}</span>)}</div>
              </div>
              <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
                {[['Pick up', `${formatDay(today)} · ${fmtTime(START)}`], ['Back by', fmtTime(END)], ['Where', 'Equipment cage']].map(([a, b]) => <div key={a} className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">{a}</span><span className="text-pt-text">{b}</span></div>)}
              </div>
            </div>

            {pickupOpen && (
              <section className="space-y-3">
                <div {...T('pickupinfo')}><h2 className="text-pt-text text-xl font-semibold tracking-tight">Pick up</h2><p className="text-pt-muted text-sm">Open the case and tick what's there. Tap "Missing?" for anything that isn't.</p></div>
                {pieceList(true)}
                {missing.size > 0 && <p className="text-red-200 text-sm bg-red-500/10 rounded-xl px-4 py-3">{missing.size} piece{missing.size > 1 ? 's' : ''} reported missing <b>before you took it</b>. The equipment team will see it, and it goes on the record of whoever had it last.</p>}
                <button {...T('gearsign')} onClick={tap('gearsign')} disabled={!allOut} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Sign: I've got it</button>
              </section>
            )}
            {kitStatus === 'out' && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400"><p className="font-medium">Picked up ✓</p><p className="text-pt-text/80 text-sm mt-0.5">Signed by Riley at {fmtTime(START - 10)}. Theirs until it's back.</p></div>}

            {kitStatus === 'returned' && (
              <section className="space-y-3">
                <div><h2 className="text-pt-text text-xl font-semibold tracking-tight">Check in</h2><p className="text-pt-muted text-sm">Check the batteries are charging, then tick each piece. If you can't get to it before the next pickup, that creator's pickup check covers it.</p></div>
                {pieceList(false)}
                <input {...T('checknote')} value={checkNote} onChange={e => setCheckNote(e.target.value.slice(0, 200))} placeholder="Note (optional), e.g. lens cap scratched"
                  className="w-full bg-pt-surface rounded-xl px-4 py-3 text-pt-text text-[15px] placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent" />
                <button {...T('checkedin')} onClick={tap('checkedin')} disabled={!allIn} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Checked in</button>
              </section>
            )}
            {kitStatus === 'checked_in' && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400"><p className="font-medium">Checked in ✓</p><p className="text-pt-text/80 text-sm mt-0.5">Ready for the next creator.</p></div>}

            {(kitStatus === 'returned' || kitStatus === 'checked_in') && (
              <div {...T('retphoto')} className="space-y-2">
                <p className="text-pt-muted text-xs px-1">Return photo</p>
                <div className="w-24 space-y-1"><GearArt category="Camera" className="w-24 h-24 rounded-xl" /><p className="text-xs text-pt-muted">Taken {fmtTime(END - 5)}</p></div>
              </div>
            )}

            {(missingShown || inMissing.size > 0) && kitStatus !== 'held' && (
              <div {...T('problems')} className="bg-amber-500/10 rounded-2xl px-4 py-3 space-y-1 text-[15px]">
                <p className="text-amber-200 font-medium">Problems</p>
                {lines.filter(l => missing.has(l.key)).map(l => <p key={`p${l.key}`} className="text-pt-text">1× {l.name} missing at pickup</p>)}
                {kitStatus === 'checked_in' && lines.filter(l => inMissing.has(l.key)).map(l => <p key={`c${l.key}`} className="text-pt-text">1× {l.name} missing at check-in</p>)}
                {missingShown && <p className="text-pt-muted text-sm">Also recorded on Jordan's booking (had it last).</p>}
              </div>
            )}
            {!missingShown && inMissing.size === 0 && kitStatus !== 'held' && (
              <div {...T('problems')} className="bg-pt-surface rounded-2xl px-4 py-3 text-[15px] text-pt-muted">No problems: everything was in the case. (If something had been missing, it would be listed here.)</div>
            )}

            <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-3"><GearArt category="Camera" className="w-12 h-12 rounded-xl shrink-0" />
                <div className="min-w-0"><p className="text-pt-text text-[15px] font-medium truncate">{kitWhat}</p><p className="text-pt-muted text-xs">Bundle · {lines.length} pieces</p></div></div>
              <p className="text-pt-muted text-xs leading-relaxed">{lines.map(l => l.name).join(' · ')}</p>
            </div>

            {kitStatus === 'held' && !pickupOpen && (
              <div {...T('decline')}>
                {at('declinewhy') ? (
                  <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
                    <textarea value={declineWhy} onChange={e => setDeclineWhy(e.target.value.slice(0, 200))} rows={2} placeholder="Why? e.g. the drone is in for repair; try the Mini 3 bundle"
                      className="w-full bg-pt-bg rounded-xl px-3 py-2 text-pt-text text-[15px] placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent resize-none" />
                    <div className="grid grid-cols-2 gap-2"><span className="py-3 rounded-xl bg-pt-border text-pt-text font-medium text-center">Back</span><span className="py-3 rounded-xl bg-red-500/50 text-white font-semibold text-center">Decline</span></div>
                  </div>
                ) : <button onClick={tap('decline')} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-text font-medium">Decline (equipment team)</button>}
              </div>
            )}

            <div {...T('history')} className="space-y-1 pt-2">
              <p className="text-pt-muted text-xs px-1">History</p>
              {[
                [`${formatDay(addDays(today, -3))}, 6:12 PM`, 'Held by Riley'],
                ...(kitStatus !== 'held' ? [[`${fmtTime(START - 10)}`, `Picked up (signed)${missingShown ? ` · ${missingName} missing` : ''}`]] : []),
                ...(kitStatus === 'returned' || kitStatus === 'checked_in' ? [[`${fmtTime(END - 5)}`, 'Returned (on time)']] : []),
                ...(kitStatus === 'checked_in' ? [[`${fmtTime(END + 20)}`, `Checked in by ${first || 'you'}${checkNote.trim() ? ` · ${checkNote.trim()}` : ''}`]] : []),
              ].map(([t, a]) => <p key={t + a} className="text-pt-muted text-sm px-1">{t} · {a}</p>)}
            </div>
          </div>
        </div>
      )
    },
    items: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          <div className="flex items-center gap-3 py-2">
            <h1 className="font-display text-xl text-pt-text flex-1">All gear</h1>
            <button {...T('addgear')} onClick={tap('addgear')} className="text-pt-accent text-sm font-medium tap">+ Add gear</button>
          </div>
          <div className="w-full bg-pt-surface border border-pt-border rounded-xl px-3 py-2 text-pt-muted text-sm">Search gear</div>
        </div>
        <div className="px-4 pt-4 pb-8 space-y-6">
          <p className="text-pt-muted text-sm">Every piece of gear you own. Creators can't book pieces on their own: put them into a <span className="text-pt-accent">bundle</span>.</p>
          <div {...T('itemlist')} className="space-y-6">
            {CATS.map(cat => {
              const rows = (past('itemsave') ? stock : STOCK).filter(i => i.category === cat)
              if (!rows.length) return null
              return (
                <div key={cat} className="space-y-2">
                  <p className="text-pt-muted text-xs">{cat}</p>
                  {rows.map(i => {
                    const inB = i.inB + (past('bundlesave') ? (pick[i.id] ?? 0) : 0), loose = i.have - inB
                    return (
                      <div key={i.id} {...(i.id === 'new' ? T('newitem') : {})} className="w-full flex items-center gap-3 bg-pt-surface shadow-hairline rounded-xl px-3 py-2">
                        <GearArt category={i.category} className="w-10 h-10 rounded-lg shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-pt-text text-sm truncate">{i.name}</p>
                          <p className="text-pt-muted text-xs truncate">{i.serial ? `Serial ${i.serial} · ` : ''}{inB ? `${inB} in bundles` : 'Not in a bundle'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-pt-text font-semibold tabular-nums">{i.have}</p>
                          {loose > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{loose} loose</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    ),
    itemsheet: () => (
      <>
        {scenes.items()}
        <BottomSheet open locked onClose={() => {}} title="Add gear">
          <div className="space-y-3">
            <div {...T('itemform')} className="space-y-3">
              <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Name</span>
                <input value={itemName} onChange={e => setItemName(e.target.value.slice(0, 80))} placeholder="e.g. Sony FX3 body" className={field} /></label>
              <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Type</span>
                <select value={itemCat} onChange={e => setItemCat(e.target.value)} className={field}>{CATS.map(c => <option key={c}>{c}</option>)}</select></label>
              <div className="flex gap-2">
                <label className="block space-y-1 w-28"><span className="text-pt-muted text-[13px]">How many</span><input value="1" disabled className={field} /></label>
                <label className="block space-y-1 flex-1"><span className="text-pt-muted text-[13px]">Serial number</span>
                  <input value={serial} onChange={e => setSerial(e.target.value.slice(0, 40))} placeholder="Cameras & drones (optional)" className={field} /></label>
              </div>
              <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Replacement value ($, staff only)</span><input placeholder="Optional" disabled className={field} /></label>
            </div>
            <button {...T('itemsave')} onClick={tap('itemsave')} disabled={itemName.trim().length < 2} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Save</button>
          </div>
        </BottomSheet>
      </>
    ),
    bundles: () => (
      <div className="pb-6">
        {header('Bundles', <span className="text-pt-muted text-sm px-3 py-2 rounded-xl shadow-hairline">All gear</span>)}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button {...T('newbundle')} onClick={tap('newbundle')} className="py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">+ Bundle</button>
            <span className="py-3 rounded-xl border border-pt-accent text-pt-accent font-semibold text-center">+ Add-on extra</span>
          </div>
          <p className="text-pt-muted text-sm">Creators only see what's here, never the loose pieces in All gear.</p>
          <div {...T('bundlelist')} className="space-y-3">
            <div className="space-y-2">
              <p className="text-pt-muted text-xs">Bundles · Booked whole, never split</p>
              {past('bundlesave') && (
                <div {...T('newkit')} className="bg-pt-surface shadow-hairline rounded-2xl p-3 flex gap-3">
                  <GearArt category="Camera" className="w-16 h-16 rounded-xl shrink-0" />
                  <div className="min-w-0"><p className="text-pt-text font-medium truncate">{kitName}</p><p className="text-pt-muted text-xs">Camera · {pieceCount} pieces</p>
                    <p className="text-pt-muted text-xs truncate">{kitPieces.slice(0, 3).map(p => `${p.qty}× ${p.name}`).join(', ')}{kitPieces.length > 3 ? '…' : ''}</p></div>
                </div>
              )}
              {[['Sony A7S III kit', 'Camera', '1× Sony A7S III body, 1× 24-70mm lens, 3× Camera battery'], ['DJI Mini 5 drone', 'Drones', '1× DJI Mini 5 drone, 1× Controller, 3× Drone battery']].map(([n, c, p]) => (
                <div key={n} className="bg-pt-surface shadow-hairline rounded-2xl p-3 flex gap-3">
                  <GearArt category={c} className="w-16 h-16 rounded-xl shrink-0" />
                  <div className="min-w-0"><p className="text-pt-text font-medium truncate">{n}</p><p className="text-pt-muted text-xs">{c} · 5 pieces</p><p className="text-pt-muted text-xs truncate">{p}</p></div>
                </div>
              ))}
              {past('gearsign') && missingShown && (
                <div {...T('missingbox')} className="bg-amber-500/10 rounded-2xl px-3 py-2 space-y-1">
                  <p className="text-amber-200 text-xs font-medium">{kitName}: reported missing</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className={`text-pt-text ${found ? 'line-through opacity-50' : ''}`}>1× {missingName} · {formatDay(today)}</span>
                    {found ? <span className="text-green-400 text-sm">Found ✓</span> : <button onClick={() => { if (step.id === 'foundit') { setFound(true); advance() } }} className="text-pt-accent text-sm tap">Found it</button>}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-pt-muted text-xs">Add-on extras · Creators pick how many</p>
              {[['Extra camera battery', 'Power', 6], ['Wireless mic (DJI Mic)', 'Audio', 4]].map(([n, c, q]) => (
                <div key={n as string} className="bg-pt-surface shadow-hairline rounded-2xl p-3 flex gap-3">
                  <GearArt category={c as string} className="w-16 h-16 rounded-xl shrink-0" />
                  <div className="min-w-0"><p className="text-pt-text font-medium truncate">{n}</p><p className="text-pt-muted text-xs">{q} offered</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    bundleedit: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3"><span className="text-pt-text py-1">‹</span><h1 className="font-display text-xl text-pt-text">Build a bundle</h1></div>
        <div className="px-4 pt-4 pb-8 space-y-6">
          <p className="text-pt-muted text-sm">A case of pieces creators book as a whole. It can never be split.</p>
          <div {...T('bundlename')} className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-3">
            <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Bundle name</span>
              <input value={bundleName} onChange={e => setBundleName(e.target.value.slice(0, 80))} placeholder="e.g. Sony FX3 kit" className={field} /></label>
            <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Type</span><div className={field}>Camera</div></label>
          </div>
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-1">
            <p className="text-pt-muted text-[13px]">In this bundle ({pieceCount} pieces)</p>
            {kitPieces.length === 0 && <p className="text-pt-muted text-sm">Add pieces from the list below.</p>}
            {kitPieces.map(p => <p key={p.id} className="text-pt-text text-sm"><span className="text-pt-accent font-bold tabular-nums">{p.qty}×</span> {p.name}</p>)}
          </div>
          <div {...T('pieces')} className="space-y-2">
            <p className="text-pt-muted text-[13px]">Add pieces (only ones not already in another bundle)</p>
            {stock.filter(p => p.have - p.inB > 0).map(i => {
              const n = pick[i.id] ?? 0, free = i.have - i.inB
              return (
                <div key={i.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-pt-text text-sm truncate">{i.name}{i.serial ? <span className="text-pt-muted"> · {i.serial}</span> : null}</p>
                    <p className="text-pt-muted text-xs">{free - n} of {i.have} still free</p>
                  </div>
                  {stepper(n, free, d => { if (step.id === 'bundlepieces') setPick(p => ({ ...p, [i.id]: Math.max(0, n + d) })) }, i.name)}
                </div>
              )
            })}
          </div>
          <button {...T('bundlesave')} onClick={tap('bundlesave')} disabled={pieceCount < 2 || !bundleName.trim()} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Save bundle</button>
        </div>
      </div>
    ),
    schedule: () => (
      <div className="pb-8">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
          <div className="flex items-end justify-between py-2 gap-2">
            <h1 className="font-display text-[34px] text-pt-text">Schedule</h1>
            <div className="flex gap-2 pb-0.5">
              <button {...T('teamicon')} onClick={tap('teamicon')} aria-label="Check-ins, reports and creators" className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-muted"><Icon name="people" className="w-5 h-5" /></button>
              <span className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-muted">?</span>
            </div>
          </div>
          <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
            {[s.houses.cliff1.name, s.houses.cliff2.name, 'Offsite'].map((h, n) => <span key={h} className={`flex-1 py-2 rounded-[10px] text-sm text-center ${n === 0 ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h}</span>)}
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pt-3 pb-1 -mx-4 px-4">
            {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map(d => (
              <span key={d} className={`shrink-0 w-[52px] py-2 rounded-xl text-center border ${d === tomorrow ? 'border-pt-accent bg-pt-surface' : 'border-transparent bg-pt-surface'}`}>
                <span className="block text-xs text-pt-muted">{formatDay(d, { weekday: 'short' })}</span><span className="block text-lg font-semibold text-pt-text leading-tight">{Number(d.slice(8))}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="px-4 pt-4 space-y-3">
          <p className="text-pt-muted text-sm">{formatDay(tomorrow, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.houses.cliff1.name}</p>
          <div {...T('slots')} className="space-y-2">
            {slotRow(9 * 60, 'booked', 'Jordan')}
            {slotRow(11 * 60, blocked ? 'block' : 'free', undefined, blocked ? undefined : 'freeslot')}
            {slotRow(13 * 60, 'booked', 'Riley', 'bookedslot')}
            {slotRow(15 * 60, 'free')}
            {slotRow(17 * 60, 'free')}
          </div>
        </div>
      </div>
    ),
    slotsheet: () => (
      <>
        {scenes.schedule()}
        <BottomSheet open locked onClose={() => {}} title="Book or block">
          <p className="text-pt-muted text-sm">{formatDay(tomorrow)} · {s.houses.cliff1.name} · {fmtSlot(11 * 60, s.slotMinutes)}</p>
          <div {...T('bookfor')} className="mt-4"><span className="block w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold text-center">Book this slot…</span></div>
          <div className="mt-5 border-t border-pt-border pt-4 space-y-3">
            <div {...T('blockform')} className="space-y-3">
              <p className="text-pt-text font-semibold">Or block it</p>
              <p className="text-pt-muted text-sm">Cleaners, maintenance, events, external rentals: anything that affects filming. Nobody can book blocked time.</p>
              <select value={blockType} onChange={e => setBlockType(e.target.value)} className={field}>
                {[['cleaners', 'Cleaners'], ['maintenance', 'Maintenance'], ['event', 'Event'], ['rental', 'External rental']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input value={blockNote} onChange={e => setBlockNote(e.target.value.slice(0, 60))} placeholder="Note (optional), e.g. Deep clean" className={field} />
            </div>
            <button {...T('blockbtn')} onClick={tap('blockbtn')} className="w-full bg-pt-border text-pt-text font-semibold rounded-xl py-3">Block this slot</button>
          </div>
        </BottomSheet>
      </>
    ),
    shootsheet: () => (
      <>
        {scenes.schedule()}
        <BottomSheet open locked onClose={() => {}} title="Riley's shoot">
          <div className="space-y-4">
            <div className="flex items-center gap-3"><Avatar name="Riley" size={44} /><div className="min-w-0 flex-1"><p className="text-pt-text font-semibold">Riley</p><p className="text-pt-muted text-sm">{formatDay(tomorrow)} · {s.houses.cliff1.name} · {fmtSlot(13 * 60, s.slotMinutes)}</p></div><Pill tone="free">Booked</Pill></div>
            <div {...T('teamactions')} className="space-y-2">
              <div className="flex gap-2"><span className="flex-1 bg-pt-border text-pt-text font-semibold rounded-xl py-3 text-center">Move</span></div>
              <span className="block w-full bg-red-500/15 text-red-300 font-semibold rounded-xl py-3 text-center">Cancel their shoot (no strike)</span>
            </div>
            <button {...T('closeshoot')} onClick={tap('closeshoot')} className="w-full py-3 rounded-xl shadow-hairline text-pt-text">Done</button>
          </div>
        </BottomSheet>
      </>
    ),
    team: () => {
      const tab = past('tocreators') ? 'creators' : past('toreports') ? 'reports' : 'checkins'
      return (
        <div className="pb-10">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
            <div className="flex items-end gap-2 py-2"><span className="w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1">‹</span><h1 className="font-display text-[34px] text-pt-text">Schedule team</h1></div>
            <div className="flex gap-2">
              {[['checkins', `Check-ins${decided ? '' : ' (1)'}`], ['reports', 'Reports (1)'], ['creators', 'Creators']].map(([v, l]) => <button key={v} {...T(`tab-${v}`)} onClick={tap(`tab-${v}`)} className={`px-3 py-1 rounded-full text-sm ${tab === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>)}
            </div>
          </div>
          <div {...T('teamlist')} className="p-4 space-y-2">
            {tab === 'checkins' && <>
              <h2 className="text-pt-text font-semibold">Needs a decision</h2>
              <p className="text-pt-muted text-sm">No check-in by the end of the slot. The creator has {s.explainHours} hours to explain; then you decide.</p>
              {decided ? <p className="text-pt-muted text-sm">Nothing to decide. Jordan is marked as filmed.</p> : (
                <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
                  <div className="flex items-center gap-3"><Avatar name="Jordan" /><div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">Jordan</p><p className="text-pt-muted text-xs">{formatDay(addDays(today, -1))} · {s.houses.cliff1.name} · {fmtSlot(9 * 60, s.slotMinutes)}</p></div><Pill tone="taken">No check-in</Pill></div>
                  <p className="text-pt-text text-sm">“My phone died, but we filmed the whole thing. Ask Riley!”</p>
                  <div className="flex gap-2">
                    <button {...T('decide')} onClick={() => { if (step.id === 'checkins') { setDecided(true); advance() } }} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm">They filmed</button>
                    <span className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm text-center">No-show · strike</span>
                  </div>
                </div>
              )}
            </>}
            {tab === 'reports' && <>
              <p className="text-pt-muted text-sm">Sent by the next creator at check-in. Dismiss, or uphold it to give that person a strike.</p>
              <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-3"><Avatar name="Sam" /><div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">Riley reported Sam</p><p className="text-pt-muted text-xs">{formatDay(addDays(today, -1))} · {s.houses.cliff1.name}</p></div><Pill tone="warn">Report</Pill></div>
                <p className="text-pt-text text-sm">Ran over 25 min · Left the house a mess</p>
                <p className="text-pt-text text-sm bg-pt-bg rounded-xl px-3 py-2">“Still packing up when I arrived, pizza boxes in the kitchen.”</p>
                <div className="flex gap-2"><span className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm text-center">Dismiss</span><span className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm text-center">Strike for Sam</span></div>
              </div>
            </>}
            {tab === 'creators' && <>
              <p className="text-pt-muted text-sm">Last {s.strikeDays} days. {s.strikeCount} strikes pause prop and gear bookings for {s.pauseDays} days.</p>
              {[['Sam', '3 of 5 filmed · 2 missed · 2 strikes', <span key="p" className="shrink-0 bg-red-500/15 text-red-300 rounded-lg px-3 py-2 text-xs">Paused · Lift</span>],
                ['Riley', '6 of 6 filmed', <Pill key="r" tone="free">Reliable</Pill>], ['Jordan', '4 of 4 filmed', <Pill key="j" tone="free">Reliable</Pill>]].map(([n, d, p]) => (
                <div key={n as string} className="bg-pt-surface rounded-2xl p-3 flex items-center gap-3"><Avatar name={n as string} /><div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">{n}</p><p className="text-pt-muted text-xs">{d}</p></div>{p}</div>
              ))}
            </>}
          </div>
        </div>
      )
    },
    admin: () => (
      <div className="pb-6">
        {header('Admin')}
        <div className="p-4">
          <div {...T('adminlist')} className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
            {[['Gear queue', "Today's pickups and returns, what's out, what to check in"], ['Bundles & add-on extras', 'What creators can book; build a new kit'],
              ['All gear', 'Every piece you own: add gear, serial numbers, values, archive'], ['Schedule team', 'Check-ins, reports to review, creators booked vs filmed, pauses'],
              ['Schedule settings', 'Houses, slots, priority days, strikes, Google Calendar'], ['Google Calendar import', 'Sort events added straight in the shared calendar'],
              ['Gear team tour', 'Practise the gear room again, step by step'], ['Help', 'How do I…? Gear, check-ins, the schedule, sign-in'], ['My account', 'Your photo, notifications; sign out']].map(([t, d]) => (
              <button key={t} {...(t === 'My account' ? T('myaccount') : {})} onClick={t === 'My account' ? tap('myaccount') : undefined} className="w-full flex items-center gap-3 px-4 py-4 text-left">
                <div className="flex-1 min-w-0"><p className="text-pt-text font-medium">{t}</p><p className="text-pt-muted text-xs mt-0.5">{d}</p></div>
                <span className="text-pt-muted">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ),
    notify: () => (
      <div className="pb-6">
        {header('Account')}
        <div className="px-4 pt-2 pb-8 space-y-6">
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 flex items-center gap-4">
            <Avatar email={profile.email} name={name} size={64} />
            <span className="min-w-0"><b className="block text-pt-text truncate">{name}</b><span className="block text-pt-muted text-xs truncate">{profile.email}</span><span className="block text-pt-accent text-sm">Equipment team</span></span>
          </div>
          {notifyCard}
        </div>
      </div>
    ),
    rules: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Your cheat sheet</h1>
        <div className="flex items-center gap-3"><Cap size={36} /><p className="text-[15px] text-pt-text/85">The gear room in six lines. Replay it from Admin → Gear team tour any time.</p></div>
        {([
          ['box', 'Every piece goes in All gear first. Loose pieces are invisible to creators until they are in a bundle or an add-on extra.'],
          ['tools', 'A piece lives in one bundle at a time. Bundles are booked whole. Pieces are locked while a bundle is booked or out.'],
          ['handshake', 'Pickup opens 30 minutes before. The creator ticks every piece and signs. Missing before signing goes on whoever had it last.'],
          ['check', 'Late = 30 minutes after the booked end. Check returns in: tick every piece, write down any damage.'],
          ['eye', "Who had what: the booking's Problems and History. Tap Found it when a missing piece turns up."],
          ['calendar', `Book or block any free slot. Team moves and cancels never give a strike. Decide missed check-ins after ${s.explainHours} hours.`],
        ] as [IconName, string][]).map(([i, t], n) => <div key={t} className="chapter-rise flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4" style={{ animationDelay: `${n * 60}ms` }}><Icon name={i} className="w-6 h-6 text-pt-accent shrink-0" /><p className="text-[16px] text-pt-text">{t}</p></div>)}
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8 text-center">
          <div className="relative self-center"><Confetti count={40} /><Cap size={96} className="cap-bob" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '120ms' }}>The gear room is yours{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '190ms' }}>You stocked it, built a kit, handed it out, got it back and kept the calendar straight. That's the job.</p>
          </div>
          <BadgeWall chapters={GEAR_CHAPTERS} />
        </div>
        <div className="pb-4"><button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">{required ? "Let's get to work" : 'Done'}</button></div>
      </div>
    ),
  }

  // The equipment team's real tab bar (Queue / Schedule / Bundles / All gear / Admin).
  const TAB: Partial<Record<Scene, Tab>> = { queue: 'Queue', items: 'All gear', itemsheet: 'All gear', bundles: 'Bundles', schedule: 'Schedule', slotsheet: 'Schedule', shootsheet: 'Schedule', admin: 'Admin', notify: 'Admin' }
  const lit = TAB[step.scene]
  const inPart = STEPS.filter(x => x.part === step.part && !x.id.startsWith('part') && !x.quiz)
  const stepInPart = inPart.findIndex(x => x.id === step.id) + 1
  const nextDisabled = (step.id === 'itemform' && itemName.trim().length < 2) || (step.id === 'bundlename' && bundleName.trim().length < 2)
    || (step.id === 'bundlepieces' && pieceCount < 2) || (step.id === 'declinewhy' && declineWhy.trim().length < 3)
    || (step.id === 'pieces' && (!allOut || missing.size === 0)) || (step.id === 'checkpieces' && !allIn) || (step.id === 'notify' && push === 'off' && !pushMsg)
  const navKey = (t: Tab) => `nav-${t.replace(' ', '').toLowerCase()}`

  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="Gear team tour (practice)">
      <div className="flex-1 overflow-y-auto">{scenes[step.scene]()}</div>
      {lit && (
        <nav {...T('tabbar')} className="shrink-0 flex bg-black/80 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1)] pb-tabbar">
          {(['Queue', 'Schedule', 'Bundles', 'All gear', 'Admin'] as Tab[]).map(t => (
            <button key={t} {...T(navKey(t))} onClick={tap(navKey(t))}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs ${lit === t ? 'text-pt-accent' : 'text-pt-muted'}`}>
              {TAB_ICONS[t]}<span>{t}</span>
            </button>
          ))}
        </nav>
      )}
      {step.id.startsWith('part') && <ChapterCard key={step.id} n={step.part!} body={step.body} onGo={advance} onBack={back} chapters={GEAR_CHAPTERS} />}
      {step.quiz && <QuizCard key={step.id} part={step.part!} {...step.quiz} onDone={advance} onBack={back} />}
      {step.part && !step.id.startsWith('part') && !step.quiz && <Spotlight stepKey={step.id} target={step.target} top={step.top} dim={!step.look} title={step.title} body={step.body} part={step.part}
        chapters={GEAR_CHAPTERS} stepInPart={stepInPart || undefined} stepsInPart={stepInPart ? inPart.length : undefined} next={step.next} onNext={advance}
        nextDisabled={nextDisabled} disabledHint={step.hint} onBack={back} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
