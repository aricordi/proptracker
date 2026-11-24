// The day view (owner, Nov 24): Google-Calendar style, both houses side by side, real hours. Shared by Schedule,
// Requests (team) and the laptop views so every role sees the same day.
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import BottomSheet from './BottomSheet'
import Avatar from './Avatar'
import { useSession } from '../auth'
import { useMyVideos, isUpcoming } from '../services/cast'
import { whenLabel, formatDay } from '../lib/dates'
import { useMyWaitlist, waitKey } from '../hooks/useWaitlist'
import { waitRefusal } from '../../functions/src/waitlistRules'
import { addDays } from '../../functions/src/booking'
import { fmtTime, nowStamp } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, needsGuideline, INVITE_HOLD_MINUTES, errorText, slotState, fmtSlot, isNoCrewDay, slotWindow, HOUSES, BLOCK_TYPES, headsUps,
  type House, type ScheduleDay, houseClose, houseOpen, houseBookings, freeGaps, hardBlocks, priorityLocked, TIME_STEP, MIN_BOOKING_MINUTES, aheadDaysFor,
} from '../services/schedule'

const hoursText = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min` }

// A day from the month view (owner, Nov 2): both houses side by side, one row per time. Free = gold, tap to request.
// The server never asks the schedule team (owner, equipment) for a guideline, even in the owner's creator mode or
// "View as": match it by the REAL role, so the owner isn't sent to upload a PDF they don't need (audit, Nov 7).
export function useSkipsGuideline(team: boolean) {
  const { realRole } = useSession()
  return team || realRole === 'owner' || realRole === 'equipment'
}

export function DayPickSheet({ date, day, team, lockFree = team, teamView, canBook, now, onClose, onTap, onShoot, onOffsite, onDay, inline = false, note }: {
  date: string; day?: ScheduleDay; team: boolean; lockFree?: boolean; teamView: boolean; canBook: boolean; now: string; onDay?: (d: string) => void
  onClose: () => void; onTap: (st: ReturnType<typeof slotState>, h: House, start: number, end?: number) => void
  onShoot: (id: string) => void; onOffsite: () => void; inline?: boolean; note?: string
}) {
  const s = useScheduleSettings()
  const { profile } = useSession()
  const skipG = useSkipsGuideline(team)
  const email = profile.email
  // "Notify me if it opens" (Nov 7): a bell on someone else's slot puts you on its list in one tap.
  const waits = useMyWaitlist(email, canBook && !team)
  const [waitErr, setWaitErr] = useState('')
  const [waitBusy, setWaitBusy] = useState('')
  const [waitInfo, setWaitInfo] = useState('')
  useEffect(() => { if (!waitInfo) return; const t = setTimeout(() => setWaitInfo(''), 6000); return () => clearTimeout(t) }, [waitInfo])
  async function bell(h: House, start: number) {
    const k = waitKey(date, h, start), w = waits.entries[k]
    setWaitBusy(k); setWaitErr('')
    setWaitInfo('')
    try {
      if (w) { await waits.leave(w); setWaitInfo(`Off the list for ${fmtTime(start % 1440)}.`) }
      else { await waits.join(date, h, start); setWaitInfo(`You're on the list for ${s.houses[h].name} at ${fmtTime(start % 1440)}. If it opens up, it's held for you for ${INVITE_HOLD_MINUTES} minutes and you'll get a notification.`) }
    } catch (e) { setWaitErr(errorText(e)) } finally { setWaitBusy('') }
  }
  // DAY GRID (owner, Nov 24: "people go on the Google Calendar app because it's easy to see gaps and who's filming… too neat"):
  // like a Google Calendar day: hours down the side, Cliff 1 and Cliff 2 side by side, every booking a block sized by its real
  // hours with the person's name, and every free stretch (even 15 minutes) a gold space you can tap to book inside it.
  // The day starts at 9 AM (owner, Nov 24: "people don't film before 9"), earlier only when something is booked before 9,
  // or after a tap on "Show from 7 AM".
  const [early, setEarly] = useState(false)
  const houseStart = houseOpen(s), close = houseClose(s)
  const firstThing = Math.min(...HOUSES.flatMap(h => [...houseBookings(day, h, s, now).map(b => b.start), ...hardBlocks(day).filter(b => b.house === h).map(b => b.start)]), 24 * 60)
  const open = early ? houseStart : Math.max(houseStart, Math.min(9 * 60, Math.floor(firstThing / 60) * 60))
  const PX = 44                                              // pixels per hour
  const y = (m: number) => ((m - open) / 60) * PX
  const nowDay = now.slice(0, 10), nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
  const nowAt = date === nowDay ? (nowMin < open && nowMin + 1440 < close ? nowMin + 1440 : nowMin) : date < nowDay ? close : -1
  const hours: number[] = []
  for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) hours.push(m)
  // Creators can request about 2 weeks ahead (owner, Nov 24): later days still show every booking, but free time can't be asked for yet.
  const aheadDays = aheadDaysFor(email, s, team)
  const notOpen = !team && date > addDays(nowDay, aheadDays)
  const opensOn = addDays(date, -aheadDays)
  const col = (h: House) => {
    const locked = !lockFree && priorityLocked(date, h, s, email, now)
    const items: React.ReactNode[] = []
    // Free stretches first (underneath). Shorter than the 30-minute minimum still shows, so nobody wonders where it went.
    for (const g0 of freeGaps(day, date, h, s, now, TIME_STEP)) {
      if (g0.end <= open) continue
      const g = { start: Math.max(g0.start, open), end: g0.end }   // the part from where the view starts (drawing only)
      // Booking starts where the view starts (9 AM) when there's room after it; otherwise the whole stretch (e.g. 8:00–9:20).
      const tapFrom = g.end - g.start >= MIN_BOOKING_MINUTES ? g.start : g0.start
      const tall = y(g.end) - y(g.start), short = g0.end - g0.start < MIN_BOOKING_MINUTES
      const guide = !locked && !skipG && canBook && needsGuideline(date, h, email, s)
      const can = !locked && !short && !notOpen && (canBook || team)
      items.push(
        <button key={`f${g.start}`} disabled={!can} onClick={() => onTap({ t: 'free' }, h, tapFrom, g0.end)}
          data-testid={can ? 'free-gap' : undefined} data-house={h}
          style={{ top: y(g.start) + 1, height: Math.max(tall - 2, 10) }}
          className={`absolute inset-x-1 rounded-lg text-left px-2 overflow-hidden flex flex-col justify-start ${locked ? 'bg-white/[0.04] text-pt-muted' : short ? 'border border-dashed border-white/15 text-pt-muted' : 'border-2 border-dashed border-pt-accent/70 text-pt-accent active:bg-pt-accent/10'}`}>
          {tall >= 18 && <span className="block text-[12px] font-bold leading-tight pt-0.5 truncate">{locked ? 'Priority day' : short ? `${g0.end - g0.start} min gap` : `${can ? '+ ' : ''}Free ${hoursText(g0.end - tapFrom)}`}</span>}
          {tall >= 34 && !locked && <span className="block text-[12px] leading-tight opacity-80 truncate">{fmtTime(tapFrom % 1440)}–{fmtTime(g0.end % 1440)}</span>}
          {tall >= 50 && guide && <span className="block text-[12px] text-amber-200 truncate">Guideline needed</span>}
        </button>)
    }
    for (const bl of hardBlocks(day).filter(x => x.house === h)) {
      const a = Math.max(bl.start, open), b = Math.min(bl.end, close)
      if (b <= a) continue
      const tall = y(b) - y(a)
      items.push(
        <button key={`k${bl.id}`} disabled={!team} onClick={() => onTap({ t: 'block', block: bl } as ReturnType<typeof slotState>, h, bl.start)}
          style={{ top: y(a) + 1, height: Math.max(tall - 2, 10) }}
          className="absolute inset-x-1 rounded-lg px-2 text-left overflow-hidden flex flex-col justify-start text-violet-100 bg-[repeating-linear-gradient(135deg,#2A2140_0_6px,#3A2D5C_6px_12px)] shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]">
          {tall >= 18 && <span className="block text-[12px] font-semibold leading-tight pt-0.5 truncate">{bl.note || BLOCK_TYPES[bl.type]}</span>}
        </button>)
    }
    // Bookings: overlapping ones (a real clash) sit side by side.
    const bs = houseBookings(day, h, s, now)
    const lanes: number[] = [], laneOf = new Map<string, number>()
    for (const b of bs) { let l = lanes.findIndex(endAt => endAt <= b.start); if (l < 0) { l = lanes.length; lanes.push(0) } lanes[l] = b.end; laneOf.set(b.key, l) }
    const nLanes = Math.max(1, lanes.length)
    for (const b of bs) {
      const e = b.entry, me = e.email === email || (e.people ?? []).includes(email)
      const st = { t: e.hold ? 'held' : 'booked', entry: e, ...(e.hold ? { until: e.hold.until } : {}) } as ReturnType<typeof slotState>
      const who = me ? 'You' : e.name.split(' ')[0]
      const names = e.withNames?.length ? ` + ${e.withNames.map(n => n.split(' ')[0]).join(', ')}` : ''
      const k = waitKey(date, h, b.start), w = waits.entries[k]
      const why = !me && canBook && !team ? waitRefusal(day, date, h, b.start, s, email, now) : 'past'
      const bellOk = !me && canBook && !team && !notOpen && why !== 'past' && (!!w || !why)
      const past = slotWindow(date, b.start, b.end - b.start).to <= now
      const a = Math.max(b.start, open), z = Math.min(b.end, close), tall = y(z) - y(a)
      const lane = laneOf.get(b.key) ?? 0, wPct = 100 / nLanes
      items.push(
        <div key={`b${b.key}`} style={{ top: y(a) + 1, height: Math.max(tall - 2, 12), left: `calc(${lane * wPct}% + 4px)`, width: `calc(${wPct}% - 8px)` }}
          className={`absolute ${past ? 'opacity-45' : ''}`}>
          <button onClick={() => onTap(st, h, b.start)}
            className={`w-full h-full rounded-lg px-2 text-left overflow-hidden flex flex-col justify-start ${e.pending || e.hold ? 'bg-amber-400/[0.14] border border-dashed border-amber-400/70 text-amber-100' : me ? 'bg-pt-accent text-stone-900' : 'bg-[#3A4A63] text-white'}`}>
            <span className="block text-[13px] font-bold leading-tight pt-0.5 truncate">{e.hold ? `Held · ${who}` : `${who}${names}`}</span>
            {tall >= 34 && <span className="block text-[12px] leading-tight opacity-85 truncate">{fmtTime(b.start % 1440)}–{fmtTime(b.end % 1440)}{e.pending ? (e.move ? ' · move asked' : ' · waiting') : ''}{e.both ? ' · both' : ''}</span>}
          </button>
          {bellOk && tall >= 28 && (
            <button onClick={() => bell(h, b.start)} disabled={waitBusy === k || w?.status === 'offered'}
              aria-label={w ? `On the list, number ${w.position}. Tap to leave the list` : 'Notify me if it opens'}
              className={`absolute top-0.5 right-0.5 w-7 h-7 rounded-md grid place-items-center disabled:opacity-50 ${w ? 'bg-pt-accent text-stone-900' : 'bg-black/30 text-white/80'}`}>
              <Icon name="bell" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>)
    }
    return { items, locked }
  }
  const cols = HOUSES.map(h => ({ h, ...col(h) }))
  const freeTotal = (h: House) => freeGaps(day, date, h, s, now).reduce((n, g) => n + g.end - g.start, 0)
  const grid = (
    <div className="rounded-2xl bg-pt-surface/60 shadow-hairline overflow-hidden">
      <div className="grid grid-cols-[44px_1fr_1fr] sticky top-0 z-10 bg-pt-raised border-b border-white/[0.08]">
        <span />
        {HOUSES.map(h => (
          <span key={h} className="px-2 py-2 border-l border-white/[0.06]">
            <span className="block text-pt-text text-[14px] font-bold leading-tight">{s.houses[h].name}</span>
            <span className={`block text-[12px] leading-tight ${freeTotal(h) ? 'text-pt-accent' : 'text-pt-muted'}`}>{freeTotal(h) ? `${hoursText(freeTotal(h))} free` : 'Full'}</span>
          </span>
        ))}
      </div>
      {/* Before 9 AM is folded away, not closed (owner, Nov 24): say when there's free time earlier, and show every hour on a tap. */}
      {(open > houseStart || early) && (() => {
        const earlyFree = early ? [] : HOUSES.filter(h => freeGaps(day, date, h, s, now).some(g => g.start < open && Math.min(g.end, open) - g.start >= MIN_BOOKING_MINUTES))
        return (
          <button onClick={() => setEarly(e => !e)} className="w-full min-h-[40px] pl-[52px] pr-3 flex items-center justify-between gap-2 text-[13px] border-b border-white/[0.06]">
            <span className={`truncate ${earlyFree.length && !early ? 'text-pt-accent' : 'text-pt-muted'}`}>{early ? `Showing ${fmtTime(houseStart)}–${fmtTime(close % 1440)}` : earlyFree.length ? `Also free before 9 AM${earlyFree.length === 1 ? ` at ${s.houses[earlyFree[0]].name}` : ''}` : 'Starts at 9 AM'}</span>
            <span className="shrink-0 font-semibold text-pt-accent">{early ? 'From 9 AM' : 'Show all times'}</span>
          </button>
        )
      })()}
      <div className="grid grid-cols-[44px_1fr_1fr] relative mt-2 mb-2" style={{ height: y(close) }}>
        <div className="relative">
          {hours.map(m => <span key={m} style={{ top: y(m) - 7 }} className="absolute right-1.5 text-[12px] tabular-nums text-pt-muted leading-none">{fmtTime(m % 1440).replace(':00', '')}</span>)}
        </div>
        {cols.map(c => (
          <div key={c.h} className="relative border-l border-white/[0.06]">
            {hours.map(m => <span key={m} style={{ top: y(m) }} className="absolute inset-x-0 border-t border-white/[0.07]" />)}
            {c.items}
          </div>
        ))}
        {nowAt > open && nowAt < close && (
          <>
            <span aria-hidden style={{ height: y(nowAt) }} className="absolute left-[44px] right-0 top-0 bg-black/35 pointer-events-none" />
            <span aria-hidden style={{ top: y(nowAt) }} className="absolute left-[40px] right-0 border-t-2 border-red-500 pointer-events-none"><span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" /></span>
          </>
        )}
      </div>
    </div>
  )
  const offsite = (day?.offsite ?? []).slice().sort((a, b) => a.start - b.start)
  const title = `${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}${isNoCrewDay(date) ? ' · no crew' : ''}`
  // Heads-ups (owner, Nov 4): things happening at a house that don't stop filming (e.g. chargers being installed).
  const notes = headsUps(day).slice().sort((a, b) => a.start - b.start)
  const { profile: me } = useSession()
  const videosHere = (useMyVideos(me.email) ?? []).filter(v => v.date === date && v.status === 'accepted' && isUpcoming(v))
  const today = now.slice(0, 10)
  // ONE compact header line (owner, Nov 24: the date, the day arrows and Offsite used three rows above the calendar).
  // Apple-style header (owner, Nov 24): title left-aligned with a small grey line under it; controls grouped on the right
  // (‹ › in one pill, then Offsite), all on one line.
  const offsiteBtn = (canBook || team) && !notOpen && (
    <button onClick={onOffsite} aria-label="Book offsite (somewhere else)" className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-full bg-pt-raised text-[14px] font-medium text-pt-text">
      <Icon name="pin" className="w-4 h-4 text-sky-300" />Offsite
    </button>
  )
  const dayNav = (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex-1 min-w-0">
        {!inline && <h2 className="text-pt-text text-[22px] font-bold tracking-tight leading-tight truncate">{formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' })}</h2>}
        <p className="text-pt-muted text-[13px] leading-tight mt-0.5 truncate">{whenLabel(date, today)}{isNoCrewDay(date) ? ' · no crew' : ''}</p>
      </div>
      {onDay && (
        <div className="shrink-0 flex h-9 rounded-full bg-pt-raised overflow-hidden">
          <button onClick={() => onDay(addDays(date, -1))} disabled={date <= today} aria-label="Day before" className="w-10 grid place-items-center text-[20px] leading-none text-pt-text disabled:opacity-30">‹</button>
          <span className="w-px my-2 bg-white/10" aria-hidden />
          <button onClick={() => onDay(addDays(date, 1))} aria-label="Next day" className="w-10 grid place-items-center text-[20px] leading-none text-pt-text">›</button>
        </div>
      )}
      {offsiteBtn}
    </div>
  )
  const body = (<>
      {dayNav}
      {note && <p className="rounded-xl bg-amber-400/[0.08] px-3 py-2.5 mb-2 text-[13px] text-amber-200">{note}</p>}
      {videosHere.length > 0 && (
        <div className="mb-2 space-y-1.5" data-testid="day-videos">
          {videosHere.map(v => (
            <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-400/[0.10] text-[13px]">
              <Icon name="video" className="w-4 h-4 shrink-0 text-sky-300" />
              <span className="min-w-0 truncate"><b className="text-pt-text">In {v.hostName.split(' ')[0]}'s video</b> <span className="text-pt-muted">· {v.placeName} {fmtTime(v.start)}</span></span>
            </div>
          ))}
        </div>
      )}
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
      {notOpen && canBook && (
        <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 mb-2 text-[13px] text-pt-muted">Requests for this day open on <b className="text-pt-text">{formatDay(opensOn, { weekday: 'short', month: 'short', day: 'numeric' })}</b> (bookings open {aheadDays} days ahead). You can see who's booked.</p>
      )}
      {grid}
      {waitInfo && <p role="status" onClick={() => setWaitInfo('')} className="fixed inset-x-4 bottom-6 z-[60] mx-auto max-w-md rounded-2xl bg-pt-raised shadow-float px-4 py-3 text-[14px] text-pt-text"><Icon name="bell" className="inline w-4 h-4 mr-1.5 text-pt-accent" />{waitInfo}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 text-[12px] text-pt-muted">
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded border-2 border-dashed border-pt-accent/80" />{canBook || team ? 'Free, tap to book' : 'Free'}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded bg-[#3A4A63]" />Filming</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded bg-pt-accent" />You</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded border border-dashed border-amber-400" />Waiting for OK</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded bg-[repeating-linear-gradient(135deg,#2A2140_0_3px,#3A2D5C_3px_6px)] shadow-[inset_0_0_0_1px_rgba(167,139,250,0.5)]" />Blocked (cleaners, events…)</span>
      </div>
      {!team && canBook && (
        <p className="flex items-start gap-2 mt-3 text-[12px] text-pt-muted">
          <span className="shrink-0 w-6 h-6 rounded-md grid place-items-center bg-black/30 text-white/80"><Icon name="bell" className="w-3.5 h-3.5" /></span>
          <span><b className="text-pt-text">Want a time someone has?</b> Tap the bell on their booking. If they cancel, it's held for you for {INVITE_HOLD_MINUTES} minutes and you get a notification. Tap it again (gold) to leave the list.</span>
        </p>
      )}
      {waitErr && <p className="text-red-300 text-sm mt-3">{waitErr}</p>}
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
  </>)
  // Laptop: the day sits next to the month instead of sliding up.
  if (inline) return <section className="rounded-[20px] shadow-hairline p-4"><h2 className="text-pt-text text-[20px] font-semibold mb-3">{title}</h2>{body}</section>
  return <BottomSheet open onClose={onClose}>{body}</BottomSheet>
}


/** How a booking looks in the grid: you (gold), someone else (blue-grey), a request/hold (amber dashed), or a highlight (sky). */
export type GridTone = 'you' | 'other' | 'waiting' | 'sky'
const TONE_CLS: Record<GridTone, string> = {
  you: 'bg-pt-accent text-stone-900',
  other: 'bg-[#3A4A63] text-white',
  waiting: 'bg-amber-400/[0.14] border border-dashed border-amber-400/70 text-amber-100',
  sky: 'bg-sky-400/25 shadow-[inset_0_0_0_1px_rgba(124,196,250,0.7)] text-sky-50',
}
export const BLOCK_CLS = 'text-violet-100 bg-[repeating-linear-gradient(135deg,#2A2140_0_6px,#3A2D5C_6px_12px)] shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]'

/** The same day grid, read only and smaller (shoot page "See in calendar", swap preview): nothing to tap. */
export function MiniDayGrid({ date, day, label }: { date: string; day?: ScheduleDay; label: (b: ReturnType<typeof houseBookings>[number]) => { text: string; tone: GridTone } }) {
  const s = useScheduleSettings()
  const now = useMemoNow()
  const houseStart = houseOpen(s), close = houseClose(s)
  const firstThing = Math.min(...HOUSES.flatMap(h => [...houseBookings(day, h, s, now).map(b => b.start), ...hardBlocks(day).filter(b => b.house === h).map(b => b.start)]), 24 * 60)
  const open = Math.max(houseStart, Math.min(9 * 60, Math.floor(firstThing / 60) * 60))
  const PX = 32, y = (m: number) => ((m - open) / 60) * PX
  const hours: number[] = []
  for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) hours.push(m)
  const col = (h: House) => {
    const out: React.ReactNode[] = []
    for (const g of freeGaps(day, date, h, s, now, MIN_BOOKING_MINUTES)) {
      if (g.end <= open) continue
      const a = Math.max(g.start, open), tall = y(g.end) - y(a)
      out.push(<span key={`f${g.start}`} style={{ top: y(a) + 1, height: Math.max(tall - 2, 8) }} className="absolute inset-x-1 rounded-md border border-dashed border-pt-accent/50 text-pt-accent text-[12px] leading-tight px-1.5 pt-0.5 overflow-hidden">{tall >= 18 ? 'Free' : ''}</span>)
    }
    for (const bl of hardBlocks(day).filter(x => x.house === h)) {
      const a = Math.max(bl.start, open), tall = y(Math.min(bl.end, close)) - y(a)
      if (tall <= 0) continue
      out.push(<span key={`k${bl.id}`} style={{ top: y(a) + 1, height: Math.max(tall - 2, 8) }} className={`absolute inset-x-1 rounded-md text-[12px] leading-tight px-1.5 pt-0.5 overflow-hidden truncate ${BLOCK_CLS}`}>{tall >= 18 ? (bl.note || BLOCK_TYPES[bl.type]) : ''}</span>)
    }
    for (const b of houseBookings(day, h, s, now)) {
      const l = label(b), a = Math.max(b.start, open), tall = y(Math.min(b.end, close)) - y(a)
      out.push(<span key={`b${b.key}`} style={{ top: y(a) + 1, height: Math.max(tall - 2, 10) }} className={`absolute inset-x-1 rounded-md px-1.5 pt-0.5 overflow-hidden ${TONE_CLS[l.tone]}`}>
        <span className="block text-[12px] font-bold leading-tight truncate">{l.text}</span>
        {tall >= 30 && <span className="block text-[12px] leading-tight opacity-80 truncate">{fmtTime(b.start % 1440)}–{fmtTime(b.end % 1440)}</span>}
      </span>)
    }
    return out
  }
  return (
    <div className="rounded-xl bg-pt-surface/60 shadow-hairline overflow-hidden">
      <div className="grid grid-cols-[44px_1fr_1fr] bg-pt-raised border-b border-white/[0.08]">
        <span />
        {HOUSES.map(h => <span key={h} className="px-2 py-1.5 border-l border-white/[0.06] text-pt-text text-[13px] font-bold">{s.houses[h].name}</span>)}
      </div>
      <div className="grid grid-cols-[44px_1fr_1fr] relative my-1.5" style={{ height: y(close) }}>
        <div className="relative">{hours.map(m => <span key={m} style={{ top: y(m) - 7 }} className="absolute right-1.5 whitespace-nowrap text-[12px] tabular-nums text-pt-muted leading-none">{fmtTime(m % 1440).replace(':00', '')}</span>)}</div>
        {HOUSES.map(h => (
          <div key={h} className="relative border-l border-white/[0.06]">
            {hours.map(m => <span key={m} style={{ top: y(m) }} className="absolute inset-x-0 border-t border-white/[0.07]" />)}
            {col(h)}
          </div>
        ))}
      </div>
    </div>
  )
}
function useMemoNow() {
  const [n, setN] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setN(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  return n
}
