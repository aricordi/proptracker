// Invite and swap cards, shared by the Book screen and the chat (Nov 2).
import { useState } from 'react'
import Avatar from './Avatar'
import { formatDay } from '../lib/dates'
import { fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, answerSwap, answerInvite, fmtSlot, errorText, type SwapRequest, type ScheduleInvite } from '../services/schedule'

export function SwapAsk({ r, incoming = false }: { r: SwapRequest; incoming?: boolean }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const label = (x: SwapRequest['from']) => `${formatDay(x.date)} · ${x.place === 'offsite' ? 'Offsite' : s.houses[x.place].name} · ${fmtSlot(x.start, x.end - x.start)}`
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerSwap({ id: r.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rise-in rounded-[20px] p-4 bg-pt-surface space-y-3">
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

export function InviteAsk({ inv, now }: { inv: ScheduleInvite; now: string }) {
  const s = useScheduleSettings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const until = fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerInvite({ id: inv.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="rise-in rounded-[20px] p-4 bg-pt-surface space-y-3">
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
