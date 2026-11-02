// Requests (owner, Nov 2): every creator booking waits here for the equipment team, an admin or the owner. One page with
// what's needed to decide ("succinct, but powerful"): the month at a glance, then each request with who's asking (their
// last 30 days, what's coming up, strikes), what's around that time at the house, and Approve / Deny.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import Avatar from '../components/Avatar'
import BottomSheet from '../components/BottomSheet'
import MonthGrid, { monthAdd, monthTitle } from '../components/MonthGrid'
import {
  useScheduleSettings, useScheduleDays, useShootsSince, useAllStatuses, decideBooking, fmtSlot, slotState,
  BLOCK_TYPES, type House, type Shoot, type ScheduleDay, type ScheduleSettings, type UserStatus,
} from '../services/schedule'
import { waitingRequests, factsFor, reqKey, placeName, ago, partnerLine, REASONS, type Req } from '../desk/requestFacts'
import { collabPairs } from '../lib/collabs'
import { useDesk } from '../desk/desk'
import DeskApprovals from '../desk/DeskApprovals'


export default function ApprovalsScreen() {
  const navigate = useNavigate()
  const { profile } = useSession()
  const s = useScheduleSettings()
  const today = todayInStudio(), now = nowStamp()
  const days = useScheduleDays(addDays(today, -1), addDays(today, 120))
  // 90 days back: the last month's numbers + who usually films with whom.
  const shoots = useShootsSince(addDays(today, -90), true)
  const statuses = useAllStatuses(true)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [dayOpen, setDayOpen] = useState<string | null>(null)

  const reqs: Req[] = useMemo(() => waitingRequests(shoots ?? [], now).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start),
    [shoots, now.slice(0, 15)])   // eslint-disable-line react-hooks/exhaustive-deps
  const pairs = useMemo(() => collabPairs(shoots ?? []), [shoots])
  const desk = useDesk()
  if (desk.on) return <DeskApprovals reqs={reqs} shoots={shoots} days={days} statuses={statuses} pairs={pairs} />

  return (
    <div className="min-h-full bg-pt-bg pb-12">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
        <h1 className="font-display text-[34px] text-pt-text">Requests</h1>
        <p className="text-pt-muted text-sm">{reqs.length === 0 ? 'Nothing waiting. New requests show up here.' : `${reqs.length} waiting for a yes or no, soonest first.`}</p>
      </div>
      <div className="px-4 space-y-6">
        <section className="bg-pt-surface shadow-hairline rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button aria-label="Previous month" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(monthAdd(month, -1))} className="w-10 h-10 rounded-full bg-pt-bg text-pt-accent text-xl disabled:opacity-30">‹</button>
            <h2 className="text-pt-text font-semibold text-[17px]">{monthTitle(month)}</h2>
            <button aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))} className="w-10 h-10 rounded-full bg-pt-bg text-pt-accent text-xl">›</button>
          </div>
          <MonthGrid month={month} days={days} s={s} email={profile.email} now={now} today={today} team onPick={setDayOpen} />
        </section>

        <section className="space-y-3">
          {reqs.map(r => <RequestCard key={reqKey(r)} r={r} s={s} days={days} shoots={shoots ?? []} pairs={pairs} status={statuses[r.shoot.creatorEmail]} today={today} now={now}
            onDay={() => { setMonth(r.date.slice(0, 7)); setDayOpen(r.date) }} onPerson={() => navigate(`/people/${encodeURIComponent(r.shoot.creatorEmail)}`)} />)}
        </section>
      </div>
      {dayOpen && <DaySheet date={dayOpen} day={days?.[dayOpen]} s={s} email={profile.email} now={now} reqs={reqs.filter(r => r.date === dayOpen)} onClose={() => setDayOpen(null)} />}
    </div>
  )
}

export const TONE: Record<string, string> = { red: 'bg-red-400/15 text-red-300', amber: 'bg-amber-400/15 text-amber-300', green: 'bg-green-400/10 text-green-300',
  gold: 'bg-pt-accent/15 text-pt-accent', muted: 'bg-pt-bg text-pt-muted' }

function RequestCard({ r, s, days, shoots, pairs, status, today, now, onDay, onPerson }: {
  r: Req; s: ScheduleSettings; days: Record<string, ScheduleDay> | null; shoots: Shoot[]; pairs: ReturnType<typeof collabPairs>; status?: UserStatus; today: string; now: string
  onDay: () => void; onPerson: () => void
}) {
  const sh = r.shoot, email = sh.creatorEmail
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const f = factsFor(r, shoots, status, days, s, today, now, pairs)
  const around = f.around.map(x => `${x.label}: ${x.value}`)

  async function decide(approve: boolean) {
    setBusy(true); setMsg(null)
    try {
      await decideBooking({ id: sh.id, approve, ...(approve ? {} : { reason }) })
      setMsg({ ok: true, text: approve ? `Approved ✓ ${sh.creatorName.split(' ')[0]} gets a notification.` : `Denied. ${sh.creatorName.split(' ')[0]} gets your reason.` })
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }) } finally { setBusy(false) }
  }
  const flag = (tone: string, text: string) => <span key={text} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[tone] ?? TONE.muted}`}>{text}</span>

  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        <button onClick={onPerson} aria-label={`${sh.creatorName}'s record`}><Avatar email={email} name={sh.creatorName} size={40} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-pt-text font-semibold">{sh.creatorName}{r.move && <span className="text-amber-300 font-normal"> · wants to move</span>}</p>
          <button onClick={onDay} className="text-left text-pt-text text-[15px] underline decoration-pt-border underline-offset-4">
            {formatDay(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(r.place, r.where, s)} · {fmtSlot(r.start, r.end - r.start)}</button>
          {r.move && <p className="text-pt-muted text-xs">Now: {formatDay(sh.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(sh.place, sh.where ?? '', s)} · {fmtSlot(sh.start, sh.end - sh.start)}</p>}
          <p className="text-pt-muted text-xs">Asked {ago(r.since)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {f.flags.map(x => flag(x.tone, x.text))}
        {flag('muted', `${f.filmed} of ${f.past30} filmed (30 days)`)}
        {flag('muted', `${f.upcoming} coming up`)}
      </div>
      {f.partners.length > 0 && <p className="text-pt-muted text-[13px]">Usually films with: <span className="text-pt-text">{partnerLine(f.partners)}</span></p>}
      {around.length > 0 && <p className="text-pt-muted text-[13px] leading-snug">{around.join(' · ')}</p>}
      {msg ? <p className={`text-sm font-semibold ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>
        : !denying ? (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => decide(true)} className="flex-1 min-h-[44px] rounded-xl bg-green-500/15 text-green-400 font-semibold disabled:opacity-40">Approve</button>
            <button disabled={busy} onClick={() => setDenying(true)} className="flex-1 min-h-[44px] rounded-xl bg-red-500/10 text-red-300 font-semibold disabled:opacity-40">Deny</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">{REASONS.map(x => <button key={x} onClick={() => setReason(x)} className={`px-3 min-h-[34px] rounded-full text-[13px] ${reason === x ? 'bg-pt-text text-black' : 'bg-pt-bg text-pt-muted'}`}>{x}</button>)}</div>
            <input id={`why-${sh.id}`} value={reason} onChange={e => setReason(e.target.value)} placeholder={`Why? ${sh.creatorName.split(' ')[0]} reads this`}
              className="w-full min-h-[44px] rounded-xl bg-pt-bg text-pt-text px-3 text-[16px]" />
            <div className="flex gap-2">
              <button onClick={() => setDenying(false)} className="flex-1 min-h-[44px] rounded-xl bg-pt-bg text-pt-text">Back</button>
              <button disabled={busy || reason.trim().length < 3} onClick={() => decide(false)} className="flex-1 min-h-[44px] rounded-xl bg-red-500/15 text-red-300 font-semibold disabled:opacity-40">Deny</button>
            </div>
          </div>
        )}
    </div>
  )
}

// One day, both houses side by side: who has each time, requests dashed. Offsite shoots and blocks underneath.
function DaySheet({ date, day, s, email, now, reqs, onClose }: { date: string; day?: ScheduleDay; s: ScheduleSettings; email: string; now: string; reqs: Req[]; onClose: () => void }) {
  const cell = (h: House, st: number) => {
    const x = slotState(day, date, h, st, s, email, now, true)
    if (x.t === 'booked') return <span className={`block truncate rounded-lg px-2 py-1 text-[13px] ${x.entry.pending ? 'border border-dashed border-amber-400/60 text-amber-300' : 'bg-pt-accent/15 text-pt-accent'}`}>{x.entry.name}</span>
    if (x.t === 'block') return <span className="block truncate text-pt-muted text-[13px] px-2">{x.block.note || BLOCK_TYPES[x.block.type]}</span>
    if (x.t === 'held') return <span className="block truncate text-amber-300 text-[13px] px-2">Held · {x.entry.name}</span>
    if (x.t === 'past') return <span className="block text-pt-muted text-[13px] px-2">—</span>
    return <span className="block text-green-400 text-[13px] px-2">Free</span>
  }
  return (
    <BottomSheet open onClose={onClose} title={formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}>
      {reqs.length > 0 && <p className="text-amber-300 text-sm mb-2">{reqs.length} request{reqs.length === 1 ? '' : 's'} waiting this day (dashed).</p>}
      <div className="grid grid-cols-[84px_1fr_1fr] gap-x-2 gap-y-1.5 items-center">
        <span /><span className="text-pt-muted text-xs font-semibold">{s.houses.cliff1.name}</span><span className="text-pt-muted text-xs font-semibold">{s.houses.cliff2.name}</span>
        {s.slots.map(st => [
          <span key={`t${st}`} className="text-pt-muted text-xs tabular-nums">{fmtSlot(st, s.slotMinutes)}</span>,
          <span key={`a${st}`} className="min-w-0">{cell('cliff1', st)}</span>,
          <span key={`b${st}`} className="min-w-0">{cell('cliff2', st)}</span>,
        ])}
      </div>
      {(day?.offsite ?? []).length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-pt-muted text-xs font-semibold">Offsite</p>
          {day!.offsite!.map(o => <p key={o.shootId} className={`text-[13px] ${o.pending ? 'text-amber-300' : 'text-pt-text'}`}>{fmtSlot(o.start, o.end - o.start)} · {o.name} · {o.where}{o.pending ? ' (requested)' : ''}</p>)}
        </div>
      )}
    </BottomSheet>
  )
}
