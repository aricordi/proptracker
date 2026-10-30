import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import RoundIcon from '../components/RoundIcon'
import MyRequestsButton from '../components/MyRequestsButton'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions, db } from '../firebase'
import { doc, onSnapshot } from 'firebase/firestore'
import { takePendingAdds, peekPendingAdds, useEarliestDayFor, useAddToShoot } from '../activeShoot'
import { useSession } from '../auth'
import BottomSheet from '../components/BottomSheet'
import Avatar from '../components/Avatar'
import ShootNeeds from '../components/ShootNeeds'
import AiButton from '../components/AiButton'
import { useAssistant } from '../assistant'
import { Pill } from '../components/GearUi'
import ProofPhotos, { PhotoStrip } from '../components/ProofPhotos'
import { whenLabel, formatDay } from '../lib/dates'
import { useProfiles } from '../services/profiles'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useShoot, useMySwaps, useMyStatus, useMyInvites, answerInvite, type ScheduleInvite, bookShoot, cancelShoot, moveShoot, requestSwap, answerSwap,
  addScheduleBlock, removeScheduleBlock, listSchedulePeople, listFilmingFriends, bookWithFriends, INVITE_HOLD_MINUTES, myCalendarLink, checkInShoot, wrapShoot, explainMissedCheckIn, decideShoot,
  checkinWindow, isMissed, explainUntil, slotKey, errorText, slotState, findFree, fmtSlot, isNoCrewDay, isPriorityDay,
  inPriorityGroup, priorityLocked, releaseStamp, monthOf, isShortNotice, withinUndo, slotWindow, HOUSES, BLOCK_TYPES, MONTHLY_HOUSE,
  type House, type Place, type ScheduleDay, type Block, type ShootKind, type BlockType, type Shoot, type SwapRequest,
  houseSlotsOn, MONTHLY_SLOTS_ON,
} from '../services/schedule'

const calendarPending = httpsCallable<Record<string, never>, { pending: unknown[] }>(functions, 'calendarPending')
const DAYS_SHOWN = 35
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const stampLabel = (s: string) => `${formatDay(s.slice(0, 10))}, ${fmtTime(Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)))}`
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const btnGrey = 'w-full bg-pt-raised text-pt-text font-semibold rounded-[14px] py-3 min-h-[48px] shadow-hairline disabled:opacity-40'

type Friend = { email: string; name: string }

// Someone else's booked house slot (what a swap is asked for).
interface TheirSlot { shootId: string; name: string; email?: string; date: string; house: House; start: number }

type SheetState =
  | { kind: 'calendar' }
  | { kind: 'book'; house: Place; date: string; start: number }
  | { kind: 'offsite'; date: string; move?: Shoot }
  | { kind: 'shoot'; id: string }
  | { kind: 'taken'; slot: TheirSlot }
  | { kind: 'block'; date: string; house: House; start: number }
  | { kind: 'unblock'; date: string; block: Block }
  | { kind: 'find'; house?: House; fromToday?: boolean }
  | { kind: 'group'; house: House; date: string; start: number; friends: Friend[] }
  | { kind: 'move'; shoot: Shoot }
  | { kind: 'swap'; mine?: Shoot; theirs?: TheirSlot }
  | null

// The house schedule: Cliff 1, Cliff 2 and offsite shoots, by day, in 2-hour slots.
export default function ScheduleScreen() {
  const { profile, role, canBook } = useSession()
  // team = the schedule team who change things (owner, equipment). Admins only look (owner, Oct 20/27): they open anyone's
  // shoot and the Schedule team page, but don't film, so they never book, block or move.
  const team = role === 'owner' || role === 'equipment'
  const teamView = team || role === 'admin'
  const s = useScheduleSettings()
  const profiles = useProfiles()
  const today = todayInStudio()
  const [date, setDate] = useState(today)
  const [house, setHouse] = useState<Place>('cliff1')
  const [sheet, setSheet] = useState<SheetState>(null)
  // After booking: if things were picked for a new shoot (✦ Prop ideas), put them in it and review it.
  const navigate = useNavigate()
  const addToShoot = useAddToShoot()
  // Schedule team: changes Google Calendar refused (to retry).
  const [calWaiting, setCalWaiting] = useState(0)
  const [calNew, setCalNew] = useState(0)
  useEffect(() => {
    if (!(role === 'owner' && s.googleCalendarId)) return
    calendarPending({}).then(r => setCalWaiting(r.data.pending.length)).catch(() => {})
    // The 15-minute calendar check counts new events added straight in Google Calendar, waiting to be sorted.
    return onSnapshot(doc(db, 'app_settings', 'calendarCheck'), d => setCalNew(Number(d.get('newEvents') ?? 0)), () => {})
  }, [role, s.googleCalendarId])
  const booked = (id: string) => {
    const pending = takePendingAdds()
    if (pending && (pending.props.length + pending.gear.length + pending.builds.length)) { addToShoot(id, pending); navigate('/reserve') }
    else setSheet({ kind: 'shoot', id })
  }
  // ?shoot=<id> opens that shoot (from Home); ?book=1 opens "Book a shoot".
  // The open shoot stays in the address (owner, Oct 20), so Back from a request page lands on the shoot again.
  // ?sent=props|gear|both: just sent from "Your shoot", say so on the shoot.
  const [params, setParams] = useSearchParams()
  const [sent, setSent] = useState<string | null>(null)
  useEffect(() => {
    const id = params.get('shoot'), book = params.get('book')
    if (params.get('sent')) { setSent(params.get('sent')); const n = new URLSearchParams(params); n.delete('sent'); setParams(n, { replace: true }); return }
    if (id) { if (!(sheet?.kind === 'shoot' && sheet.id === id)) setSheet({ kind: 'shoot', id }) }
    else if (book) { setSheet({ kind: 'find', fromToday: true }); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = sheet?.kind === 'shoot' ? sheet.id : null, has = params.get('shoot')
    if (params.get('sent') || want === has) return
    if (want) setParams({ shoot: want }, { replace: true })
    else if (has) { setParams({}, { replace: true }); setSent(null) }
  }, [sheet])   // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const days = useScheduleDays(today, addDays(today, 120))
  const mine = useMyShoots(profile.email, today)
  const swaps = useMySwaps(profile.email)
  const invites = useMyInvites(profile.email)
  const ai = useAssistant()
  const status = useMyStatus(profile.email)
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const day = days?.[date]
  const myDays = useMemo(() => new Set((mine ?? []).map(x => x.date)), [mine])
  const next = (mine ?? []).find(x => x.to > now)

  const notes: { tone: 'info' | 'gold' | 'muted'; text: React.ReactNode }[] = []
  if (isNoCrewDay(date)) notes.push({ tone: 'info', text: <><b>Sunday · open filming.</b> First come, first served. The crew is off, so you run the shoot yourself.</> })
  if (house !== 'offsite' && isPriorityDay(date, house, s) && !team) {
    if (inPriorityGroup(profile.email, s)) notes.push({ tone: 'gold', text: <><b>Priority day.</b> You're in the priority group: book any free slot.</> })
    else if (priorityLocked(date, house, s, profile.email, now)) notes.push({ tone: 'gold', text: <><b>Priority day.</b> Unclaimed slots open to everyone on <b>{stampLabel(releaseStamp(date, s))}</b>.</> })
    else notes.push({ tone: 'gold', text: <><b>Released priority day.</b> Free slots are open to everyone.</> })
  }
  if (house === 'cliff2') notes.push({ tone: 'muted', text: `${s.houses.cliff2.name}: first come, first served. External rentals come first.` })

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
        <div className="flex items-end justify-between py-2 gap-2">
          <h1 className="font-display text-[34px] text-pt-text">Schedule</h1>
          <div className="flex gap-2 pb-0.5">
            <AiButton mode="time" />
            <MyRequestsButton />
            {teamView && <RoundIcon icon="team" label="Check-ins, reports and creators" to="/schedule/team" />}
            {role === 'owner' && <RoundIcon icon="settings" label="Schedule settings" to="/schedule/settings" />}
            <RoundIcon icon="help" label="Help" to="/help" />
          </div>
        </div>
        <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
          {([...HOUSES, 'offsite'] as Place[]).map(h => (
            <button key={h} onClick={() => setHouse(h)}
              className={`flex-1 py-2 rounded-[10px] text-sm ${house === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>
              {h === 'offsite' ? 'Offsite' : s.houses[h].name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pt-3 pb-1 -mx-4 px-4">
          {Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i)).map(d => (
            <button key={d} onClick={() => setDate(d)}
              className={`shrink-0 w-[52px] py-2 rounded-xl text-center border ${d === date ? 'border-pt-accent bg-pt-surface' : 'border-transparent bg-pt-surface'}`}>
              <span className="block text-xs text-pt-muted">{formatDay(d, { weekday: 'short' })}</span>
              <span className="block text-lg font-semibold text-pt-text leading-tight">{Number(d.slice(8))}</span>
              <span className={`block mx-auto mt-0.5 w-1 h-1 rounded-full ${myDays.has(d) ? 'bg-pt-accent' : 'bg-transparent'}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {paused && <div className="rounded-xl px-3 py-3 text-sm border border-red-400/40 bg-red-400/10 text-pt-text"><b>Prop and gear bookings paused until {formatDay(status!.pausedUntil!)}</b> because of {status!.strikes ?? 2} strikes (no-shows or reports). You can still book house slots. Ask the schedule team if this looks wrong.</div>}
        {!paused && (status?.strikes ?? 0) > 0 && <div className="rounded-xl px-3 py-2 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">{status!.strikes} strike{status!.strikes === 1 ? '' : 's'} in the last {s.strikeDays} days. {s.strikeCount} pause your prop and gear bookings for {s.pauseDays} days.</div>}
        {swaps.incoming.map(r => <SwapAsk key={r.id} r={r} incoming />)}
        {swaps.outgoing.map(r => <SwapAsk key={r.id} r={r} />)}
        {invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => <InviteAsk key={i.id} inv={i} now={now} />)}

        {/* Your own shoots at a glance (owner, Oct 20): soonest first, tap one to open it, "All" for the full list. */}
        {next && (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-[15px] font-semibold">Your shoots</h2>
              <button onClick={() => navigate('/shoots')} className="text-pt-accent text-sm tap">All my shoots ›</button>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {(mine ?? []).filter(x => x.to > now).slice(0, 6).map(x => (
                <button key={x.id} onClick={() => { setDate(x.date); if (x.place !== house) setHouse(x.place); setSheet({ kind: 'shoot', id: x.id }) }}
                  className={`shrink-0 w-[148px] text-left rounded-2xl px-3 py-3 ${x.date === today ? 'bg-pt-accent/[0.16] shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.5)]' : 'bg-pt-surface shadow-hairline'}`}>
                  <span className={`block text-xs font-semibold ${x.date === today ? 'text-pt-accent' : 'text-pt-muted'}`}>{whenLabel(x.date, today)}</span>
                  <span className="block text-pt-text font-semibold leading-tight mt-0.5">{formatDay(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="block text-pt-muted text-xs truncate mt-0.5">{fmtSlot(x.start, x.end - x.start)} · {x.place === 'offsite' ? (x.where || 'Offsite') : s.houses[x.place].name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Three clearly separate things: book (gold), the AI helper (violet), and the calendar link (at the bottom) */}
        {calNew > 0 && (
          <button onClick={() => navigate('/schedule/import')} className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 bg-sky-400/10 text-left shadow-[inset_0_0_0_0.5px_rgba(56,189,248,0.4)]">
            <Icon name="calendar" className="w-5 h-5 text-sky-300" /><span className="flex-1 text-pt-text text-sm">{calNew} new event{calNew === 1 ? '' : 's'} in Google Calendar to sort</span><span className="text-pt-muted">›</span>
          </button>
        )}
        {calWaiting > 0 && (
          <button onClick={() => navigate('/schedule/calendar')} className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 bg-sky-400/10 text-left shadow-[inset_0_0_0_0.5px_rgba(56,189,248,0.4)]">
            <Icon name="calendar" className="w-5 h-5 text-sky-300" /><span className="flex-1 text-pt-text text-sm">{calWaiting} change{calWaiting === 1 ? '' : 's'} couldn't reach Google Calendar · try again</span><span className="text-pt-muted">›</span>
          </button>
        )}
        {canBook && <button onClick={() => setSheet({ kind: 'find', fromToday: true })} className={`${btnGold} py-4 text-[17px]`}>Book a shoot</button>}
        {/* Small on purpose (owner, Oct 19): the ✦ AI button at the top is the main way in. */}
        {canBook && <button onClick={() => ai.open('time')} className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF] active:scale-[0.98] transition-transform">
          <span className="text-[#BF9DFF]">✦</span><span className="flex-1 min-w-0 truncate">Or ask AI to find a time</span><span className="text-pt-muted">›</span>
        </button>}

        <div className="flex items-center justify-between gap-2 pt-6 mt-2 border-t border-pt-border">
          <p className="text-pt-text font-semibold">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })}{date === today ? ' · Today' : ''}</p>
          {house !== 'offsite' && canBook && <button onClick={() => setSheet({ kind: 'find' })} className="text-pt-accent text-sm shrink-0 tap">Find a time</button>}
        </div>
        {house !== 'offsite' && <p className="text-pt-muted text-xs -mt-1">{s.houses[house].address}</p>}
        {notes.map((n, i) => (
          <div key={i} className={`rounded-xl px-3 py-3 text-sm border ${n.tone === 'gold' ? 'border-pt-accent/50 bg-pt-accent/10 text-pt-text' : n.tone === 'info' ? 'border-sky-400/40 bg-sky-400/10 text-pt-text' : 'border-pt-border bg-pt-surface text-pt-muted'}`}>{n.text}</div>
        ))}

        {days === null && <p className="text-pt-muted text-sm text-center py-6">Loading…</p>}
        {days !== null && house !== 'offsite' && (
          <div className="space-y-2">
            {s.slots.map(start => (
              <SlotRow key={start} day={day} date={date} house={house} start={start} team={team} email={profile.email} now={now}
                onTap={st => {
                  if (st.t === 'free') { if (team) setSheet({ kind: 'block', date, house, start }); else if (canBook) setSheet({ kind: 'book', house, date, start }) }
                  else if (st.t === 'booked') {
                    const isMine = st.entry.email === profile.email || (mine ?? []).some(x => x.id === st.entry.shootId)
                    setSheet(teamView || isMine ? { kind: 'shoot', id: st.entry.shootId } : { kind: 'taken', slot: { shootId: st.entry.shootId, name: st.entry.name, email: st.entry.email, date, house, start } })
                  }
                  else if (st.t === 'block' && team) setSheet({ kind: 'unblock', date, block: st.block })
                }} />
            ))}
          </div>
        )}
        {days !== null && house === 'offsite' && (
          <div className="space-y-2">
            {(day?.offsite ?? []).length === 0 && <p className="text-pt-muted text-sm">No offsite shoots this day.</p>}
            {(day?.offsite ?? []).slice().sort((a, b) => a.start - b.start).map(o => (
              <button key={o.shootId} onClick={() => (teamView || o.email === profile.email) && setSheet({ kind: 'shoot', id: o.shootId })}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-pt-surface text-left">
                <Avatar email={o.email} name={o.name} />
                <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text truncate">{o.email === profile.email ? 'You' : o.name}</span><span className="block text-pt-muted text-xs truncate">{o.where} · {fmtSlot(o.start, o.end - o.start)}</span></span>
                <Pill tone="info">Offsite</Pill>
              </button>
            ))}
            {(canBook || team) && <button onClick={() => setSheet({ kind: 'offsite', date: date })} className={btnGrey}>+ Add an offsite or location shoot</button>}
          </div>
        )}

        <button onClick={() => setSheet({ kind: 'calendar' })} className="!mt-8 w-full flex items-center gap-3 p-4 rounded-2xl bg-pt-surface shadow-hairline text-left">
          <span className="w-10 h-10 rounded-xl grid place-items-center bg-pt-bg text-lg shrink-0"><Icon name="calendar" className="w-5 h-5 text-pt-accent" /></span>
          <span className="flex-1 min-w-0 text-pt-text text-[15px] font-semibold">{team ? 'Schedule' : 'My shoots'} in my phone's calendar</span>
          <span className="text-pt-muted">›</span>
        </button>
      </div>

      {sheet?.kind === 'calendar' && <CalendarSheet team={team} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'book' && <BookSheet {...sheet} team={team} mine={mine ?? []}
        dayFull={!team && sheet.house !== 'offsite' && houseSlotsOn(days?.[sheet.date], profile.email, now) >= s.slotsPerDay} onClose={() => setSheet(null)} onBooked={booked} />}
      {sheet?.kind === 'group' && <GroupBookSheet {...sheet} team={team} mine={mine ?? []} onClose={() => setSheet(null)} onBooked={booked} />}
      {sheet?.kind === 'offsite' && <OffsiteSheet date={sheet.date} move={sheet.move} team={team} onClose={() => setSheet(null)} onDone={booked} />}
      {sheet?.kind === 'block' && <TeamSlotSheet {...sheet} onClose={() => setSheet(null)} onBook={() => setSheet({ kind: 'book', house: sheet.house, date: sheet.date, start: sheet.start })} />}
      {sheet?.kind === 'unblock' && <UnblockSheet {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shoot' && <ShootSheet id={sheet.id} team={team} sent={sent} onClose={() => setSheet(null)}
        onMove={sh => setSheet(sh.place === 'offsite' ? { kind: 'offsite', date: sh.date, move: sh } : { kind: 'move', shoot: sh })}
        onSwap={sh => setSheet({ kind: 'swap', mine: sh })} />}
      {sheet?.kind === 'taken' && (
        <BottomSheet open onClose={() => setSheet(null)} title={sheet.slot.name}>
          <div className="flex items-center gap-3">
            <Avatar email={sheet.slot.email} name={sheet.slot.name} size={48} />
            <div className="min-w-0">
              {profiles[sheet.slot.email ?? '']?.channel && <p className="text-pt-text text-sm truncate">{profiles[sheet.slot.email ?? '']!.channel}</p>}
              <p className="text-pt-muted text-sm">{formatDay(sheet.slot.date)} · {s.houses[sheet.slot.house].name} · {fmtSlot(sheet.slot.start, s.slotMinutes)}</p>
            </div>
          </div>
          <p className="text-pt-text text-sm mt-4">This slot is booked. "Find a time" shows the next free one, or ask to swap one of your shoots for it.</p>
          <button onClick={() => setSheet({ kind: 'find' })} className={`mt-4 ${btnGold}`}>Find a time</button>
          {(mine ?? []).some(x => x.place !== 'offsite' && x.from > now) && (
            <button onClick={() => setSheet({ kind: 'swap', theirs: sheet.slot })} className={`mt-2 ${btnGrey}`}>Ask to swap</button>
          )}
        </BottomSheet>
      )}
      {sheet?.kind === 'find' && days && (
        <FindSheet days={days} from={sheet.fromToday || date < today ? today : date} house={sheet.house} team={team} email={profile.email} now={now}
          onOffsite={() => { setHouse('offsite'); setSheet({ kind: 'offsite', date: sheet.fromToday ? today : date }) }}
          onClose={() => setSheet(null)} onPick={(d, h, st, friends) => { setDate(d); setHouse(h)
            setSheet(friends.length ? { kind: 'group', house: h, date: d, start: st, friends } : team ? { kind: 'block', date: d, house: h, start: st } : { kind: 'book', house: h, date: d, start: st }) }} />
      )}
      {sheet?.kind === 'move' && days && (
        <MoveSheet shoot={sheet.shoot} days={days} team={team} now={now} onClose={() => setSheet(null)} onMoved={sh => { setDate(sh.date); setHouse(sh.place); setSheet({ kind: 'shoot', id: sh.id }) }} />
      )}
      {sheet?.kind === 'swap' && days && (
        <SwapSheet mine={sheet.mine} theirs={sheet.theirs} days={days} myShoots={mine ?? []} email={profile.email} now={now} onClose={() => setSheet(null)} />
      )}
    </div>
  )
}

function SlotRow({ day, date, house, start, team, email, now, onTap }: {
  day?: ScheduleDay; date: string; house: House; start: number; team: boolean; email: string; now: string
  onTap: (st: ReturnType<typeof slotState>) => void
}) {
  const s = useScheduleSettings()
  const profiles = useProfiles()
  const st = slotState(day, date, house, start, s, email, now, team)
  let title: React.ReactNode, sub: React.ReactNode = null, pill: React.ReactNode = null, face: React.ReactNode = null, cls = 'bg-pt-surface border-transparent'
  if (st.t === 'block') { title = st.block.note || BLOCK_TYPES[st.block.type]; sub = st.block.note && st.block.note !== BLOCK_TYPES[st.block.type] ? BLOCK_TYPES[st.block.type] : null; pill = <Pill tone="muted">Blocked</Pill>; cls = 'bg-[repeating-linear-gradient(135deg,#1C1C1E_0_8px,#232325_8px_16px)] border-transparent' }
  else if (st.t === 'booked') {
    const isMine = st.entry.email === email
    face = <Avatar email={st.entry.email} name={st.entry.name} ring={isMine} />
    title = isMine ? 'You' : st.entry.name
    const ch = st.entry.email ? profiles[st.entry.email]?.channel : ''
    // Imported from the old calendar at its real hours (e.g. 2:30–5 PM), and old double bookings (clashes).
    const real = st.entry.time ? `Really ${fmtTime(st.entry.time.start)}–${fmtTime(st.entry.time.end)}` : ''
    const clash = (day?.clashes ?? []).filter(c => c.house === house && c.slot === slotKey(start))
    sub = [real, ch, MONTHLY_SLOTS_ON ? (st.entry.kind === 'monthly' ? 'Monthly slot' : 'Extra slot') : ''].filter(Boolean).join(' · ')
    if (clash.length) sub = <><span className="text-red-300 font-semibold">Clash · also {clash.map(c => c.name).join(', ')}</span>{sub ? ` · ${sub}` : ''}</>
    if (isMine) { pill = <Pill tone="info">Yours</Pill>; cls = 'bg-pt-accent/10 border-pt-accent' }
    if (clash.length) { pill = <Pill tone="taken">Clash</Pill>; cls = 'bg-red-500/[0.06] border-red-400/50' }
  }
  else if (st.t === 'past') { title = '—'; sub = 'Past'; cls = 'bg-pt-surface border-transparent opacity-45' }
  else if (st.t === 'held') {
    const forMe = st.entry.email === email
    face = <Avatar email={st.entry.email} name={st.entry.name} />
    title = <span className="text-amber-300">{forMe ? 'Held for you' : `Held for ${st.entry.name}`}</span>
    sub = `${st.entry.hold?.fromName}'s collab · ${forMe ? 'confirm above' : `opens at ${fmtTime(Number(st.until.slice(11, 13)) * 60 + Number(st.until.slice(14, 16)))} if not confirmed`}`
    pill = <Pill tone="warn">Held</Pill>; cls = 'bg-amber-400/[0.06] border-dashed border-amber-400/50'
  }
  else if (st.t === 'locked') { title = <span className="text-pt-muted">Priority only</span>; sub = `Opens ${stampLabel(st.opens)}`; pill = <Pill tone="muted"><Icon name="lock" className="w-3.5 h-3.5" label="Locked" /></Pill> }
  else { title = <span className="text-pt-accent">{team ? 'Free · book or block' : 'Free'}</span>; sub = isNoCrewDay(date) ? 'No crew' : null; cls = 'bg-pt-surface border-pt-accent/35' }
  const tappable = st.t === 'free' || st.t === 'booked' || (st.t === 'block' && team)
  return (
    <button disabled={!tappable} onClick={() => onTap(st)}
      className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border ${cls} ${tappable ? 'active:opacity-80' : ''}`}>
      <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums whitespace-nowrap">{fmtSlot(start, s.slotMinutes)}</span>
      {face}
      <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text truncate">{title}</span>{sub && <span className="block text-pt-muted text-xs truncate">{sub}</span>}</span>
      {pill}
    </button>
  )
}

// Offsite or location shoot: any start and end time (half hours) + where. Also used to move one.
function OffsiteSheet({ date, move, team, onClose, onDone }: { date: string; move?: Shoot; team: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const today = todayInStudio()
  const [day, setDay] = useState(move?.date ?? (date < today ? today : date))
  const [start, setStart] = useState(move?.start ?? 600)
  const [end, setEnd] = useState(move?.end ?? 840)
  const [where, setWhere] = useState(move?.where ?? '')
  const [forEmail, setForEmail] = useState('')
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (team && !move) listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [team, move])
  async function save() {
    setBusy(true); setErr('')
    try {
      if (move) { await moveShoot({ id: move.id, date: day, start, end, where }); onDone(move.id) }
      else { const r = await bookShoot({ place: 'offsite', date: day, start, end, where, ...(forEmail ? { forEmail } : {}) }); onDone(r.data.id) }
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const ends = HALF_HOURS.map(t => t + start + 30).filter(t => t <= start + 18 * 60)
  return (
    <BottomSheet open onClose={onClose} title={move ? 'Move your offsite shoot' : 'Offsite or location shoot'}>
      <p className="text-pt-muted text-sm">No house is held. It goes on the schedule so props, gear and the team know, and so it counts toward production.</p>
      <div className="space-y-3 mt-4">
        {team && !move && (
          <label className="block"><span className="block text-pt-muted text-xs mb-2">Book for</span>
            <select value={forEmail} onChange={e => setForEmail(e.target.value)} className={field}>
              <option value="">Me</option>
              {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
            </select></label>
        )}
        <label className="block"><span className="block text-pt-muted text-xs mb-2">Day</span>
          <input type="date" value={day} min={today} onChange={e => e.target.value && setDay(e.target.value)} className={field} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="block text-pt-muted text-xs mb-2">From</span>
            <select value={start} onChange={e => { const v = Number(e.target.value); setStart(v); if (end <= v) setEnd(v + 120) }} className={field}>
              {HALF_HOURS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select></label>
          <label className="block"><span className="block text-pt-muted text-xs mb-2">Until</span>
            <select value={end} onChange={e => setEnd(Number(e.target.value))} className={field}>
              {ends.map(t => <option key={t} value={t}>{fmtTime(t)}{t >= 1440 ? ' (next day)' : ''}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="block text-pt-muted text-xs mb-2">Where</span>
          <input value={where} onChange={e => setWhere(e.target.value)} placeholder="An address, or paste a Maps link" className={field} /></label>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        <button disabled={busy || !where.trim()} onClick={save} className={btnGold}>{busy ? 'Saving…' : move ? 'Move it' : 'Add to the schedule'}</button>
      </div>
    </BottomSheet>
  )
}

function BookSheet({ house, date, start, team, mine, dayFull, onClose, onBooked }: { house: Place; date: string; start: number; team: boolean; mine: Shoot[]; dayFull: boolean; onClose: () => void; onBooked: (id: string) => void }) {
  const s = useScheduleSettings()
  const usedThatMonth = mine.filter(x => x.month === monthOf(date) && x.kind === 'monthly').length
  const left = Math.max(0, s.monthlySlots - usedThatMonth)
  const [kind, setKind] = useState<ShootKind>(MONTHLY_SLOTS_ON && house === MONTHLY_HOUSE && (team || left > 0) ? 'monthly' : 'extra')
  const [forEmail, setForEmail] = useState('')
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (team) listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [team])
  async function book() {
    setBusy(true); setErr('')
    try {
      const r = await bookShoot({ place: house, date, start, kind, ...(forEmail ? { forEmail } : {}) })
      // A short "Booked ✓" moment (the button glows gold) before the shoot opens.
      setDone(true); setTimeout(() => onBooked(r.data.id), 650)
    }
    catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const h = house as House
  return (
    <BottomSheet open onClose={onClose} title="Book this slot">
      <p className="text-pt-muted text-sm">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.houses[h].name} · {fmtSlot(start, s.slotMinutes)}</p>
      <p className="text-pt-muted text-xs">{s.houses[h].address}</p>
      {team && (
        <label className="block mt-4"><span className="block text-pt-muted text-xs mb-2">Book for</span>
          <select value={forEmail} onChange={e => setForEmail(e.target.value)} className={field}>
            <option value="">Me</option>
            {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select></label>
      )}
      {MONTHLY_SLOTS_ON && house === MONTHLY_HOUSE && (
        <div className="mt-4"><span className="block text-pt-muted text-xs mb-2">Counts as</span>
          <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5">
            <button disabled={!team && left === 0} onClick={() => setKind('monthly')} className={`flex-1 py-2 rounded-[10px] text-sm disabled:opacity-40 ${kind === 'monthly' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>
              Monthly slot{team && forEmail ? '' : ` (${left} left)`}</button>
            <button onClick={() => setKind('extra')} className={`flex-1 py-2 rounded-[10px] text-sm ${kind === 'extra' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Extra slot</button>
          </div>
        </div>
      )}
      {isNoCrewDay(date) && <p className="mt-3 rounded-xl px-3 py-3 text-sm border border-sky-400/40 bg-sky-400/10 text-pt-text">Sunday: no crew. You run the shoot yourself.</p>}
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      {dayFull && !done && <p className="mt-3 rounded-xl px-3 py-3 text-sm bg-amber-400/10 text-pt-text shadow-[inset_0_0_0_0.5px_rgba(251,191,36,0.4)]">
        You already have your house slot that day. Creators book one {s.slotMinutes / 60}-hour slot a day; ask the schedule team if you need more.</p>}
      <button disabled={busy || done || dayFull} onClick={book} className={`mt-5 w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 ${done ? 'booked-flash !opacity-100' : ''}`}>{done ? 'Booked ✓' : busy ? 'Booking…' : 'Book it'}</button>
      <p className="text-pt-muted text-xs text-center mt-2">Confirmed instantly.</p>
    </BottomSheet>
  )
}

function ShootSheet({ id, team, sent, onClose, onMove, onSwap }: { id: string; team: boolean; sent?: string | null; onClose: () => void; onMove: (s: Shoot) => void; onSwap: (s: Shoot) => void }) {
  const s = useScheduleSettings()
  const { profile } = useSession()
  const profiles = useProfiles()
  const shoot = useShoot(id)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const now = nowStamp()
  if (shoot === undefined) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">Loading…</p></BottomSheet>
  if (shoot === null) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">This shoot can't be opened.</p></BottomSheet>
  const mine = shoot.creatorEmail === profile.email
  const where = shoot.place === 'offsite' ? shoot.where : `${s.houses[shoot.place].name} · ${s.houses[shoot.place].address}`
  const upcoming = shoot.status === 'booked' && shoot.from > now
  const justBooked = withinUndo(shoot.createdAt)
  const short = isShortNotice(shoot.from, now, s) && !justBooked
  // Inside the notice period a creator can only swap (house slots) or cancel as a no-show; the team can always move/cancel.
  const canMove = upcoming && (team || (mine && !short))
  const canSwap = upcoming && mine && shoot.place !== 'offsite'
  const canCancel = shoot.status === 'booked' && (team || (mine && upcoming))
  const noShow = !team && short
  async function cancel() {
    setBusy(true); setErr('')
    try { await cancelShoot({ id, ...(noShow ? { confirmNoShow: true } : {}) }); onClose() } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const actionLabel: Record<string, string> = { booked: 'Booked', cancelled: 'Cancelled', moved: 'Moved', swapped: 'Swapped', 'checked-in': 'Checked in', wrapped: 'Wrapped', reported: 'Reported', report: 'Sent a report', explained: 'Explained a missed check-in', 'no-show': 'No-show', 'marked-filmed': 'Marked as filmed', 'props-added': 'Props requested', 'gear-added': 'Gear held' }
  return (
    <BottomSheet open onClose={onClose} title={mine ? 'Your shoot' : shoot.creatorName}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Avatar email={shoot.creatorEmail} name={shoot.creatorName} size={44} ring={mine} />
          <div className="min-w-0">
            <p className="text-pt-text font-semibold">{formatDay(shoot.date, { weekday: 'long', month: 'short', day: 'numeric' })} · {fmtSlot(shoot.start, shoot.end - shoot.start)}</p>
            <p className="text-pt-muted text-sm">{where}</p>
            {!mine && profiles[shoot.creatorEmail]?.channel && <p className="text-pt-muted text-sm">{profiles[shoot.creatorEmail]!.channel}</p>}
            <div className="flex gap-2 mt-2">
              {shoot.status === 'cancelled' ? <Pill tone="taken">Cancelled</Pill> : <Pill tone="free">Booked</Pill>}
              {(MONTHLY_SLOTS_ON || shoot.kind === 'offsite') && <Pill tone="muted">{shoot.kind === 'monthly' ? 'Monthly slot' : shoot.kind === 'offsite' ? 'Offsite' : 'Extra slot'}</Pill>}
            </div>
          </div>
        </div>
        {sent && mine && (
          <div className="rounded-xl px-3 py-3 text-sm bg-green-500/10 border border-green-500/30 text-pt-text">
            <b className="text-green-400">Sent ✓</b> {sent === 'gear' ? 'Your gear is held.' : sent === 'both' ? 'Props went to the arts team, gear to the equipment team.' : 'The arts team has your props request. Add gear below if you need it.'}
          </div>
        )}
        {shoot.status === 'booked' && <OnTheDay shoot={shoot} mine={mine} team={team} />}
        {shoot.status === 'booked' && <ShootNeeds shoot={shoot} mine={mine} team={team} />}
        {mine && upcoming && short && !team && (
          <p className="rounded-xl px-3 py-3 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">
            Less than {s.noticeHours} hours to go. You can still <b>swap</b> with someone; cancelling now counts as a no-show.
          </p>
        )}
        {(canMove || canSwap) && (
          <div className="flex gap-2">
            {canMove && <button onClick={() => onMove(shoot)} className="flex-1 bg-pt-border text-pt-text font-semibold rounded-xl py-3">Move</button>}
            {canSwap && <button onClick={() => onSwap(shoot)} className="flex-1 bg-pt-border text-pt-text font-semibold rounded-xl py-3">Swap with someone</button>}
          </div>
        )}
        <div>
          <p className="text-pt-muted text-xs mb-1">History</p>
          <ol className="bg-pt-bg rounded-xl divide-y divide-white/[0.06]">
            {shoot.history.map((h, i) => (
              <li key={i} className="px-3 py-2 text-sm"><span className="text-pt-muted text-xs block">{new Date(h.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="text-pt-text">{actionLabel[h.action] ?? h.action}{h.note ? ` · ${h.note}` : ''}</span></li>
            ))}
          </ol>
        </div>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {canCancel && !confirm && (
          <button onClick={() => setConfirm(true)} className="w-full bg-red-500/15 text-red-300 font-semibold rounded-xl py-3">
            {team && !mine ? 'Cancel their shoot (no strike)' : noShow ? 'Cancel (counts as a no-show)' : 'Cancel this shoot'}</button>
        )}
        {canCancel && confirm && (
          <div className="space-y-2">
            <p className="text-pt-text text-sm">{noShow ? `It's less than ${s.noticeHours} hours before your shoot, so cancelling counts as a no-show. Swapping with someone doesn't.` : 'The slot opens to everyone right away.'} Props and gear requested for this shoot are cancelled too.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-3">Keep it</button>
              <button disabled={busy} onClick={cancel} className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Cancelling…' : 'Yes, cancel'}</button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

// Move a house shoot to another free slot in one step (the old one is only given up once the new one is yours).
function MoveSheet({ shoot, days, team, now, onClose, onMoved }: { shoot: Shoot; days: Record<string, ScheduleDay>; team: boolean; now: string; onClose: () => void; onMoved: (s: Shoot) => void }) {
  const s = useScheduleSettings()
  const [where, setWhere] = useState<House | 'any'>(shoot.place as House)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const today = todayInStudio()
  const { role, profile } = useSession()
  // Moving the owner's own shoot follows the priority lock; the team moving someone else's doesn't.
  const results = findFree(days, today, 60, 1, where === 'any' ? HOUSES : [where], s, shoot.creatorEmail, now, team && !(role === 'owner' && shoot.creatorEmail === profile.email), 10)
  async function go(date: string, house: House, start: number) {
    const key = `${date}${house}${start}`
    setBusy(key); setErr('')
    try {
      await moveShoot({ id: shoot.id, place: house, date, start })
      const win = slotWindow(date, start, s.slotMinutes)
      onMoved({ ...shoot, place: house, date, start, end: start + s.slotMinutes, from: win.from, to: win.to })
    } catch (e) { setErr(errorText(e)); setBusy('') }
  }
  return (
    <BottomSheet open onClose={onClose} title="Move to…">
      <p className="text-pt-muted text-sm">Now: {formatDay(shoot.date)} · {s.houses[shoot.place as House].name} · {fmtSlot(shoot.start, shoot.end - shoot.start)}. You keep it until the new slot is yours.</p>
      <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5 mt-3">
        {([...HOUSES, 'any'] as const).map(h => (
          <button key={h} onClick={() => setWhere(h)} className={`flex-1 py-2 rounded-[10px] text-sm ${where === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h === 'any' ? 'Either' : s.houses[h].name}</button>
        ))}
      </div>
      {MONTHLY_SLOTS_ON && shoot.kind === 'monthly' && <p className="text-pt-muted text-xs mt-2">Stays a monthly slot at {s.houses.cliff1.name}; at {s.houses.cliff2.name} it becomes an extra slot.</p>}
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      <div className="mt-3 space-y-2">
        {results.length === 0 && <p className="text-pt-muted text-sm">No free slots in the next 60 days.</p>}
        {results.map(r => (
          <div key={`${r.date}${r.house}${r.start}`} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
            <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold">{formatDay(r.date)}</p>
              <p className="text-pt-muted text-xs">{s.houses[r.house].name} · {fmtSlot(r.start, s.slotMinutes)}{isNoCrewDay(r.date) ? ' · no crew' : ''}</p></div>
            <button disabled={!!busy} onClick={() => go(r.date, r.house, r.start)} className="bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-40">{busy === `${r.date}${r.house}${r.start}` ? 'Moving…' : 'Move here'}</button>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}

// Ask someone to trade slots. Start from your shoot (pick theirs) or from theirs (pick yours).
function SwapSheet({ mine, theirs, days, myShoots, email, now, onClose }: {
  mine?: Shoot; theirs?: TheirSlot; days: Record<string, ScheduleDay>; myShoots: Shoot[]; email: string; now: string; onClose: () => void
}) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [sent, setSent] = useState('')
  const others: TheirSlot[] = useMemo(() => {
    const out: TheirSlot[] = []
    for (const [date, d] of Object.entries(days).sort(([a], [b]) => a.localeCompare(b))) {
      for (const house of HOUSES) for (const [k, e] of Object.entries(d[house] ?? {})) {
        const start = Number(k)
        if (e.email === email || slotWindow(date, start, s.slotMinutes).from <= now) continue
        out.push({ shootId: e.shootId, name: e.name, email: e.email, date, house, start })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).slice(0, 60)
  }, [days, email, now, s.slotMinutes])
  const mySlots = myShoots.filter(x => x.place !== 'offsite' && x.from > now)
  async function ask(myId: string, theirId: string, name: string) {
    setBusy(myId + theirId); setErr('')
    try { await requestSwap({ myShootId: myId, theirShootId: theirId }); setSent(name) } catch (e) { setErr(errorText(e)) } finally { setBusy('') }
  }
  const row = (key: string, who: React.ReactNode, line: string, onAsk: () => void) => (
    <div key={key} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
      {who}
      <p className="flex-1 min-w-0 text-pt-text text-sm">{line}</p>
      <button disabled={!!busy} onClick={onAsk} className="bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-40">Ask</button>
    </div>
  )
  return (
    <BottomSheet open onClose={onClose} title="Swap with someone">
      {sent ? (
        <div className="space-y-3">
          <p className="text-pt-text">Asked ✓</p>
          <p className="text-pt-muted text-sm">{sent} sees your request in their Schedule. When they accept, your shoots switch instantly. Until then nothing changes.</p>
          <button onClick={onClose} className={btnGold}>Done</button>
        </div>
      ) : (
        <>
          <p className="text-pt-muted text-sm">
            {mine ? `Offer your ${formatDay(mine.date)} · ${fmtSlot(mine.start, mine.end - mine.start)} slot. Pick whose slot you'd like instead.`
              : theirs ? `Ask ${theirs.name} for ${formatDay(theirs.date)} · ${fmtSlot(theirs.start, s.slotMinutes)}. Pick which of your shoots to offer.` : ''}
            {' '}A swap never counts as a no-show.
          </p>
          {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
          <div className="mt-3 space-y-2">
            {mine && others.length === 0 && <p className="text-pt-muted text-sm">No one else has an upcoming house slot.</p>}
            {mine && others.map(o => row(o.shootId, <Avatar email={o.email} name={o.name} />, `${o.name} · ${formatDay(o.date)} · ${s.houses[o.house].name} · ${fmtSlot(o.start, s.slotMinutes)}`, () => ask(mine.id, o.shootId, o.name)))}
            {theirs && mySlots.length === 0 && <p className="text-pt-muted text-sm">You have no upcoming house shoots to offer.</p>}
            {theirs && mySlots.map(m => row(m.id, null, `Your ${formatDay(m.date)} · ${s.houses[m.place as House].name} · ${fmtSlot(m.start, m.end - m.start)}`, () => ask(m.id, theirs.shootId, theirs.name)))}
          </div>
        </>
      )}
    </BottomSheet>
  )
}

// A pending swap: someone asking me (accept / decline), or me waiting on someone (withdraw).
function SwapAsk({ r, incoming = false }: { r: SwapRequest; incoming?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const label = (x: SwapRequest['from']) => `${formatDay(x.date)} · ${x.place === 'offsite' ? 'Offsite' : s.houses[x.place].name} · ${fmtSlot(x.start, x.end - x.start)}`
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerSwap({ id: r.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl p-4 border border-pt-accent/50 bg-pt-accent/10 space-y-2">
      <div className="flex items-center gap-3">
        <Avatar email={incoming ? r.fromEmail : r.toEmail} name={incoming ? r.fromName : r.toName} />
        <p className="text-pt-text text-sm flex-1 min-w-0">
          {incoming ? <><b>{r.fromName}</b> asks to swap: you'd get <b>{label(r.from)}</b>, they'd get your <b>{label(r.to)}</b>.</>
            : <>Waiting for <b>{r.toName}</b> to answer your swap: your {label(r.from)} for their {label(r.to)}.</>}
        </p>
      </div>
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        {incoming && <button disabled={busy} onClick={() => answer(true)} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-2 disabled:opacity-40">Accept</button>}
        <button disabled={busy} onClick={() => answer(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 disabled:opacity-40">{incoming ? 'Decline' : 'Withdraw'}</button>
      </div>
    </div>
  )
}

function TeamSlotSheet({ date, house, start, onClose, onBook }: { date: string; house: House; start: number; onClose: () => void; onBook: () => void }) {
  const s = useScheduleSettings()
  const [type, setType] = useState<BlockType>('cleaners')
  const [allDay, setAllDay] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function block() {
    setBusy(true); setErr('')
    try { await addScheduleBlock({ date, house, type, note, ...(allDay ? { allDay: true } : { start, end: start + s.slotMinutes }) }); onClose() }
    catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title="Book or block">
      <p className="text-pt-muted text-sm">{formatDay(date)} · {s.houses[house].name} · {fmtSlot(start, s.slotMinutes)}</p>
      <button onClick={onBook} className="mt-4 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Book this slot…</button>
      <div className="mt-5 border-t border-pt-border pt-4 space-y-3">
        <p className="text-pt-text font-semibold">Or block it</p>
        <p className="text-pt-muted text-sm">Cleaners, maintenance, events, external rentals: anything that affects filming. Nobody can book blocked time.</p>
        <select value={type} onChange={e => setType(e.target.value as BlockType)} className={field}>
          {(Object.keys(BLOCK_TYPES) as BlockType[]).map(t => <option key={t} value={t}>{BLOCK_TYPES[t]}</option>)}
        </select>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional), e.g. Deep clean" className={field} />
        <label className="flex items-center gap-2 text-pt-text text-sm"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> Block the whole day at {s.houses[house].name}</label>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        <button disabled={busy} onClick={block} className="w-full bg-pt-border text-pt-text font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Blocking…' : allDay ? 'Block the whole day' : 'Block this slot'}</button>
      </div>
    </BottomSheet>
  )
}

function UnblockSheet({ date, block, onClose }: { date: string; block: Block; onClose: () => void }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function remove() {
    setBusy(true); setErr('')
    try { await removeScheduleBlock({ date, id: block.id }); onClose() } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title={block.note || BLOCK_TYPES[block.type]}>
      <p className="text-pt-muted text-sm">{formatDay(date)} · {s.houses[block.house].name} · {fmtTime(block.start)}–{fmtTime(block.end)} · {BLOCK_TYPES[block.type]}</p>
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      <button disabled={busy} onClick={remove} className="mt-5 w-full bg-red-500/15 text-red-300 font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Removing…' : 'Remove this block'}</button>
    </BottomSheet>
  )
}

function FindSheet({ days, from, house, team, email, now, onClose, onPick, onOffsite }: {
  days: Record<string, ScheduleDay>; from: string; house?: House; team: boolean; email: string; now: string
  onClose: () => void; onPick: (date: string, house: House, start: number, friends: Friend[]) => void; onOffsite: () => void
}) {
  const { role } = useSession()
  const s = useScheduleSettings()
  const profiles = useProfiles()
  // Picks from ✦ Prop ideas waiting for this new shoot: start on the first day they can still be added.
  const pending = useMemo(() => peekPendingAdds(), [])
  const earliestFor = useEarliestDayFor()
  const minDay = pending ? earliestFor(pending, from) : from
  from = minDay > from ? minDay : from
  // Owner (Oct 19): ask WHO is filming (just me / with 1 or 2 friends), not how many hours. Each person gets
  // one slot back to back; picked friends get their slot held for them to confirm.
  const [friendCount, setFriendCount] = useState(0)
  const [friends, setFriends] = useState<Friend[]>([])
  const [people, setPeople] = useState<Friend[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { if (friendCount && !people) listFilmingFriends({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [friendCount, people])
  const chosen = friends.slice(0, friendCount)
  const count = 1 + friendCount
  const [where, setWhere] = useState<House | 'any'>(house ?? 'any')
  // Times first, soonest first. One row per time with a button for each house that's free then,
  // so people pick the house themselves (no default).
  const results = useMemo(() => {
    // The owner booking for themselves follows the priority lock (owner, Oct 27); only equipment overrides it here.
    const found = findFree(days, from, 60, count, where === 'any' ? HOUSES : [where], s, email, now, team && role !== 'owner', 2000)
      // Skip days a picked friend already films at a house (they get one slot a day too).
      .filter(r => team || chosen.every(f => houseSlotsOn(days[r.date], f.email, now) < s.slotsPerDay))
    const byTime = new Map<string, { date: string; start: number; houses: House[] }>()
    for (const r of found) {
      const k = `${r.date}|${r.start}`
      const had = byTime.get(k)
      if (!had) byTime.set(k, { date: r.date, start: r.start, houses: [r.house] })
      else had.houses = HOUSES.filter(h => h === r.house || had.houses.includes(h))
    }
    return [...byTime.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  }, [days, from, count, where, s, email, now, team, chosen.map(f => f.email).join()])   // eslint-disable-line react-hooks/exhaustive-deps
  // Owner (Oct 19): jump to a day instead of scrolling. "Soonest" = the next days with free times;
  // a picked day shows all of its times first, then the days after it. Each other day shows 3 (tap for the rest).
  const [pick, setPick] = useState<string | null>(null)
  const [open, setOpen] = useState<string[]>([])
  const freeDays = useMemo(() => new Set(results.map(r => r.date)), [results])
  const strip = useMemo(() => Array.from({ length: 35 }, (_, k) => addDays(from, k)), [from])
  const dayGroups: [string, typeof results][] = []
  for (const r of results) {
    if (pick && r.date < pick) continue
    const last = dayGroups[dayGroups.length - 1]
    if (last && last[0] === r.date) last[1].push(r); else if (dayGroups.length < 6) dayGroups.push([r.date, [r]])
  }
  const pickedEmpty = pick && !freeDays.has(pick)
  const needPick = friendCount > 0 && chosen.length < friendCount
  // Owner (Oct 19): a search, not a list of usual partners (who you film with changes). Name or channel.
  const term = q.trim().toLowerCase()
  const matches = term ? (people ?? []).filter(p => !chosen.some(c => c.email === p.email)
    && (p.name.toLowerCase().includes(term) || (profiles[p.email]?.channel ?? '').toLowerCase().includes(term))) : []
  const who = ['Just me', '+ 1 friend', '+ 2 friends']
  return (
    <BottomSheet open onClose={onClose} title="Book a shoot">
      {pending && <p className="mb-4 rounded-xl px-3 py-3 text-sm bg-[#BF9DFF]/10 text-pt-text shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)]">✦ The props and gear you picked go into this shoot once it's booked{minDay > todayInStudio() ? `. Times start ${formatDay(minDay, { weekday: 'long', month: 'short', day: 'numeric' })}, the first day there's still time to get them ready` : ''}.</p>}
      {/* Where first (owner, Oct 30: offsite was hidden at the bottom). One slim row so the times stay high up. */}
      <div className="flex bg-pt-bg rounded-full p-0.5 gap-0.5 text-sm mb-4">
        <span className="flex-1 rounded-full min-h-[36px] grid place-items-center bg-pt-border text-pt-text font-semibold">At the houses</span>
        <button onClick={onOffsite} className="flex-1 rounded-full min-h-[36px] text-pt-muted">Somewhere else ›</button>
      </div>
      <p className="text-pt-muted text-xs mb-2">Who's filming?</p>
      <div className="flex bg-pt-bg rounded-full p-1 gap-1">
        {who.map((label, n) => (
          <button key={n} onClick={() => { setFriendCount(n); setFriends(f => f.slice(0, n)) }} className={`flex-1 rounded-full min-h-[40px] text-sm ${friendCount === n ? 'bg-pt-accent text-stone-900 font-semibold shadow-gold' : 'text-pt-text'}`}>{label}</button>
        ))}
      </div>
      {friendCount > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {chosen.map(f => (
              <button key={f.email} onClick={() => setFriends(x => x.filter(y => y.email !== f.email))} className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline">
                <Avatar email={f.email} name={f.name} size={32} />{f.name.split(' ')[0]}<span className="text-pt-muted">×</span>
              </button>
            ))}
          </div>
          {needPick && (
            <div className="bg-pt-bg rounded-xl p-2">
              <input type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={chosen.length ? 'Search for your second friend' : 'Search by name or channel'} className={field} />
              <div className="max-h-48 overflow-y-auto mt-1">
                {term && people === null && <p className="text-pt-muted text-sm p-2">Loading…</p>}
                {term && people !== null && matches.length === 0 && <p className="text-pt-muted text-sm p-2">No one called "{q.trim()}".</p>}
                {matches.slice(0, 6).map(p => (
                  <button key={p.email} onClick={() => { setFriends([...chosen, p]); setQ('') }} className="w-full flex items-center gap-3 p-2 rounded-lg text-left">
                    <Avatar email={p.email} name={p.name} size={32} />
                    <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm truncate">{p.name}</span>
                      {profiles[p.email]?.channel && <span className="block text-pt-muted text-xs truncate">{profiles[p.email]!.channel}</span>}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-pt-muted text-xs">{chosen.length === friendCount
            ? `You book your slot; ${chosen.length > 1 ? 'theirs are' : 'theirs is'} held for ${INVITE_HOLD_MINUTES} minutes for them to confirm.`
            : 'Each of you gets a 2-hour slot, back to back. Pick who, or they can book the next slot themselves.'}</p>
        </div>
      )}
      <div className="mt-5 -mx-6 px-6 flex gap-2 overflow-x-auto no-scrollbar">
        <button onClick={() => setPick(null)} className={`shrink-0 rounded-2xl px-4 min-h-[56px] text-sm font-semibold ${pick === null ? 'bg-pt-accent text-stone-900 shadow-gold' : 'bg-pt-bg text-pt-text'}`}>Soonest</button>
        {strip.map(d => {
          const on = pick === d, free = freeDays.has(d)
          return (
            <button key={d} onClick={() => { setPick(d); setOpen(o => o.includes(d) ? o : [...o, d]) }} aria-label={formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}
              className={`shrink-0 w-12 rounded-2xl min-h-[56px] flex flex-col items-center justify-center ${on ? 'bg-pt-accent text-stone-900 shadow-gold' : free ? 'bg-pt-bg text-pt-text' : 'bg-pt-bg text-pt-muted/50'}`}>
              <span className="text-xs leading-none">{formatDay(d, { weekday: 'short' })}</span>
              <span className="text-[17px] font-semibold leading-tight mt-1">{Number(d.slice(8))}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-5 space-y-6">
        {pickedEmpty && <p className="text-pt-muted text-sm">Nothing free on {formatDay(pick!, { weekday: 'long', month: 'short', day: 'numeric' })}{friendCount ? ' for all of you' : ''}. The next free days are below.</p>}
        {results.length === 0 && <p className="text-pt-muted text-sm">Nothing free in the next 60 days{where === 'any' ? '' : ` at ${s.houses[where].name}`}. Try {friendCount ? 'fewer friends' : 'another house'}.</p>}
        {dayGroups.map(([d, list]) => (
          <div key={d}>
            <p className="text-pt-text text-[20px] font-semibold tracking-heading mb-3">{d === todayInStudio() ? 'Today' : formatDay(d, { weekday: 'long', month: 'short', day: 'numeric' })}{isNoCrewDay(d) && <span className="text-pt-muted text-sm font-normal"> · no crew</span>}</p>
            <div className="space-y-2">
              {(open.includes(d) ? list : list.slice(0, 3)).map(r => (
                <div key={`${r.date}${r.start}`} className="flex items-center gap-2 bg-pt-bg rounded-xl p-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-pt-text font-semibold">{fmtSlot(r.start, count * s.slotMinutes)}</span>
                    {friendCount > 0 && <span className="block text-pt-muted text-xs truncate">You {fmtSlot(r.start, s.slotMinutes)}{chosen.length ? ` · then ${chosen.map(f => f.name.split(' ')[0]).join(', ')}` : ''}</span>}
                  </span>
                  {r.houses.map(h => (
                    <button key={h} onClick={() => onPick(r.date, h, r.start, chosen.length === friendCount ? chosen : [])} aria-label={`${team ? 'Open' : 'Book'} ${s.houses[h].name}`}
                      className="bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[40px] text-sm shadow-gold shrink-0">{s.houses[h].name}</button>
                  ))}
                </div>
              ))}
              {list.length > 3 && !open.includes(d) && (
                <button onClick={() => setOpen(o => [...o, d])} className="tap text-pt-accent text-sm">{list.length - 3} more {list.length - 3 === 1 ? 'time' : 'times'} this day</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex bg-pt-bg rounded-full p-0.5 gap-0.5 text-xs w-fit">
        {(['any', ...HOUSES] as const).map(h => (
          <button key={h} onClick={() => setWhere(h)} className={`px-3 py-1.5 rounded-full ${where === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h === 'any' ? 'Any house' : `Only ${s.houses[h].name}`}</button>
        ))}
      </div>
    </BottomSheet>
  )
}

// Book your slot and hold the next one(s) for the friends you picked (they confirm within 20 minutes).
function GroupBookSheet({ house, date, start, friends, team, mine, onClose, onBooked }: {
  house: House; date: string; start: number; friends: Friend[]; team: boolean; mine: Shoot[]; onClose: () => void; onBooked: (id: string) => void
}) {
  const s = useScheduleSettings()
  const left = Math.max(0, s.monthlySlots - mine.filter(x => x.month === monthOf(date) && x.kind === 'monthly').length)
  const [kind, setKind] = useState<ShootKind>(MONTHLY_SLOTS_ON && house === MONTHLY_HOUSE && (team || left > 0) ? 'monthly' : 'extra')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  async function book() {
    setBusy(true); setErr('')
    try {
      const r = await bookWithFriends({ place: house, date, start, friends: friends.map(f => f.email), mySlots: 1, kind })
      setDone(true); setTimeout(() => onBooked(r.data.shootIds[0]), 650)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const { profile } = useSession()
  const rows = [{ email: profile.email, name: 'You', note: 'Booked' }, ...friends.map(f => ({ email: f.email, name: f.name, note: `Held ${INVITE_HOLD_MINUTES} min` }))]
  return (
    <BottomSheet open onClose={onClose} title="Book back to back">
      <p className="text-pt-muted text-sm">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.houses[house].name}</p>
      <div className="mt-4 space-y-2">
        {rows.map((p, i) => (
          <div key={p.email} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
            <Avatar email={p.email} name={i === 0 ? (profile.name || 'You') : p.name} size={36} />
            <span className="flex-1 min-w-0"><span className="block text-pt-text font-semibold truncate">{p.name}</span>
              <span className="block text-pt-muted text-xs">{fmtSlot(start + i * s.slotMinutes, s.slotMinutes)}</span></span>
            <span className={`text-xs ${i === 0 ? 'text-pt-accent' : 'text-amber-300'}`}>{p.note}</span>
          </div>
        ))}
      </div>
      {MONTHLY_SLOTS_ON && house === MONTHLY_HOUSE && (
        <div className="mt-4"><span className="block text-pt-muted text-xs mb-2">Your slot counts as</span>
          <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5">
            <button disabled={!team && left === 0} onClick={() => setKind('monthly')} className={`flex-1 py-2 rounded-[10px] text-sm disabled:opacity-40 ${kind === 'monthly' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Monthly slot ({left} left)</button>
            <button onClick={() => setKind('extra')} className={`flex-1 py-2 rounded-[10px] text-sm ${kind === 'extra' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Extra slot</button>
          </div>
        </div>
      )}
      <p className="text-pt-muted text-xs mt-4">{friends.map(f => f.name.split(' ')[0]).join(' and ')} {friends.length > 1 ? 'get' : 'gets'} a notification to confirm. If they don't within {INVITE_HOLD_MINUTES} minutes, the slot opens to everyone.</p>
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      <button disabled={busy || done} onClick={book} className={`mt-5 ${btnGold} ${done ? 'booked-flash !opacity-100' : ''}`}>{done ? 'Booked ✓' : busy ? 'Booking…' : `Book + invite ${friends.length > 1 ? 'them' : friends[0].name.split(' ')[0]}`}</button>
    </BottomSheet>
  )
}

// "Add to my calendar": a private link phone calendars subscribe to; it updates by itself.
function CalendarSheet({ team, onClose }: { team: boolean; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = (reset = false) => { setErr(''); setMsg(''); myCalendarLink({ reset }).then(r => { setLink(r.data); if (reset) setMsg('New link made. The old one no longer works.') }).catch(e => setErr(errorText(e))) }
  useEffect(() => { load() }, [])
  async function copy() {
    if (!link) return
    try { await navigator.clipboard.writeText(link.url); setMsg('Link copied ✓') } catch { setMsg(link.url) }
  }
  return (
    <BottomSheet open onClose={onClose} title="Add to my calendar">
      <p className="text-pt-muted text-sm">{team ? "Every shoot on the schedule shows up in your phone's calendar" : "Your shoots show up in your phone's calendar"} and update by themselves (within about an hour). This link is private: don't share it.</p>
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      {!link && !err && <p className="text-pt-muted text-sm mt-3">Making your link…</p>}
      {link && (
        <div className="space-y-2 mt-4">
          <a href={link.webcal} className={`block text-center ${btnGold}`}>Add to iPhone / Apple Calendar</a>
          <button onClick={copy} className={btnGrey}>Copy link (for Google Calendar)</button>
          <p className="text-pt-muted text-xs">Google Calendar: on a computer, open Google Calendar → Other calendars → + → From URL, and paste the link.</p>
          <button onClick={() => load(true)} className="w-full text-pt-muted text-xs underline py-1">Shared it by mistake? Make a new link</button>
          {msg && <p className="text-pt-text text-sm break-all">{msg}</p>}
        </div>
      )}
    </BottomSheet>
  )
}

// On the day: progress, check in (set photo + report the slot before), wrap; missed check-ins.
function OnTheDay({ shoot, mine, team }: { shoot: Shoot; mine: boolean; team: boolean }) {
  const s = useScheduleSettings()
  const now = nowStamp()
  const days = useScheduleDays(shoot.date, shoot.date)
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [over, setOver] = useState(0)
  const [mess, setMess] = useState(false)
  const [messPhotos, setMessPhotos] = useState<string[]>([])
  const [reportNote, setReportNote] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const win = checkinWindow(shoot, now, s)
  const missed = isMissed(shoot, now)
  const prev = shoot.place !== 'offsite' ? days?.[shoot.date]?.[shoot.place]?.[slotKey(shoot.start - s.slotMinutes)] : undefined
  const prevOther = prev && prev.shootId !== shoot.id ? prev : undefined
  async function run(f: () => Promise<unknown>) { setBusy(true); setErr(''); try { await f() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) } }
  const stage = shoot.wrap ? 3 : shoot.checkin ? 2 : 1
  const step = (on: boolean) => `flex-1 h-1 rounded-full ${on ? 'bg-pt-accent' : 'bg-pt-border'}`
  return (
    <div className="space-y-3">
      {shoot.place !== 'offsite' && (
        <div>
          <div className="flex gap-1"><span className={step(true)} /><span className={step(stage >= 2)} /><span className={step(stage >= 3)} /></div>
          <div className="flex justify-between text-xs text-pt-muted mt-1"><span>Booked</span><span>Checked in</span><span>Filmed</span></div>
        </div>
      )}
      {err && <p className="text-red-300 text-sm">{err}</p>}

      {mine && !shoot.checkin && win === 'open' && (
        <div className="bg-pt-bg rounded-xl p-3 space-y-3">
          <p className="text-pt-text font-semibold">You're up: check in</p>
          <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo of the set" hint="Opens your camera" max={3} />
          {prevOther && (
            <div className="space-y-2">
              <p className="text-pt-muted text-sm">The slot before you: <b className="text-pt-text">{prevOther.name}</b>. Anything wrong? The team reviews every report.</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setOver(over ? 0 : 15)} className={`px-3 py-2 rounded-full text-sm border ${over ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-surface text-pt-text'}`}>Ran over into my time</button>
                <button onClick={() => setMess(!mess)} className={`px-3 py-2 rounded-full text-sm border ${mess ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-surface text-pt-text'}`}>House left a mess</button>
              </div>
              {over > 0 && <select value={over} onChange={e => setOver(Number(e.target.value))} className={field}>{[10, 15, 20, 30, 45, 60, 90].map(m => <option key={m} value={m}>They left {m} minutes late</option>)}</select>}
              {mess && <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={messPhotos} onChange={setMessPhotos} onUploading={setUploading} label="Photos of the mess" max={5} />}
              {(over > 0 || mess) && <textarea value={reportNote} onChange={e => setReportNote(e.target.value.slice(0, 300))} rows={2} placeholder="What happened? e.g. They were still packing up at 3:20, dishes left in the sink" className={field} />}
            </div>
          )}
          <button disabled={busy || uploading || !photos.length || (mess && !messPhotos.length)} className={btnGold}
            onClick={() => run(() => checkInShoot({ id: shoot.id, photos, ...((over || mess) ? { report: { overMinutes: over || undefined, mess, photos: messPhotos, ...(reportNote.trim() ? { note: reportNote.trim() } : {}) } } : {}) }))}>
            {busy ? 'Checking in…' : over || mess ? 'Check in and send report' : 'Check in'}</button>
        </div>
      )}
      {mine && !shoot.checkin && win === 'early' && shoot.from.slice(0, 10) === now.slice(0, 10) && (
        <p className="text-pt-muted text-sm">Check-in opens {s.checkinBefore} minutes before your shoot. You'll take a photo of the set.</p>
      )}

      {shoot.checkin && (
        <div className="bg-pt-bg rounded-xl p-3 space-y-2">
          <p className="text-pt-text text-sm">Checked in {new Date(shoot.checkin.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}{shoot.wrap ? ` · filmed “${shoot.wrap.title}”` : ''}</p>
          <PhotoStrip urls={shoot.checkin.photos} title="Set photo" />
          {mine && !shoot.wrap && (
            <div className="flex gap-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What did you film?" className={field} />
              <button disabled={busy} onClick={() => run(() => wrapShoot({ id: shoot.id, title }))} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 disabled:opacity-40">Wrap</button>
            </div>
          )}
        </div>
      )}

      {missed && (
        <div className="rounded-xl p-3 space-y-2 border border-red-400/40 bg-red-400/10">
          <p className="text-pt-text text-sm font-semibold">No check-in for this shoot</p>
          {shoot.explanation && <p className="text-pt-text text-sm">“{shoot.explanation.text}”</p>}
          {mine && !shoot.explanation && now < explainUntil(shoot, s) && (
            <>
              <p className="text-pt-muted text-sm">Did you film? Tell the schedule team what happened before {stampLabel(explainUntil(shoot, s))}. Otherwise it may count as a no-show.</p>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="e.g. My phone died, we filmed 1–3 PM" className={field} />
              <button disabled={busy || !text.trim()} onClick={() => run(() => explainMissedCheckIn({ id: shoot.id, text }))} className={btnGrey}>Send</button>
            </>
          )}
          {mine && !shoot.explanation && now >= explainUntil(shoot, s) && <p className="text-pt-muted text-sm">The schedule team will decide.</p>}
          {team && (
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => run(() => decideShoot({ id: shoot.id, outcome: 'filmed' }))} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm disabled:opacity-40">They filmed</button>
              <button disabled={busy} onClick={() => run(() => decideShoot({ id: shoot.id, outcome: 'noshow' }))} className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm disabled:opacity-40">No-show · strike</button>
            </div>
          )}
        </div>
      )}
      {shoot.outcome && <p className="text-pt-muted text-sm">{shoot.outcome === 'filmed' ? 'Marked as filmed by the team.' : 'Marked as a no-show by the team.'}</p>}
    </div>
  )
}

// Someone invited you to film right after them: the slot is held for you for 20 minutes.
function InviteAsk({ inv, now }: { inv: ScheduleInvite; now: string }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const until = fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerInvite({ id: inv.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl p-4 border border-amber-400/40 bg-amber-400/10 space-y-2">
      <p className="text-pt-text text-[15px]"><b>{inv.fromName}</b> invited you to film right after them: <b>{formatDay(inv.date)} · {s.houses[inv.place].name} · {fmtSlot(inv.start, inv.end - inv.start)}</b>.</p>
      <p className="text-amber-200 text-sm">Held for you until {until}{inv.until.slice(0, 10) !== now.slice(0, 10) ? ` (${formatDay(inv.until.slice(0, 10))})` : ''}.</p>
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => answer(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-3 disabled:opacity-40">Can't make it</button>
        <button disabled={busy} onClick={() => answer(true)} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40 shadow-gold">Confirm my slot</button>
      </div>
    </div>
  )
}
