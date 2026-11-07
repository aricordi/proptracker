// Invite and swap cards, shared by the Book screen and the chat (Nov 2).
import { useState } from 'react'
import Avatar from './Avatar'
import { Icon } from './Icon'
import { ChatCard, SlotTile, primaryBtn, secondaryBtn } from './ChatCard'
import { formatDay } from '../lib/dates'
import { fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, useScheduleDays, answerSwap, answerInvite, fmtSlot, errorText, slotKey, HOUSES, type SwapRequest, type ScheduleInvite } from '../services/schedule'

// Same card anatomy as the rest of the chat (ChatCard): icon/avatar, coloured label, the key fact big, time tiles
// instead of sentences, one big button (owner, Nov 3: guide the eye with the design, not with paragraphs).
const day = (d: string) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' })
const place = (x: { place: string }, s: ReturnType<typeof useScheduleSettings>) => x.place === 'offsite' ? 'Offsite' : s.houses[x.place as 'cliff1' | 'cliff2'].name

export function SwapAsk({ r, incoming = false }: { r: SwapRequest; incoming?: boolean; urgent?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [peek, setPeek] = useState(false)
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerSwap({ id: r.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const first = (n: string) => n.split(' ')[0]
  if (!incoming) return (
    <ChatCard tone="plain" lead={<Avatar email={r.toEmail} name={r.toName} size={48} />} label="Swap sent" title={`Waiting for ${first(r.toName)}`}
      actions={<button disabled={busy} onClick={() => answer(false)} className={secondaryBtn}>Withdraw</button>}>
      <div className="flex items-center gap-2">
        <SlotTile tag="You give" day={day(r.from.date)} time={fmtSlot(r.from.start, r.from.end - r.from.start)} place={place(r.from, s)} />
        <Icon name="swap" className="w-5 h-5 text-pt-muted shrink-0" />
        <SlotTile tag="You get" hot day={day(r.to.date)} time={fmtSlot(r.to.start, r.to.end - r.to.start)} place={place(r.to, s)} />
      </div>
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
    </ChatCard>
  )
  return (
    <ChatCard tone="ask" lead={<Avatar email={r.fromEmail} name={r.fromName} size={48} />} label="Needs your answer" title={`${first(r.fromName)} wants to swap`}
      actions={<>
        <button disabled={busy} onClick={() => answer(false)} className={secondaryBtn}>Decline</button>
        <button disabled={busy} onClick={() => answer(true)} className={primaryBtn}>Accept swap</button>
      </>}>
      <div className="flex items-center gap-2">
        <SlotTile tag="You get" hot day={day(r.from.date)} time={fmtSlot(r.from.start, r.from.end - r.from.start)} place={place(r.from, s)} />
        <Icon name="swap" className="w-5 h-5 text-sky-200 shrink-0" />
        <SlotTile tag="You give" day={day(r.to.date)} time={fmtSlot(r.to.start, r.to.end - r.to.start)} place={place(r.to, s)} />
      </div>
      <button onClick={() => setPeek(!peek)} className="mt-3 flex items-center gap-2 text-[16px] font-semibold text-sky-200 tap">
        <Icon name="eye" className="w-4 h-4" />{peek ? 'Hide the day' : 'See who else films that day'}</button>
      {peek && <div className="mt-2"><SwapPreview r={r} /></div>}
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
    </ChatCard>
  )
}

export function InviteAsk({ inv, now }: { inv: ScheduleInvite; now: string; urgent?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const until = fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerInvite({ id: inv.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <ChatCard tone="ask" {...(inv.waitlist ? { icon: 'bell' as const } : { lead: <Avatar email={inv.fromEmail} name={inv.fromName} size={48} /> })} label="Needs your answer"
      title={inv.waitlist ? 'A time you wanted opened up' : `${inv.fromName.split(' ')[0]} invited you to film`}
      side={<span className="shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 bg-amber-400/15 text-amber-200 text-[14px] font-bold"><Icon name="clock" className="w-3.5 h-3.5" />{until}{inv.until.slice(0, 10) !== now.slice(0, 10) ? ` ${formatDay(inv.until.slice(0, 10), { weekday: 'short' })}` : ''}</span>}
      actions={<>
        <button disabled={busy} onClick={() => answer(false)} className={secondaryBtn}>Can't</button>
        <button disabled={busy} onClick={() => answer(true)} className={primaryBtn}>Confirm my slot</button>
      </>}>
      <SlotTile tag={inv.waitlist ? 'From your waitlist · held for you' : 'Right after them · held for you'} hot day={day(inv.date)} time={fmtSlot(inv.start, inv.end - inv.start)} place={s.houses[inv.place].name} />
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
    </ChatCard>
  )
}

// "See in calendar" on Your shoot (owner, Nov 4): the whole day at both houses, your shoot in gold, so you can see who
// films before and after you. Names only (the schedule is visible to every creator anyway).
export function DayLineup({ date, shootId }: { date: string; shootId: string }) {
  const s = useScheduleSettings()
  const days = useScheduleDays(date, date)
  const day = days?.[date]
  if (days === null) return <p className="text-pt-muted text-sm">Loading the day…</p>
  const cell = (h: 'cliff1' | 'cliff2', start: number) => {
    const e = day?.[h]?.[slotKey(start)]
    const you = !!e?.shootId && e.shootId === shootId
    const block = (day?.blocks ?? []).find(b => !b.soft && b.house === h && b.start < start + s.slotMinutes && b.end > start)
    const text = you ? 'You' : e?.shootId ? `${e.name}${e.pending ? ' (asked)' : ''}` : e?.hold ? `Held · ${e.name}` : block ? (block.note || 'Blocked') : ''
    const cls = you ? 'bg-pt-accent text-stone-900 font-bold' : e?.shootId || e?.hold ? 'bg-pt-surface text-pt-text' : block ? 'bg-pt-surface text-pt-muted' : 'text-pt-muted/50'
    return <span key={h} className={`flex-1 min-w-0 truncate rounded-lg px-2 py-1.5 text-[14px] text-center ${cls}`}>{text || 'Free'}</span>
  }
  const offsite = day?.offsite ?? []
  return (
    <div className="rounded-xl bg-pt-bg/60 p-2 space-y-1">
      <p className="text-[14px] text-pt-muted px-1 pb-1">{formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' })} at the houses</p>
      <div className="flex gap-1.5 pl-[62px] text-[12px] text-pt-muted">{HOUSES.map(h => <span key={h} className="flex-1 text-center">{s.houses[h].name}</span>)}</div>
      {s.slots.map(start => (
        <div key={start} className="flex items-center gap-1.5">
          <span className="w-[56px] shrink-0 text-[12px] text-pt-muted tabular-nums">{fmtTime(start)}</span>
          {HOUSES.map(h => cell(h, start))}
        </div>
      ))}
      {offsite.length > 0 && <p className="text-[12px] text-pt-muted px-1 pt-1">Offsite that day: {offsite.map(o => o.shootId === shootId ? 'You' : o.name).join(', ')}</p>}
    </div>
  )
}

// What the day you'd get looks like after the swap (owner, Nov 3: "who else would be filming that day"): both houses,
// every slot, your new slot in gold, the one you give away marked when it's the same day.
function SwapPreview({ r }: { r: SwapRequest }) {
  const s = useScheduleSettings()
  const d = r.from.date
  const days = useScheduleDays(d, d)
  const day = days?.[d]
  if (days === null) return <p className="text-pt-muted text-sm">Loading the day…</p>
  const cell = (h: 'cliff1' | 'cliff2', start: number) => {
    const isNew = r.from.place === h && r.from.start === start
    const isOld = r.to.place === h && r.to.date === d && r.to.start === start
    const e = day?.[h]?.[slotKey(start)]
    const block = (day?.blocks ?? []).find(b => !b.soft && b.house === h && b.start < start + s.slotMinutes && b.end > start)
    const text = isNew ? 'You (after swap)' : isOld ? `${r.fromName.split(' ')[0]} (after swap)` : e?.shootId ? e.name : e?.hold ? `Held · ${e.name}` : block ? (block.note || 'Blocked') : ''
    const cls = isNew ? 'bg-pt-accent text-stone-900 font-bold' : isOld ? 'bg-sky-400/20 text-sky-100' : e?.shootId || e?.hold ? 'bg-pt-surface text-pt-text' : block ? 'bg-pt-surface text-pt-muted' : 'text-pt-muted/50'
    return <span key={h} className={`flex-1 min-w-0 truncate rounded-lg px-2 py-1.5 text-[14px] text-center ${cls}`}>{text || 'Free'}</span>
  }
  const offsite = day?.offsite ?? []
  return (
    <div className="rounded-xl bg-pt-bg/60 p-2 space-y-1">
      <p className="text-[14px] text-pt-muted px-1 pb-1">{formatDay(d, { weekday: 'long', month: 'short', day: 'numeric' })} after the swap</p>
      <div className="flex gap-1.5 pl-[62px] text-[12px] text-pt-muted">{HOUSES.map(h => <span key={h} className="flex-1 text-center">{s.houses[h].name}</span>)}</div>
      {s.slots.map(start => (
        <div key={start} className="flex items-center gap-1.5">
          <span className="w-[56px] shrink-0 text-[12px] text-pt-muted tabular-nums">{fmtTime(start)}</span>
          {HOUSES.map(h => cell(h, start))}
        </div>
      ))}
      {offsite.length > 0 && <p className="text-[12px] text-pt-muted px-1 pt-1">Offsite that day: {offsite.map(o => o.name).join(', ')}</p>}
    </div>
  )
}
