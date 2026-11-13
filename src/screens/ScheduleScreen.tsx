import { secondaryBtn } from '../components/ChatCard'
import { Icon } from '../components/Icon'
import { friendlyError } from '../lib/errors'
import GuidelinePicker from '../components/GuidelinePicker'
import MonthGrid, { monthAdd, monthTitle } from '../components/MonthGrid'
import { SwapAsk, InviteAsk, DayLineup } from '../components/ScheduleAsks'
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
import { useDesk } from '../desk/desk'
import AiButton from '../components/AiButton'
import { useAssistant } from '../assistant'
import { Pill } from '../components/GearUi'
import ProofPhotos, { PhotoStrip } from '../components/ProofPhotos'
import { whenLabel, formatDay } from '../lib/dates'
import { useProfiles } from '../services/profiles'
import { useUsualPartners } from '../hooks/useUsualPartners'
import { useMyWaitlist, waitKey } from '../hooks/useWaitlist'
import { waitRefusal } from '../../functions/src/waitlistRules'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, needsGuideline, houseFreeFrom, type Guideline, useMyShoots, useShoot, useMySwaps, useMyStatus, useMyInvites, bookShoot, cancelShoot, moveShoot, requestSwap,
  addScheduleBlock, removeScheduleBlock, redoCalendarImport, listSchedulePeople, listFilmingFriends, bookWithFriends, INVITE_HOLD_MINUTES, myCalendarLink, checkInShoot, wrapShoot, explainMissedCheckIn, decideShoot,
  checkinWindow, isMissed, explainUntil, slotKey, errorText, slotState, findFree, fmtSlot, isNoCrewDay,
  monthOf, isShortNotice, withinUndo, bookedLate, cancelCountsAsNoShow, timeSetByTeam, LATE_BOOKING_FREE_HOURS, slotWindow, HOUSES, BLOCK_TYPES, MONTHLY_HOUSE, headsUps,
  type House, type Place, type ScheduleDay, type Block, type ShootKind, type BlockType, type Shoot,
  houseSlotsOn, MONTHLY_SLOTS_ON, isLive,
} from '../services/schedule'

const calendarPending = httpsCallable<Record<string, never>, { pending: unknown[] }>(functions, 'calendarPending')
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const stampLabel = (s: string) => `${formatDay(s.slice(0, 10))}, ${fmtTime(Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)))}`
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const btnGrey = 'w-full bg-pt-raised text-pt-text font-semibold rounded-[14px] py-3 min-h-[48px] shadow-hairline disabled:opacity-40'

type Friend = { email: string; name: string }

// Someone else's booked house slot (what a swap is asked for).
// pending = someone's request the team hasn't approved yet; move = a slot someone asked to move into (also waiting).
interface TheirSlot { shootId: string; name: string; email?: string; date: string; house: House; start: number; pending?: boolean; move?: boolean }
// Only approved house shoots with no move waiting can be swapped (the server refuses the rest).
const swappable = (x: Shoot, now: string) => x.place !== 'offsite' && x.from > now && x.status === 'booked' && !x.moveRequest

type SheetState =
  | { kind: 'calendar' }
  | { kind: 'day'; date: string }
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
  const desk = useDesk().on
  // Month view only (owner, Nov 3): tap a day → its times → tap a time to book (with friends if you like).
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sheet, setSheet] = useState<SheetState>(null)
  // After booking: if things were picked for a new shoot (✦ Prop ideas), put them in it and review it.
  const navigate = useNavigate()
  const addToShoot = useAddToShoot()
  // Schedule team: changes Google Calendar refused (to retry).
  const [calWaiting, setCalWaiting] = useState(0)
  const [calNew, setCalNew] = useState(0)
  useEffect(() => {
    if (!((role === 'owner' || role === 'equipment') && s.googleCalendarId)) return
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
    const id = params.get('shoot'), book = params.get('book'), offsite = params.get('offsite')
    if (params.get('sent')) { setSent(params.get('sent')); const n = new URLSearchParams(params); n.delete('sent'); setParams(n, { replace: true }); return }
    if (id) { if (!(sheet?.kind === 'shoot' && sheet.id === id)) setSheet({ kind: 'shoot', id }) }
    // ?book=1 = just the month (it is the booking screen); picks from ✦ Prop ideas still get "soonest times".
    else if (book) { if (peekPendingAdds()) setSheet({ kind: 'find', fromToday: true }); setParams({}, { replace: true }) }
    else if (offsite && /^\d{4}-\d{2}-\d{2}$/.test(offsite)) { setSheet({ kind: 'offsite', date: offsite }); setParams({}, { replace: true }) }
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
  const myDates = useMemo(() => new Set((mine ?? []).map(x => x.date)), [mine])
  const swaps = useMySwaps(profile.email)
  const invites = useMyInvites(profile.email)
  const ai = useAssistant()
  const status = useMyStatus(profile.email)
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const next = (mine ?? []).find(x => x.to > now)

  // One rule for tapping a slot, used by the day list and the month's day sheet.
  const tapSlot = (st: ReturnType<typeof slotState>, d: string, h: House, start: number) => {
    // A priority-day slot the owner sees as locked is still the team's to block or book for someone (the server allows it;
    // only the owner's own booking follows the lock).
    if (st.t === 'free' || (st.t === 'locked' && team)) { if (team) setSheet({ kind: 'block', date: d, house: h, start }); else if (canBook) setSheet({ kind: 'book', house: h, date: d, start }) }
    else if (st.t === 'booked') {
      const isMine = st.entry.email === profile.email || (mine ?? []).some(x => x.id === st.entry.shootId)
      setSheet(teamView || isMine ? { kind: 'shoot', id: st.entry.shootId } : { kind: 'taken', slot: { shootId: st.entry.shootId, name: st.entry.name, email: st.entry.email, date: d, house: h, start, pending: !!st.entry.pending, move: !!st.entry.move } })
    }
    else if (st.t === 'block' && team) setSheet({ kind: 'unblock', date: d, block: st.block })
  }

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className={`sticky top-0 bg-pt-bg pt-safe z-10 pb-2 ${desk ? "px-8" : "px-4"}`}>
        {/* Nov 13 polish: when the buttons don't fit next to the title (owner: 5 of them), they move to a row ABOVE it instead of cutting it to "Cal…". */}
        <div className="flex flex-wrap-reverse items-end justify-between py-2 gap-x-2 gap-y-2">
          <h1 className="font-display text-[30px] text-pt-text shrink-0">{canBook ? 'Calendar' : 'Schedule'}</h1>
          <div className="flex gap-2 pb-0.5 ml-auto">
            <AiButton mode="time" />
            <MyRequestsButton />
            {teamView && <RoundIcon icon="team" label="Check-ins, reports and creators" to="/schedule/team" />}
            {role === 'owner' && <RoundIcon icon="settings" label="Schedule settings" to="/schedule/settings" />}
            <RoundIcon icon="help" label="Help" to="/help" />
          </div>
        </div>
      </div>

      <div className={desk ? 'px-8 pt-2 grid grid-cols-[minmax(0,1fr)_400px] gap-10 items-start' : ''}>
      <div className={desk ? 'pt-4 space-y-4' : 'px-4 pt-4 space-y-3'}>
        {paused && <div className="rounded-xl px-3 py-3 text-sm border border-red-400/40 bg-red-400/10 text-pt-text"><b>Prop bookings paused until {formatDay(status!.pausedUntil!)}</b> {status!.manualPause ? <>by the team{status!.pauseNote ? <>: {status!.pauseNote}</> : ''}.</> : <>because of {status!.strikes ?? 2} strikes (no-shows or reports).</>} You can still book house slots. Ask the schedule team if this looks wrong.</div>}
        {!paused && (status?.strikes ?? 0) > 0 && <div className="rounded-xl px-3 py-2 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">{status!.strikes} strike{status!.strikes === 1 ? '' : 's'} in the last {s.strikeDays} days. {s.strikeCount} pause your prop bookings for {s.pauseDays} days.</div>}
        {swaps.incoming.map(r => <SwapAsk key={r.id} r={r} incoming urgent />)}
        {swaps.outgoing.map(r => <SwapAsk key={r.id} r={r} />)}
        {invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => <InviteAsk key={i.id} inv={i} now={now} urgent />)}


        {(
          <section className="space-y-3 pb-2">
            <div className="flex items-center justify-between">
              <button disabled={month <= today.slice(0, 7)} onClick={() => setMonth(monthAdd(month, -1))} aria-label="Previous month" className="w-11 h-11 grid place-items-center rounded-full bg-pt-surface text-pt-text text-xl disabled:opacity-30">‹</button>
              <h2 className="text-pt-text text-[20px] font-semibold">{monthTitle(month)}</h2>
              <button disabled={month >= addDays(today, 115).slice(0, 7)} onClick={() => setMonth(monthAdd(month, 1))} aria-label="Next month" className="w-11 h-11 grid place-items-center rounded-full bg-pt-surface text-pt-text text-xl disabled:opacity-30">›</button>
            </div>
            {days === null ? <p className="text-pt-muted text-sm text-center py-6">Loading…</p>
              : <MonthGrid month={month} days={days} s={s} email={profile.email} now={now} today={today} team={team} lockFree={role === 'equipment'} selected={desk ? date : null} myDates={myDates}
                  onPick={d => { setDate(d); if (!desk) setSheet({ kind: 'day', date: d }) }} />}
          </section>
        )}

        {/* Your own shoots at a glance (owner, Oct 20): soonest first, tap one to open it, "All" for the full list. */}
        {next && (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-[15px] font-semibold">Your shoots</h2>
              <button onClick={() => navigate('/shoots')} className="text-pt-accent text-sm tap">All my shoots ›</button>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {(mine ?? []).filter(x => x.to > now).slice(0, 6).map(x => (
                <button key={x.id} onClick={() => { setDate(x.date); setSheet({ kind: 'shoot', id: x.id }) }}
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
        {/* Small on purpose (owner, Oct 19): the ✦ AI button at the top is the main way in. */}
        {canBook && <button onClick={() => ai.open('time')} className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF] active:scale-[0.98] transition-transform">
          <span className="text-[#BF9DFF]">✦</span><span className="flex-1 min-w-0 truncate">Or ask AI to find a time</span><span className="text-pt-muted">›</span>
        </button>}

        <button onClick={() => setSheet({ kind: 'calendar' })} className="!mt-8 w-full flex items-center gap-3 p-4 rounded-2xl bg-pt-surface shadow-hairline text-left">
          <span className="w-10 h-10 rounded-xl grid place-items-center bg-pt-bg text-lg shrink-0"><Icon name="calendar" className="w-5 h-5 text-pt-accent" /></span>
          <span className="flex-1 min-w-0 text-pt-text text-[15px] font-semibold">{team ? 'Schedule' : 'My shoots'} in my phone's calendar</span>
          <span className="text-pt-muted">›</span>
        </button>
      </div>
      {desk && (
        <div className="sticky top-4 pt-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DayPickSheet inline date={date} day={days?.[date]} team={team} lockFree={role === 'equipment'} teamView={teamView} canBook={canBook} now={now}
            onClose={() => {}} onTap={(st, h, start) => tapSlot(st, date, h, start)}
            onShoot={id => setSheet({ kind: 'shoot', id })} onOffsite={() => setSheet({ kind: 'offsite', date })} />
        </div>
      )}
      </div>

      {sheet?.kind === 'day' && <DayPickSheet date={sheet.date} day={days?.[sheet.date]} team={team} lockFree={role === 'equipment'} teamView={teamView} canBook={canBook} now={now}
        onClose={() => setSheet(null)} onTap={(st, h, start) => tapSlot(st, sheet.date, h, start)}
        onShoot={id => setSheet({ kind: 'shoot', id })}
        onOffsite={() => setSheet({ kind: 'offsite', date: sheet.date })} />}
      {sheet?.kind === 'calendar' && <CalendarSheet team={team} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'book' && <BookSheet {...sheet} team={team} mine={mine ?? []} day={days?.[sheet.date]} now={now}
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
          <p className="text-pt-text text-sm mt-4">{sheet.slot.move ? 'Someone asked to move their shoot here. The team is deciding, so check back soon, or "Find a time" shows the next free one.'
            : sheet.slot.pending ? 'Someone asked for this slot. The team is deciding, so check back soon, or "Find a time" shows the next free one.'
            : 'This slot is booked. "Find a time" shows the next free one, or ask to swap one of your shoots for it.'}</p>
          <button onClick={() => setSheet({ kind: 'find' })} className={`mt-4 ${btnGold}`}>Find a time</button>
          {canBook && !team && <WaitButton slot={sheet.slot} email={profile.email} day={days?.[sheet.slot.date]} now={now} />}
          {!sheet.slot.pending && (mine ?? []).some(x => swappable(x, now)) && (
            <button onClick={() => setSheet({ kind: 'swap', theirs: sheet.slot })} className={`mt-2 ${btnGrey}`}>Ask to swap</button>
          )}
          {!sheet.slot.move && s.instantBookers.some(p => p.email === profile.email) && !s.instantBookers.some(p => p.email === sheet.slot.email) && (
            <TakeSlot slot={sheet.slot} onTaken={id => setSheet({ kind: 'shoot', id })} />
          )}
        </BottomSheet>
      )}
      {sheet?.kind === 'find' && days && (
        <FindSheet days={days} from={sheet.fromToday || date < today ? today : date} house={sheet.house} team={team} email={profile.email} now={now}
          onOffsite={() => setSheet({ kind: 'offsite', date: sheet.fromToday ? today : date })}
          onClose={() => setSheet(null)} onPick={(d, h, st, friends) => { setDate(d)
            setSheet(friends.length ? { kind: 'group', house: h, date: d, start: st, friends } : team ? { kind: 'block', date: d, house: h, start: st } : { kind: 'book', house: h, date: d, start: st }) }} />
      )}
      {sheet?.kind === 'move' && days && (
        <MoveSheet shoot={sheet.shoot} days={days} team={team} now={now} onClose={() => setSheet(null)} onMoved={sh => { setDate(sh.date); setSheet({ kind: 'shoot', id: sh.id }) }} />
      )}
      {sheet?.kind === 'swap' && days && (
        <SwapSheet mine={sheet.mine} theirs={sheet.theirs} days={days} myShoots={mine ?? []} email={profile.email} now={now} onClose={() => setSheet(null)} />
      )}
    </div>
  )
}

// "Notify me if it opens" on the taken-slot sheet (same list as the bell in the day sheet).
function WaitButton({ slot, email, day, now }: { slot: TheirSlot; email: string; day?: ScheduleDay; now: string }) {
  const s = useScheduleSettings()
  const waits = useMyWaitlist(email, true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const w = waits.entries[waitKey(slot.date, slot.house, slot.start)]
  // Only offer it when the server would say yes (not started, no house slot that day yet, not locked, no guideline
  // needed); if they're already on the list, keep the button so they can leave, until the time starts.
  const why = waitRefusal(day, slot.date, slot.house, slot.start, s, email, now)
  if (why === 'past' || (!w && why)) return null
  async function go() {
    setBusy(true); setErr('')
    try { if (w) await waits.leave(w); else await waits.join(slot.date, slot.house, slot.start) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (<>
    <button disabled={busy || w?.status === 'offered'} onClick={go} className={`mt-2 ${btnGrey} inline-flex items-center justify-center gap-2`}>
      <Icon name="bell" className="w-4 h-4" />{w?.status === 'offered' ? "It's held for you: confirm in the chat" : w ? `On the list${w.position ? ` · #${w.position}` : ''} · Leave` : 'Notify me if it opens'}
    </button>
    {!w && <p className="text-pt-muted text-xs text-center mt-1">If it opens up, it's held for you for {INVITE_HOLD_MINUTES} minutes and you get a notification.</p>}
    {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
  </>)
}

// A day from the month view (owner, Nov 2): both houses side by side, one row per time. Free = gold, tap to request.
// The server never asks the schedule team (owner, equipment) for a guideline, even in the owner's creator mode or
// "View as": match it by the REAL role, so the owner isn't sent to upload a PDF they don't need (audit, Nov 7).
function useSkipsGuideline(team: boolean) {
  const { realRole } = useSession()
  return team || realRole === 'owner' || realRole === 'equipment'
}

function DayPickSheet({ date, day, team, lockFree = team, teamView, canBook, now, onClose, onTap, onShoot, onOffsite, inline = false }: {
  date: string; day?: ScheduleDay; team: boolean; lockFree?: boolean; teamView: boolean; canBook: boolean; now: string
  onClose: () => void; onTap: (st: ReturnType<typeof slotState>, h: House, start: number) => void
  onShoot: (id: string) => void; onOffsite: () => void; inline?: boolean
}) {
  const s = useScheduleSettings()
  const { profile } = useSession()
  const skipG = useSkipsGuideline(team)
  const email = profile.email
  // "Notify me if it opens" (Nov 7): a bell on someone else's slot puts you on its list in one tap.
  const waits = useMyWaitlist(email, canBook && !team)
  const [waitErr, setWaitErr] = useState('')
  const [waitBusy, setWaitBusy] = useState('')
  async function bell(h: House, start: number) {
    const k = waitKey(date, h, start), w = waits.entries[k]
    setWaitBusy(k); setWaitErr('')
    try { if (w) await waits.leave(w); else await waits.join(date, h, start) } catch (e) { setWaitErr(errorText(e)) } finally { setWaitBusy('') }
  }
  const cell = (h: House, start: number) => {
    // The owner booking for themselves follows the priority lock like the server does (audit, Nov 5).
    const st = slotState(day, date, h, start, s, email, now, lockFree)
    let label: React.ReactNode, cls = 'bg-pt-surface text-pt-muted'
    const early = houseFreeFrom(day, h, start, s)
    // Cliff 1 priority days for people outside the priority group (owner, Nov 3): say it on the slot itself.
    const guide = st.t === 'free' && !skipG && canBook && needsGuideline(date, h, email, s)
    if (st.t === 'free') { label = <>Free{guide && <span className="block text-xs font-normal text-amber-200">Guideline required</span>}{early && <span className="block text-xs font-normal text-sky-300">from {fmtTime(early.at)}</span>}</>; cls = 'bg-pt-accent/[0.14] text-pt-accent font-semibold shadow-[inset_0_0_0_1px_rgba(201,169,97,0.45)]' }
    else if (st.t === 'booked') {
      const me = st.entry.email === email
      label = me ? 'You' : st.entry.name
      cls = st.entry.pending ? 'bg-amber-400/[0.07] text-amber-200 border border-dashed border-amber-400/50' : me ? 'bg-pt-accent/10 text-pt-text font-semibold' : 'bg-pt-surface text-pt-text'
      if (st.entry.pending) label = <>{label}<span className="block text-xs text-amber-300/80">{st.entry.move ? 'move asked' : 'asked'}</span></>
    }
    else if (st.t === 'block') { label = <>{st.block.note || 'Blocked'}{st.block.end % 120 !== 0 || st.block.end - st.block.start < s.slotMinutes ? <span className="block text-xs">until {fmtTime(st.block.end)}</span> : null}</>; cls = 'bg-[repeating-linear-gradient(135deg,#1C1C1E_0_8px,#232325_8px_16px)] text-pt-muted' }
    else if (st.t === 'held') { label = `Held · ${st.entry.name}`; cls = 'bg-amber-400/[0.06] text-amber-300 border border-dashed border-amber-400/50' }
    else if (st.t === 'locked') { label = <span className="inline-flex items-center gap-1"><Icon name="lock" className="w-3.5 h-3.5" label="Locked" />Priority</span> }
    else label = '—'
    const tappable = (st.t === 'free' && (canBook || team)) || st.t === 'booked' || ((st.t === 'block' || st.t === 'locked') && team)
    const cellBtn = (
      <button key={h} disabled={!tappable} onClick={() => onTap(st, h, start)}
        className={`flex-1 min-w-0 min-h-[48px] rounded-xl px-2 py-1.5 text-[14px] text-center truncate ${cls} ${st.t === 'past' ? 'opacity-40' : ''} ${tappable ? 'active:opacity-80' : ''}`}>
        <span className="block truncate">{label}</span>
      </button>
    )
    // Someone else's slot (booked, asked for, or held): creators can wait for it.
    const theirs = (st.t === 'booked' || st.t === 'held') && st.entry.email?.toLowerCase() !== email.toLowerCase()
    if (!(theirs && canBook && !team)) return cellBtn
    const k = waitKey(date, h, start), w = waits.entries[k]
    // No bell where the server would refuse: started already, you film that day, priority lock, guideline needed.
    // Someone already on the list keeps it (to leave) until the time starts.
    const why = waitRefusal(day, date, h, start, s, email, now)
    if (why === 'past' || (!w && why)) return cellBtn
    return (
      <div key={h} className="flex-1 min-w-0 flex gap-1">
        {cellBtn}
        <button onClick={() => bell(h, start)} disabled={waitBusy === k || w?.status === 'offered'}
          aria-label={w ? `On the list, number ${w.position}. Tap to leave the list` : 'Notify me if it opens'}
          title={w ? 'On the list · tap to leave' : 'Notify me if it opens'}
          className={`shrink-0 w-11 min-h-[48px] rounded-xl grid place-items-center text-[12px] font-bold disabled:opacity-50 ${w ? 'bg-pt-accent/[0.16] text-pt-accent shadow-[inset_0_0_0_1px_rgba(201,169,97,0.45)]' : 'bg-pt-surface text-pt-muted'}`}>
          {w ? <span className="flex flex-col items-center leading-none"><Icon name="bell" className="w-4 h-4" />{w.position > 0 && <span className="mt-0.5">#{w.position}</span>}</span> : <Icon name="bell" className="w-5 h-5" />}
        </button>
      </div>
    )
  }
  const offsite = (day?.offsite ?? []).slice().sort((a, b) => a.start - b.start)
  const title = `${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}${isNoCrewDay(date) ? ' · no crew' : ''}`
  // Heads-ups (owner, Nov 4): things happening at a house that don't stop filming (e.g. chargers being installed).
  const notes = headsUps(day).slice().sort((a, b) => a.start - b.start)
  const body = (<>
      {notes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {notes.map(b => (
            <button key={b.id} disabled={!team} onClick={() => onTap({ t: 'block', block: b } as ReturnType<typeof slotState>, b.house, b.start)}
              className="w-full flex items-start gap-2.5 p-3 rounded-xl bg-amber-400/[0.08] text-left">
              <Icon name="alert" className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
              <span className="min-w-0"><span className="block text-pt-text text-sm font-semibold">Heads-up · {s.houses[b.house].name}: {b.note || BLOCK_TYPES[b.type]}</span>
                <span className="block text-pt-muted text-xs">{b.start <= s.slots[0] && b.end >= 1440 ? 'All day' : `${fmtTime(b.start)}–${fmtTime(b.end)}`} · You can still film; expect some noise or people around.</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 pl-[78px] mb-1 text-xs text-pt-muted">
        {HOUSES.map(h => <span key={h} className="flex-1 text-center">{s.houses[h].name}</span>)}
      </div>
      <div className="space-y-1.5">
        {s.slots.map(start => (
          <div key={start} className="flex items-center gap-2">
            <span className="w-[70px] shrink-0 text-pt-muted text-[13px] tabular-nums">{fmtTime(start)}</span>
            {HOUSES.map(h => cell(h, start))}
          </div>
        ))}
      </div>
      {waitErr && <p className="text-red-300 text-sm mt-3">{waitErr}</p>}
      {!team && canBook && <p className="text-pt-muted text-xs mt-3">Tap a gold time to ask for it (you can add friends next). The equipment team approves it, and it's held for you while you wait.
        {' '}Want a taken time? If it has a bell, tap it: if it opens up, it's held for you for {INVITE_HOLD_MINUTES} minutes{Object.keys(waits.entries).some(k => k.startsWith(date)) ? '. Tap a gold bell to leave the list.' : '.'}</p>}
      {offsite.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-pt-text text-sm font-semibold">Offsite this day</p>
          {offsite.map(o => (
            <button key={o.shootId} disabled={!(teamView || o.email === email)} onClick={() => onShoot(o.shootId)} className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-pt-surface text-left">
              <Avatar email={o.email} name={o.name} />
              <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm font-semibold truncate">{o.email === email ? 'You' : o.name}{o.pending ? ' · asked' : ''}</span><span className="block text-pt-muted text-xs truncate">{o.where} · {fmtSlot(o.start, o.end - o.start)}</span></span>
            </button>
          ))}
        </div>
      )}
      {(canBook || team) && <button onClick={onOffsite} className={`mt-4 ${btnGrey}`}>Book Offsite</button>}
  </>)
  // Laptop: the day sits next to the month instead of sliding up.
  if (inline) return <section className="rounded-[20px] shadow-hairline p-4"><h2 className="text-pt-text text-[20px] font-semibold mb-3">{title}</h2>{body}</section>
  return <BottomSheet open onClose={onClose} title={title}>{body}</BottomSheet>
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
  const sset = useScheduleSettings()
  const { profile: me } = useSession()
  const asks = !team && !sset.instantBookers.some(p => p.email === me.email) && (!move || move.status === 'booked')
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
      <p className="text-pt-muted text-sm">No house is held. It goes on the schedule so the props team and the schedule team know, and so it counts toward production.</p>
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
        <button disabled={busy || !where.trim()} onClick={save} className={btnGold}>{busy ? 'Saving…' : asks ? (move ? 'Ask to move it' : 'Ask for this') : move ? 'Move it' : 'Add to the schedule'}</button>
        {asks && <p className="text-pt-muted text-xs text-center">The equipment team approves it. You'll get a notification.</p>}
      </div>
    </BottomSheet>
  )
}

// Tap a free time on the calendar (owner, Nov 3): ask straight away whether friends are filming too. With friends, you
// get your slot and the next one(s) at the same house are held for them to confirm (bookWithFriends).
function BookSheet({ house, date, start, team, mine, day, now, dayFull, onClose, onBooked }: { house: Place; date: string; start: number; team: boolean; mine: Shoot[]; day?: ScheduleDay; now: string; dayFull: boolean; onClose: () => void; onBooked: (id: string) => void }) {
  const s = useScheduleSettings()
  const profiles = useProfiles()
  const usedThatMonth = mine.filter(x => x.month === monthOf(date) && x.kind === 'monthly').length
  const left = Math.max(0, s.monthlySlots - usedThatMonth)
  const [kind, setKind] = useState<ShootKind>(MONTHLY_SLOTS_ON && house === MONTHLY_HOUSE && (team || left > 0) ? 'monthly' : 'extra')
  const [forEmail, setForEmail] = useState('')
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const { profile } = useSession()
  const asks = !team && !s.instantBookers.some(p => p.email === profile.email)
  const [guide, setGuide] = useState<Guideline | null>(null)
  const skipG = useSkipsGuideline(team)
  const needG = !skipG && house !== 'offsite' && needsGuideline(date, house, profile.email, s)
  useEffect(() => { if (team) listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [team])
  // Friends (creators only): how many, then search by name or channel.
  const [friendCount, setFriendCount] = useState(0)
  const [friends, setFriends] = useState<Friend[]>([])
  const [everyone, setEveryone] = useState<Friend[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { if (friendCount && !everyone) listFilmingFriends({}).then(r => setEveryone(r.data.people)).catch(() => setEveryone([])) }, [friendCount, everyone])
  const chosen = friends.slice(0, friendCount)
  // "Usually films with" (owner, Nov 7): one-tap shortcut to the people they film back to back with most; never auto-added.
  // Loads as soon as the sheet opens (shown only once they pick "+ 1 friend"), so the row is ready and doesn't push the search box down.
  const usualOnes = useUsualPartners(profile.email, s.slotMinutes, !team).filter(p => !chosen.some(c => c.email === p.email))
  const h = house as House
  // The slot(s) right after yours must be free for your friends.
  const nextFree = Array.from({ length: friendCount }, (_, i) => start + (i + 1) * s.slotMinutes)
    .every(st => s.slots.includes(st) && slotState(day, date, h, st, s, profile.email, now, false).t === 'free')
  const term = q.trim().toLowerCase()
  const matches = term ? (everyone ?? []).filter(p => !chosen.some(c => c.email === p.email)
    && (p.name.toLowerCase().includes(term) || (profiles[p.email]?.channel ?? '').toLowerCase().includes(term))) : []
  const withFriends = friendCount > 0
  async function book() {
    setBusy(true); setErr('')
    try {
      const id = withFriends
        ? (await bookWithFriends({ place: h, date, start, friends: chosen.map(f => f.email), mySlots: 1, kind, ...(guide ? { guideline: guide } : {}) })).data.shootIds[0]
        : (await bookShoot({ place: house, date, start, kind, ...(forEmail ? { forEmail } : {}), ...(guide ? { guideline: guide } : {}) })).data.id
      // A short "Booked ✓" moment (the button glows gold) before the shoot opens.
      setDone(true); setTimeout(() => onBooked(id), 650)
    }
    catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const verb = asks ? 'Request' : 'Book'
  return (
    <BottomSheet open onClose={onClose} title={withFriends ? `Group booking · ${1 + friendCount} slots` : asks ? "Ask for this slot" : "Book this slot"}>
      <p className="text-pt-muted text-sm">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.houses[h].name} · {fmtSlot(start, s.slotMinutes * (1 + friendCount))}{withFriends ? ` · ${(s.slotMinutes * (1 + friendCount)) / 60} hours` : ''}</p>
      <p className="text-pt-muted text-xs">{s.houses[h].address}</p>
      {team && (
        <label className="block mt-4"><span className="block text-pt-muted text-xs mb-2">Book for</span>
          <select value={forEmail} onChange={e => setForEmail(e.target.value)} className={field}>
            <option value="">Me</option>
            {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select></label>
      )}
      {!team && (
        <div className="mt-4">
          <p className="text-pt-muted text-xs mb-2">Who's filming? Need more than {s.slotMinutes / 60} hours? Add who you're filming with: one slot each, back to back, and they confirm theirs.</p>
          <div className="flex bg-pt-bg rounded-full p-1 gap-1">
            {['Just me', '+ 1 friend', '+ 2 friends'].map((label, n) => (
              <button key={n} onClick={() => { setFriendCount(n); setFriends(f => f.slice(0, n)) }}
                className={`flex-1 rounded-full min-h-[40px] text-sm ${friendCount === n ? 'bg-pt-accent text-stone-900 font-semibold shadow-gold' : 'text-pt-text'}`}>{label}</button>
            ))}
          </div>
          {withFriends && (
            <div className="mt-3 space-y-2">
              {!nextFree && <p className="rounded-xl px-3 py-2 text-sm bg-amber-400/10 text-pt-text">The {friendCount === 1 ? 'slot' : 'slots'} right after this one {friendCount === 1 ? "isn't" : "aren't"} free. Pick an earlier time, or fewer friends.</p>}
              <div className="flex flex-wrap gap-2">
                {chosen.map(f => (
                  <button key={f.email} onClick={() => setFriends(x => x.filter(y => y.email !== f.email))} className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline">
                    <Avatar email={f.email} name={f.name} size={32} />{f.name.split(' ')[0]} · {fmtTime(start + (chosen.indexOf(f) + 1) * s.slotMinutes)}<span className="text-pt-muted">×</span>
                  </button>
                ))}
              </div>
              {chosen.length < friendCount && (
                <div className="bg-pt-bg rounded-xl p-2">
                  {usualOnes.length > 0 && (
                    <div className="px-1 pb-2" data-testid="usual-partners">
                      <p className="text-pt-muted text-xs mb-2">Usually films with</p>
                      <div className="flex flex-wrap gap-2">
                        {usualOnes.map(p => (
                          <button key={p.email} onClick={() => { setFriends([...chosen, { email: p.email, name: p.name }]); setQ('') }}
                            aria-label={`Film with ${p.name}`}
                            className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline">
                            <Avatar email={p.email} name={p.name} size={32} />{p.label}<span className="text-pt-accent">+</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={chosen.length ? 'Search for your second friend' : 'Search by name or channel'} className={field} />
                  <div className="max-h-48 overflow-y-auto mt-1">
                    {term && everyone === null && <p className="text-pt-muted text-sm p-2">Loading…</p>}
                    {term && everyone !== null && matches.length === 0 && <p className="text-pt-muted text-sm p-2">No one called "{q.trim()}".</p>}
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
              {chosen.length === friendCount && <p className="text-pt-muted text-xs">{chosen.length > 1 ? 'Their slots are' : 'Their slot is'} held for {INVITE_HOLD_MINUTES} minutes for them to confirm.</p>}
            </div>
          )}
        </div>
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
      {needG && <div className="mt-3"><GuidelinePicker value={guide} onChange={setGuide} /></div>}
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      {dayFull && !done && <p className="mt-3 rounded-xl px-3 py-3 text-sm bg-amber-400/10 text-pt-text shadow-[inset_0_0_0_0.5px_rgba(251,191,36,0.4)]">
        You already have your house slot that day. Creators book one {s.slotMinutes / 60}-hour slot a day; ask the schedule team if you need more.</p>}
      <button disabled={busy || done || dayFull || (needG && !guide) || (withFriends && (!nextFree || chosen.length < friendCount))} onClick={book}
        className={`mt-5 w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 ${done ? 'booked-flash !opacity-100' : ''}`}>
        {done ? (asks ? 'Requested ✓' : 'Booked ✓') : busy ? 'Sending…' : needG && !guide ? 'Add your guideline first'
          : withFriends && chosen.length < friendCount ? `Pick ${friendCount - chosen.length === 1 ? 'your friend' : 'your friends'}`
          : withFriends ? `${verb} + invite ${chosen.length > 1 ? 'them' : chosen[0].name.split(' ')[0]}` : asks ? 'Request this time' : 'Book it'}</button>
      <p className="text-pt-muted text-xs text-center mt-2">{asks ? 'The equipment team approves it. The slot is held for you meanwhile.' : 'Confirmed instantly.'}</p>
    </BottomSheet>
  )
}

// Redo a calendar import (owner, Nov 4: a group booking came in as one person). Takes every shoot made from that Google
// event off the schedule and shows the event on the import screen again; Google Calendar itself is untouched.
function RedoImport({ shootId, onDone }: { shootId: string; onDone: () => void }) {
  const navigate = useNavigate()
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setBusy(true); setErr('')
    try { await redoCalendarImport({ shootId }); onDone(); navigate('/schedule/import') } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <div className="rounded-xl bg-sky-400/[0.08] p-3 space-y-2">
      <p className="text-pt-text text-sm"><b>From Google Calendar.</b> Wrong person, house or time?</p>
      {!ask ? <button onClick={() => setAsk(true)} className="w-full min-h-[44px] rounded-xl bg-pt-bg text-sky-200 text-sm font-semibold">Redo this import</button> : <>
        <p className="text-pt-muted text-xs">Takes this shoot (and any others made from the same calendar event) off the schedule and shows the event on the import screen again, so you can pick the right people. Google Calendar isn't changed.</p>
        <div className="flex gap-2">
          <button onClick={() => setAsk(false)} className="flex-1 min-h-[44px] rounded-xl bg-pt-border text-pt-text text-sm">Keep it</button>
          <button disabled={busy} onClick={go} className="flex-1 min-h-[44px] rounded-xl bg-sky-400 text-stone-900 text-sm font-semibold disabled:opacity-40">{busy ? 'Working…' : 'Redo it'}</button>
        </div></>}
      {err && <p className="text-red-300 text-sm">{err}</p>}
    </div>
  )
}

function ShootSheet({ id, team, sent, onClose, onMove, onSwap }: { id: string; team: boolean; sent?: string | null; onClose: () => void; onMove: (s: Shoot) => void; onSwap: (s: Shoot) => void }) {
  const s = useScheduleSettings()
  const { profile, role } = useSession()
  const profiles = useProfiles()
  const shoot = useShoot(id)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [lineup, setLineup] = useState(false)
  const [showHist, setShowHist] = useState(false)
  const now = nowStamp()
  if (shoot === undefined) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">Loading…</p></BottomSheet>
  if (shoot === null) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">This shoot can't be opened.</p></BottomSheet>
  const mine = shoot.creatorEmail === profile.email
  const where = shoot.place === 'offsite' ? shoot.where : `${s.houses[shoot.place].name} · ${s.houses[shoot.place].address}`
  const requested = shoot.status === 'requested'
  const upcoming = isLive(shoot) && shoot.from > now
  const justBooked = withinUndo(shoot.createdAt)
  const short = isShortNotice(shoot.from, now, s) && !justBooked && !requested
  // Booked less than 24 h before it starts: cancelling is free, even inside the notice period (owner, Nov 6).
  const late = bookedLate(shoot)
  // The team set this time (priority booking or a team move): the creator can still move it, and cancelling is free.
  const teamTime = timeSetByTeam(shoot)
  // Inside the notice period a creator can only swap (house slots) or cancel as a no-show; the team can always move/cancel.
  const canMove = upcoming && (team || (mine && (!short || teamTime)))
  const canSwap = upcoming && mine && shoot.place !== 'offsite' && !requested && !shoot.moveRequest
  const canCancel = isLive(shoot) && (team || (mine && upcoming))
  // Same rule as the server, so the warning and what happens always agree.
  const noShow = !team && cancelCountsAsNoShow(shoot, now, s)
  async function cancel() {
    setBusy(true); setErr('')
    try { await cancelShoot({ id, ...(noShow ? { confirmNoShow: true } : {}) }); onClose() } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const actionLabel: Record<string, string> = { booked: 'Booked', cancelled: 'Cancelled', moved: 'Moved', swapped: 'Swapped', 'checked-in': 'Checked in', wrapped: 'Wrapped', reported: 'Reported', report: 'Sent a report', explained: 'Explained a missed check-in', 'no-show': 'No-show', 'marked-filmed': 'Marked as filmed', 'props-added': 'Props requested', 'gear-added': 'Gear held', requested: 'Requested', approved: 'Approved', denied: 'Not approved', expired: 'Ran out (nobody approved it in time)', 'move-requested': 'Asked to move', 'move-approved': 'Move approved', 'move-denied': 'Move not approved', 'move-expired': 'Move ran out' }
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
              {shoot.status === 'requested' ? <Pill tone="warn">Waiting for approval</Pill> : shoot.status === 'booked' ? <Pill tone="free">Approved</Pill>
                : <Pill tone="taken">{shoot.status === 'denied' ? 'Not approved' : shoot.status === 'expired' ? 'Ran out' : 'Cancelled'}</Pill>}
              {(MONTHLY_SLOTS_ON || shoot.kind === 'offsite') && <Pill tone="muted">{shoot.kind === 'monthly' ? 'Monthly slot' : shoot.kind === 'offsite' ? 'Offsite' : 'Extra slot'}</Pill>}
              {isLive(shoot) && <button onClick={() => setLineup(v => !v)} aria-expanded={lineup} className="tap inline-flex items-center gap-1 text-pt-accent text-sm">{lineup ? 'Hide calendar' : 'See in calendar'} ›</button>}
            </div>
          </div>
        </div>
        {lineup && <DayLineup date={shoot.date} shootId={id} />}
        {sent && mine && (
          <div className="rounded-xl px-3 py-3 text-sm bg-green-500/10 border border-green-500/30 text-pt-text">
            <b className="text-green-400">Sent ✓</b> {sent === 'gear' ? 'Your gear is held.' : sent === 'both' ? 'Props went to the arts team, gear to the equipment team.' : s.gearReserve ? 'The arts team has your props request. Add gear below if you need it.' : 'The arts team has your props request. Gear: take what\'s free on your shoot day, from an hour before.'}
          </div>
        )}
        {requested && <p className="rounded-xl px-3 py-3 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">
          {mine ? <>Sent to the equipment team. The slot is held for you while they check it; you'll get a notification. You can already add props.</> : <>Waiting for the equipment team to approve it.</>}</p>}
        {shoot.status === 'denied' && <p className="rounded-xl px-3 py-3 text-sm border border-red-400/40 bg-red-400/10 text-pt-text">Not approved{shoot.deniedReason ? `: ${shoot.deniedReason}` : '.'}</p>}
        {shoot.moveRequest && <p className="rounded-xl px-3 py-3 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">
          Move requested to <b>{shoot.moveRequest.place === 'offsite' ? shoot.moveRequest.where : s.houses[shoot.moveRequest.place].name} · {formatDay(shoot.moveRequest.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtSlot(shoot.moveRequest.start, shoot.moveRequest.end - shoot.moveRequest.start)}</b>. This time stays yours until it's approved.</p>}
        {shoot.status === 'booked' && <OnTheDay shoot={shoot} mine={mine} team={team} />}
        {isLive(shoot) && <ShootNeeds shoot={shoot} mine={mine} team={team} />}
        {mine && upcoming && short && !team && (
          <p className="rounded-xl px-3 py-3 text-sm border border-amber-400/40 bg-amber-400/10 text-pt-text">
            {teamTime ? <>The schedule team set this time for you, so you can still <b>move</b> it, and <b>cancelling is free</b>.</>
              : late ? <>Less than {s.noticeHours} hours to go, so moving isn't possible. You booked it less than {LATE_BOOKING_FREE_HOURS} hours ahead, so <b>cancelling is free</b>.</>
              : <>Less than {s.noticeHours} hours to go. You can still <b>swap</b> with someone; cancelling now counts as a no-show.</>}
          </p>
        )}
        {(canMove || canSwap) && (
          <div className="flex gap-2">
            {canMove && <button onClick={() => onMove(shoot)} className={`flex-1 ${secondaryBtn}`}>Move</button>}
            {canSwap && <button onClick={() => onSwap(shoot)} className={`flex-1 ${secondaryBtn}`}>Swap</button>}
          </div>
        )}
        <div>
          {/* Folded away (owner, Nov 4: the shoot page should match the rest; history is rarely needed). */}
          <button onClick={() => setShowHist(v => !v)} aria-expanded={showHist} className="w-full min-h-[44px] flex items-center gap-2 px-1 text-left">
            <span className="text-pt-muted text-[14px] font-semibold">History</span><span className="text-pt-muted/70 text-[14px]">· {shoot.history.length}</span>
            <span className={`ml-auto text-pt-muted transition-transform ${showHist ? 'rotate-90' : ''}`} aria-hidden>›</span>
          </button>
          {showHist && <ol className="bg-white/[0.05] rounded-[20px] divide-y divide-white/[0.06]">
            {shoot.history.map((h, i) => (
              <li key={i} className="px-3 py-2 text-sm"><span className="text-pt-muted text-xs block">{new Date(h.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="text-pt-text">{actionLabel[h.action] ?? h.action}{h.note ? ` · ${h.note}` : ''}</span></li>
            ))}
          </ol>}
        </div>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {(role === 'owner' || role === 'equipment') && (shoot as Shoot & { calendarEventId?: string }).calendarEventId && <RedoImport shootId={id} onDone={onClose} />}
        {canCancel && !confirm && (
          <button onClick={() => setConfirm(true)} className="w-full min-h-[52px] rounded-2xl bg-red-500/15 text-red-300 font-semibold text-[16px]">
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
  const skipG = useSkipsGuideline(team)
  const instant = s.instantBookers.some(p => p.email === shoot.creatorEmail)
  const asks = !team && !instant && shoot.status === 'booked'
  // Moving the owner's own shoot follows the priority lock; the team moving someone else's doesn't.
  const results = findFree(days, today, 60, 1, where === 'any' ? HOUSES : [where], s, shoot.creatorEmail, now, team && !(role === 'owner' && shoot.creatorEmail === profile.email), 10, [shoot.id])
  // Moving onto a Cliff 1 Thursday/Saturday needs a guideline (owner, Nov 3), unless the shoot already has one.
  const [guide, setGuide] = useState<Guideline | null>(null)
  const [needFor, setNeedFor] = useState<{ date: string; house: House; start: number } | null>(null)
  async function go(date: string, house: House, start: number) {
    if (!skipG && !shoot.guideline && !guide && needsGuideline(date, house, shoot.creatorEmail, s)) { setNeedFor({ date, house, start }); return }
    const key = `${date}${house}${start}`
    setBusy(key); setErr('')
    try {
      const r = await moveShoot({ id: shoot.id, place: house, date, start, ...(guide ? { guideline: guide } : {}) })
      // An approved shoot moved by a creator is a REQUEST: it stays where it is until the team approves the new time.
      if (r.data.status === 'requested' && shoot.status === 'booked') { onMoved(shoot); return }
      const win = slotWindow(date, start, s.slotMinutes)
      onMoved({ ...shoot, place: house, date, start, end: start + s.slotMinutes, from: win.from, to: win.to })
    } catch (e) { setErr(errorText(e)); setBusy('') }
  }
  return (
    <BottomSheet open onClose={onClose} title="Move to…">
      <p className="text-pt-muted text-sm">Now: {formatDay(shoot.date)} · {s.houses[shoot.place as House].name} · {fmtSlot(shoot.start, shoot.end - shoot.start)}. {asks ? 'The equipment team approves the new time. You keep this one until they do.' : 'You keep it until the new slot is yours.'}</p>
      <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5 mt-3">
        {([...HOUSES, 'any'] as const).map(h => (
          <button key={h} onClick={() => setWhere(h)} className={`flex-1 py-2 rounded-[10px] text-sm ${where === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h === 'any' ? 'Either' : s.houses[h].name}</button>
        ))}
      </div>
      {MONTHLY_SLOTS_ON && shoot.kind === 'monthly' && <p className="text-pt-muted text-xs mt-2">Stays a monthly slot at {s.houses.cliff1.name}; at {s.houses.cliff2.name} it becomes an extra slot.</p>}
      {needFor && <div className="space-y-2"><GuidelinePicker value={guide} onChange={g => setGuide(g)} />
        {guide && <button onClick={() => { const t = needFor; setNeedFor(null); void go(t.date, t.house, t.start) }} className={btnGold}>Continue: move to {s.houses[needFor.house].name} · {fmtSlot(needFor.start, s.slotMinutes)}</button>}</div>}
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      <div className="mt-3 space-y-2">
        {results.length === 0 && <p className="text-pt-muted text-sm">No free slots in the next 60 days.</p>}
        {results.map(r => (
          <div key={`${r.date}${r.house}${r.start}`} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
            <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold">{formatDay(r.date)}</p>
              <p className="text-pt-muted text-xs">{s.houses[r.house].name} · {fmtSlot(r.start, s.slotMinutes)}{isNoCrewDay(r.date) ? ' · no crew' : ''}</p></div>
            <button disabled={!!busy} onClick={() => go(r.date, r.house, r.start)} className="bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-40">{busy === `${r.date}${r.house}${r.start}` ? 'Moving…' : asks ? 'Ask for this' : 'Move here'}</button>
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
    const seen = new Set<string>()
    for (const [date, d] of Object.entries(days).sort(([a], [b]) => a.localeCompare(b))) {
      for (const house of HOUSES) for (const [k, e] of Object.entries(d[house] ?? {})) {
        const start = Number(k)
        // Only approved shoots: not a friend's held slot, someone's request or a move waiting for the team.
        // An imported shoot can fill two slots: list it once.
        if (!e.shootId || e.hold || e.pending || e.move || seen.has(e.shootId)) continue
        if (e.email === email || slotWindow(date, start, s.slotMinutes).from <= now) continue
        seen.add(e.shootId)
        out.push({ shootId: e.shootId, name: e.name, email: e.email, date, house, start })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).slice(0, 60)
  }, [days, email, now, s.slotMinutes])
  const mySlots = myShoots.filter(x => swappable(x, now))
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
            {theirs && mySlots.length === 0 && <p className="text-pt-muted text-sm">You have no approved upcoming house shoots to offer.</p>}
            {theirs && mySlots.map(m => row(m.id, null, `Your ${formatDay(m.date)} · ${s.houses[m.place as House].name} · ${fmtSlot(m.start, m.end - m.start)}`, () => ask(m.id, theirs.shootId, theirs.name)))}
          </div>
        </>
      )}
    </BottomSheet>
  )
}

// A pending swap: someone asking me (accept / decline), or me waiting on someone (withdraw).
function TeamSlotSheet({ date, house, start, onClose, onBook }: { date: string; house: House; start: number; onClose: () => void; onBook: () => void }) {
  const s = useScheduleSettings()
  const [type, setType] = useState<BlockType>('cleaners')
  const [allDay, setAllDay] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Owner, Nov 3: blocks can be shorter than a slot (cleaners 1–2 PM), and can repeat weekly (the trainer every Thursday).
  const [from, setFrom] = useState(start)
  const [until, setUntil] = useState(start + s.slotMinutes)
  const [weeks, setWeeks] = useState(1)
  const [msg, setMsg] = useState('')
  // Heads-up only (owner, Nov 4): shows on the calendar, never stops anyone booking.
  const [soft, setSoft] = useState(false)
  const halfHours = Array.from({ length: 48 }, (_, i) => i * 30)
  async function block() {
    setBusy(true); setErr('')
    try {
      const r = await addScheduleBlock({ date, house, type, note, repeatWeeks: weeks, ...(soft ? { soft: true } : {}), ...(allDay ? { allDay: true } : { start: from, end: until }) })
      if (r.data.skipped?.length) setMsg(`Blocked ${r.data.placed?.length ?? 1} weeks. Skipped (already booked): ${r.data.skipped.map(x => `${formatDay(x.date, { month: 'short', day: 'numeric' })} (${x.names.join(', ')})`).join('; ')}.`)
      else onClose()
    }
    catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title="Book or block">
      <p className="text-pt-muted text-sm">{formatDay(date)} · {s.houses[house].name} · {fmtSlot(start, s.slotMinutes)}</p>
      <button onClick={onBook} className="mt-4 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Book this slot…</button>
      <div className="mt-5 border-t border-pt-border pt-4 space-y-3">
        <p className="text-pt-text font-semibold">Or put something on the calendar</p>
        <div className="flex bg-pt-bg rounded-full p-1 gap-1" role="radiogroup" aria-label="Does it stop filming?">
          {([[false, 'Blocks filming'], [true, 'Heads-up only']] as const).map(([v, l]) => (
            <button key={l} role="radio" aria-checked={soft === v} onClick={() => setSoft(v)}
              className={`flex-1 min-h-[40px] rounded-full text-sm font-semibold ${soft === v ? (v ? 'bg-amber-400 text-stone-900' : 'bg-pt-border text-pt-text') : 'text-pt-muted'}`}>{l}</button>
          ))}
        </div>
        <p className="text-pt-muted text-sm">{soft
          ? 'Something happening at the house that people can still film around (a delivery, chargers being installed, a contractor outside). It shows on the calendar; everyone can still book.'
          : 'Cleaners, maintenance, events, external rentals: anything that stops filming. Nobody can book blocked time.'}</p>
        <select value={type} onChange={e => setType(e.target.value as BlockType)} className={field}>
          {(Object.keys(BLOCK_TYPES) as BlockType[]).map(t => <option key={t} value={t}>{BLOCK_TYPES[t]}</option>)}
        </select>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional), e.g. Deep clean" className={field} />
        <label className="flex items-center gap-2 text-pt-text text-sm"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> The whole day at {s.houses[house].name}</label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-pt-muted text-xs">From<select value={from} onChange={e => { const v = Number(e.target.value); setFrom(v); if (until <= v) setUntil(v + 30) }} className={field}>{halfHours.map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></label>
            <label className="text-pt-muted text-xs">Until<select value={until} onChange={e => setUntil(Number(e.target.value))} className={field}>{[...halfHours, 1440].filter(m => m > from).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></label>
          </div>
        )}
        <label className="block text-pt-muted text-xs">Repeat
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} className={field}>
            <option value={1}>Just this once</option>
            {[2, 4, 8, 12, 26].map(n => <option key={n} value={n}>Every {formatDay(date, { weekday: 'long' })} for {n} weeks</option>)}
          </select></label>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {msg ? <><p className="text-amber-200 text-sm">{msg}</p><button onClick={onClose} className="w-full bg-pt-border rounded-xl py-3">Done</button></> :
        <button disabled={busy} onClick={block} className="w-full bg-pt-border text-pt-text font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Saving…' : soft ? (allDay ? 'Add a heads-up for the whole day' : `Add heads-up ${fmtTime(from)}–${fmtTime(until)}${weeks > 1 ? ` for ${weeks} weeks` : ''}`) : allDay ? 'Block the whole day' : weeks > 1 ? `Block ${fmtTime(from)}–${fmtTime(until)} for ${weeks} weeks` : `Block ${fmtTime(from)}–${fmtTime(until)}`}</button>}
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
      <button disabled={busy} onClick={remove} className="mt-5 w-full bg-red-500/15 text-red-300 font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Removing…' : block.soft ? 'Remove this heads-up' : 'Remove this block'}</button>
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
      {pending && <p className="mb-4 rounded-xl px-3 py-3 text-sm bg-[#BF9DFF]/10 text-pt-text shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)]">✦ The props you picked go into this shoot once it's booked{minDay > todayInStudio() ? `. Times start ${formatDay(minDay, { weekday: 'long', month: 'short', day: 'numeric' })}, the first day there's still time to get them ready` : ''}.</p>}
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
      const r = await bookWithFriends({ place: house, date, start, friends: friends.map(f => f.email), mySlots: 1, kind, ...(guide ? { guideline: guide } : {}) })
      setDone(true); setTimeout(() => onBooked(r.data.shootIds[0]), 650)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const { profile } = useSession()
  const asks = !team && !s.instantBookers.some(p => p.email === profile.email)
  const [guide, setGuide] = useState<Guideline | null>(null)
  const skipG = useSkipsGuideline(team)
  const needG = !skipG && needsGuideline(date, house, profile.email, s)
  const rows = [{ email: profile.email, name: 'You', note: asks ? 'Requested' : 'Booked' }, ...friends.map(f => ({ email: f.email, name: f.name, note: `Held ${INVITE_HOLD_MINUTES} min` }))]
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
      {needG && <div className="mt-3"><GuidelinePicker value={guide} onChange={setGuide} /></div>}
      <button disabled={busy || done || (needG && !guide)} onClick={book} className={`mt-5 ${btnGold} ${done ? 'booked-flash !opacity-100' : ''}`}>{done ? (asks ? 'Requested ✓' : 'Booked ✓') : busy ? 'Sending…' : `${asks ? 'Request' : 'Book'} + invite ${friends.length > 1 ? 'them' : friends[0].name.split(' ')[0]}`}</button>
      {asks && <p className="text-pt-muted text-xs text-center mt-2">The equipment team approves each slot. They're held for you meanwhile.</p>}
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
          <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo of the set" max={3} />
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
              {!shoot.explanation && now < explainUntil(shoot, s)
                ? <p className="flex-1 bg-pt-bg rounded-xl px-2 py-2 text-pt-muted text-xs text-center">No-show possible after {stampLabel(explainUntil(shoot, s))}, unless they explain</p>
                : <button disabled={busy} onClick={() => run(() => decideShoot({ id: shoot.id, outcome: 'noshow' }))} className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm disabled:opacity-40">No-show · strike</button>}
            </div>
          )}
        </div>
      )}
      {shoot.outcome && <p className="text-pt-muted text-sm">{shoot.outcome === 'filmed' ? 'Marked as filmed by the team.' : 'Marked as a no-show by the team.'}</p>}
    </div>
  )
}

// Someone invited you to film right after them: the slot is held for you for 20 minutes.

// Priority booking (owner, Nov 2: Kyle can take any slot): take a slot someone else has. They get a neutral
// "schedule change" notice (no strike) and their next request is first in line.
function TakeSlot({ slot, onTaken }: { slot: TheirSlot; onTaken: (id: string) => void }) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const first = slot.name.split(' ')[0]
  async function take() {
    setBusy(true); setErr('')
    try { const r = await bookShoot({ place: slot.house, date: slot.date, start: slot.start, take: true }); onTaken(r.data.id) }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 space-y-2">
      {sure && <p className="text-amber-300 text-sm">{first} gets a schedule-change notice (no strike) and their next request is first in line.</p>}
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <button disabled={busy} onClick={() => sure ? take() : setSure(true)} className="w-full rounded-xl py-3 font-bold bg-amber-400/15 text-amber-300 disabled:opacity-40">
        {busy ? 'Booking…' : sure ? 'Confirm priority booking' : 'Priority booking: take this slot'}</button>
    </div>
  )
}
