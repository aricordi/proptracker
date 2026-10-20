// Admin tour (owner, Oct 20: "build out the tutorial for the admin role"). Same coach, chapter cards, quizzes and badges
// as the creator and gear team tours (Spotlight + Fun.tsx), with ADMIN_CHAPTERS:
//   1 Find your way around (Dashboard / Queue / Gear / Schedule / Props, a look at the Dashboard + tools)  2 Watch the queues (props
//   queue, a request page, the gear queue: all view only)  3 Your creators (Dashboard → All creators: totals, periods, sort)
//   4 Read a record (one creator: tiles + every flag)  5 Give a strike (about + reason, the automatic pause) + quiz
//   6 Second chances (remove a strike, pause by hand, lift) + quiz  7 On the day (Schedule → team: missed check-ins,
//   reports) + quiz  8 Hold the door (invite a creator, booking rules) + quiz  9 Stay in the loop (REAL notifications).
// Scenes copy the real screens (ReservationsScreen, ReservationDetailScreen, GearBookingsScreen, AdminScreen,
// CreatorsScreen, PersonHistoryScreen + ManageCreator, ScheduleScreen, ScheduleTeamScreen, UsersScreen + invite sheet,
// BookingRulesScreen, AccountScreen). When one of those screens changes a lot, update its scene here too.
// SEALED: practice data only (made-up creators, requests and strikes). Nothing is saved, given or sent, except turning on
// notifications in chapter 9 and marking the tour done. Required once for admins (App.tsx TourGate); replay at /tour/admin.
import { useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useScheduleSettings, fmtSlot } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { pushState, turnOnPush, isIOS, type PushState } from '../services/push'
import { Pill } from '../components/GearUi'
import { TAB_ICONS } from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { fmtHours } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { Cap, Confetti, ChapterCard, QuizCard, BadgeWall, type Chapter } from './Fun'
import { markTourDone, savedStep, saveStep } from './tourState'

export const ADMIN_CHAPTERS: Chapter[] = [
  { name: 'Find your way around', badge: 'Explorer', icon: 'search' },
  { name: 'Watch the queues', badge: 'Watcher', icon: 'eye' },
  { name: 'Your creators', badge: 'Talent scout', icon: 'people' },
  { name: 'Read a record', badge: 'Detective', icon: 'file' },
  { name: 'Give a strike', badge: 'Referee', icon: 'stop' },
  { name: 'Second chances', badge: 'Fair play', icon: 'restore' },
  { name: 'On the day', badge: 'Judge', icon: 'clock' },
  { name: 'Hold the door', badge: 'Gatekeeper', icon: 'lock' },
  { name: 'Stay in the loop', badge: 'In the loop', icon: 'bell' },
]

type Scene = 'hello' | 'meet' | 'queue' | 'request' | 'gearq' | 'admin' | 'creators' | 'person' | 'strikesheet' | 'removesheet'
  | 'pausesheet' | 'schedule' | 'team' | 'users' | 'invitesheet' | 'rules' | 'notify' | 'cheat' | 'done'
type Tab = 'Dashboard' | 'Queue' | 'Gear' | 'Schedule' | 'Props'
interface Step { id: string; scene: Scene; part?: number; target?: string; title: ReactNode; body?: ReactNode; next?: string; hint?: string; top?: boolean; look?: boolean
  quiz?: { q: ReactNode; options: string[]; correct: number; explain: ReactNode } }

const ABOUT: [string, string][] = [['props', 'Props'], ['gear', 'Gear'], ['schedule', 'Schedule'], ['behaviour', 'Behaviour'], ['other', 'Other']]
const field = 'w-full bg-pt-bg rounded-xl px-3 py-3 text-pt-text shadow-hairline placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent'
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())

export default function AdminTour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const name = profile.name || user.displayName || profile.email
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const s = useScheduleSettings()
  const b = useBookingSettings()
  const today = todayInStudio()

  // ── What you type and pick ──
  const [about, setAbout] = useState('gear'), [strikeWhy, setStrikeWhy] = useState('')
  const [removeWhy, setRemoveWhy] = useState('')
  const [days, setDays] = useState(7), [pauseWhy, setPauseWhy] = useState('')
  const [decided, setDecided] = useState(false)
  const [invEmail, setInvEmail] = useState(''), [invName, setInvName] = useState('')
  const invitee = invName.trim() || invEmail.trim() || 'Maya'

  // ── Chapter 9 is real: notifications on this phone ──
  const [push, setPush] = useState<PushState>(() => { try { return pushState() } catch { return 'unsupported' } })
  const [pushBusy, setPushBusy] = useState(false), [pushMsg, setPushMsg] = useState('')
  const turnOn = () => { setPushBusy(true); setPushMsg(''); turnOnPush().then(setPush).catch(e => setPushMsg((e as Error).message || "That didn't work. Try again.")).finally(() => setPushBusy(false)) }

  const C = 'Continue'
  const intro = (n: number, scene: Scene, body: ReactNode): Step => ({ id: `part${n}`, scene, part: n, title: ADMIN_CHAPTERS[n - 1].name, body })
  const ul = (rows: [string, string][]) => <ul className="mt-1 space-y-1">{rows.map(([k, t]) => <li key={k}><b className="text-stone-900">{k}</b>: {t}</li>)}</ul>
  const STEPS: Step[] = [
    { id: 'hello', scene: 'hello', title: '' },
    { id: 'meet', scene: 'meet', title: '' },
    // 1 · Find your way around
    intro(1, 'admin', "You keep an eye on everything, and you look after the creators. Five tabs, and none of them can break anything."),
    { id: 'tabs', scene: 'admin', part: 1, target: 'tabbar', look: true, next: C, title: 'Your five tabs',
      body: ul([['Dashboard', 'your creators at a glance, plus your tools'], ['Queue', 'every props request'], ['Gear', 'every gear booking'], ['Schedule', 'the house calendar'], ['Props', 'the whole closet']]) },
    { id: 'dashlook', scene: 'admin', part: 1, target: 'dashpreview', look: true, next: C, title: 'Your Dashboard, your home',
      body: `Every creator gets one standing: Needs attention, Behind or On track, worst first, with the reason. The bar shows filmed (coloured) and booked (light) against the minimum of 4 shoots a month.` },
    { id: 'analyticslook', scene: 'admin', part: 1, target: 'dashlinks', look: true, next: C, title: 'Go deeper: Analytics',
      body: ul([['Creators', 'the scoreboard, then tap anyone for their report card: standing, month by month against the minimum, flags, what they filmed'], ['Flags', 'by type: abandoned shoots, running over, mess, skipped check-ins, late or broken returns, not confirming'], ['Teams', 'the arts department and equipment team: what is waiting, packed on time, check-in speed'], ['Advanced view', 'the table icon: break any number down by person, house, week, flag or staff, sort it, download it'], ['Trends', 'the whole studio over time, last'], ['Settings sheet', 'every rule the app runs on, and who can change it']]) },
    { id: 'adminlook', scene: 'admin', part: 1, target: 'adminlist', look: true, next: C, title: 'Your tools, further down',
      body: "All creators, the schedule team, activity, invites and booking rules. Settings, the Google Calendar and anything technical stay with the owner." },
    { id: 'toqueue', scene: 'admin', part: 1, target: 'nav-queue', title: <>Now tap <b>Queue</b></>, body: 'Every props request, live.' },
    // 2 · Watch the queues
    intro(2, 'queue', "The arts department and the equipment team do the picking, packing and checking. You can see all of it, so you always know what's going on."),
    { id: 'queuelook', scene: 'queue', part: 2, target: 'queuetabs', look: true, next: C, title: 'The props queue, in piles',
      body: ul([['Today', 'pickups due and props due back'], ['To prepare', 'being picked or built'], ['Ready', 'packed, waiting for the creator'], ['Out', 'with a creator (late first)'], ['Returns', 'back, being checked']]) },
    { id: 'openreq', scene: 'queue', part: 2, target: 'reqcard', title: "Tap Devon's request", body: 'The red ring means late.' },
    { id: 'reqlook', scene: 'request', part: 2, target: 'reqhead', look: true, next: C, title: 'Where it is, at a glance',
      body: "Status, the shoot day, who booked it, and what's in it. There are no tick or pack buttons for you: the arts department does that part." },
    { id: 'reqhistory', scene: 'request', part: 2, target: 'reqhistory', look: true, next: C, title: 'Every step, with a time',
      body: "Requested, packed, picked up, and when it was due back. When you talk to Devon about it, this is your proof." },
    { id: 'back2', scene: 'request', part: 2, target: 'back', title: <>Tap <b>‹ Back</b></> },
    { id: 'togear', scene: 'queue', part: 2, target: 'nav-gear', title: <>Now tap <b>Gear</b></> },
    { id: 'gearlook', scene: 'gearq', part: 2, target: 'gearlist', look: true, next: C, title: 'Same idea for gear',
      body: "The equipment team runs it. A Late pill means it's 30 minutes past the booked end. Late creators can't book more gear until it's back." },
    // 3 · Your creators
    intro(3, 'gearq', "This is the big one. One screen that shows who's filming, and who's slipping."),
    { id: 'toadmin3', scene: 'gearq', part: 3, target: 'nav-dashboard', title: <>Tap <b>Dashboard</b></> },
    { id: 'tocreators', scene: 'admin', part: 3, target: 'row-creators', title: <>Tap <b>All creators</b></>, body: 'The full list, one row per creator.' },
    { id: 'tiles', scene: 'creators', part: 3, target: 'tiles', look: true, next: C, title: 'The whole team in four numbers',
      body: 'Shoots filmed, no-shows, late returns and strikes, for everyone together.' },
    { id: 'period', scene: 'creators', part: 3, target: 'period-90', title: <>Tap <b>Last 90 days</b></>, body: 'Every number on the page follows the period you pick.' },
    { id: 'sortflags', scene: 'creators', part: 3, target: 'sort-flags', title: <>Tap <b>Most flags</b></>, body: 'The people who need a chat float to the top.' },
    { id: 'rowslook', scene: 'creators', part: 3, target: 'creatorlist', look: true, next: C, title: 'One row per creator',
      body: <>"<b>3 filmed of 5 booked</b>" and a bar: green is great, gold is fine, red needs attention. The tags are their flags. Paused means they can't book props or gear right now.</> },
    // 4 · Read a record
    intro(4, 'creators', "Numbers tell you something's off. The record tells you what happened."),
    { id: 'opendevon', scene: 'creators', part: 4, target: 'row-devon', title: <>Tap <b>Devon</b></> },
    { id: 'persontiles', scene: 'person', part: 4, target: 'persontiles', look: true, next: C, title: "Devon's numbers", body: 'Filmed, booked and coming up, for the same period.' },
    { id: 'flaglist', scene: 'person', part: 4, target: 'flaglist', look: true, next: C, title: 'Every flag, with the day',
      body: ul([['No-show', 'booked, never came'], ['Started late', 'checked in 15+ min after the start'], ['Ran over / mess', 'reported by the next creator'], ['Late props / gear', 'brought back late'], ['Strike', 'on their record, with the reason']]) },
    // 5 · Give a strike
    intro(5, 'person', "Devon brought the A7S kit back a day late. That's worth a strike. Here's how to give one fairly."),
    { id: 'givestrike', scene: 'person', part: 5, target: 'givestrike', title: <>Tap <b>Give a strike</b></> },
    { id: 'strikeform', scene: 'strikesheet', part: 5, target: 'strikeform', top: true, next: C, hint: 'Write a short reason first', title: 'What about, and why',
      body: <>Pick <b>Gear</b>, then write it plainly, e.g. <b>"Brought the A7S kit back a day late"</b>. Devon sees your words.</> },
    { id: 'strikesave', scene: 'strikesheet', part: 5, target: 'strikesave', title: <>Tap <b>Give the strike</b></> },
    { id: 'strikedone', scene: 'strikesheet', part: 5, target: 'strikedone', look: true, next: C, title: 'That was strike number two',
      body: `${s.strikeCount} strikes in ${s.strikeDays} days pauses prop and gear bookings for ${s.pauseDays} days, automatically. Devon gets a ping either way.` },
    { id: 'closestrike', scene: 'strikesheet', part: 5, target: 'closesheet', title: <>Tap <b>Done</b></> },
    { id: 'pausedlook', scene: 'person', part: 5, target: 'pausebanner', look: true, next: C, title: 'Paused',
      body: "Devon can still book house time, just not props or gear, until the date shown." },
    { id: 'quiz5', scene: 'person', part: 5, title: '', quiz: {
      q: `Devon gets ${s.strikeCount} strikes in ${s.strikeDays} days. What happens?`, options: ['Nothing until the owner checks', `Props and gear booking pause for ${s.pauseDays} days`, 'Their account is turned off'], correct: 1,
      explain: 'The pause is automatic. They can still book house time, and you can lift it early if it was a mistake.' } },
    // 6 · Second chances
    intro(6, 'person', "Turns out Devon's late return was a mix-up: the team was closed when they came by. Strikes should be fair, so you can take one back."),
    { id: 'removeone', scene: 'person', part: 6, target: 'removelink', title: <>Tap <b>Remove</b> next to the strike</> },
    { id: 'removeform', scene: 'removesheet', part: 6, target: 'removeform', top: true, next: C, hint: 'Write a short reason first', title: 'Say why it comes off',
      body: <>e.g. <b>"Cage was closed when they came back"</b>. It stays on the record as removed, with your reason.</> },
    { id: 'removesave', scene: 'removesheet', part: 6, target: 'removesave', title: <>Tap <b>Remove the strike</b></> },
    { id: 'removedone', scene: 'removesheet', part: 6, target: 'removedone', look: true, next: C, title: 'Back under the limit',
      body: "Devon has one strike again, so the automatic pause lifted by itself." },
    { id: 'closeremove', scene: 'removesheet', part: 6, target: 'closesheet', title: <>Tap <b>Done</b></> },
    { id: 'topause', scene: 'person', part: 6, target: 'pausebtn', title: <>Now tap <b>Pause bookings</b></>, body: 'For when you need to pause someone without a strike, e.g. after a serious chat.' },
    { id: 'pauseform', scene: 'pausesheet', part: 6, target: 'pauseform', top: true, next: C, hint: 'Write a short reason first', title: 'How long, and why',
      body: 'Pick the days and write the reason. A pause you start stays until it ends, or until someone lifts it.' },
    { id: 'pausesave', scene: 'pausesheet', part: 6, target: 'pausesave', title: <>Tap <b>Pause for {days} days</b></> },
    { id: 'closepause', scene: 'pausesheet', part: 6, target: 'closesheet', title: <>Tap <b>Done</b></> },
    { id: 'liftlook', scene: 'person', part: 6, target: 'pausebtn', look: true, next: C, title: 'Lift the pause, any time',
      body: "Changed your mind, or it's sorted? Lift the pause and they can book again straight away. (Practice: we'll leave it.)" },
    { id: 'quiz6', scene: 'person', part: 6, title: '', quiz: {
      q: 'You paused Devon by hand, then removed one of their strikes. Is the pause lifted?', options: ['Yes, automatically', 'No, a hand pause stays until it ends or is lifted', 'Only on Sundays'], correct: 1,
      explain: 'Removing a strike only lifts a pause that came from strikes. Yours stays until you (or the team) lift it.' } },
    // 7 · On the day
    intro(7, 'person', "Creators check in on the day with a photo of the set. When they don't, or when the house is left a mess, someone has to decide. That can be you."),
    { id: 'toschedule', scene: 'person', part: 7, target: 'nav-schedule', title: <>Tap <b>Schedule</b></> },
    { id: 'teamicon', scene: 'schedule', part: 7, target: 'teamicon', title: 'Tap the team button', body: 'Top right, the two people.' },
    { id: 'decide', scene: 'team', part: 7, target: 'decide', title: <>Jordan didn't check in. Tap <b>They filmed</b></>,
      body: `They had ${s.explainHours} hours to explain, and they did: their phone died. Riley saw them filming.` },
    { id: 'toreports', scene: 'team', part: 7, target: 'tab-reports', title: <>Tap <b>Reports</b></> },
    { id: 'reports', scene: 'team', part: 7, target: 'teamlist', look: true, next: C, title: 'Reports from the next creator',
      body: 'Ran over, left a mess. Read it, look at the photos, then Dismiss, or Strike for that person.' },
    { id: 'quiz7', scene: 'team', part: 7, title: '', quiz: {
      q: "The equipment team moves Riley's shoot because the house flooded. Does Riley get a strike?", options: ['Yes', 'No, team moves and cancels never count', 'Only on priority days'], correct: 1,
      explain: 'Strikes are for no-shows, late cancels by the creator, upheld reports, and ones you give with a reason.' } },
    // 8 · Hold the door
    intro(8, 'team', "New creator joining? You let them in. And you look after the booking rules everyone works by."),
    { id: 'toadmin8', scene: 'team', part: 8, target: 'nav-dashboard', title: <>Tap <b>Dashboard</b></> },
    { id: 'tousers', scene: 'admin', part: 8, target: 'row-users', title: <>Tap <b>Invite creators</b></> },
    { id: 'invitebtn', scene: 'users', part: 8, target: 'invitebtn', title: <>Tap <b>+ Invite</b></> },
    { id: 'inviteform', scene: 'invitesheet', part: 8, target: 'inviteform', top: true, next: C, hint: 'Type an email address first', title: 'Their Google email and name',
      body: <>Try <b>maya@example.com</b>. It must be the exact email they sign in to Google with. You can only invite <b>creators</b>.</> },
    { id: 'invitesave', scene: 'invitesheet', part: 8, target: 'invitesave', title: <>Tap <b>Invite as Creator</b></> },
    { id: 'invited', scene: 'invitesheet', part: 8, target: 'invited', look: true, next: C, title: 'Now send them the message',
      body: "The app gives you a ready-made message with the link. Paste it in a text or WhatsApp. (Practice: nobody was invited.)" },
    { id: 'closeinvite', scene: 'invitesheet', part: 8, target: 'closesheet', title: <>Tap <b>Done</b></> },
    { id: 'toadmin8b', scene: 'users', part: 8, target: 'nav-dashboard', title: <>Tap <b>Dashboard</b> again</> },
    { id: 'torules', scene: 'admin', part: 8, target: 'row-rules', title: <>Tap <b>Booking rules</b></> },
    { id: 'ruleslook', scene: 'rules', part: 8, target: 'notice', look: true, next: C, title: 'The deadlines everyone sees',
      body: `Props from the closet: ${b.leadTimeDays} open days ahead. New things to make or find: ${b.buildLeadDays}. Changes apply to everyone right away, so tap Save only when you're sure.` },
    { id: 'quiz8', scene: 'rules', part: 8, title: '', quiz: {
      q: 'A new arts department helper starts Monday. Who invites them?', options: ['You, as Arts department', 'The owner', 'They sign themselves up'], correct: 1,
      explain: 'You invite creators. Staff roles (arts, equipment, admin) are invited by the owner.' } },
    // 9 · Stay in the loop (real)
    intro(9, 'rules', "Last one, and it's real: turn on notifications so you hear about your own shoots, invites and anything about your bookings."),
    { id: 'toadmin9', scene: 'rules', part: 9, target: 'nav-dashboard', title: <>Tap <b>Dashboard</b></> },
    { id: 'toaccount', scene: 'admin', part: 9, target: 'myaccount', title: <>Tap <b>My account</b></> },
    { id: 'notify', scene: 'notify', part: 9, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications',
      body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card).' : 'Tap the gold button, then Allow when your phone asks.' },
    { id: 'cheat', scene: 'cheat', title: '' },
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
  const period = at('period') && past('period') ? '90' : '30'
  const byFlags = past('sortflags')
  const struck = past('strikesave')            // strike 2 given
  const removed = past('removesave')           // that strike taken back
  const handPaused = past('pausesave')
  const autoPaused = struck && !removed
  const paused = autoPaused || handPaused
  const strikes = struck && !removed ? 2 : 1
  const pausedUntil = addDays(today, handPaused ? days : s.pauseDays)

  const header = (title: string, right?: ReactNode) => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
      <h1 className="font-display text-[34px] text-pt-text flex-1">{title}</h1>{right}
    </div>
  )
  const backBar = (label = '‹ Back') => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-2 py-2 flex items-center"><button {...T('back')} onClick={tap('back')} className="text-pt-accent text-[17px] px-2 py-1">{label}</button></div>
  )
  const card = (o: { t: string; sub: string; what: string; pills: ReactNode; late?: boolean; target?: string }) => (
    <button key={o.t} {...(o.target ? T(o.target) : {})} onClick={o.target ? tap(o.target) : undefined}
      className={`w-full text-left bg-pt-surface rounded-2xl p-4 space-y-1 ${o.late ? 'ring-1 ring-red-400/60' : ''}`}>
      <div className="flex items-center justify-between gap-2"><p className="text-pt-text font-semibold truncate">{o.t}</p><div className="flex gap-1 shrink-0">{o.pills}</div></div>
      <p className="text-pt-muted text-sm">{o.sub}</p>
      <p className="text-pt-muted text-xs truncate">{o.what}</p>
    </button>
  )
  const sheetDone = (text: ReactNode) => (
    <div className="space-y-4 text-center py-2">
      <p className="text-pt-text text-[15px]">{text}</p>
      <button {...T('closesheet')} onClick={tap('closesheet')} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
    </div>
  )
  const chips = (list: [string, string][], value: string, on: (v: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {list.map(([v, l]) => <button key={v} onClick={() => on(v)} className={`px-3 py-2 rounded-full text-sm ${value === v ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-muted shadow-hairline'}`}>{l}</button>)}
    </div>
  )
  const reason = (value: string, set: (v: string) => void, placeholder: string) => (
    <textarea value={value} onChange={e => set(e.target.value.slice(0, 300))} rows={3} placeholder={placeholder} className={`${field} resize-none`} />
  )
  const notifyCard = (
    <div {...T('notifycard')} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent"><Icon name="bell" className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0"><b className="block text-pt-text">Notifications</b><span className="block text-pt-muted text-xs">Your shoots, invites from friends, things due back</span></span>
      </div>
      {push === 'on' ? <p className="text-green-400 font-semibold">✓ Notifications are on</p>
        : push === 'off' ? <button disabled={pushBusy} onClick={turnOn} className={btnGold}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
        : push === 'needs-install' ? (
          <ol className="space-y-2 text-[14px] text-pt-text list-decimal list-inside">
            <li>Tap <b>Share</b> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b>, then Add</li>
            <li>Open <b>Prime Capitol</b> from your Home Screen</li><li>Dashboard → My account → <b>Turn on</b></li>
          </ol>
        ) : push === 'blocked' ? <p className="text-pt-muted text-sm">Notifications are blocked for this app. {isIOS() ? 'iPhone Settings → Notifications → Prime Capitol → Allow Notifications.' : 'Tap the lock or ⓘ next to the web address → Notifications → Allow.'}</p>
        : <p className="text-pt-muted text-sm">This browser can't show notifications. Open the app on your phone to turn them on.</p>}
      {pushMsg && <p className="text-amber-300 text-xs">Couldn't turn them on: {pushMsg} You can try again later from Dashboard → My account.</p>}
    </div>
  )

  // Practice creators. Devon is the one who needs attention.
  const people = [
    { key: 'devon', name: 'Devon', filmed: 3, booked: 5, up: 1, flags: [['1 no-show', true], ['1 late gear', false], ['1 ran over', false], [`${strikes} strike${strikes > 1 ? 's' : ''}`, true]] as [string, boolean][], paused },
    { key: 'jordan', name: 'Jordan', filmed: period === '90' ? 9 : 4, booked: period === '90' ? 10 : 5, up: 2, flags: [['1 no check-in', false]] as [string, boolean][], paused: false },
    { key: 'riley', name: 'Riley', filmed: period === '90' ? 14 : 6, booked: period === '90' ? 14 : 6, up: 3, flags: [] as [string, boolean][], paused: false },
    { key: 'maya', name: 'Maya', filmed: 2, booked: 2, up: 1, flags: [] as [string, boolean][], paused: false },
  ]
  const ordered = byFlags ? people : [...people].sort((a, b) => b.filmed - a.filmed)
  const flagPills = (f: [string, boolean][]) => !f.length ? <span className="text-xs rounded-full px-2 py-1 bg-green-500/15 text-green-300">No flags ✓</span>
    : <span className="flex flex-wrap gap-1">{f.map(([t, serious]) => <span key={t} className={`text-xs rounded-full px-2 py-1 ${serious ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200'}`}>{t}</span>)}</span>
  const periodChips = (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {[['30', 'Last 30 days'], ['month', 'This month'], ['90', 'Last 90 days']].map(([v, l]) => <button key={v} {...T(`period-${v}`)} onClick={tap(`period-${v}`)} className={`shrink-0 px-3 py-1 rounded-full text-sm ${period === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{l}</button>)}
    </div>
  )

  const scenes: Record<Scene, () => ReactNode> = {
    hello: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          <div className="chapter-rise relative self-center"><span className="absolute inset-0 rounded-full blur-2xl bg-pt-accent/25" /><BrandMark className="relative w-28 text-white" title="" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '100ms' }}>Welcome aboard{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '170ms' }}>You look after the creators: who's filming, who's slipping, and keeping it fair. The app does the counting for you.</p>
          </div>
          <div className="space-y-3">
            {([['people', 'How much each creator films, and every flag on their record'], ['stop', 'Strikes and pauses, always with a reason'], ['eye', 'Every queue and the schedule, to look at (not to change)']] as [IconName, string][]).map(([i, t], n) => (
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
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '170ms' }}>I'll show you how to keep an eye on things, read a creator's record, hand out strikes fairly (and take them back), and let new creators in.</p>
          </div>
          <div className="chapter-rise grid grid-cols-3 gap-2 text-center" style={{ animationDelay: '240ms' }}>
            {[[String(ADMIN_CHAPTERS.length), 'chapters'], ['~6', 'minutes'], [String(ADMIN_CHAPTERS.length), 'badges']].map(([n, l]) => <div key={l} className="rounded-2xl bg-pt-surface shadow-hairline py-3"><b className="block text-[24px] text-pt-accent">{n}</b><span className="text-pt-muted text-sm">{l}</span></div>)}
          </div>
          <p className="chapter-rise text-[15px] text-pt-muted text-center" style={{ animationDelay: '300ms' }}>It's all practice: made-up creators, requests and strikes. Nobody gets a strike or an invite here. Tap what glows, and Back if you miss something.</p>
        </div>
        <div className="chapter-rise space-y-2 pb-4" style={{ animationDelay: '360ms' }}>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          <button onClick={back} className="w-full py-2 text-pt-muted text-[15px]">Back</button>
        </div>
      </div>
    ),
    queue: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          <div className="py-2"><h1 className="font-display text-[34px] text-pt-text">Props queue</h1></div>
          <div {...T('queuetabs')} className="flex gap-2 overflow-x-auto no-scrollbar">
            {['Today (2)', 'To prepare (3)', 'Ready (1)', 'Out (2)', 'Returns (0)', 'Done'].map((l, n) => <span key={l} className={`shrink-0 px-3 py-1 rounded-full text-sm ${n === 0 ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</span>)}
          </div>
        </div>
        <div className="p-4 space-y-2">
          {card({ t: 'My Roommate Is A Spy', sub: `Was due back ${formatDay(addDays(today, -1))} · Devon`, what: 'Spy sunglasses, 2× Walkie-talkie', pills: <Pill tone="taken">Late</Pill>, late: true, target: 'reqcard' })}
          {card({ t: 'Ghost Hunt at 3 AM', sub: 'Pickup today · Jordan', what: '6× Candles, Ouija board', pills: <Pill tone="info">Packed & ready</Pill> })}
        </div>
      </div>
    ),
    request: () => (
      <div className="pb-10">
        {backBar()}
        <div className="px-4 space-y-4">
          <div {...T('reqhead')} className="space-y-3">
            <div className="space-y-1">
              <div className="flex gap-2"><Pill tone="warn">Picked up</Pill><Pill tone="taken">Late</Pill></div>
              <h1 className="font-display text-[34px] text-pt-text leading-tight">My Roommate Is A Spy</h1>
              <p className="text-pt-muted">{formatDay(addDays(today, -2), { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <p className="text-pt-muted text-sm">Booked by <span className="text-pt-accent">Devon</span></p>
            </div>
            <div className="bg-red-500/10 rounded-xl px-4 py-3 text-red-200 text-sm">Late: was due back {formatDay(addDays(today, -1))} by 10 AM.</div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {[['Spy sunglasses', 1], ['Walkie-talkie', 2]].map(([n, q]) => <div key={n as string} className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-text">{n}</span><span className="text-pt-muted">×{q}</span></div>)}
            </div>
          </div>
          <div {...T('reqhistory')} className="space-y-1 pt-2">
            <p className="text-pt-muted text-xs px-1">History</p>
            {[[`${formatDay(addDays(today, -6))}, 4:10 PM`, 'Requested by Devon'], [`${formatDay(addDays(today, -3))}, 11:02 AM`, 'Packed & ready (2 photos) by Farrell'],
              [`${formatDay(addDays(today, -2))}, 9:40 AM`, 'Picked up (Devon signed)'], [`${formatDay(addDays(today, -1))}, 10:00 AM`, 'Due back: not returned yet']].map(([t, a]) => <p key={t} className="text-pt-muted text-sm px-1">{t} · {a}</p>)}
          </div>
        </div>
      </div>
    ),
    gearq: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          <div className="py-2"><h1 className="font-display text-[34px] text-pt-text">Gear queue</h1></div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {['Today (2)', 'Out (2)', 'To check in (0)', 'Upcoming', 'Past'].map((l, n) => <span key={l} className={`shrink-0 px-3 py-1 rounded-full text-sm ${n === 1 ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</span>)}
          </div>
        </div>
        <div {...T('gearlist')} className="p-4 space-y-2">
          {card({ t: 'My Roommate Is A Spy', sub: `${formatDay(addDays(today, -1))} · ${fmtHours(10 * 60, 12 * 60)} · Devon`, what: 'Sony A7S III kit', pills: <><Pill tone="taken">Late</Pill><Pill tone="warn">Out</Pill></>, late: true })}
          {card({ t: 'Ghost Hunt at 3 AM', sub: `${formatDay(today)} · ${fmtHours(13 * 60, 15 * 60)} · Jordan`, what: 'Interview light kit', pills: <Pill tone="warn">Out</Pill> })}
        </div>
      </div>
    ),
    admin: () => (
      <div className="pb-6">
        {header('Dashboard')}
        <div className="px-4 space-y-4">
          <div {...T('dashpreview')} className="space-y-3">
            <div className="flex bg-pt-surface rounded-full p-0.5 text-sm w-fit">{['This month', 'Last month', '12 weeks'].map((l, n) => <span key={l} className={`px-3.5 py-1.5 rounded-full whitespace-nowrap ${n === 0 ? 'bg-pt-accent text-stone-900 font-medium' : 'text-pt-muted'}`}>{l}</span>)}</div>
            <div className="grid grid-cols-3 gap-2">
              {([['1', 'Needs attention', 'bg-red-500/10 text-red-300'], ['1', 'Behind', 'bg-amber-500/10 text-amber-200'], ['2', 'On track', 'bg-green-500/10 text-green-300']] as [string, string, string][]).map(([n, l, cl]) => (
                <div key={l} className={`rounded-2xl p-3 ${cl.split(' ')[0]}`}><span className={`block text-[28px] font-bold leading-none tabular-nums ${cl.split(' ')[1]}`}>{n}</span><span className="block text-pt-text text-[13px] mt-1">{l}</span></div>
              ))}
            </div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {([['Devon', 'Needs attention', 'bg-red-500/15 text-red-300', 'bg-red-300', 1, 0, '1 no-show · 1 short of the minimum'], ['Riley', 'Behind', 'bg-amber-500/15 text-amber-200', 'bg-amber-200', 1, 1, '1 short of the minimum'],
                ['Jordan', 'On track', 'bg-green-500/15 text-green-300', 'bg-green-300', 4, 0, 'showed up 100%']] as [string, string, string, string, number, number, string][]).map(([n, l, pill, fill, f, cm, why]) => (
                <div key={n} className="flex items-center gap-3 px-3 py-3">
                  <span className="w-10 h-10 rounded-full bg-pt-border grid place-items-center text-pt-text font-semibold shrink-0">{n[0]}</span>
                  <span className="flex-1 min-w-0 space-y-1.5">
                    <span className="flex items-center gap-2"><b className="flex-1 text-pt-text text-[15px]">{n}</b><span className={`text-xs font-medium rounded-full px-2 py-0.5 ${pill}`}>{l}</span></span>
                    <span className="relative block h-2 rounded-full bg-white/[0.08] overflow-hidden"><i className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${f * 25}%` }} />{cm > 0 && <i className="absolute inset-y-0 bg-white/25" style={{ left: `${f * 25}%`, width: `${cm * 25}%` }} />}</span>
                    <span className="flex gap-2 text-xs"><span className="text-pt-text"><b>{f}</b> of 4 filmed{cm ? ` · ${cm} booked` : ''}</span><span className={l === 'On track' ? 'text-pt-muted' : pill.split(' ')[1]}>{why}</span></span>
                  </span>
                </div>
              ))}
            </div>
            <div {...T('dashlinks')} className="grid grid-cols-2 gap-2"><span className="py-3 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold text-center">Open analytics</span><span className="py-3 rounded-2xl bg-pt-surface shadow-hairline text-pt-text font-semibold text-center">Settings sheet</span></div>
            <div className="bg-amber-500/10 rounded-2xl px-3 py-3 flex items-center gap-3"><span className="min-w-[32px] h-8 px-2 rounded-full grid place-items-center text-sm font-bold bg-red-500/20 text-red-300">{decided ? 0 : 1}</span><span className="flex-1 text-pt-text text-[15px]">Missed check-in to decide</span><span className="text-pt-accent">›</span></div>
          </div>
          <div className="flex items-baseline justify-between pt-1"><h2 className="text-pt-text text-[20px] font-semibold tracking-tight">Needs attention</h2>
            <button {...T('row-creators')} onClick={tap('row-creators')} className="text-pt-accent text-sm tap">All creators ›</button></div>
          <div className="bg-pt-surface rounded-2xl p-3 space-y-2"><span className="flex items-center gap-3"><Avatar name="Devon" /><span className="flex-1 min-w-0"><b className="block text-pt-text">Devon</b><span className="block text-pt-muted text-xs">3 filmed of 5 booked</span></span></span>{flagPills(people[0].flags)}</div>
          <h2 className="text-pt-text text-[20px] font-semibold tracking-tight pt-2">Admin tools</h2>
          <div {...T('adminlist')} className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
            {[['', 'Analytics', 'Weekly and monthly filming, averages, every flag by type, the teams'], ['', 'Creators', 'How much each creator films, every flag, and strikes and pauses'], ['', 'Settings sheet', 'Every rule the app runs on, and who can change it'], ['', 'Requests calendar', 'Every props request by shoot day'],
              ['', 'Schedule team', 'Missed check-ins and reports to decide, creators booked vs filmed'],
              ['', 'Activity', 'Everything that happened, with who and when'], ['users', 'Invite creators', 'Add creators or turn their access off'],
              ['rules', 'Booking rules', 'How far ahead props must be booked; closed days; turnaround days'], ['', 'Admin tour', 'Practise all of this again'],
              ['', 'Help', 'How do I…? Booking, props, gear, check-in, sign-in'], ['myaccount', 'My account', 'Your photo and channel name; sign out']].map(([k, t, d]) => {
              const target = k === 'myaccount' ? 'myaccount' : k ? `row-${k}` : ''
              return (
                <button key={t} {...(target ? T(target) : {})} onClick={target ? tap(target) : undefined} className="w-full flex items-center gap-3 px-4 py-4 text-left">
                  <div className="flex-1 min-w-0"><p className="text-pt-text font-medium">{t}</p><p className="text-pt-muted text-xs mt-0.5">{d}</p></div>
                  <span className="text-pt-muted">›</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    ),
    creators: () => {
      const total = (f: (p: typeof people[number]) => number) => people.reduce((n, p) => n + f(p), 0)
      const tiles: [string, number, string][] = [['Shoots filmed', total(p => p.filmed), 'text-pt-text'], ['No-shows', 1, 'text-red-300'], ['Late returns', 1, 'text-amber-200'], ['Strikes', strikes, 'text-red-300']]
      return (
        <div className="min-h-full pb-10">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
            <span className="text-pt-accent text-[17px] py-1 inline-block">‹ Back</span>
            <h1 className="font-display text-[34px] text-pt-text py-1">Creators</h1>
            {periodChips}
          </div>
          <div className="px-4 space-y-4">
            <div {...T('tiles')} className="grid grid-cols-2 gap-2">
              {tiles.map(([t, n, cls]) => <div key={t} className="bg-pt-surface rounded-2xl p-3"><p className={`text-[28px] font-bold leading-none tabular-nums ${n ? cls : 'text-pt-text'}`}>{n}</p><p className="text-pt-muted text-xs mt-1">{t}</p></div>)}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-pt-muted text-xs">{people.length} creators · tap one for every flag</p>
              <div className="flex bg-pt-surface rounded-full p-0.5 text-xs">
                {([['filming', 'Most filming'], ['flags', 'Most flags']] as const).map(([v, l]) => <button key={v} {...T(`sort-${v}`)} onClick={tap(`sort-${v}`)} className={`px-3 py-1 rounded-full ${(v === 'flags') === byFlags ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>)}
              </div>
            </div>
            <div {...T('creatorlist')} className="space-y-2">
              {ordered.map(c => {
                const rate = c.booked ? c.filmed / c.booked : 0
                return (
                  <button key={c.key} {...T(`row-${c.key}`)} onClick={tap(`row-${c.key}`)} className="w-full text-left bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
                    <span className="flex items-center gap-3">
                      <Avatar name={c.name} />
                      <span className="flex-1 min-w-0"><b className="block text-pt-text truncate">{c.name}</b><span className="block text-pt-muted text-xs">{c.filmed} filmed of {c.booked} booked · {c.up} coming up</span></span>
                      {c.paused && <span className="text-xs rounded-full px-2 py-1 bg-red-500/20 text-red-300 shrink-0">Paused</span>}
                      <span className="text-pt-muted">›</span>
                    </span>
                    <span className="block h-1.5 rounded-full bg-pt-border overflow-hidden"><i className={`block h-full rounded-full ${rate >= 0.9 ? 'bg-green-400' : rate >= 0.7 ? 'bg-pt-accent' : 'bg-red-400'}`} style={{ width: `${Math.round(rate * 100)}%` }} /></span>
                    {flagPills(c.flags)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )
    },
    person: () => {
      const strikeRows: { id: string; text: string; removed?: boolean; target?: string }[] = [
        { id: 's1', text: `${formatDay(addDays(today, -12))} · No-show at ${s.houses.cliff1.name}` },
        ...(struck ? [{ id: 's2', text: `${formatDay(today)} · Gear: ${strikeWhy.trim() || 'Brought the A7S kit back a day late'}`, removed, target: removed ? undefined : 'removelink' }] : []),
      ]
      const flags: [string, string, boolean][] = [
        [formatDay(addDays(today, -12)), `No-show at ${s.houses.cliff1.name} (${fmtSlot(9 * 60, s.slotMinutes)})`, true],
        [formatDay(addDays(today, -8)), `Ran over 25 min · reported by Riley`, false],
        [formatDay(addDays(today, -1)), 'Late gear: Sony A7S III kit (still out)', false],
      ]
      return (
        <div className="pb-10">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-center gap-3"><span className="text-pt-accent text-[17px] py-1">‹ Back</span><h1 className="text-pt-text text-xl font-semibold">Devon</h1></div>
          <div className="px-4 space-y-4">
            <div><p className="text-pt-muted text-sm">devon@example.com</p><p className="text-pt-accent text-sm">Creator</p></div>
            {periodChips}
            {paused && (
              <div {...T('pausebanner')} className="bg-red-500/10 rounded-2xl px-4 py-3">
                <p className="text-red-200 font-medium">Paused until {formatDay(pausedUntil)}</p>
                <p className="text-pt-text/80 text-sm">{handPaused ? `Paused by ${first || 'you'}: ${pauseWhy.trim() || 'Two no-shows in a row'}` : `${s.strikeCount} strikes in ${s.strikeDays} days`}. Props and gear only; house time still OK.</p>
              </div>
            )}
            <div className="flex gap-2">
              <button {...T('givestrike')} onClick={tap('givestrike')} className="flex-1 py-3 rounded-xl bg-red-500/15 text-red-300 font-semibold text-sm">Give a strike</button>
              <button {...T('pausebtn')} onClick={tap('pausebtn')} className="flex-1 py-3 rounded-xl bg-pt-surface text-pt-text font-semibold text-sm">{paused ? 'Lift the pause' : 'Pause bookings'}</button>
            </div>
            <div {...T('persontiles')} className="grid grid-cols-3 gap-2">
              {[[3, 'filmed'], [5, 'booked'], [1, 'coming up']].map(([n, l]) => <div key={l} className="bg-pt-surface shadow-hairline rounded-2xl p-3"><p className="text-[28px] font-bold leading-none tabular-nums text-pt-text">{n}</p><p className="text-pt-muted text-xs mt-1">{l}</p></div>)}
            </div>
            <div {...T('flaglist')} className="space-y-2">
              {flagPills(people[0].flags)}
              {flags.map(([d, t, serious]) => (
                <div key={t} className="bg-pt-surface rounded-2xl px-4 py-3 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${serious ? 'bg-red-400' : 'bg-amber-300'}`} />
                  <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px]">{t}</span><span className="block text-pt-muted text-xs">{d}</span></span>
                </div>
              ))}
              <p className="text-pt-muted text-xs px-1 pt-2">Strikes</p>
              {strikeRows.map(r => (
                <div key={r.id} className="bg-pt-surface rounded-2xl px-4 py-3 flex items-center gap-3">
                  <span className={`flex-1 min-w-0 text-[15px] ${r.removed ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{r.text}</span>
                  {r.removed ? <span className="text-pt-muted text-xs shrink-0">Removed</span>
                    : r.target ? <button {...T(r.target)} onClick={tap(r.target)} className="text-pt-accent text-sm tap shrink-0">Remove</button> : null}
                </div>
              ))}
              {removed && <p className="text-pt-muted text-xs px-1">Removed by {first || 'you'}: {removeWhy.trim() || 'Cage was closed when they came back'}</p>}
            </div>
          </div>
        </div>
      )
    },
    strikesheet: () => (
      <>
        {scenes.person()}
        <BottomSheet open locked onClose={() => {}} title="Strike for Devon">
          {past('strikesave') ? sheetDone(<span {...T('strikedone')}>Strike given. That's 2, so Devon's prop and gear bookings are now paused.</span>) : (
            <div className="space-y-4">
              <div {...T('strikeform')} className="space-y-4">
                <p className="text-pt-muted text-sm">It goes on Devon's record, with your reason, and counts toward the automatic pause.</p>
                {chips(ABOUT, about, v => { if (step.id === 'strikeform') setAbout(v) })}
                {reason(strikeWhy, v => { if (step.id === 'strikeform') setStrikeWhy(v) }, 'Why? e.g. "Brought the A7S kit back a day late"')}
              </div>
              <button {...T('strikesave')} onClick={tap('strikesave')} disabled={strikeWhy.trim().length < 3} className="w-full py-4 rounded-2xl bg-red-500/80 text-white font-semibold disabled:opacity-40">Give the strike</button>
            </div>
          )}
        </BottomSheet>
      </>
    ),
    removesheet: () => (
      <>
        {scenes.person()}
        <BottomSheet open locked onClose={() => {}} title="Remove this strike">
          {past('removesave') ? sheetDone(<span {...T('removedone')}>Removed. Devon has 1 strike now, and the pause is lifted.</span>) : (
            <div className="space-y-4">
              <div {...T('removeform')} className="space-y-4">
                <p className="text-pt-text text-[15px]">{formatDay(today)} · Gear: {strikeWhy.trim() || 'Brought the A7S kit back a day late'}</p>
                <p className="text-pt-muted text-sm">It stays on the record as removed, with your reason. If Devon drops below the limit, an automatic pause lifts too.</p>
                {reason(removeWhy, v => { if (step.id === 'removeform') setRemoveWhy(v) }, 'Why does it come off?')}
              </div>
              <button {...T('removesave')} onClick={tap('removesave')} disabled={removeWhy.trim().length < 3} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Remove the strike</button>
            </div>
          )}
        </BottomSheet>
      </>
    ),
    pausesheet: () => (
      <>
        {scenes.person()}
        <BottomSheet open locked onClose={() => {}} title="Pause Devon's bookings">
          {past('pausesave') ? sheetDone(<>Paused until {formatDay(addDays(today, days))}.</>) : (
            <div className="space-y-4">
              <div {...T('pauseform')} className="space-y-4">
                <p className="text-pt-muted text-sm">Devon can still book house time, but not props or gear, until the pause ends.</p>
                {chips([3, 7, 14, 30].map(d => [String(d), `${d} days`]), String(days), v => { if (step.id === 'pauseform') setDays(Number(v)) })}
                {reason(pauseWhy, v => { if (step.id === 'pauseform') setPauseWhy(v) }, 'Why?')}
              </div>
              <button {...T('pausesave')} onClick={tap('pausesave')} disabled={pauseWhy.trim().length < 3} className="w-full py-4 rounded-2xl bg-red-500/80 text-white font-semibold disabled:opacity-40">Pause for {days} days</button>
            </div>
          )}
        </BottomSheet>
      </>
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
        </div>
        <div className="px-4 pt-4 space-y-2">
          <p className="text-pt-muted text-sm">{formatDay(today, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.houses.cliff1.name}</p>
          {[[9 * 60, 'Jordan'], [11 * 60, ''], [13 * 60, 'Riley'], [15 * 60, 'Maya']].map(([t, who]) => (
            <div key={t as number} className={`w-full flex items-center gap-3 p-3 rounded-2xl border ${who ? 'bg-pt-surface border-transparent' : 'bg-pt-surface border-pt-accent/35'}`}>
              <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums whitespace-nowrap">{fmtSlot(t as number, s.slotMinutes)}</span>
              {who && <Avatar name={who as string} />}
              <span className="flex-1 min-w-0 font-semibold truncate">{who ? <span className="text-pt-text">{who}</span> : <span className="text-pt-accent">Free</span>}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    team: () => {
      const tab = past('toreports') ? 'reports' : 'checkins'
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
                    <button {...T('decide')} onClick={() => { if (step.id === 'decide') { setDecided(true); advance() } }} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm">They filmed</button>
                    <span className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm text-center">No-show · strike</span>
                  </div>
                </div>
              )}
            </>}
            {tab === 'reports' && <>
              <p className="text-pt-muted text-sm">Sent by the next creator at check-in. Dismiss, or uphold it to give that person a strike.</p>
              <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-3"><Avatar name="Devon" /><div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">Riley reported Devon</p><p className="text-pt-muted text-xs">{formatDay(addDays(today, -8))} · {s.houses.cliff1.name}</p></div><Pill tone="warn">Report</Pill></div>
                <p className="text-pt-text text-sm">Ran over 25 min · Left the house a mess</p>
                <p className="text-pt-text text-sm bg-pt-bg rounded-xl px-3 py-2">“Still packing up when I arrived, pizza boxes in the kitchen.”</p>
                <div className="flex gap-2"><span className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm text-center">Dismiss</span><span className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm text-center">Strike for Devon</span></div>
              </div>
            </>}
          </div>
        </div>
      )
    },
    users: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
          <span className="text-pt-text py-1">‹</span><h1 className="font-display text-xl text-pt-text flex-1">People</h1>
          <button {...T('invitebtn')} onClick={tap('invitebtn')} className="text-pt-accent text-sm font-medium tap">+ Invite</button>
        </div>
        <div className="px-4 pt-2 space-y-2">
          {[...(past('invitesave') ? [[invitee, 'Creator · invited, not signed in yet']] : []), ['Jordan', 'Creator'], ['Riley', 'Creator'], ['Devon', 'Creator']].map(([n, r]) => (
            <div key={n} className="bg-pt-surface shadow-hairline rounded-2xl p-3 flex items-center gap-3"><Avatar name={n} /><div className="min-w-0 flex-1"><p className="text-pt-text font-medium truncate">{n}</p><p className="text-pt-muted text-xs">{r}</p></div><span className="text-pt-muted">›</span></div>
          ))}
        </div>
      </div>
    ),
    invitesheet: () => (
      <>
        {scenes.users()}
        <BottomSheet open locked onClose={() => {}} title={past('invitesave') ? 'Invited ✓' : 'Invite someone'}>
          {past('invitesave') ? (
            <div className="space-y-4">
              <div {...T('invited')} className="space-y-3">
                <p className="text-pt-text text-[15px]"><b>{invitee}</b> can now sign in as <b>Creator</b>.</p>
                <p className="text-pt-muted text-sm">The app doesn't send emails yet, so send them this message (text, WhatsApp, email…):</p>
                <pre className="whitespace-pre-wrap bg-pt-bg shadow-hairline rounded-xl px-3 py-3 text-pt-text text-[13px] font-sans">{`Hi ${invName.trim().split(' ')[0] || 'there'}! You're invited to Prime Capitol, where we book shoot times, props and gear.\nOpen https://proptracker.arbcreative.co and sign in with Google using ${invEmail.trim() || 'maya@example.com'}.`}</pre>
                <span className="block w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold text-center">Send the invite message</span>
              </div>
              <button {...T('closesheet')} onClick={tap('closesheet')} className="w-full py-3 rounded-xl bg-pt-bg shadow-hairline text-pt-text font-medium">Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div {...T('inviteform')} className="space-y-4">
                <input value={invEmail} onChange={e => step.id === 'inviteform' && setInvEmail(e.target.value.slice(0, 120))} placeholder="Email address *" type="email" inputMode="email" autoCapitalize="none" className={field} />
                <input value={invName} onChange={e => step.id === 'inviteform' && setInvName(e.target.value.slice(0, 60))} placeholder="Name (optional)" className={field} />
                <div><p className="text-pt-muted text-xs mb-2">Access</p><span className="inline-block px-3 py-2 rounded-full text-sm bg-pt-accent text-stone-900 font-semibold">Creator</span><p className="text-pt-muted text-xs mt-2">Books shoot times and adds props and gear to their shoots.</p></div>
              </div>
              <button {...T('invitesave')} onClick={tap('invitesave')} disabled={!validEmail(invEmail)} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Invite as Creator</button>
            </div>
          )}
        </BottomSheet>
      </>
    ),
    rules: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3"><span className="text-pt-text py-1">‹</span><h1 className="font-display text-xl text-pt-text">Booking rules</h1></div>
        <div className="px-4 pt-4 pb-8 space-y-6">
          <div {...T('notice')} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
            <p className="text-pt-text font-medium">Notice needed</p>
            <p className="text-pt-muted text-sm">Creators must ask at least this many open days before the shoot day. The arts department can always book sooner.</p>
            {[['Props we have', b.leadTimeDays], ['New props (make or find)', b.buildLeadDays]].map(([l, v]) => (
              <div key={l as string} className="flex items-center gap-3"><span className="text-pt-text text-sm w-36">{l}</span><span className="w-16 text-center bg-pt-bg shadow-hairline rounded-xl py-2 text-pt-text">{v}</span><span className="text-pt-muted">days</span></div>
            ))}
          </div>
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
            <p className="text-pt-text font-medium">Days the prop room is closed</p>
            <div className="grid grid-cols-7 gap-1">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w, i) => <span key={w} className={`py-2 rounded-xl text-xs font-medium text-center ${b.closedWeekdays.includes(i) ? 'bg-red-500/25 text-red-200 border border-red-500/40' : 'bg-pt-bg shadow-hairline text-pt-text'}`}>{w}</span>)}</div>
          </div>
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
            <p className="text-pt-text font-medium">Turnaround</p>
            <p className="text-pt-muted text-sm">Open days after a shoot before the same item can go out again, e.g. extra days for washing costumes.</p>
          </div>
          <span className="block w-full py-4 rounded-2xl bg-pt-accent/40 text-stone-900 font-semibold text-center">Save</span>
        </div>
      </div>
    ),
    notify: () => (
      <div className="pb-6">
        {header('Account')}
        <div className="px-4 pt-2 pb-8 space-y-6">
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 flex items-center gap-4">
            <Avatar email={profile.email} name={name} size={64} />
            <span className="min-w-0"><b className="block text-pt-text truncate">{name}</b><span className="block text-pt-muted text-xs truncate">{profile.email}</span><span className="block text-pt-accent text-sm">Admin</span></span>
          </div>
          {notifyCard}
        </div>
      </div>
    ),
    cheat: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Your cheat sheet</h1>
        <div className="flex items-center gap-3"><Cap size={36} /><p className="text-[15px] text-pt-text/85">Your job in six lines. Replay it from Dashboard → Admin tour any time.</p></div>
        {([
          ['eye', 'Queues and the schedule are for looking. The arts department and the equipment team do the changing.'],
          ['people', 'Your Dashboard ranks every creator, worst first: Needs attention, Behind or On track, against the minimum of 4 shoots a month. Tap anyone for their report card; Back zooms out; the table icon breaks it all down.'],
          ['stop', `A strike needs a reason the creator can read. ${s.strikeCount} strikes in ${s.strikeDays} days pause props and gear for ${s.pauseDays} days.`],
          ['restore', 'Removing a strike keeps it on the record as removed. It lifts an automatic pause, never one you started.'],
          ['clock', `Missed check-in: wait for their explanation (${s.explainHours} hours), then They filmed or No-show. Reports: Dismiss or Strike.`],
          ['lock', "You invite creators only. Booking rules change for everyone at once. Settings and anything technical: ask the owner."],
        ] as [IconName, string][]).map(([i, t], n) => <div key={t} className="chapter-rise flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4" style={{ animationDelay: `${n * 60}ms` }}><Icon name={i} className="w-6 h-6 text-pt-accent shrink-0" /><p className="text-[16px] text-pt-text">{t}</p></div>)}
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8 text-center">
          <div className="relative self-center"><Confetti count={40} /><Cap size={96} className="cap-bob" /></div>
          <div className="space-y-3">
            <h1 className="chapter-rise font-display text-[34px] leading-[1.05] font-extrabold tracking-tight" style={{ animationDelay: '120ms' }}>You're all set{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85" style={{ animationDelay: '190ms' }}>You can read any creator's record, be fair with strikes, and let the right people in. That's the job.</p>
          </div>
          <BadgeWall chapters={ADMIN_CHAPTERS} />
        </div>
        <div className="pb-4"><button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">{required ? "Let's get to work" : 'Done'}</button></div>
      </div>
    ),
  }

  // The admin's real tab bar (Dashboard / Queue / Gear / Schedule / Props).
  const TAB: Partial<Record<Scene, Tab>> = { queue: 'Queue', request: 'Queue', gearq: 'Gear', admin: 'Dashboard', creators: 'Dashboard', person: 'Dashboard', strikesheet: 'Dashboard',
    removesheet: 'Dashboard', pausesheet: 'Dashboard', schedule: 'Schedule', team: 'Schedule', users: 'Dashboard', invitesheet: 'Dashboard', rules: 'Dashboard', notify: 'Dashboard' }
  const lit = TAB[step.scene]
  const inPart = STEPS.filter(x => x.part === step.part && !x.id.startsWith('part') && !x.quiz)
  const stepInPart = inPart.findIndex(x => x.id === step.id) + 1
  const nextDisabled = (step.id === 'strikeform' && strikeWhy.trim().length < 3) || (step.id === 'removeform' && removeWhy.trim().length < 3)
    || (step.id === 'pauseform' && pauseWhy.trim().length < 3) || (step.id === 'inviteform' && !validEmail(invEmail)) || (step.id === 'notify' && push === 'off' && !pushMsg)
  const navKey = (t: Tab) => `nav-${t.toLowerCase()}`

  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="Admin tour (practice)">
      <div className="flex-1 overflow-y-auto">{scenes[step.scene]()}</div>
      {lit && (
        <nav {...T('tabbar')} className="shrink-0 flex bg-black/80 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1)] pb-tabbar">
          {(['Dashboard', 'Queue', 'Gear', 'Schedule', 'Props'] as Tab[]).map(t => (
            <button key={t} {...T(navKey(t))} onClick={tap(navKey(t))}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs ${lit === t ? 'text-pt-accent' : 'text-pt-muted'}`}>
              {TAB_ICONS[t]}<span>{t}</span>
            </button>
          ))}
        </nav>
      )}
      {step.id.startsWith('part') && <ChapterCard key={step.id} n={step.part!} body={step.body} onGo={advance} onBack={back} chapters={ADMIN_CHAPTERS} />}
      {step.quiz && <QuizCard key={step.id} part={step.part!} {...step.quiz} onDone={advance} onBack={back} />}
      {step.part && !step.id.startsWith('part') && !step.quiz && <Spotlight stepKey={step.id} target={step.target} top={step.top} dim={!step.look} title={step.title} body={step.body} part={step.part}
        chapters={ADMIN_CHAPTERS} stepInPart={stepInPart || undefined} stepsInPart={stepInPart ? inPart.length : undefined} next={step.next} onNext={advance}
        nextDisabled={nextDisabled} disabledHint={step.hint} onBack={back} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
