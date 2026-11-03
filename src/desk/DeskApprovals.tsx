// Requests & schedule on a laptop (owner, Nov 2, mockup https://claude.ai/artifact/1isLGLUyiGDKDuagpzZwgU approved): a numbers
// strip, a WEEK BOARD of both houses (every day × every slot: approved, requested, moving, Kyle, blocked) or the month, and on the
// right the waiting requests (oldest first, tick several → approve all) with everything needed to decide one. Keyboard:
// A approve, D deny, J/K next/previous, W/M week/month, ←/→ change week, T this week, Esc back.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useProfiles } from '../services/profiles'
import Avatar from '../components/Avatar'
import MonthGrid, { monthAdd, monthTitle } from '../components/MonthGrid'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, decideBooking, fmtSlot, slotKey, blockAt, slotWindow, BLOCK_TYPES, HOUSES,
  type House, type Shoot, type ScheduleDay, type UserStatus,
} from '../services/schedule'
import { factsFor, reqKey, placeName, ago, hoursWaiting, REASONS, type Req } from './requestFacts'
import type { Pair } from '../lib/collabs'
import { useKeys } from './desk'
import { GiveSlotSheet, ClashList, type GiveTarget } from '../components/GiveSlotSheet'

const TONE: Record<string, string> = { red: 'bg-red-400/15 text-red-300', amber: 'bg-amber-400/15 text-amber-200', green: 'bg-green-400/10 text-green-300',
  gold: 'bg-pt-accent/15 text-pt-accent', muted: 'bg-pt-raised text-pt-muted' }
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7))

export default function DeskApprovals({ reqs, shoots, days, statuses, pairs, clashes = [] }: {
  reqs: Req[]; shoots: Shoot[] | null; days: Record<string, ScheduleDay> | null; statuses: Record<string, UserStatus>; pairs: Pair[]; clashes?: GiveTarget[]
}) {
  const [give, setGive] = useState<GiveTarget | null>(null)
  const navigate = useNavigate()
  const { profile } = useSession()
  const s = useScheduleSettings()
  const today = todayInStudio()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const [view, setView] = useState<'week' | 'month'>('week')
  const [week, setWeek] = useState(mondayOf(today))
  const [month, setMonth] = useState(today.slice(0, 7))
  const queue = useMemo(() => { const first = (r: Req) => statuses[r.shoot.creatorEmail]?.firstInLine && !r.move ? 0 : 1; return [...reqs].sort((a, b) => first(a) - first(b) || a.since.localeCompare(b.since)) }, [reqs, statuses])
  const [sel, setSel] = useState<string | null>(null)
  const cur = queue.find(r => reqKey(r) === sel) ?? queue[0] ?? null
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => { setDenying(false); setReason('') }, [cur && reqKey(cur)])   // eslint-disable-line react-hooks/exhaustive-deps

  const all = shoots ?? []
  const byId = useMemo(() => new Map(all.map(x => [x.id, x])), [all])
  const instant = new Set(s.instantBookers.map(p => p.email))
  const flagged = (email: string) => !!statuses[email]?.strikes || all.some(x => x.creatorEmail === email && x.noShow && x.date >= addDays(today, -30))

  const select = (r: Req) => { setSel(reqKey(r)); if (view === 'week') setWeek(mondayOf(r.date)) }
  const step = (n: number) => {
    if (!queue.length) return
    const i = cur ? queue.findIndex(r => reqKey(r) === reqKey(cur)) : -1
    select(queue[(i + n + queue.length) % queue.length])
  }
  const nextAfter = (done: string[]) => { const rest = queue.filter(r => !done.includes(reqKey(r))); setSel(rest[0] ? reqKey(rest[0]) : null) }

  async function decide(r: Req, approve: boolean, why = '') {
    setBusy(true)
    try {
      await decideBooking({ id: r.shoot.id, approve, ...(approve ? {} : { reason: why }) })
      const first = r.shoot.creatorName.split(' ')[0]
      setToast({ ok: true, text: approve ? `${first} approved · they get a notification` : `${first} told: "${why}"` })
      nextAfter([reqKey(r)])
    } catch (e) { setToast({ ok: false, text: friendlyError(e) }) } finally { setBusy(false); setDenying(false); setReason('') }
  }
  async function approveTicked() {
    const list = queue.filter(r => ticked.has(reqKey(r)))
    setBusy(true)
    let ok = 0
    const failed: string[] = []
    for (const r of list) { try { await decideBooking({ id: r.shoot.id, approve: true }); ok++ } catch (e) { failed.push(`${r.shoot.creatorName}: ${friendlyError(e)}`) } }
    setBusy(false); setTicked(new Set())
    setToast({ ok: !failed.length, text: failed.length ? `${ok} approved. Not approved: ${failed.join('; ')}` : `${ok} approved · they get a notification` })
    nextAfter(list.map(reqKey))
  }

  useKeys({
    a: () => { if (cur && !busy && !denying) decide(cur, true) },
    d: () => { if (cur) setDenying(true) },
    j: () => step(1), k: () => step(-1),
    w: () => setView('week'), m: () => setView('month'),
    t: () => { setWeek(mondayOf(today)); setMonth(today.slice(0, 7)) },
    ArrowRight: () => view === 'week' ? setWeek(addDays(week, 7)) : setMonth(monthAdd(month, 1)),
    ArrowLeft: () => view === 'week' ? setWeek(addDays(week, -7)) : setMonth(monthAdd(month, -1)),
    Escape: () => setDenying(false),
  })

  // Numbers across the top.
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const live = (x: Shoot) => x.status === 'booked'
  const todayShoots = all.filter(x => live(x) && x.date === today).length
  const thisWeek = mondayOf(today)
  const weekBooked = all.filter(x => live(x) && x.date >= thisWeek && x.date <= addDays(thisWeek, 6))
  const houseSlots = weekBooked.filter(x => x.place !== 'offsite').length
  const use = Math.round(houseSlots / Math.max(1, 7 * HOUSES.length * s.slots.length) * 100)
  const old = queue.filter(r => hoursWaiting(r.since) > 12).length
  const kpis: { n: string; label: string; tone?: string }[] = [
    { n: String(queue.length), label: 'Requests waiting', tone: queue.length ? 'text-amber-300' : '' },
    { n: String(old), label: 'Waiting over 12 h', tone: old ? 'text-red-300' : '' },
    { n: String(todayShoots), label: 'Shoots today' },
    { n: String(weekBooked.length), label: 'Booked this week' },
    { n: `${use}%`, label: 'House use this week', tone: 'text-green-400' },
    { n: String(pairs.filter(p => p.times >= 2).length), label: 'Regular filming pairs (90 days)' },
  ]

  return (
    <div className="h-full flex bg-[#0B0B0C]">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-6 pt-5 pb-3 flex-wrap">
          <h1 className="text-pt-text text-[22px] font-bold tracking-tight mr-2">Requests &amp; schedule</h1>
          <div className="flex bg-pt-surface rounded-[10px] p-0.5">
            {(['week', 'month'] as const).map(v => <button key={v} onClick={() => setView(v)} title={v === 'week' ? 'W' : 'M'}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] ${view === v ? 'bg-pt-raised text-pt-text font-semibold' : 'text-pt-muted'}`}>{v === 'week' ? 'Week' : 'Month'}</button>)}
          </div>
          <button aria-label="Previous" onClick={() => view === 'week' ? setWeek(addDays(week, -7)) : setMonth(monthAdd(month, -1))} className="w-8 h-8 rounded-lg bg-pt-surface text-pt-text">‹</button>
          <span className="text-pt-text font-semibold min-w-[170px] text-center tabular-nums">{view === 'week'
            ? `${formatDay(week, { month: 'short', day: 'numeric' })} – ${formatDay(addDays(week, 6), { month: 'short', day: 'numeric' })}` : monthTitle(month)}</span>
          <button aria-label="Next" onClick={() => view === 'week' ? setWeek(addDays(week, 7)) : setMonth(monthAdd(month, 1))} className="w-8 h-8 rounded-lg bg-pt-surface text-pt-text">›</button>
          <button onClick={() => { setWeek(mondayOf(today)); setMonth(today.slice(0, 7)) }} className="px-3 h-8 rounded-lg bg-pt-surface text-pt-muted text-[13px] hover:text-pt-text">Today</button>
          <span className="ml-auto text-pt-muted text-xs hidden 2xl:block">Keys: <Kbd>A</Kbd> approve <Kbd>D</Kbd> deny <Kbd>J</Kbd>/<Kbd>K</Kbd> next <Kbd>W</Kbd>/<Kbd>M</Kbd> view <Kbd>←</Kbd><Kbd>→</Kbd> week</span>
        </div>
        <div className="grid grid-cols-6 gap-px bg-white/[0.06] border-y border-white/[0.06]">
          {kpis.map(k => <div key={k.label} className="bg-[#0B0B0C] px-4 py-2.5 min-w-0"><b className={`block text-[22px] font-bold tracking-tight tabular-nums ${k.tone || 'text-pt-text'}`}>{k.n}</b><span className="block text-pt-muted text-xs leading-tight">{k.label}</span></div>)}
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {days === null ? <p className="text-pt-muted text-sm">Loading…</p> : view === 'month' ? (
            <div className="max-w-[900px]">
              <MonthGrid month={month} days={days} s={s} email={profile.email} now={now} today={today} team onPick={d => { setWeek(mondayOf(d)); setView('week') }} />
              <p className="text-pt-muted text-xs mt-3">Tap a day to open its week.</p>
            </div>
          ) : (
            <WeekBoard weekDays={weekDays} days={days} today={today} now={now} sel={cur} byId={byId} instant={instant} flagged={flagged} reqs={queue}
              onReq={select} onShoot={id => navigate(`/schedule?shoot=${encodeURIComponent(id)}`)} />
          )}
        </div>
      </div>

      <aside className="w-[344px] shrink-0 border-l border-white/[0.06] flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-4 pt-5 pb-3 border-b border-white/[0.06]">
          <h2 className="text-pt-text text-[16px] font-semibold">Waiting ({queue.length})</h2>
          {ticked.size > 0
            ? <button disabled={busy} onClick={approveTicked} className="ml-auto px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[13px] font-semibold disabled:opacity-40">Approve {ticked.size} ticked</button>
            : <span className="ml-auto text-pt-muted text-xs">Oldest first</span>}
        </div>
        {clashes.length > 0 && <div className="px-3 pt-3 max-h-[220px] overflow-y-auto"><ClashList items={clashes} s={s} onGive={setGive} /></div>}
        <div className="max-h-[260px] overflow-y-auto border-b border-white/[0.06]">
          {queue.length === 0 && <p className="text-pt-muted text-sm px-4 py-6 text-center">All caught up. New requests show up here and on the board.</p>}
          {queue.map(r => {
            const k = reqKey(r), on = cur && reqKey(cur) === k
            return (
              <div key={k} onClick={() => select(r)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && select(r)}
                className={`grid grid-cols-[18px_28px_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 cursor-pointer ${on ? 'bg-pt-raised' : 'hover:bg-white/[0.03]'}`}>
                <input type="checkbox" aria-label={`Tick ${r.shoot.creatorName}`} checked={ticked.has(k)} onClick={e => e.stopPropagation()}
                  onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(k); else n.delete(k); return n })} className="accent-[#C9A961]" />
                <Avatar email={r.shoot.creatorEmail} name={r.shoot.creatorName} size={28} />
                <span className="min-w-0">
                  <span className="block text-pt-text text-[13px] font-semibold truncate">{r.shoot.creatorName}{flagged(r.shoot.creatorEmail) && <span className="text-red-400"> ●</span>}</span>
                  <span className="block text-pt-muted text-xs truncate">{r.move ? 'Move → ' : ''}{formatDay(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(r.place, r.where, s)} · {fmtSlot(r.start, r.end - r.start)}</span>
                </span>
                <span className={`text-xs tabular-nums ${hoursWaiting(r.since) > 12 ? 'text-red-300' : 'text-pt-muted'}`}>{ago(r.since).replace(' ago', '')}</span>
              </div>
            )
          })}
        </div>
        {cur ? <Inspector key={reqKey(cur)} r={cur} shoots={all} status={statuses[cur.shoot.creatorEmail]} days={days} pairs={pairs} today={today} now={now}
          busy={busy} denying={denying} reason={reason} setReason={setReason} setDenying={setDenying}
          onApprove={() => decide(cur, true)} onDeny={() => decide(cur, false, reason.trim())}
          onRecord={() => navigate(`/people/${encodeURIComponent(cur.shoot.creatorEmail)}`)}
          onGive={cur.place !== 'offsite' && !cur.move && s.instantBookers.length ? () => setGive({ date: cur.date, house: cur.place as House, start: cur.start, holder: { name: cur.shoot.creatorName, email: cur.shoot.creatorEmail } }) : undefined} />
          : <div className="flex-1" />}
      </aside>
      {give && <GiveSlotSheet t={give} onClose={() => setGive(null)} />}
      {toast && <div role="status" className={`fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-xl shadow-float text-[14px] font-semibold ${toast.ok ? 'bg-pt-raised text-pt-text' : 'bg-red-600 text-white'}`}>{toast.text}</div>}
    </div>
  )
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="mx-0.5 px-1.5 py-px rounded bg-pt-raised text-pt-text font-mono text-[11px]">{children}</kbd>

function WeekBoard({ weekDays, days, today, now, sel, byId, instant, flagged, reqs, onReq, onShoot }: {
  weekDays: string[]; days: Record<string, ScheduleDay>; today: string; now: string; sel: Req | null; byId: Map<string, Shoot>; instant: Set<string>
  flagged: (email: string) => boolean; reqs: Req[]; onReq: (r: Req) => void; onShoot: (id: string) => void
}) {
  const s = useScheduleSettings()
  const reqAt = (date: string, h: House, st: number) => reqs.find(r => r.date === date && r.place === h && r.start === st)
  const cols = `56px repeat(${weekDays.length * HOUSES.length}, minmax(42px, 1fr))`
  const cell = (date: string, h: House, st: number) => {
    const day = days[date]
    const past = slotWindow(date, st, s.slotMinutes).to <= now
    const e = day?.[h]?.[slotKey(st)]
    const block = blockAt(day, h, st, s.slotMinutes)
    const r = reqAt(date, h, st)
    let cls = 'bg-white/[0.025]', who = '', sub = '', click: (() => void) | undefined, dot = false, title = 'Free'
    if (e?.hold) { cls = 'bg-amber-400/[0.06] shadow-[inset_0_0_0_1px_rgba(245,184,61,0.4)]'; who = e.name; sub = 'held · invite'; title = `Held for ${e.name}` }
    else if (e) {
      const sh = byId.get(e.shootId), first = e.name.split(' ')[0]
      who = first; dot = !!e.email && flagged(e.email); title = e.name
      if (e.pending && e.move) { cls = 'bg-sky-400/[0.08] shadow-[inset_0_0_0_1px_rgba(124,196,250,0.6)] text-sky-200'; sub = 'wants to move here'; if (r) click = () => onReq(r) }
      else if (e.pending) { cls = 'bg-amber-400/[0.08] bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(245,184,61,0.07)_6px_12px)] shadow-[inset_0_0_0_1px_rgba(245,184,61,0.55)] text-amber-100'; sub = 'requested'; if (r) click = () => onReq(r) }
      else if (e.email && instant.has(e.email)) { cls = 'bg-pt-accent/15 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.6)] text-pt-accent'; sub = 'priority'; click = () => onShoot(e.shootId) }
      else { cls = 'bg-pt-surface text-pt-text'; sub = sh?.moveRequest ? 'moving…' : sh?.checkin ? 'checked in' : ''; click = () => onShoot(e.shootId) }
      if (sh?.moveRequest && !e.pending) cls += ' opacity-60'
    } else if (block) { cls = 'bg-[repeating-linear-gradient(135deg,#161618_0_7px,#1F1F22_7px_14px)] text-pt-muted'; who = block.note || BLOCK_TYPES[block.type]; sub = 'blocked'; title = who }
    const on = sel && r && reqKey(sel) === reqKey(r)
    return (
      <button key={`${date}${h}${st}`} disabled={!click} onClick={click} title={`${formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${s.houses[h].name} · ${fmtSlot(st, s.slotMinutes)} · ${title}`}
        className={`relative h-[52px] rounded-[7px] px-1.5 py-1 text-left text-[12px] leading-tight overflow-hidden ${cls} ${past ? 'opacity-35' : ''} ${on ? '!shadow-[inset_0_0_0_2px_#F5F5F7]' : ''} ${click ? 'hover:brightness-125' : ''} ${h === HOUSES[HOUSES.length - 1] ? 'mr-1' : ''}`}>
        {who && <span className="block font-semibold truncate">{who}</span>}
        {sub && <span className="block text-[11px] opacity-70 truncate">{sub}</span>}
        {dot && <i className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-400" aria-label="Has flags" />}
      </button>
    )
  }
  return (
    <div className="min-w-[700px]">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: cols }}>
        <span />
        {weekDays.map(d => (
          <div key={d} className={`text-center pb-0.5 font-semibold text-[13px] ${d === today ? 'text-pt-accent' : 'text-pt-text'}`} style={{ gridColumn: `span ${HOUSES.length}` }}>
            {formatDay(d, { weekday: 'short' })} {Number(d.slice(8))}
            <span className="block text-[11px] font-normal text-pt-muted">{d === today ? 'today' : weekday(d) === 0 ? 'no crew' : (s.priorityWeekdays.includes(weekday(d)) ? 'priority' : ' ')}</span>
          </div>
        ))}
        <span />
        {weekDays.map(d => HOUSES.map(h => <div key={`${d}${h}`} className={`text-center text-[11px] text-pt-muted pb-1 border-b border-white/[0.06] ${h === HOUSES[HOUSES.length - 1] ? 'mr-1' : ''}`}>{s.houses[h].name}</div>))}
        {s.slots.map(st => [
          <span key={`t${st}`} className="text-right pr-2 pt-1.5 text-pt-muted text-[11px] tabular-nums">{fmtTime(st)}</span>,
          ...weekDays.flatMap(d => HOUSES.map(h => cell(d, h, st))),
        ])}
      </div>
      <div className="mt-3 grid gap-[3px]" style={{ gridTemplateColumns: cols }}>
        <span className="text-right pr-2 text-pt-muted text-[11px]">Offsite</span>
        {weekDays.map(d => (
          <div key={d} className="text-[11px] text-pt-muted space-y-0.5 pr-1" style={{ gridColumn: `span ${HOUSES.length}` }}>
            {(days[d]?.offsite ?? []).map(o => {
              const r = reqs.find(x => x.shoot.id === o.shootId && !x.move)
              return <button key={o.shootId} onClick={() => r ? onReq(r) : onShoot(o.shootId)} className={`block w-full truncate text-left rounded px-1 ${o.pending ? 'text-amber-200 bg-amber-400/[0.08]' : 'hover:text-pt-text'}`}>
                {fmtSlot(o.start, o.end - o.start).split('–')[0]} {o.name.split(' ')[0]} · {o.where}{o.pending ? ' (requested)' : ''}</button>
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-4 text-pt-muted text-xs">
        <Key c="bg-pt-surface">Approved</Key>
        <Key c="bg-amber-400/20 shadow-[inset_0_0_0_1px_rgba(245,184,61,0.7)]">Request waiting</Key>
        <Key c="bg-sky-400/20 shadow-[inset_0_0_0_1px_rgba(124,196,250,0.7)]">Wants to move (old slot faded)</Key>
        <Key c="bg-pt-accent/25 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.7)]">Books without approval (Kyle)</Key>
        <Key c="bg-[repeating-linear-gradient(135deg,#161618_0_3px,#2a2a2e_3px_6px)]">Blocked</Key>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-red-400" />Strikes or a no-show (30 days)</span>
      </div>
    </div>
  )
}
const Key = ({ c, children }: { c: string; children: React.ReactNode }) => <span className="flex items-center gap-1.5"><i className={`w-3 h-3 rounded-[3px] ${c}`} />{children}</span>

function Inspector({ r, shoots, status, days, pairs, today, now, busy, denying, reason, setReason, setDenying, onApprove, onDeny, onRecord, onGive }: {
  r: Req; shoots: Shoot[]; status?: UserStatus; days: Record<string, ScheduleDay> | null; pairs: Pair[]; today: string; now: string
  busy: boolean; denying: boolean; reason: string; setReason: (v: string) => void; setDenying: (v: boolean) => void
  onApprove: () => void; onDeny: () => void; onRecord: () => void; onGive?: () => void
}) {
  const s = useScheduleSettings()
  const profiles = useProfiles()
  const sh = r.shoot
  const f = factsFor(r, shoots, status, days, s, today, now, pairs)
  const channel = profiles[sh.creatorEmail]?.channel
  return <>
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar email={sh.creatorEmail} name={sh.creatorName} size={42} />
        <div className="min-w-0">
          <p className="text-pt-text text-[16px] font-semibold truncate">{sh.creatorName}</p>
          <p className="text-pt-muted text-xs truncate">{channel ? `${channel} · ` : ''}<button onClick={onRecord} className="text-pt-accent hover:underline">Open record ›</button></p>
        </div>
      </div>
      <div className="bg-pt-surface rounded-xl px-3 py-2.5">
        {r.move && <p className="text-pt-muted text-xs">Wants to move from {formatDay(sh.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(sh.place, sh.where ?? '', s)} · {fmtSlot(sh.start, sh.end - sh.start)}</p>}
        <p className="text-pt-text text-[15px] font-bold">{r.move ? 'to ' : ''}{formatDay(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {placeName(r.place, r.where, s)} · {fmtSlot(r.start, r.end - r.start)}</p>
        <p className="text-pt-muted text-xs">Asked {ago(r.since)}{r.place === 'cliff1' && s.priorityWeekdays.includes(weekday(r.date)) ? ' · priority day' : ''}{weekday(r.date) === 0 ? ' · Sunday, no crew' : ''}</p>
      </div>
      {sh.guideline && <a href={sh.guideline.url} target="_blank" rel="noreferrer" className="block bg-pt-surface rounded-xl px-3 py-2 text-[13px] text-pt-accent font-semibold hover:underline">Filming guideline: {sh.guideline.name} ›</a>}
      {f.flags.length > 0 && <div className="flex flex-wrap gap-1.5">{f.flags.map(x => <span key={x.text} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[x.tone]}`}>{x.text}</span>)}</div>}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat n={`${f.filmed} of ${f.past30}`} l="filmed · 30 days" />
        <Stat n={String(f.thisMonth)} l="others this month" />
        <Stat n={String(f.sameWeek)} l="others that week" />
      </div>
      <Spark weeks={f.weekly} />
      <div className="bg-pt-surface rounded-xl px-3 divide-y divide-white/[0.06]">
        {f.around.map(x => <div key={x.label} className="flex justify-between gap-3 py-1.5 text-[12px]"><span className="text-pt-muted">{x.label}</span><span className="text-pt-text text-right">{x.value}</span></div>)}
        {f.around.length === 0 && <p className="py-2 text-pt-muted text-xs">Offsite: no house is held.</p>}
      </div>
      <div className="bg-pt-surface rounded-xl px-3 py-2">
        <p className="text-pt-muted text-xs mb-1">Usually films with (last 90 days)</p>
        {f.partners.length === 0 ? <p className="text-pt-muted text-[13px]">Nobody yet: films alone.</p>
          : f.partners.slice(0, 4).map(p => (
            <div key={p.email} className="flex items-center gap-2 py-1">
              <Avatar email={p.email} name={p.name} size={22} />
              <span className="flex-1 min-w-0 text-[13px] text-pt-text truncate">{p.name}</span>
              <span className="text-xs text-pt-muted tabular-nums">{p.times}× · last {formatDay(p.last, { month: 'short', day: 'numeric' })}</span>
            </div>
          ))}
      </div>
    </div>
    <div className="px-4 py-3 border-t border-white/[0.06]">
      {!denying ? (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={onApprove} className="min-h-[42px] rounded-xl bg-green-500/15 text-green-400 font-bold disabled:opacity-40">Approve <Kbd>A</Kbd></button>
          <button disabled={busy} onClick={() => setDenying(true)} className="min-h-[42px] rounded-xl bg-red-500/10 text-red-300 font-bold disabled:opacity-40">Deny <Kbd>D</Kbd></button>
          {onGive && <button disabled={busy} onClick={onGive} className="col-span-2 min-h-[36px] rounded-xl bg-pt-raised text-pt-accent text-[13px] font-semibold">Priority booking…</button>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">{REASONS.map(x => <button key={x} onClick={() => setReason(x)} className={`px-2.5 py-1 rounded-full text-[12px] ${reason === x ? 'bg-pt-text text-black' : 'bg-pt-raised text-pt-muted hover:text-pt-text'}`}>{x}</button>)}</div>
          <input id="desk-deny-why" autoFocus value={reason} onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && reason.trim().length >= 3) onDeny(); if (e.key === 'Escape') setDenying(false) }}
            placeholder={`Why? ${sh.creatorName.split(' ')[0]} reads this`} className="w-full min-h-[38px] rounded-lg bg-pt-bg text-pt-text px-3 text-[14px]" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDenying(false)} className="min-h-[38px] rounded-lg bg-pt-raised text-pt-text text-[13px]">Back <Kbd>Esc</Kbd></button>
            <button disabled={busy || reason.trim().length < 3} onClick={onDeny} className="min-h-[38px] rounded-lg bg-red-500/15 text-red-300 font-semibold text-[13px] disabled:opacity-40">Deny</button>
          </div>
        </div>
      )}
    </div>
  </>
}
const Stat = ({ n, l }: { n: string; l: string }) => <div className="bg-pt-surface rounded-lg px-2.5 py-2"><b className="block text-pt-text text-[16px] tabular-nums">{n}</b><span className="text-pt-muted text-[11px] leading-tight block">{l}</span></div>

function Spark({ weeks }: { weeks: number[] }) {
  const w = 300, h = 44, max = Math.max(2, ...weeks), step = w / (weeks.length - 1)
  const pts = weeks.map((v, i) => `${i * step},${h - (v / max) * (h - 8) - 2}`).join(' ')
  const avg = weeks.reduce((a, b) => a + b, 0) / weeks.length
  return (
    <div className="bg-pt-surface rounded-xl px-3 py-2">
      <p className="flex justify-between text-pt-muted text-[11px]"><span>Shoots per week · last 8 weeks</span><span className="tabular-nums">avg {Math.round(avg * 10) / 10}</span></p>
      <svg viewBox={`-4 -2 ${w + 8} ${h + 6}`} preserveAspectRatio="none" className="w-full h-[44px] mt-1" role="img" aria-label={`Shoots per week: ${weeks.join(', ')}`}>
        <line x1="0" x2={w} y1={h - 2} y2={h - 2} stroke="rgba(255,255,255,.08)" />
        <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(201,169,97,.15)" stroke="none" />
        <polyline points={pts} fill="none" stroke="#C9A961" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <circle cx={w} cy={h - (weeks[weeks.length - 1] / max) * (h - 8) - 2} r={3.5} fill="#C9A961" />
      </svg>
    </div>
  )
}
