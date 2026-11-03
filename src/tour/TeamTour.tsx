// Short hands-on tour for the team (owner, Nov 3: "I liked the interactive nature of the tutorial, especially for staff,
// we just needed to keep it shorter"). Replaces the long gear-team and admin tours. Same coach, chapter cards, quiz and
// badges (Spotlight + Fun.tsx), about 5 minutes, practice data only (nothing is approved, blocked or saved), except
// turning on notifications in the last chapter and marking the tour done.
//   Equipment: 1 Approve requests (+ a priority booking)  2 The gear log (check a return in)  3 Block time  4 Stay in the loop
//   Admin:     1 Your scoreboard  2 Approve requests (+ a priority booking)  3 Act on a flag  4 Stay in the loop
// When the real Requests, Gear log, schedule or flag screens change a lot, update the matching scene here.
import { useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useScheduleSettings, fmtSlot } from '../services/schedule'
import { pushState, turnOnPush, isIOS, type PushState } from '../services/push'
import { Pill, PieceChecklist } from '../components/GearUi'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { fmtTime } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { Cap, Confetti, ChapterCard, QuizCard, BadgeWall, type Chapter } from './Fun'
import { markTourDone, savedStep, saveStep } from './tourState'

export type TeamRole = 'equipment' | 'admin'
const CH: Record<TeamRole, Chapter[]> = {
  equipment: [
    { name: 'Approve the requests', badge: 'Gatekeeper', icon: 'calendar' },
    { name: 'The gear log', badge: 'Tracker', icon: 'camera' },
    { name: 'Block time', badge: 'Scheduler', icon: 'clock' },
    { name: 'Stay in the loop', badge: 'In the loop', icon: 'bell' },
  ],
  admin: [
    { name: 'Your scoreboard', badge: 'Analyst', icon: 'chart' },
    { name: 'Approve the requests', badge: 'Gatekeeper', icon: 'calendar' },
    { name: 'Act on a flag', badge: 'Fair judge', icon: 'eye' },
    { name: 'Stay in the loop', badge: 'In the loop', icon: 'bell' },
  ],
}
type Scene = 'hello' | 'requests' | 'priority' | 'log' | 'checkin' | 'schedule' | 'block' | 'score' | 'flag' | 'notify' | 'rules' | 'done'
interface Step { id: string; scene: Scene; part?: number; target?: string; title: ReactNode; body?: ReactNode; next?: string; hint?: string; top?: boolean; look?: boolean
  quiz?: { q: ReactNode; options: string[]; correct: number; explain: ReactNode } }
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const LINES = [{ key: 'cam', name: 'Sony FX3 body', unit: 1, of: 1 }, { key: 'lens', name: '24-70mm lens', unit: 1, of: 1 }, { key: 'bat', name: 'Battery charging case', unit: 1, of: 1 }, { key: 'mic', name: 'Rode shotgun mic', unit: 1, of: 1 }]

export default function TeamTour({ role, onFinish, onSkip, required = false }: { role: TeamRole; onFinish: () => void; onSkip?: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const s = useScheduleSettings()
  const chapters = CH[role]
  const kyle = s.instantBookers[0]?.name.split(' ')[0] || 'Kyle'
  const today = todayInStudio()
  let thu = addDays(today, 1); while (weekday(thu) !== 4) thu = addDays(thu, 1)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [blockWeeks, setBlockWeeks] = useState(1)
  const [note, setNote] = useState('')
  const [push, setPush] = useState<PushState>(() => { try { return pushState() } catch { return 'unsupported' } })
  const [pushBusy, setPushBusy] = useState(false), [pushMsg, setPushMsg] = useState('')
  const turnOn = () => { setPushBusy(true); setPushMsg(''); turnOnPush().then(setPush).catch(e => setPushMsg((e as Error).message || "That didn't work.")).finally(() => setPushBusy(false)) }

  const C = 'Continue'
  const intro = (n: number, scene: Scene, body: ReactNode): Step => ({ id: `part${n}`, scene, part: n, title: chapters[n - 1].name, body })
  const req = (n: number): Step[] => [
    intro(n, 'requests', 'Every creator booking is a request. It holds the slot so nobody else takes it, and waits for a yes or no from you.'),
    { id: 'reqlook', scene: 'requests', part: n, target: 'reqcard', look: true, next: C, title: 'Everything you need to decide',
      body: <>How much they film, strikes, who's before and after them, and flags like <b>10th this month</b> or <b>3 days in a row</b>. Cliff 1 Thursdays and Saturdays come with their <b>filming guideline</b>.</> },
    { id: 'approve', scene: 'requests', part: n, target: 'approve', title: <>Tap <b>Approve</b></>, body: 'Riley gets a notification. Deny needs a short reason they can read.' },
    { id: 'prio', scene: 'requests', part: n, target: 'priobtn', title: <>Now {kyle} needs Devon's slot. Tap <b>Priority booking…</b></>,
      body: `${kyle}'s own bookings are approved at once. When ${kyle} needs a slot someone else has, you decide what happens to them.` },
    { id: 'priomove', scene: 'priority', part: n, target: 'moveopt', top: true, title: <>Move Devon to <b>Cliff 2</b></>, body: 'Moving keeps their props and gear. Cancelling is the other option: no strike either way.' },
    { id: 'priobook', scene: 'priority', part: n, target: 'priook', top: true, title: <>Tap <b>Book it for {kyle}</b></>, body: <>Devon gets a neutral "schedule change" notice. If you'd cancelled instead, their next request would be first in line.</> },
  ]
  const STEPS: Step[] = role === 'equipment' ? [
    { id: 'hello', scene: 'hello', title: '' },
    ...req(1),
    { id: 'quiz1', scene: 'requests', part: 1, title: '', quiz: { q: 'A request nobody decides on reaches its start time. What happens?', options: ['It becomes a booking', 'It is dropped and the creator is told', 'It stays forever'], correct: 1,
      explain: 'Undecided requests are dropped at their start time. You also get a reminder after 12 hours.' } },
    intro(2, 'log', 'Gear is grab-and-go: creators take it on their shoot day (tick every piece, one photo) and bring it back with a photo. The Gear log is who has what.'),
    { id: 'loglook', scene: 'log', part: 2, target: 'loglist', look: true, next: C, title: 'Who has what, right now', body: <>Out first, <b>late in red</b> (30 minutes after the end; at the houses that's when the shoot ends, offsite it's the end of the day). Every take shows the photo from when it left.</> },
    { id: 'openret', scene: 'log', part: 2, target: 'retcard', title: <>A return is waiting: tap Riley's</> },
    { id: 'retlook', scene: 'checkin', part: 2, target: 'retinfo', look: true, next: C, title: 'What Riley told you', body: 'Riley reported the lens cap cracked and confirmed the charging case is plugged in. Reports also come by notification the moment they happen.' },
    { id: 'tick', scene: 'checkin', part: 2, target: 'pieces', top: true, next: C, hint: 'Tick every piece', title: 'Tick every piece back on the shelf', body: 'Anything that isn\'t there: tap Missing? It goes on the record of whoever had it.' },
    { id: 'checked', scene: 'checkin', part: 2, target: 'checkedin', title: <>Tap <b>Checked in</b></> },
    intro(3, 'schedule', 'Cleaners, trainers, inspections: anything that affects filming goes on the schedule as a block.'),
    { id: 'freeslot', scene: 'schedule', part: 3, target: 'freeslot', title: <>Tap a free slot</>, body: 'You can also just put it in the Google Calendar: the app reads it in.' },
    { id: 'blockform', scene: 'block', part: 3, target: 'blockform', top: true, next: C, title: 'Times and repeats', body: <>Blocks can be shorter than a slot (cleaners 1–2 PM): the next creator sees "house free from 2 PM". Pick <b>Repeat</b> for things like the weekly trainer.</> },
    { id: 'blockbtn', scene: 'block', part: 3, target: 'blockbtn', title: <>Tap <b>Block</b></> },
    intro(4, 'notify', "Last one, and it's real: turn on notifications so you hear about requests, gear taken, returns and problems."),
    { id: 'notify', scene: 'notify', part: 4, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications', body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card).' : 'Tap the gold button, then Allow.' },
    { id: 'rules', scene: 'rules', title: '' }, { id: 'done', scene: 'done', title: '' },
  ] : [
    { id: 'hello', scene: 'hello', title: '' },
    intro(1, 'score', 'Your home is the scoreboard: who is filming more, who is filming less, and who needs attention.'),
    { id: 'scorelook', scene: 'score', part: 1, target: 'tiles', look: true, next: C, title: 'Tap a tile to filter', body: 'Creators are compared with each other (no minimum). Needs attention = no-shows, late returns or other serious flags.' },
    { id: 'scorerow', scene: 'score', part: 1, target: 'devon', look: true, next: C, title: 'Every creator, worst first', body: 'Tap anyone to open their record: month by month, flags, strikes.' },
    ...req(2),
    intro(3, 'flag', 'Every no-show, late return or mess becomes a flag. You decide what it means.'),
    { id: 'flaglook', scene: 'flag', part: 3, target: 'evidence', look: true, next: C, title: 'Look at the evidence first', body: 'Times, photos, what they said. Gear back 2 hours late, worth $4,740: the 10% late fee is recorded (the app charges nothing).' },
    { id: 'flagnote', scene: 'flag', part: 3, target: 'flagnote', next: C, hint: 'Type a short reason', title: 'Write why', body: 'Every action needs a reason the creator can read. Try "Dropped off at the house, Maanik was out".' },
    { id: 'excuse', scene: 'flag', part: 3, target: 'excuse', title: <>Tap <b>Excuse it</b></>, body: `Or Give a strike: ${s.strikeCount} strikes in ${s.strikeDays} days pause prop requests for ${s.pauseDays} days. Gear is never paused.` },
    { id: 'quiz3', scene: 'flag', part: 3, title: '', quiz: { q: 'A creator gets a strike. What do they lose?', options: ['Their account', 'Props and gear', `Prop requests, once they reach ${s.strikeCount} strikes`], correct: 2,
      explain: `${s.strikeCount} strikes in ${s.strikeDays} days pause prop requests for ${s.pauseDays} days. They can still book filming time and take gear.` } },
    intro(4, 'notify', "Last one, and it's real: turn on notifications so you hear about requests and anything that needs you."),
    { id: 'notify', scene: 'notify', part: 4, target: 'notifycard', look: true, next: C, hint: 'Turn them on first', title: 'Turn on notifications', body: push === 'needs-install' ? 'On iPhone, add the app to your Home Screen first (steps on the card).' : 'Tap the gold button, then Allow.' },
    { id: 'rules', scene: 'rules', title: '' }, { id: 'done', scene: 'done', title: '' },
  ]

  const [idx, setIdx] = useState(() => required ? Math.min(savedStep(profile.email), STEPS.length - 1) : 0)
  const step = STEPS[idx]
  const I = (id: string) => STEPS.findIndex(x => x.id === id)
  const past = (id: string) => I(id) >= 0 && idx > I(id)
  const advance = () => setIdx(n => { const m = Math.min(n + 1, STEPS.length - 1); if (required) saveStep(profile.email, m); return m })
  const back = idx > 0 ? () => setIdx(n => { const m = Math.max(0, n - 1); if (required) saveStep(profile.email, m); return m }) : undefined
  const tap = (t: string) => () => { if (step.target === t) advance() }
  const T = (t: string) => ({ 'data-tour': t })
  const finish = () => { markTourDone(profile.email); onFinish() }
  const header = (title: string) => <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3"><h1 className="font-display text-[34px] text-pt-text">{title}</h1></div>
  const pill = (tone: string, text: string) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>{text}</span>

  const scenes: Record<Scene, () => ReactNode> = {
    hello: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          <div className="chapter-rise relative self-center"><span className="absolute inset-0 rounded-full blur-2xl bg-pt-accent/25" /><BrandMark className="relative w-24 text-white" title="" /></div>
          <div className="space-y-3 text-center">
            <h1 className="chapter-rise font-display text-[32px] leading-[1.05] font-extrabold tracking-tight">Welcome{first ? `, ${first}` : ''}!</h1>
            <p className="chapter-rise text-[17px] leading-relaxed text-pt-text/85">{role === 'equipment' ? 'You keep the schedule fair and the gear accounted for. Here is your job in 4 short chapters.' : 'You keep an eye on the creators: who films, who shows up, and what happens when something goes wrong. 4 short chapters.'}</p>
          </div>
          <div className="chapter-rise grid grid-cols-3 gap-2 text-center">
            {[['4', 'chapters'], ['~5', 'minutes'], ['4', 'badges']].map(([n, l]) => <div key={l} className="rounded-2xl bg-pt-surface shadow-hairline py-3"><b className="block text-[24px] text-pt-accent">{n}</b><span className="text-pt-muted text-sm">{l}</span></div>)}
          </div>
          <div className="flex items-center gap-3 justify-center"><Cap size={36} /><p className="text-[15px] text-pt-muted">Practice data only. Tap what glows.</p></div>
        </div>
        <div className="space-y-2 pb-4">
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Show me</button>
          {!required && <button onClick={onFinish} className="w-full py-2 text-pt-muted text-[15px]">Not now</button>}
          {required && onSkip && <button onClick={onSkip} className="w-full py-2 text-pt-muted text-[15px]">Skip for now</button>}
        </div>
      </div>
    ),
    requests: () => (
      <div className="pb-8">{header('Requests')}
        <div className="px-4 space-y-3">
          <div {...T('reqcard')} className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2.5">
            <div className="flex items-start gap-3"><Avatar name="Riley" size={40} />
              <div className="min-w-0 flex-1"><p className="text-pt-text font-semibold">Riley</p>
                <p className="text-pt-text text-[15px]">{formatDay(thu, { weekday: 'short', month: 'short', day: 'numeric' })} · Cliff 1 · {fmtSlot(19 * 60, s.slotMinutes)}</p><p className="text-pt-muted text-xs">Asked 2 h ago</p></div></div>
            <div className="flex flex-wrap gap-1.5">{pill('bg-amber-400/15 text-amber-300', '10th this month')}{pill('bg-pt-accent/15 text-pt-accent', 'Back to back with Jordan · usual partner')}{pill('bg-pt-bg text-pt-muted', '6 of 6 filmed (30 days)')}</div>
            <p className="text-[14px] text-pt-accent font-semibold">Guideline: Haunted diner.pdf ›</p>
            {past('approve') ? <p className="text-green-400 text-sm font-semibold">Approved ✓ Riley gets a notification.</p> : (
              <div className="flex gap-2"><button {...T('approve')} onClick={tap('approve')} className="flex-1 min-h-[44px] rounded-xl bg-green-500/15 text-green-400 font-semibold">Approve</button>
                <button className="flex-1 min-h-[44px] rounded-xl bg-red-500/10 text-red-300 font-semibold">Deny</button></div>)}
          </div>
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2.5">
            <div className="flex items-start gap-3"><Avatar name="Devon" size={40} />
              <div className="min-w-0 flex-1"><p className="text-pt-text font-semibold">Devon</p><p className="text-pt-text text-[15px]">{formatDay(thu, { weekday: 'short', month: 'short', day: 'numeric' })} · Cliff 1 · {fmtSlot(17 * 60, s.slotMinutes)}</p><p className="text-pt-muted text-xs">Asked 5 h ago</p></div></div>
            {past('priobook') ? <p className="text-green-400 text-sm font-semibold">Booked for {kyle} ✓ Devon was moved to Cliff 2 and notified.</p> : (
              <div className="flex gap-2"><button className="flex-1 min-h-[44px] rounded-xl bg-green-500/15 text-green-400 font-semibold">Approve</button>
                <button {...T('priobtn')} onClick={tap('priobtn')} className="shrink-0 px-3 min-h-[44px] rounded-xl bg-pt-bg text-pt-accent text-[13px] font-semibold">Priority booking…</button></div>)}
          </div>
        </div>
      </div>
    ),
    priority: () => (
      <div className="pb-8">{header('Priority booking')}
        <div className="px-4 space-y-3">
          <p className="text-pt-text">Cliff 1 · {formatDay(thu, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtSlot(17 * 60, s.slotMinutes)}<span className="block text-pt-muted text-sm">Devon has it now.</span></p>
          <p className="text-pt-muted text-xs font-semibold">Book it for</p>
          <span className="inline-flex items-center gap-2 rounded-full pl-1 pr-3 min-h-[40px] bg-pt-accent text-stone-900 font-semibold"><Avatar name={kyle} size={30} />{kyle}</span>
          <p className="text-pt-muted text-xs font-semibold">What happens to Devon?</p>
          <button {...T('moveopt')} onClick={tap('moveopt')} className={`w-full text-left px-3 min-h-[44px] rounded-xl ${past('priomove') ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-text'}`}>Move them to Cliff 2 · {fmtSlot(17 * 60, s.slotMinutes)}</button>
          <button className="w-full text-left px-3 min-h-[44px] rounded-xl bg-pt-surface text-pt-text">Cancel their shoot (they're notified; their next request is first in line)</button>
          <button {...T('priook')} onClick={tap('priook')} disabled={!past('priomove')} className={btnGold}>Book it for {kyle}</button>
        </div>
      </div>
    ),
    log: () => (
      <div className="pb-8">{header('Gear log')}
        <div {...T('loglist')} className="px-4 space-y-2">
          {[['My Roommate Is A Spy', 'Sam', 'Sony A7S III kit', 'Late · due back 12 PM', true], ['Ghost Hunt at 3 AM', 'Jordan', 'DJI Mini 5 drone kit', `Taken ${fmtTime(14 * 60)} · back by ${fmtTime(17 * 60)}`, false]].map(([t, w, what, when, late]) => (
            <div key={String(t)} className={`bg-pt-surface rounded-2xl p-4 space-y-1 ${late ? 'ring-1 ring-red-400/60' : ''}`}>
              <div className="flex justify-between gap-2"><p className="text-pt-text font-semibold truncate">{t}</p>{late ? <Pill tone="taken">Late</Pill> : <Pill tone="warn">Out</Pill>}</div>
              <p className="text-pt-muted text-sm">{when} · {w}</p><p className="text-pt-muted text-xs">{what}</p>
            </div>))}
          <button {...T('retcard')} onClick={tap('retcard')} className="w-full text-left bg-pt-surface rounded-2xl p-4 space-y-1">
            <div className="flex justify-between gap-2"><p className="text-pt-text font-semibold">If You See This, RUN</p><span className="flex gap-1"><Pill tone="warn">⚠ Damage reported</Pill><Pill tone="free">Returned</Pill></span></div>
            <p className="text-pt-muted text-sm">Returned 3:05 PM · Riley</p><p className="text-pt-muted text-xs">Sony FX3 kit</p>
          </button>
        </div>
      </div>
    ),
    checkin: () => (
      <div className="pb-10">{header('Check in')}
        <div className="px-4 space-y-4">
          <div {...T('retinfo')} className="bg-amber-500/10 rounded-2xl px-4 py-3 space-y-1 text-[15px]">
            <p className="text-amber-200 font-medium">From Riley's return</p>
            <p className="text-pt-text">Lens cap: damage reported ("cracked")</p><p className="text-pt-text">Charging case: plugged in ✓</p>
          </div>
          <div {...T('pieces')}><PieceChecklist lines={LINES} ticked={ticked} missing={new Set()} onTick={k => { if (step.id === 'tick') setTicked(t => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n }) }} onMissing={() => {}} /></div>
          {past('checked') ? <p className="text-green-400 font-semibold">Checked in ✓</p> : <button {...T('checkedin')} onClick={tap('checkedin')} disabled={ticked.size < LINES.length} className={btnGold}>Checked in</button>}
        </div>
      </div>
    ),
    schedule: () => (
      <div className="pb-8">{header('Schedule')}
        <div className="px-4 space-y-2">
          <p className="text-pt-muted text-sm">{formatDay(thu, { weekday: 'long', month: 'short', day: 'numeric' })} · Cliff 2</p>
          {[[11 * 60, 'Free'], [13 * 60, 'free'], [15 * 60, 'Jordan']].map(([st, w]) => {
            const blocked = st === 13 * 60 && past('blockbtn')
            return (
              <button key={st} {...(st === 13 * 60 ? T('freeslot') : {})} onClick={st === 13 * 60 ? tap('freeslot') : undefined}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border ${blocked ? 'bg-[repeating-linear-gradient(135deg,#1C1C1E_0_8px,#232325_8px_16px)] border-transparent' : w === 'Jordan' ? 'bg-pt-surface border-transparent' : 'bg-pt-surface border-pt-accent/35'}`}>
                <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums">{fmtSlot(Number(st), s.slotMinutes)}</span>
                <span className="flex-1"><span className="block font-semibold text-pt-text">{blocked ? 'Trainer' : w === 'Jordan' ? 'Jordan' : <span className="text-pt-accent">Free · book or block</span>}</span>
                  {st === 15 * 60 && past('blockbtn') && <span className="block text-sky-300 text-xs">House free from {fmtTime(14 * 60)} (trainer until {fmtTime(14 * 60)})</span>}
                  {blocked && <span className="block text-pt-muted text-xs">{fmtTime(13 * 60)}–{fmtTime(14 * 60)}{blockWeeks > 1 ? ` · every ${formatDay(thu, { weekday: 'long' })} for ${blockWeeks} weeks` : ''}</span>}</span>
                {blocked && <Pill tone="muted">Blocked</Pill>}
              </button>)
          })}
        </div>
      </div>
    ),
    block: () => (
      <div className="pb-8">{header('Book or block')}
        <div {...T('blockform')} className="px-4 space-y-3">
          <p className="text-pt-muted text-sm">{formatDay(thu)} · Cliff 2 · {fmtSlot(13 * 60, s.slotMinutes)}</p>
          <div className="bg-pt-surface rounded-xl px-3 py-3 text-pt-text">Type: Event · "Trainer"</div>
          <div className="grid grid-cols-2 gap-2"><div className="bg-pt-surface rounded-xl px-3 py-3 text-pt-text">From {fmtTime(13 * 60)}</div><div className="bg-pt-surface rounded-xl px-3 py-3 text-pt-text">Until {fmtTime(14 * 60)}</div></div>
          <select value={blockWeeks} onChange={e => setBlockWeeks(Number(e.target.value))} className="w-full bg-pt-surface rounded-xl px-3 py-3 text-pt-text">
            <option value={1}>Just this once</option>{[4, 8, 12].map(n => <option key={n} value={n}>Every {formatDay(thu, { weekday: 'long' })} for {n} weeks</option>)}
          </select>
          <button {...T('blockbtn')} onClick={tap('blockbtn')} className="w-full bg-pt-border text-pt-text font-semibold rounded-xl py-3">Block {fmtTime(13 * 60)}–{fmtTime(14 * 60)}{blockWeeks > 1 ? ` for ${blockWeeks} weeks` : ''}</button>
        </div>
      </div>
    ),
    score: () => (
      <div className="pb-8">{header('Dashboard')}
        <div className="px-4 space-y-3">
          <div {...T('tiles')} className="grid grid-cols-2 gap-2">
            {[['Posting more', '2', 'text-green-400'], ['Posting less', '1', 'text-amber-300'], ['Typical', '3', 'text-pt-text'], ['Needs attention', '1', 'text-red-300']].map(([l, n, c]) => (
              <div key={l} className="bg-pt-surface rounded-2xl p-3"><b className={`block text-[24px] ${c}`}>{n}</b><span className="text-pt-muted text-sm">{l}</span></div>))}
          </div>
          {[['Jordan', '7 filmed · 3 more than typical', ''], ['Maya', '4 filmed · typical', ''], ['Devon', '4 filmed · 1 no-show, 1 late return', 'devon'], ['Riley', '1 filmed · 3 fewer than typical', '']].map(([n, t, tg]) => (
            <div key={n} {...(tg ? T(tg) : {})} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3"><Avatar name={n} size={36} />
              <span className="flex-1 min-w-0"><b className="block text-pt-text">{n}</b><span className={`block text-xs ${n === 'Devon' ? 'text-red-300' : 'text-pt-muted'}`}>{t}</span></span></div>))}
        </div>
      </div>
    ),
    flag: () => (
      <div className="pb-8">{header('Late gear · Devon')}
        <div className="px-4 space-y-3">
          <div {...T('evidence')} className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {[['Due back', `${fmtTime(17 * 60)}`], ['Came back', `${fmtTime(19 * 60)} (2 h late)`], ['Last had it', 'Devon'], ['Value', '$4,740'], ['Late fee', '10% recorded']].map(([a, b]) => <div key={a} className="flex justify-between px-4 py-2.5 text-[15px]"><span className="text-pt-muted">{a}</span><span className="text-pt-text">{b}</span></div>)}
          </div>
          <input {...T('flagnote')} value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder="Why? Devon reads this" className="w-full bg-pt-surface rounded-xl px-3 min-h-[48px] text-base" />
          {past('excuse') ? <p className="text-green-400 font-semibold">Excused ✓ It stops counting everywhere.</p> : (
            <div className="grid grid-cols-2 gap-2"><button {...T('excuse')} onClick={tap('excuse')} disabled={note.trim().length < 3} className="min-h-[44px] rounded-xl bg-pt-border font-semibold disabled:opacity-40">Excuse it</button>
              <button className="min-h-[44px] rounded-xl bg-red-500/15 text-red-300 font-semibold">Give a strike</button>
              <button className="min-h-[44px] rounded-xl bg-pt-border font-semibold">Send a note</button><button className="min-h-[44px] rounded-xl bg-pt-border font-semibold">Mark as handled</button></div>)}
        </div>
      </div>
    ),
    notify: () => (
      <div className="pb-6">{header('My account')}
        <div className="px-4 space-y-4">
          <div {...T('notifycard')} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent"><Icon name="bell" className="w-5 h-5" /></span>
              <b className="text-pt-text">Notifications</b></div>
            {push === 'on' ? <p className="text-green-400 font-semibold">✓ Notifications are on</p>
              : push === 'off' ? <button disabled={pushBusy} onClick={turnOn} className={btnGold}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
              : push === 'needs-install' ? <ol className="space-y-2 text-[14px] text-pt-text list-decimal list-inside"><li>Tap <b>Share</b> in Safari</li><li><b>Add to Home Screen</b></li><li>Open <b>Prime Capitol</b> from the Home Screen</li><li>My account → <b>Turn on</b></li></ol>
              : push === 'blocked' ? <p className="text-pt-muted text-sm">Blocked for this app. {isIOS() ? 'iPhone Settings → Notifications → Prime Capitol → Allow.' : 'Tap the lock next to the address → Notifications → Allow.'}</p>
              : <p className="text-pt-muted text-sm">This browser can't show notifications. Open the app on your phone to turn them on.</p>}
            {pushMsg && <p className="text-amber-300 text-xs">Couldn't turn them on: {pushMsg} Try again later from My account.</p>}
          </div>
        </div>
      </div>
    ),
    rules: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Your cheat sheet</h1>
        {((role === 'equipment' ? [
          ['calendar', 'Every creator booking is a request: approve or deny with a reason. Undecided ones drop at their start time.'],
          ['star', `Priority booking: when ${kyle} needs a taken slot, move the other person or cancel them (no strike, neutral notice).`],
          ['camera', 'Gear log = who has what. Check returns in: tick every piece, read the damage reports.'],
          ['clock', 'Block time from the schedule (shorter than a slot, or repeating weekly), or put it in Google Calendar.'],
        ] : [
          ['chart', 'Dashboard: who films more, less, and who needs attention. Tap anyone for their record.'],
          ['calendar', `Approve or deny requests; make a priority booking when ${kyle} needs a slot.`],
          ['eye', 'Flags: read the evidence, then excuse, note, strike or mark handled, always with a reason.'],
          ['stop', `${s.strikeCount} strikes in ${s.strikeDays} days pause prop requests for ${s.pauseDays} days. Gear is never paused.`],
        ]) as [IconName, string][]).map(([i, t]) => <div key={t} className="flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4"><Icon name={i} className="w-6 h-6 text-pt-accent shrink-0" /><p className="text-[16px] text-pt-text">{t}</p></div>)}
        <p className="text-pt-muted text-sm">The one-page Team guide in your menu has all of this, any time.</p>
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(110% 60% at 50% 0%, #2b2416 0%, #000 65%)' }}>
        <div className="flex-1 flex flex-col justify-center gap-6 py-8 text-center">
          <div className="relative self-center"><Confetti count={40} /><Cap size={96} className="cap-bob" /></div>
          <h1 className="font-display text-[34px] leading-[1.05] font-extrabold tracking-tight">You're set{first ? `, ${first}` : ''}!</h1>
          <BadgeWall chapters={chapters} />
        </div>
        <div className="pb-4"><button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">{required ? "Let's get to work" : 'Done'}</button></div>
      </div>
    ),
  }

  const inPart = STEPS.filter(x => x.part === step.part && !x.id.startsWith('part') && !x.quiz)
  const stepInPart = inPart.findIndex(x => x.id === step.id) + 1
  const nextDisabled = (step.id === 'tick' && ticked.size < LINES.length) || (step.id === 'flagnote' && note.trim().length < 3) || (step.id === 'notify' && push === 'off' && !pushMsg)
  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="Team tour (practice)">
      <div className="flex-1 overflow-y-auto">{scenes[step.scene]()}</div>
      {step.id.startsWith('part') && <ChapterCard key={step.id} n={step.part!} body={step.body} onGo={advance} onBack={back} chapters={chapters} />}
      {step.quiz && <QuizCard key={step.id} part={step.part!} {...step.quiz} onDone={advance} onBack={back} />}
      {step.part && !step.id.startsWith('part') && !step.quiz && <Spotlight stepKey={step.id} target={step.target} top={step.top} dim={!step.look} title={step.title} body={step.body} part={step.part}
        chapters={chapters} stepInPart={stepInPart || undefined} stepsInPart={stepInPart ? inPart.length : undefined} next={step.next} onNext={advance}
        nextDisabled={nextDisabled} disabledHint={step.hint} onBack={back} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
