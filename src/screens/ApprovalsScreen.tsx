// Requests (owner, Nov 2): every creator booking waits here for the equipment team, an admin or the owner. One page with
// what's needed to decide ("succinct, but powerful"): the month at a glance, then each request with who's asking (their
// last 30 days, what's coming up, strikes), what's around that time at the house, and Approve / Deny.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { waitingRequests, sortReqs, factsFor, reqKey, placeName, ago, partnerLine, REASONS, type Req } from '../desk/requestFacts'
import { collabPairs } from '../lib/collabs'
import { useDesk } from '../desk/desk'
import DeskApprovals from '../desk/DeskApprovals'
import { GiveSlotSheet, ClashList, useCalendarClashes, type GiveTarget } from '../components/GiveSlotSheet'
import CalendarQueue from '../components/CalendarQueue'
import { useCalendarQueue } from '../services/schedule'
import { Toast } from '../components/cleanup/Parts'

/** Bookings | Calendar (owner, Nov 4): Google Calendar imports wait in their own tab for the equipment team. */
export function RequestTabs({ tab, setTab, bookings, calendar, desk }: { tab: string; setTab: (t: 'bookings' | 'calendar') => void; bookings: number; calendar: number; desk?: boolean }) {
  return (
    <div className={`flex bg-pt-surface rounded-xl p-1 gap-1 ${desk ? '' : 'w-full'}`} role="tablist">
      {([['bookings', 'Bookings', bookings], ['calendar', 'Google Calendar', calendar]] as const).map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`flex-1 min-h-[40px] px-4 rounded-lg text-sm whitespace-nowrap inline-flex items-center justify-center gap-1.5 ${tab === k ? 'bg-pt-raised text-pt-text font-semibold' : 'text-pt-muted'}`}>
          {l}{n > 0 && <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-bold inline-flex items-center justify-center ${k === 'calendar' ? 'bg-sky-400 text-stone-900' : 'bg-amber-400 text-stone-900'}`}>{n}</span>}
        </button>
      ))}
    </div>
  )
}


export default function ApprovalsScreen() {
  const navigate = useNavigate()
  const { profile, isGearStaff } = useSession()
  const s = useScheduleSettings()
  const [params, setParams] = useSearchParams()
  const tab = isGearStaff && params.get('tab') === 'calendar' ? 'calendar' : 'bookings'
  const setTab = (t: 'bookings' | 'calendar') => setParams(t === 'calendar' ? { tab: 'calendar' } : {}, { replace: true })
  const queue = useCalendarQueue(isGearStaff)
  const today = todayInStudio(), now = nowStamp()
  const days = useScheduleDays(addDays(today, -1), addDays(today, 120))
  // 90 days back: the last month's numbers + who usually films with whom.
  const shoots = useShootsSince(addDays(today, -90), true)
  const statuses = useAllStatuses(true)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [dayOpen, setDayOpen] = useState<string | null>(null)

  const reqs: Req[] = useMemo(() => sortReqs(waitingRequests(shoots ?? [], now), statuses),
    [shoots, statuses, now.slice(0, 15)])   // eslint-disable-line react-hooks/exhaustive-deps
  const clashes = useCalendarClashes(days, s)
  const [give, setGive] = useState<GiveTarget | null>(null)
  // The request card disappears once decided, so its confirmation shows here, at the top of the screen.
  const [done, setDone] = useState<string | null>(null)
  const pairs = useMemo(() => collabPairs(shoots ?? []), [shoots])
  const desk = useDesk()
  const tabs = isGearStaff ? <RequestTabs tab={tab} setTab={setTab} bookings={reqs.length} calendar={queue?.length ?? 0} desk={desk.on} /> : null
  if (desk.on && tab === 'calendar') return (
    <div className="h-full overflow-auto bg-[#0B0B0C]">
      <div className="max-w-[820px] mx-auto px-6 pt-5 pb-12 space-y-4">
        <div className="flex items-center gap-4 flex-wrap"><h1 className="text-pt-text text-[22px] font-bold tracking-tight">Requests</h1>{tabs}</div>
        <CalendarQueue items={queue} />
      </div>
    </div>
  )
  if (desk.on) return <DeskApprovals reqs={reqs} shoots={shoots} days={days} statuses={statuses} pairs={pairs} clashes={clashes} tabs={tabs} />

  return (
    <div className="min-h-full bg-pt-bg pb-12">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
        <h1 className="font-display text-[34px] text-pt-text">Requests</h1>
        {tabs && <div className="mt-2">{tabs}</div>}
        {tab === 'bookings' && <p className="text-pt-muted text-sm mt-2">{reqs.length === 0 ? 'Nothing waiting. New requests show up here.' : `${reqs.length} waiting for a yes or no, soonest first.`}</p>}
      </div>
      {tab === 'calendar' ? <div className="px-4 pt-2"><CalendarQueue items={queue} /></div> : <div className="px-4 space-y-6">
        <ClashList items={clashes} s={s} onGive={setGive} />
        <section className="bg-pt-surface shadow-hairline rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button aria-label="Previous month" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(monthAdd(month, -1))} className="w-10 h-10 rounded-full bg-pt-bg text-pt-accent text-xl disabled:opacity-30">‹</button>
            <h2 className="text-pt-text font-semibold text-[17px]">{monthTitle(month)}</h2>
            <button aria-label="Next month" onClick={() => setMonth(monthAdd(month, 1))} className="w-10 h-10 rounded-full bg-pt-bg text-pt-accent text-xl">›</button>
          </div>
          <MonthGrid month={month} days={days} s={s} email={profile.email} now={now} today={today} team onPick={setDayOpen} />
        </section>

        <section className="space-y-3">
          {reqs.map(r => <RequestCard key={reqKey(r)} r={r} s={s} days={days} shoots={shoots ?? []} pairs={pairs} status={statuses[r.shoot.creatorEmail]} today={today} now={now} onDone={setDone}
            onDay={() => { setMonth(r.date.slice(0, 7)); setDayOpen(r.date) }} onPerson={() => navigate(`/people/${encodeURIComponent(r.shoot.creatorEmail)}`)}
            onGive={r.place !== 'offsite' && !r.move ? () => setGive({ date: r.date, house: r.place as House, start: r.start, holder: { name: r.shoot.creatorName, email: r.shoot.creatorEmail } }) : undefined} />)}
        </section>
      </div>}
      {dayOpen && <DaySheet date={dayOpen} day={days?.[dayOpen]} s={s} email={profile.email} now={now} reqs={reqs.filter(r => r.date === dayOpen)} onClose={() => setDayOpen(null)}
        onGive={(h, st, e) => { setDayOpen(null); setGive({ date: dayOpen, house: h, start: st, holder: { name: e.name, email: e.email ?? '' } }) }} />}
      {give && <GiveSlotSheet t={give} onClose={() => setGive(null)} />}
      {done && <Toast text={done} onDone={() => setDone(null)} />}
    </div>
  )
}

export const TONE: Record<string, string> = { red: 'bg-red-400/15 text-red-300', amber: 'bg-amber-400/15 text-amber-300', green: 'bg-green-400/10 text-green-300',
  gold: 'bg-pt-accent/15 text-pt-accent', muted: 'bg-pt-bg text-pt-muted' }

function RequestCard({ r, s, days, shoots, pairs, status, today, now, onDay, onPerson, onGive, onDone }: {
  r: Req; s: ScheduleSettings; days: Record<string, ScheduleDay> | null; shoots: Shoot[]; pairs: ReturnType<typeof collabPairs>; status?: UserStatus; today: string; now: string
  onDay: () => void; onPerson: () => void; onGive?: () => void; onDone: (text: string) => void
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
      const text = approve ? `Approved ✓ ${sh.creatorName.split(' ')[0]} gets a notification.` : `Denied. ${sh.creatorName.split(' ')[0]} gets your reason.`
      setMsg({ ok: true, text }); onDone(text)
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }) } finally { setBusy(false) }
  }
  const flag = (tone: string, text: string) => <span key={text} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[tone] ?? TONE.muted}`}>{text}</span>

  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        <button onClick={onPerson} aria-label={`${sh.creatorName}'s record`}><Avatar email={email} name={sh.creatorName} size={40} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-pt-text font-semibold">{sh.creatorName}{r.move && <span className="text-amber-300 font-normal"> · wants to move</span>}</p>
          <button onClick={onDay} className="tap text-left text-pt-text text-[15px] underline decoration-pt-border underline-offset-4">
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
      {sh.guideline && <a href={sh.guideline.url} target="_blank" rel="noreferrer" className="block text-[14px] text-pt-accent font-semibold">Guideline: {sh.guideline.name} ›</a>}
      {f.partners.length > 0 && <p className="text-pt-muted text-[13px]">Usually films with: <span className="text-pt-text">{partnerLine(f.partners)}</span></p>}
      {around.length > 0 && <p className="text-pt-muted text-[13px] leading-snug">{around.join(' · ')}</p>}
      {msg ? <p className={`text-sm font-semibold ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>
        : !denying ? (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => decide(true)} className="flex-1 min-h-[44px] rounded-xl bg-green-500/15 text-green-400 font-semibold disabled:opacity-40">Approve</button>
            <button disabled={busy} onClick={() => setDenying(true)} className="flex-1 min-h-[44px] rounded-xl bg-red-500/10 text-red-300 font-semibold disabled:opacity-40">Deny</button>
            {onGive && s.instantBookers.length > 0 && <button disabled={busy} onClick={onGive} className="shrink-0 px-3 min-h-[44px] rounded-xl bg-pt-bg text-pt-accent text-[13px] font-semibold">Priority booking…</button>}
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
function DaySheet({ date, day, s, email, now, reqs, onClose, onGive }: { date: string; day?: ScheduleDay; s: ScheduleSettings; email: string; now: string; reqs: Req[]; onClose: () => void
  onGive: (h: House, start: number, e: { name: string; email?: string }) => void }) {
  const cell = (h: House, st: number) => {
    const x = slotState(day, date, h, st, s, email, now, true)
    if (x.t === 'booked') return <button onClick={() => onGive(h, st, x.entry)} title="Give this slot to someone with priority" className={`block w-full text-left truncate rounded-lg px-2 py-1 text-[13px] ${x.entry.pending ? 'border border-dashed border-amber-400/60 text-amber-300' : 'bg-pt-accent/15 text-pt-accent'}`}>{x.entry.name}</button>
    if (x.t === 'block') return <span className="block truncate text-pt-muted text-[13px] px-2">{x.block.note || BLOCK_TYPES[x.block.type]}</span>
    if (x.t === 'held') return <span className="block truncate text-amber-300 text-[13px] px-2">Held · {x.entry.name}</span>
    if (x.t === 'past') return <span className="block text-pt-muted text-[13px] px-2">—</span>
    return <span className="block text-green-400 text-[13px] px-2">Free</span>
  }
  return (
    <BottomSheet open onClose={onClose} title={formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}>
      {reqs.length > 0 && <p className="text-amber-300 text-sm mb-2">{reqs.length} request{reqs.length === 1 ? '' : 's'} waiting this day (dashed).</p>}
      <p className="text-pt-muted text-xs mb-2">Tap a name to make a priority booking for that slot.</p>
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
