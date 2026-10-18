import { useEffect, useMemo, useState } from 'react'
import RoundIcon from '../components/RoundIcon'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import BottomSheet from '../components/BottomSheet'
import Avatar from '../components/Avatar'
import ShootNeeds from '../components/ShootNeeds'
import TimeChat from '../components/TimeChat'
import { Pill } from '../components/GearUi'
import ProofPhotos, { PhotoStrip } from '../components/ProofPhotos'
import { formatDay } from '../lib/dates'
import { useProfiles } from '../services/profiles'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useShoot, useMySwaps, useMyStatus, useMyInvites, answerInvite, type ScheduleInvite, bookShoot, cancelShoot, moveShoot, requestSwap, answerSwap,
  addScheduleBlock, removeScheduleBlock, listSchedulePeople, myCalendarLink, checkInShoot, wrapShoot, explainMissedCheckIn, decideShoot,
  checkinWindow, isMissed, explainUntil, slotKey, errorText, slotState, findFree, fmtSlot, isNoCrewDay, isPriorityDay,
  inPriorityGroup, priorityLocked, releaseStamp, monthOf, isShortNotice, withinUndo, slotWindow, HOUSES, BLOCK_TYPES, MONTHLY_HOUSE,
  type House, type Place, type ScheduleDay, type Block, type ShootKind, type BlockType, type Shoot, type SwapRequest,
} from '../services/schedule'

const DAYS_SHOWN = 35
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const stampLabel = (s: string) => `${formatDay(s.slice(0, 10))}, ${fmtTime(Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)))}`
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const btnGrey = 'w-full bg-pt-raised text-pt-text font-semibold rounded-[14px] py-3 min-h-[48px] shadow-hairline disabled:opacity-40'

// Someone else's booked house slot (what a swap is asked for).
interface TheirSlot { shootId: string; name: string; email?: string; date: string; house: House; start: number }

type SheetState =
  | { kind: 'start' }
  | { kind: 'calendar' }
  | { kind: 'book'; house: Place; date: string; start: number }
  | { kind: 'offsite'; date: string; move?: Shoot }
  | { kind: 'shoot'; id: string }
  | { kind: 'taken'; slot: TheirSlot }
  | { kind: 'block'; date: string; house: House; start: number }
  | { kind: 'unblock'; date: string; block: Block }
  | { kind: 'find'; house?: House }
  | { kind: 'move'; shoot: Shoot }
  | { kind: 'swap'; mine?: Shoot; theirs?: TheirSlot }
  | null

// The house schedule: Cliff 1, Cliff 2 and offsite shoots, by day, in 2-hour slots.
export default function ScheduleScreen() {
  const { profile, role } = useSession()
  const team = role === 'owner' || role === 'equipment'
  const s = useScheduleSettings()
  const profiles = useProfiles()
  const today = todayInStudio()
  const [date, setDate] = useState(today)
  const [house, setHouse] = useState<Place>('cliff1')
  const [sheet, setSheet] = useState<SheetState>(null)
  // ?shoot=<id> opens that shoot (from Home); ?book=1 opens "Book a shoot".
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('shoot'), book = params.get('book')
    if (id) setSheet({ kind: 'shoot', id })
    else if (book) setSheet({ kind: 'start' })
    if (id || book) setParams({}, { replace: true })
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const days = useScheduleDays(today, addDays(today, 120))
  const mine = useMyShoots(profile.email, today)
  const swaps = useMySwaps(profile.email)
  const invites = useMyInvites(profile.email)
  const [chat, setChat] = useState(false)
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
            {team && <RoundIcon icon="team" label="Check-ins, reports and creators" to="/schedule/team" />}
            {team && <RoundIcon icon="settings" label="Schedule settings" to="/schedule/settings" />}
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
              <span className="block text-[11px] text-pt-muted">{formatDay(d, { weekday: 'short' })}</span>
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

        {!team && next && date === today && (
          <button onClick={() => setSheet({ kind: 'shoot', id: next.id })}
            className="w-full text-left rounded-2xl p-4 bg-pt-accent/[0.12] shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.4)]">
            <span className="text-[11px] uppercase tracking-wider text-pt-accent font-semibold">{next.date === today ? 'Today' : 'Your next shoot'}</span>
            <p className="text-pt-text text-lg font-semibold">{next.date === today ? '' : `${formatDay(next.date)} · `}{fmtSlot(next.start, next.end - next.start)}</p>
            <p className="text-pt-muted text-sm">{next.place === 'offsite' ? next.where : `${s.houses[next.place].name} · ${s.houses[next.place].address}`}{mine!.length > 1 ? ` · ${mine!.length - 1} more coming up` : ''}</p>
          </button>
        )}

        {/* Three clearly separate things: book (gold), the AI helper (violet), and the calendar link (at the bottom) */}
        <button onClick={() => setSheet({ kind: 'start' })} className={`${btnGold} py-4 text-[17px]`}>Book a shoot</button>
        <div className="flex items-center gap-3 pt-3 pb-1 text-pt-muted text-xs uppercase tracking-wider"><span className="h-px flex-1 bg-pt-border" />or let AI find a time<span className="h-px flex-1 bg-pt-border" /></div>
        <button onClick={() => setChat(true)} className="w-full flex items-center gap-3 p-4 rounded-[20px] text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)] active:scale-[0.98] transition-transform">
          <span className="w-10 h-10 rounded-xl grid place-items-center text-lg bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">✦</span>
          <span className="flex-1 min-w-0"><b className="block">Ask for a time</b><span className="text-pt-muted text-[13px]">"4 hours with Alex next week, evenings" · type or talk</span></span>
          <span className="w-9 h-9 rounded-full grid place-items-center bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg></span>
        </button>

        <div className="flex items-center justify-between gap-2 pt-6 mt-2 border-t border-pt-border">
          <p className="text-pt-text font-semibold">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })}{date === today ? ' · Today' : ''}</p>
          {house !== 'offsite' && <button onClick={() => setSheet({ kind: 'find', house: house as House })} className="text-pt-accent text-sm shrink-0 tap">Find a time</button>}
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
                  if (st.t === 'free') setSheet(team ? { kind: 'block', date, house, start } : { kind: 'book', house, date, start })
                  else if (st.t === 'booked') {
                    const isMine = st.entry.email === profile.email || (mine ?? []).some(x => x.id === st.entry.shootId)
                    setSheet(team || isMine ? { kind: 'shoot', id: st.entry.shootId } : { kind: 'taken', slot: { shootId: st.entry.shootId, name: st.entry.name, email: st.entry.email, date, house, start } })
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
              <button key={o.shootId} onClick={() => (team || o.email === profile.email) && setSheet({ kind: 'shoot', id: o.shootId })}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-pt-surface text-left">
                <Avatar email={o.email} name={o.name} />
                <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text truncate">{o.email === profile.email ? 'You' : o.name}</span><span className="block text-pt-muted text-xs truncate">{o.where} · {fmtSlot(o.start, o.end - o.start)}</span></span>
                <Pill tone="info">Offsite</Pill>
              </button>
            ))}
            <button onClick={() => setSheet({ kind: 'offsite', date: date })} className={btnGrey}>+ Add an offsite or location shoot</button>
          </div>
        )}

        <button onClick={() => setSheet({ kind: 'calendar' })} className="!mt-8 w-full flex items-center gap-3 p-4 rounded-2xl bg-pt-surface shadow-hairline text-left">
          <span className="w-10 h-10 rounded-xl grid place-items-center bg-pt-bg text-lg shrink-0">📅</span>
          <span className="flex-1 min-w-0 text-pt-text text-[15px] font-semibold">{team ? 'Schedule' : 'My shoots'} in my phone's calendar</span>
          <span className="text-pt-muted">›</span>
        </button>
      </div>

      {sheet?.kind === 'start' && (
        <BottomSheet open onClose={() => setSheet(null)} title="Where are you shooting?">
          <div className="space-y-2">
            {HOUSES.map(h => (
              <button key={h} onClick={() => { setHouse(h); setSheet({ kind: 'find', house: h }) }} className="w-full text-left bg-pt-bg rounded-xl p-4">
                <span className="block text-pt-text font-semibold">{s.houses[h].name}</span>
                <span className="block text-pt-muted text-sm">{s.houses[h].address} · {s.slotMinutes / 60}-hour slots</span>
              </button>
            ))}
            <button onClick={() => { setHouse('offsite'); setSheet({ kind: 'offsite', date: date }) }} className="w-full text-left bg-pt-bg rounded-xl p-4">
              <span className="block text-pt-text font-semibold">Somewhere else</span>
              <span className="block text-pt-muted text-sm">An offsite or location shoot · any hours</span>
            </button>
          </div>
        </BottomSheet>
      )}
      {sheet?.kind === 'calendar' && <CalendarSheet team={team} onClose={() => setSheet(null)} />}
      {chat && <TimeChat onClose={() => setChat(false)} />}
      {sheet?.kind === 'book' && <BookSheet {...sheet} team={team} mine={mine ?? []} onClose={() => setSheet(null)} onBooked={id => setSheet({ kind: 'shoot', id })} />}
      {sheet?.kind === 'offsite' && <OffsiteSheet date={sheet.date} move={sheet.move} team={team} onClose={() => setSheet(null)} onDone={id => setSheet({ kind: 'shoot', id })} />}
      {sheet?.kind === 'block' && <TeamSlotSheet {...sheet} onClose={() => setSheet(null)} onBook={() => setSheet({ kind: 'book', house: sheet.house, date: sheet.date, start: sheet.start })} />}
      {sheet?.kind === 'unblock' && <UnblockSheet {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shoot' && <ShootSheet id={sheet.id} team={team} onClose={() => setSheet(null)}
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
          <button onClick={() => setSheet({ kind: 'find', house: sheet.slot.house })} className={`mt-4 ${btnGold}`}>Find a time</button>
          {(mine ?? []).some(x => x.place !== 'offsite' && x.from > now) && (
            <button onClick={() => setSheet({ kind: 'swap', theirs: sheet.slot })} className={`mt-2 ${btnGrey}`}>Ask to swap</button>
          )}
        </BottomSheet>
      )}
      {sheet?.kind === 'find' && days && (
        <FindSheet days={days} from={date < today ? today : date} house={sheet.house ?? (house === 'offsite' ? 'cliff1' : house)} team={team} email={profile.email} now={now}
          onClose={() => setSheet(null)} onPick={(d, h, st) => { setDate(d); setHouse(h); setSheet(team ? { kind: 'block', date: d, house: h, start: st } : { kind: 'book', house: h, date: d, start: st }) }} />
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
    sub = [ch, st.entry.kind === 'monthly' ? 'Monthly slot' : 'Extra slot'].filter(Boolean).join(' · ')
    if (isMine) { pill = <Pill tone="info">Yours</Pill>; cls = 'bg-pt-accent/10 border-pt-accent' }
  }
  else if (st.t === 'past') { title = '—'; sub = 'Past'; cls = 'bg-pt-surface border-transparent opacity-45' }
  else if (st.t === 'held') {
    const forMe = st.entry.email === email
    face = <Avatar email={st.entry.email} name={st.entry.name} />
    title = <span className="text-amber-300">{forMe ? 'Held for you' : `Held for ${st.entry.name}`}</span>
    sub = `${st.entry.hold?.fromName}'s collab · ${forMe ? 'confirm above' : `opens at ${fmtTime(Number(st.until.slice(11, 13)) * 60 + Number(st.until.slice(14, 16)))} if not confirmed`}`
    pill = <Pill tone="warn">Held</Pill>; cls = 'bg-amber-400/[0.06] border-dashed border-amber-400/50'
  }
  else if (st.t === 'locked') { title = <span className="text-pt-muted">Priority only</span>; sub = `Opens ${stampLabel(st.opens)}`; pill = <Pill tone="muted">🔒</Pill> }
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

function BookSheet({ house, date, start, team, mine, onClose, onBooked }: { house: Place; date: string; start: number; team: boolean; mine: Shoot[]; onClose: () => void; onBooked: (id: string) => void }) {
  const s = useScheduleSettings()
  const usedThatMonth = mine.filter(x => x.month === monthOf(date) && x.kind === 'monthly').length
  const left = Math.max(0, s.monthlySlots - usedThatMonth)
  const [kind, setKind] = useState<ShootKind>(house === MONTHLY_HOUSE && (team || left > 0) ? 'monthly' : 'extra')
  const [forEmail, setForEmail] = useState('')
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (team) listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [team])
  async function book() {
    setBusy(true); setErr('')
    try { const r = await bookShoot({ place: house, date, start, kind, ...(forEmail ? { forEmail } : {}) }); onBooked(r.data.id) }
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
      {house === MONTHLY_HOUSE && (
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
      <button disabled={busy} onClick={book} className="mt-5 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40 shadow-gold">{busy ? 'Booking…' : 'Book it'}</button>
      <p className="text-pt-muted text-xs text-center mt-2">Confirmed instantly.</p>
    </BottomSheet>
  )
}

function ShootSheet({ id, team, onClose, onMove, onSwap }: { id: string; team: boolean; onClose: () => void; onMove: (s: Shoot) => void; onSwap: (s: Shoot) => void }) {
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
              <Pill tone="muted">{shoot.kind === 'monthly' ? 'Monthly slot' : shoot.kind === 'offsite' ? 'Offsite' : 'Extra slot'}</Pill>
            </div>
          </div>
        </div>
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
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">History</p>
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
  const results = findFree(days, today, 60, 1, where === 'any' ? HOUSES : [where], s, shoot.creatorEmail, now, team, 10)
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
      {shoot.kind === 'monthly' && <p className="text-pt-muted text-xs mt-2">Stays a monthly slot at {s.houses.cliff1.name}; at {s.houses.cliff2.name} it becomes an extra slot.</p>}
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

function FindSheet({ days, from, house, team, email, now, onClose, onPick }: {
  days: Record<string, ScheduleDay>; from: string; house: House; team: boolean; email: string; now: string
  onClose: () => void; onPick: (date: string, house: House, start: number) => void
}) {
  const s = useScheduleSettings()
  const [count, setCount] = useState(1)
  const [where, setWhere] = useState<House | 'any'>(house)
  const results = findFree(days, from, 60, count, where === 'any' ? HOUSES : [where], s, email, now, team, 8)
  return (
    <BottomSheet open onClose={onClose} title="Find a time">
      <p className="text-pt-muted text-sm">The next free slots from {formatDay(from)}. Filming with someone? Pick 4 hours so you can both book back to back.</p>
      <div className="flex gap-2 mt-3">
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => setCount(n)} className={`px-3 py-2 rounded-full text-sm border ${count === n ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-bg text-pt-text'}`}>{n * s.slotMinutes / 60} hours</button>
        ))}
      </div>
      <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5 mt-3">
        {([...HOUSES, 'any'] as const).map(h => (
          <button key={h} onClick={() => setWhere(h)} className={`flex-1 py-2 rounded-[10px] text-sm ${where === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h === 'any' ? 'Either' : s.houses[h].name}</button>
        ))}
      </div>
      {count > 1 && <p className="text-pt-muted text-xs mt-3">You book your own {s.slotMinutes / 60} hours; whoever films with you books the slot right after.</p>}
      <div className="mt-4 space-y-2">
        {results.length === 0 && <p className="text-pt-muted text-sm">Nothing free in the next 60 days. Try the other house or fewer hours.</p>}
        {results.map(r => (
          <div key={`${r.date}${r.house}${r.start}`} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
            <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold">{formatDay(r.date)}</p>
              <p className="text-pt-muted text-xs">{s.houses[r.house].name} · {fmtSlot(r.start, count * s.slotMinutes)}{isNoCrewDay(r.date) ? ' · no crew' : ''}</p></div>
            <button onClick={() => onPick(r.date, r.house, r.start)} className="bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm">{team ? 'Open' : 'Book'}</button>
          </div>
        ))}
      </div>
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
          <div className="flex justify-between text-[11px] text-pt-muted mt-1"><span>Booked</span><span>Checked in</span><span>Filmed</span></div>
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
            </div>
          )}
          <button disabled={busy || uploading || !photos.length || (mess && !messPhotos.length)} className={btnGold}
            onClick={() => run(() => checkInShoot({ id: shoot.id, photos, ...((over || mess) ? { report: { overMinutes: over || undefined, mess, photos: messPhotos } } : {}) }))}>
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
