// Invite and swap cards, shared by the Book screen and the chat (Nov 2).
import { useState } from 'react'
import Avatar from './Avatar'
import { formatDay } from '../lib/dates'
import { fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, useScheduleDays, answerSwap, answerInvite, fmtSlot, errorText, slotKey, HOUSES, type SwapRequest, type ScheduleInvite } from '../services/schedule'

// Something only you can answer: sky blue so it stands out from the rest of the chat (owner, Nov 3).
const URGENT = 'bg-sky-400/[0.14] ring-1 ring-sky-300/40'
const URGENT_TAG = 'text-[12px] font-bold text-sky-200'

export function SwapAsk({ r, incoming = false, urgent = false }: { r: SwapRequest; incoming?: boolean; urgent?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [peek, setPeek] = useState(false)
  const label = (x: SwapRequest['from']) => `${formatDay(x.date)} · ${x.place === 'offsite' ? 'Offsite' : s.houses[x.place].name} · ${fmtSlot(x.start, x.end - x.start)}`
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerSwap({ id: r.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className={`rise-in rounded-[20px] p-4 space-y-3 ${urgent ? URGENT : 'bg-pt-surface'}`}>
      {urgent && <p className={URGENT_TAG}>Needs your answer</p>}
      <div className="flex items-center gap-3">
        <Avatar email={incoming ? r.fromEmail : r.toEmail} name={incoming ? r.fromName : r.toName} />
        <p className="text-pt-text text-sm flex-1 min-w-0">
          {incoming ? <><b>{r.fromName}</b> asks to swap: you'd get <b>{label(r.from)}</b>, they'd get your <b>{label(r.to)}</b>.</>
            : <>Waiting for <b>{r.toName}</b> to answer your swap: your {label(r.from)} for their {label(r.to)}.</>}
        </p>
      </div>
      {incoming && <button onClick={() => setPeek(!peek)} className="text-[14px] font-semibold text-sky-200 tap">{peek ? 'Hide the preview' : 'Preview that day if you accept ›'}</button>}
      {incoming && peek && <SwapPreview r={r} />}
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        {incoming && <button disabled={busy} onClick={() => answer(true)} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-2 disabled:opacity-40">Accept</button>}
        <button disabled={busy} onClick={() => answer(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 disabled:opacity-40">{incoming ? 'Decline' : 'Withdraw'}</button>
      </div>
    </div>
  )
}

export function InviteAsk({ inv, now, urgent = false }: { inv: ScheduleInvite; now: string; urgent?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const until = fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerInvite({ id: inv.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className={`rise-in rounded-[20px] p-4 space-y-3 ${urgent ? URGENT : 'bg-pt-surface'}`}>
      {urgent && <p className={URGENT_TAG}>Needs your answer</p>}
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
    const block = (day?.blocks ?? []).find(b => b.house === h && b.start < start + s.slotMinutes && b.end > start)
    const text = isNew ? 'You (after swap)' : isOld ? `${r.fromName.split(' ')[0]} (after swap)` : e?.shootId ? e.name : e?.hold ? `Held · ${e.name}` : block ? (block.note || 'Blocked') : ''
    const cls = isNew ? 'bg-pt-accent text-stone-900 font-bold' : isOld ? 'bg-sky-400/20 text-sky-100' : e?.shootId || e?.hold ? 'bg-pt-surface text-pt-text' : block ? 'bg-pt-surface text-pt-muted' : 'text-pt-muted/50'
    return <span key={h} className={`flex-1 min-w-0 truncate rounded-lg px-2 py-1.5 text-[13px] text-center ${cls}`}>{text || 'Free'}</span>
  }
  const offsite = day?.offsite ?? []
  return (
    <div className="rounded-xl bg-pt-bg/60 p-2 space-y-1">
      <p className="text-[13px] text-pt-muted px-1 pb-1">{formatDay(d, { weekday: 'long', month: 'short', day: 'numeric' })} after the swap</p>
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
