import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import BottomSheet from '../components/BottomSheet'
import { Pill } from '../components/GearUi'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useShoot, bookShoot, cancelShoot, addScheduleBlock, removeScheduleBlock,
  listSchedulePeople, errorText, slotState, findFree, fmtSlot, isNoCrewDay, isPriorityDay, inPriorityGroup, priorityLocked,
  releaseStamp, monthOf, HOUSES, BLOCK_TYPES, MONTHLY_HOUSE,
  type House, type Place, type ScheduleDay, type Block, type ShootKind, type BlockType, type Shoot,
} from '../services/schedule'

const DAYS_SHOWN = 35
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const stampLabel = (s: string) => `${formatDay(s.slice(0, 10))}, ${fmtTime(Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)))}`

type SheetState =
  | { kind: 'book'; house: Place; date: string; start: number }
  | { kind: 'shoot'; id: string }
  | { kind: 'taken'; name: string; date: string; house: House; start: number; shootId: string }
  | { kind: 'block'; date: string; house: House; start: number }
  | { kind: 'unblock'; date: string; block: Block }
  | { kind: 'find' }
  | null

// The house schedule: Cliff 1, Cliff 2 and offsite shoots, by day, in 2-hour slots.
export default function ScheduleScreen() {
  const navigate = useNavigate()
  const { profile, role } = useSession()
  const team = role === 'owner' || role === 'equipment'
  const s = useScheduleSettings()
  const today = todayInStudio()
  const [date, setDate] = useState(today)
  const [house, setHouse] = useState<Place>('cliff1')
  const [sheet, setSheet] = useState<SheetState>(null)
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const days = useScheduleDays(today, addDays(today, 120))
  const mine = useMyShoots(profile.email, today)
  const day = days?.[date]
  const myDays = useMemo(() => new Set((mine ?? []).map(x => x.date)), [mine])

  const notes: { tone: 'info' | 'gold' | 'muted'; text: React.ReactNode }[] = []
  if (isNoCrewDay(date)) notes.push({ tone: 'info', text: <><b>Sunday · open filming.</b> First come, first served. The crew is off, so you run the shoot yourself.</> })
  if (house !== 'offsite' && isPriorityDay(date, house, s) && !team) {
    if (inPriorityGroup(profile.email, s)) notes.push({ tone: 'gold', text: <><b>Priority day.</b> You're in the priority group: book any free slot.</> })
    else if (priorityLocked(date, house, s, profile.email, now)) notes.push({ tone: 'gold', text: <><b>Priority day.</b> Unclaimed slots open to everyone on <b>{stampLabel(releaseStamp(date, s))}</b>.</> })
    else notes.push({ tone: 'gold', text: <><b>Released priority day.</b> Free slots are open to everyone.</> })
  }
  if (house === 'cliff2') notes.push({ tone: 'muted', text: 'Cliff 2: first come, first served. External rentals come first.' })

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 pb-2 border-b border-pt-border">
        <div className="flex items-end justify-between py-2 gap-2">
          <h1 className="font-display text-3xl text-pt-text">Schedule</h1>
          <div className="flex gap-2 pb-1">
            <button onClick={() => navigate('/schedule/how')} className="text-pt-accent text-sm">How it works</button>
            {team && <button onClick={() => navigate('/schedule/settings')} className="text-pt-accent text-sm">Settings</button>}
          </div>
        </div>
        <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
          {([...HOUSES, 'offsite'] as Place[]).map(h => (
            <button key={h} onClick={() => setHouse(h)}
              className={`flex-1 py-1.5 rounded-[10px] text-sm ${house === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>
              {h === 'offsite' ? 'Offsite' : s.houses[h].name}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pt-2.5 pb-1 -mx-4 px-4">
          {Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i)).map(d => (
            <button key={d} onClick={() => setDate(d)}
              className={`shrink-0 w-[52px] py-1.5 rounded-xl text-center border ${d === date ? 'border-pt-accent bg-pt-surface' : 'border-transparent bg-pt-surface'}`}>
              <span className="block text-[11px] text-pt-muted">{formatDay(d, { weekday: 'short' })}</span>
              <span className="block text-lg font-semibold text-pt-text leading-tight">{Number(d.slice(8))}</span>
              <span className={`block mx-auto mt-0.5 w-1 h-1 rounded-full ${myDays.has(d) ? 'bg-pt-accent' : 'bg-transparent'}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3 space-y-2">
        {!team && mine && mine.length > 0 && date === today && (
          <button onClick={() => setSheet({ kind: 'shoot', id: mine[0].id })}
            className="w-full text-left rounded-2xl p-3.5 border border-pt-accent/40 bg-gradient-to-br from-pt-accent/20 to-pt-surface">
            <span className="text-[11px] uppercase tracking-wider text-pt-accent font-semibold">{mine[0].date === today ? 'Today' : 'Your next shoot'}</span>
            <p className="text-pt-text text-lg font-semibold">{mine[0].date === today ? '' : `${formatDay(mine[0].date)} · `}{fmtSlot(mine[0].start, mine[0].end - mine[0].start)}</p>
            <p className="text-pt-muted text-sm">{mine[0].place === 'offsite' ? mine[0].where : `${s.houses[mine[0].place].name} · ${s.houses[mine[0].place].address}`}{mine.length > 1 ? ` · ${mine.length - 1} more coming up` : ''}</p>
          </button>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-pt-text font-semibold">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })}{date === today ? ' · Today' : ''}</p>
          {house !== 'offsite' && <button onClick={() => setSheet({ kind: 'find' })} className="text-pt-accent text-sm shrink-0">Find a time</button>}
        </div>
        {house !== 'offsite' && <p className="text-pt-muted text-xs -mt-1">{s.houses[house].address}</p>}
        {notes.map((n, i) => (
          <div key={i} className={`rounded-xl px-3 py-2.5 text-sm border ${n.tone === 'gold' ? 'border-pt-accent/50 bg-pt-accent/10 text-pt-text' : n.tone === 'info' ? 'border-sky-400/40 bg-sky-400/10 text-pt-text' : 'border-pt-border bg-pt-surface text-pt-muted'}`}>{n.text}</div>
        ))}

        {days === null && <p className="text-pt-muted text-sm text-center py-6">Loading…</p>}
        {days !== null && house !== 'offsite' && (
          <div className="space-y-2">
            {s.slots.map(start => (
              <SlotRow key={start} day={day} date={date} house={house} start={start} team={team} email={profile.email} now={now}
                mine={(mine ?? []).find(x => x.date === date && x.place === house && x.start === start)}
                onTap={(st, isMine) => {
                  if (st.t === 'free') setSheet(team ? { kind: 'block', date, house, start } : { kind: 'book', house, date, start })
                  else if (st.t === 'booked') setSheet(team || isMine ? { kind: 'shoot', id: st.entry.shootId } : { kind: 'taken', name: st.entry.name, date, house, start, shootId: st.entry.shootId })
                  else if (st.t === 'block' && team) setSheet({ kind: 'unblock', date, block: st.block })
                }} />
            ))}
          </div>
        )}
        {days !== null && house === 'offsite' && <OffsiteDay day={day} date={date} team={team} onOpen={id => setSheet({ kind: 'shoot', id })} onBooked={id => setSheet({ kind: 'shoot', id })} />}
      </div>

      {sheet?.kind === 'book' && <BookSheet {...sheet} team={team} mine={mine ?? []} onClose={() => setSheet(null)} onBooked={id => setSheet({ kind: 'shoot', id })} />}
      {sheet?.kind === 'block' && <TeamSlotSheet {...sheet} onClose={() => setSheet(null)} onBook={() => setSheet({ kind: 'book', house: sheet.house, date: sheet.date, start: sheet.start })} />}
      {sheet?.kind === 'unblock' && <UnblockSheet {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shoot' && <ShootSheet id={sheet.id} team={team} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'taken' && (
        <BottomSheet open onClose={() => setSheet(null)} title={sheet.name}>
          <p className="text-pt-muted text-sm">{formatDay(sheet.date)} · {s.houses[sheet.house].name} · {fmtSlot(sheet.start, s.slotMinutes)}</p>
          <p className="text-pt-text text-sm mt-3">This slot is booked. "Find a time" shows the next free one.</p>
          <button onClick={() => setSheet({ kind: 'find' })} className="mt-4 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3">Find a time</button>
        </BottomSheet>
      )}
      {sheet?.kind === 'find' && days && (
        <FindSheet days={days} from={date < today ? today : date} house={house === 'offsite' ? 'cliff1' : house} team={team} email={profile.email} now={now}
          onClose={() => setSheet(null)} onPick={(d, h, st) => { setDate(d); setHouse(h); setSheet(team ? { kind: 'block', date: d, house: h, start: st } : { kind: 'book', house: h, date: d, start: st }) }} />
      )}
    </div>
  )
}

function SlotRow({ day, date, house, start, team, email, now, mine, onTap }: {
  day?: ScheduleDay; date: string; house: House; start: number; team: boolean; email: string; now: string; mine?: Shoot
  onTap: (st: ReturnType<typeof slotState>, isMine: boolean) => void
}) {
  const s = useScheduleSettings()
  const st = slotState(day, date, house, start, s, email, now, team)
  let title: React.ReactNode, sub: React.ReactNode = null, pill: React.ReactNode = null, cls = 'bg-pt-surface border-transparent'
  if (st.t === 'block') { title = st.block.note || BLOCK_TYPES[st.block.type]; sub = st.block.note && st.block.note !== BLOCK_TYPES[st.block.type] ? BLOCK_TYPES[st.block.type] : null; pill = <Pill tone="muted">Blocked</Pill>; cls = 'bg-[repeating-linear-gradient(135deg,#1C1C1E_0_8px,#232325_8px_16px)] border-transparent' }
  else if (st.t === 'booked') {
    const isMine = mine?.id === st.entry.shootId
    title = isMine ? 'You' : st.entry.name
    sub = st.entry.kind === 'monthly' ? 'Monthly slot' : 'Extra slot'
    if (isMine) { pill = <Pill tone="info">Yours</Pill>; cls = 'bg-pt-accent/10 border-pt-accent' }
  }
  else if (st.t === 'past') { title = '—'; sub = 'Past'; cls = 'bg-pt-surface border-transparent opacity-45' }
  else if (st.t === 'locked') { title = <span className="text-pt-muted">Priority only</span>; sub = `Opens ${stampLabel(st.opens)}`; pill = <Pill tone="muted">🔒</Pill> }
  else { title = <span className="text-pt-accent">{team ? 'Free · book or block' : 'Free'}</span>; sub = isNoCrewDay(date) ? 'No crew' : null; cls = 'bg-pt-surface border-pt-accent/35' }
  const tappable = st.t === 'free' || st.t === 'booked' || (st.t === 'block' && team)
  return (
    <button disabled={!tappable} onClick={() => onTap(st, st.t === 'booked' && mine?.id === st.entry.shootId)}
      className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border ${cls} ${tappable ? 'active:opacity-80' : ''}`}>
      <span className="w-[86px] shrink-0 text-pt-muted text-[13px] tabular-nums whitespace-nowrap">{fmtSlot(start, s.slotMinutes)}</span>
      <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text truncate">{title}</span>{sub && <span className="block text-pt-muted text-xs">{sub}</span>}</span>
      {pill}
    </button>
  )
}

function OffsiteDay({ day, date, team, onOpen, onBooked }: { day?: ScheduleDay; date: string; team: boolean; onOpen: (id: string) => void; onBooked: (id: string) => void }) {
  const s = useScheduleSettings()
  const [start, setStart] = useState(s.slots[3] ?? s.slots[0])
  const [where, setWhere] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = (day?.offsite ?? []).slice().sort((a, b) => a.start - b.start)
  async function add() {
    setBusy(true); setErr('')
    try { const r = await bookShoot({ place: 'offsite', date, start, where }); setWhere(''); onBooked(r.data.id) }
    catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {list.length === 0 && <p className="text-pt-muted text-sm">No offsite shoots this day.</p>}
      {list.map(o => (
        <button key={o.shootId} onClick={() => onOpen(o.shootId)} disabled={!team} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-pt-surface text-left">
          <span className="flex-1 min-w-0"><span className="block font-semibold text-pt-text">{o.name}</span><span className="block text-pt-muted text-xs">{o.where} · {fmtSlot(o.start, o.end - o.start)}</span></span>
          <Pill tone="info">Offsite</Pill>
        </button>
      ))}
      <div className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
        <p className="text-pt-text font-semibold">Add an offsite or location shoot</p>
        <p className="text-pt-muted text-sm">No house is held. It goes on the schedule so props, gear and the team know, and so it counts toward production.</p>
        <select value={start} onChange={e => setStart(Number(e.target.value))} className={field}>
          {s.slots.map(st => <option key={st} value={st}>{fmtSlot(st, s.slotMinutes)}</option>)}
        </select>
        <input value={where} onChange={e => setWhere(e.target.value)} placeholder="Where? e.g. Downtown, or a Maps link" className={field} />
        {err && <p className="text-red-300 text-sm">{err}</p>}
        <button disabled={busy || !where.trim()} onClick={add} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Adding…' : 'Add to the schedule'}</button>
      </div>
    </div>
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
        <label className="block mt-4"><span className="block text-pt-muted text-xs mb-1.5">Book for</span>
          <select value={forEmail} onChange={e => setForEmail(e.target.value)} className={field}>
            <option value="">Me</option>
            {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select></label>
      )}
      {house === MONTHLY_HOUSE && (
        <div className="mt-4"><span className="block text-pt-muted text-xs mb-1.5">Counts as</span>
          <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5">
            <button disabled={!team && left === 0} onClick={() => setKind('monthly')} className={`flex-1 py-2 rounded-[10px] text-sm disabled:opacity-40 ${kind === 'monthly' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>
              Monthly slot{team && forEmail ? '' : ` (${left} left)`}</button>
            <button onClick={() => setKind('extra')} className={`flex-1 py-2 rounded-[10px] text-sm ${kind === 'extra' ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Extra slot</button>
          </div>
        </div>
      )}
      {isNoCrewDay(date) && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm border border-sky-400/40 bg-sky-400/10 text-pt-text">Sunday: no crew. You run the shoot yourself.</p>}
      {err && <p className="text-red-300 text-sm mt-3">{err}</p>}
      <button disabled={busy} onClick={book} className="mt-5 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Booking…' : 'Book it'}</button>
      <p className="text-pt-muted text-xs text-center mt-2">Confirmed instantly.</p>
    </BottomSheet>
  )
}

function ShootSheet({ id, team, onClose }: { id: string; team: boolean; onClose: () => void }) {
  const s = useScheduleSettings()
  const { profile } = useSession()
  const shoot = useShoot(id)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const now = nowStamp(), today = now.slice(0, 10)
  if (shoot === undefined) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">Loading…</p></BottomSheet>
  if (shoot === null) return <BottomSheet open onClose={onClose}><p className="text-pt-muted text-sm">This shoot can't be opened.</p></BottomSheet>
  const mine = shoot.creatorEmail === profile.email
  const where = shoot.place === 'offsite' ? shoot.where : `${s.houses[shoot.place].name} · ${s.houses[shoot.place].address}`
  const canCancel = shoot.status === 'booked' && (team || (mine && shoot.from > now))
  const lateWarn = !team && shoot.date === today && isPriorityDay(shoot.date, shoot.place, s)
  async function cancel() {
    setBusy(true); setErr('')
    try { await cancelShoot({ id }); onClose() } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title={mine ? 'Your shoot' : shoot.creatorName}>
      <div className="space-y-3">
        <div>
          <p className="text-pt-text font-semibold">{formatDay(shoot.date, { weekday: 'long', month: 'short', day: 'numeric' })} · {fmtSlot(shoot.start, shoot.end - shoot.start)}</p>
          <p className="text-pt-muted text-sm">{where}</p>
          <div className="flex gap-1.5 mt-2">
            {shoot.status === 'cancelled' ? <Pill tone="taken">Cancelled</Pill> : <Pill tone="free">Booked</Pill>}
            <Pill tone="muted">{shoot.kind === 'monthly' ? 'Monthly slot' : shoot.kind === 'offsite' ? 'Offsite' : 'Extra slot'}</Pill>
          </div>
        </div>
        {shoot.status === 'booked' && (
          <div className="bg-pt-bg rounded-xl p-3 text-sm text-pt-muted">
            Props, gear and more will be added right from this shoot in the next update. For now, book props and gear for this day in Props and Gear.
          </div>
        )}
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">History</p>
          <ol className="bg-pt-bg rounded-xl divide-y divide-pt-border">
            {shoot.history.map((h, i) => (
              <li key={i} className="px-3 py-2 text-sm"><span className="text-pt-muted text-xs block">{new Date(h.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="text-pt-text">{h.action === 'booked' ? 'Booked' : h.action === 'cancelled' ? 'Cancelled' : h.action}{h.note ? ` · ${h.note}` : ''}</span></li>
            ))}
          </ol>
        </div>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {canCancel && !confirm && (
          <button onClick={() => setConfirm(true)} className="w-full bg-red-500/15 text-red-300 font-semibold rounded-xl py-3">{team && !mine ? 'Cancel their shoot (no strike)' : 'Cancel this shoot'}</button>
        )}
        {canCancel && confirm && (
          <div className="space-y-2">
            <p className="text-pt-text text-sm">{lateWarn ? 'This is a priority-day slot today. Cancelling on the day counts against you.' : 'The slot opens to everyone right away.'}</p>
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
      <button onClick={onBook} className="mt-4 w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3">Book this slot…</button>
      <div className="mt-5 border-t border-pt-border pt-4 space-y-2.5">
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
          <button key={n} onClick={() => setCount(n)} className={`px-3 py-1.5 rounded-full text-sm border ${count === n ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-bg text-pt-text'}`}>{n * s.slotMinutes / 60} hours</button>
        ))}
      </div>
      <div className="flex bg-pt-bg rounded-xl p-0.5 gap-0.5 mt-3">
        {([...HOUSES, 'any'] as const).map(h => (
          <button key={h} onClick={() => setWhere(h)} className={`flex-1 py-1.5 rounded-[10px] text-sm ${where === h ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h === 'any' ? 'Either' : s.houses[h].name}</button>
        ))}
      </div>
      {count > 1 && <p className="text-pt-muted text-xs mt-3">You book your own {s.slotMinutes / 60} hours; whoever films with you books the slot right after.</p>}
      <div className="mt-4 space-y-2">
        {results.length === 0 && <p className="text-pt-muted text-sm">Nothing free in the next 60 days. Try the other house or fewer hours.</p>}
        {results.map(r => (
          <div key={`${r.date}${r.house}${r.start}`} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
            <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold">{formatDay(r.date)}</p>
              <p className="text-pt-muted text-xs">{s.houses[r.house].name} · {fmtSlot(r.start, count * s.slotMinutes)}{isNoCrewDay(r.date) ? ' · no crew' : ''}</p></div>
            <button onClick={() => onPick(r.date, r.house, r.start)} className="bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-1.5 text-sm">{team ? 'Open' : 'Book'}</button>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}
