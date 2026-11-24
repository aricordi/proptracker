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
import { Icon } from '../components/Icon'
import MonthGrid, { monthAdd, monthTitle } from '../components/MonthGrid'
import {
  useScheduleSettings, useScheduleDays, useShootsSince, useAllStatuses, decideBooking, fmtSlot,
  type House, type Shoot, type ScheduleDay, type ScheduleSettings, type UserStatus,
} from '../services/schedule'
import { waitingRequests, sortReqs, factsFor, reqKey, placeName, reqHours, ago, partnerLine, REASONS, type Req } from '../desk/requestFacts'
import { collabPairs } from '../lib/collabs'
import { useDesk } from '../desk/desk'
import DeskApprovals from '../desk/DeskApprovals'
import { DayPickSheet } from '../components/DayGrid'
import { GiveSlotSheet, ClashList, useCalendarClashes, type GiveTarget } from '../components/GiveSlotSheet'
import CalendarQueue from '../components/CalendarQueue'
import { useCalendarQueue } from '../services/schedule'
import { Toast } from '../components/cleanup/Parts'
import { isOwnFileLink } from '../lib/safeLink'

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
  const { profile, isGearStaff, canSeeStaff } = useSession()
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
    <div className="h-full overflow-auto bg-pt-bg">
      <div className="px-6 pt-5 pb-3 flex items-center gap-4 min-w-0"><h1 className="text-pt-text text-[28px] font-bold tracking-tight font-display">Requests</h1>{tabs}</div>
      <div className="max-w-[820px] px-6 pb-12 space-y-4">
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
            onDay={() => { setMonth(r.date.slice(0, 7)); setDayOpen(r.date) }} onPerson={canSeeStaff ? () => navigate(`/people/${encodeURIComponent(r.shoot.creatorEmail)}`) : undefined}
            onGive={r.place !== 'offsite' && !r.move ? () => setGive({ date: r.date, house: r.place as House, start: r.start, holder: { name: r.shoot.creatorName, email: r.shoot.creatorEmail } }) : undefined} />)}
        </section>
      </div>}
      {dayOpen && <DayPickSheet date={dayOpen} day={days?.[dayOpen]} team={isGearStaff} lockFree teamView canBook={false} now={now}
        note={reqs.some(r => r.date === dayOpen) ? `${reqs.filter(r => r.date === dayOpen).length} waiting for a yes or no this day (dashed). Tap one to open it.` : undefined}
        onClose={() => setDayOpen(null)} onDay={d => setDayOpen(d)}
        onTap={(st, h, start, end) => {
          if (st.t === 'booked' || st.t === 'held') { if (st.entry.shootId) { setDayOpen(null); navigate(`/schedule?shoot=${encodeURIComponent(st.entry.shootId)}`) } return }
          if (!isGearStaff) return
          setDayOpen(null); navigate(`/schedule?day=${dayOpen}${st.t === 'free' ? `&tap=${h}.${start}${end ? `.${end}` : ''}` : ''}`)
        }}
        onShoot={id => { setDayOpen(null); navigate(`/schedule?shoot=${encodeURIComponent(id)}`) }}
        onOffsite={() => { setDayOpen(null); navigate(`/schedule?offsite=${dayOpen}`) }} />}
      {give && <GiveSlotSheet t={give} onClose={() => setGive(null)} />}
      {done && <Toast text={done} onDone={() => setDone(null)} />}
    </div>
  )
}

export const TONE: Record<string, string> = { red: 'bg-red-400/15 text-red-300', amber: 'bg-amber-400/15 text-amber-300', green: 'bg-green-400/10 text-green-300',
  gold: 'bg-pt-accent/15 text-pt-accent', muted: 'bg-pt-bg text-pt-muted' }

function RequestCard({ r, s, days, shoots, pairs, status, today, now, onDay, onPerson, onGive, onDone }: {
  r: Req; s: ScheduleSettings; days: Record<string, ScheduleDay> | null; shoots: Shoot[]; pairs: ReturnType<typeof collabPairs>; status?: UserStatus; today: string; now: string
  onDay: () => void; onPerson?: () => void; onGive?: () => void; onDone: (text: string) => void
}) {
  const sh = r.shoot, email = sh.creatorEmail
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const f = factsFor(r, shoots, status, days, s, today, now, pairs)

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
        {onPerson ? <button onClick={onPerson} aria-label={`${sh.creatorName}'s record`}><Avatar email={email} name={sh.creatorName} size={40} /></button> : <Avatar email={email} name={sh.creatorName} size={40} />}
        <div className="min-w-0 flex-1">
          <p className="text-pt-text font-semibold">{sh.creatorName}{r.move && <span className="text-amber-300 font-normal"> · wants to move</span>}</p>
          <button onClick={onDay} aria-label="Open this day" className="tap text-left text-pt-text text-[15px] inline-flex items-center gap-1.5">
            <Icon name="calendar" className="w-4 h-4 text-pt-accent shrink-0" />
            <span>{formatDay(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(r.place, r.where, s, !!r.shoot.bothHouses)} · {reqHours(r)}</span>
            <span aria-hidden className="text-pt-muted">›</span></button>
          {r.move && <p className="text-pt-muted text-xs">Now: {formatDay(sh.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(sh.place, sh.where ?? '', s)} · {fmtSlot(sh.start, sh.end - sh.start)}</p>}
          <p className="text-pt-muted text-xs">Asked {ago(r.since)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {f.flags.map(x => flag(x.tone, x.text))}
        {flag('muted', `${f.filmed} of ${f.past30} filmed (30 days)`)}
        {flag('muted', `${f.upcoming} coming up`)}
      </div>
      {sh.guideline && isOwnFileLink(sh.guideline.url) && <a href={sh.guideline.url} target="_blank" rel="noreferrer" className="block text-[14px] text-pt-accent font-semibold">Guideline: {sh.guideline.name} ›</a>}
      {f.partners.length > 0 && <p className="text-pt-muted text-[13px]">Usually films with: <span className="text-pt-text">{partnerLine(f.partners)}</span></p>}
      {f.around.length > 0 && (
        <div className="rounded-xl bg-pt-bg/60 px-3 py-1.5 divide-y divide-white/[0.05]">
          {f.around.map(x => {
            const free = x.value === 'Free', warn = x.label.startsWith('⚠') || x.label.startsWith('Blocked')
            return (
              <div key={x.label} className="flex items-center gap-2 py-1.5 text-[13px]">
                <i aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${free ? 'bg-green-400' : warn ? 'bg-red-400' : x.label.startsWith('Heads-up') ? 'bg-amber-300' : 'bg-pt-muted'}`} />
                <span className="text-pt-muted shrink-0">{x.label.replace(/^⚠\s*/, '')}</span>
                <span className={`flex-1 min-w-0 text-right truncate ${free ? 'text-green-300' : 'text-pt-text'}`}>{x.value}</span>
              </div>
            )
          })}
        </div>
      )}
      {msg ? <p className={`text-sm font-semibold ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>
        : !denying ? (
          <div className="space-y-1">
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => decide(true)} className="flex-1 min-h-[44px] rounded-xl bg-green-500/15 text-green-400 font-semibold disabled:opacity-40">Approve</button>
              <button disabled={busy} onClick={() => setDenying(true)} className="flex-1 min-h-[44px] rounded-xl bg-red-500/10 text-red-300 font-semibold disabled:opacity-40">Deny</button>
            </div>
            {onGive && s.instantBookers.length > 0 && <button disabled={busy} onClick={onGive} className="w-full min-h-[44px] rounded-xl text-pt-accent text-[15px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40">Priority booking<span aria-hidden className="text-pt-muted">›</span></button>}
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

