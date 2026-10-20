// Shared bits for the gear screens: the day + hours picker, bundle artwork,
// the day timeline and status pills. Same look everywhere gear appears.
import { useMemo } from 'react'
import { useSession } from '../auth'
import { useGearCart } from '../gearCart'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, isOpen } from '../../functions/src/booking'
import {
  checkGearTimes, earliestGearDay, holdWindow, fmtTime, fmtHours, GEAR_DAY_START, GEAR_DAY_END, GEAR_STEP,
  GEAR_TIME_MESSAGES, type GearHold, type GearCategory,
} from '../services/gear'
import { formatDay } from '../lib/dates'

const TIMES: number[] = []
for (let t = GEAR_DAY_START; t <= GEAR_DAY_END; t += GEAR_STEP) TIMES.push(t)

export function nowMinutes() {
  const [h, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date()).split(':').map(Number)
  return h * 60 + m
}

// The shoot's day + hours, the problem with them (if any), and the hold window.
export function useGearWhen() {
  const cart = useGearCart()
  const settings = useBookingSettings()
  const { isStaff, isGearStaff } = useSession()
  const skipNotice = isStaff || isGearStaff
  const today = todayInStudio()
  const earliest = skipNotice ? today : earliestGearDay(today, settings)
  const date = cart.date && cart.date >= earliest ? cart.date : earliest
  const problem = checkGearTimes(date, cart.start, cart.end, today, nowMinutes(), settings, skipNotice)
  const win = holdWindow(date, cart.start, cart.end, settings)
  return { date, start: cart.start, end: cart.end, earliest, problem, message: problem ? GEAR_TIME_MESSAGES[problem] : null, win, settings, closed: !isOpen(date, settings) }
}

export function GearWhenPicker({ hoursOnly = false }: { hoursOnly?: boolean } = {}) {
  const cart = useGearCart()
  const w = useGearWhen()
  const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-2.5 py-2 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
  return (
    <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
      <div className={`grid gap-2 ${hoursOnly ? 'grid-cols-2' : 'grid-cols-[1.35fr_1fr_1fr]'}`}>
        {!hoursOnly && <label className="space-y-1 min-w-0"><span className="block text-pt-muted text-xs">Shoot day</span>
          <input type="date" value={w.date} min={w.earliest} onChange={e => e.target.value && cart.setWhen(e.target.value, cart.start, cart.end)} className={field} /></label>}
        <label className="space-y-1 min-w-0"><span className="block text-pt-muted text-xs">{hoursOnly ? 'Gear from' : 'From'}</span>
          <select value={cart.start} onChange={e => { const s = Number(e.target.value); cart.setWhen(w.date, s, Math.max(cart.end, s + GEAR_STEP)) }} className={field}>
            {TIMES.slice(0, -1).map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
          </select></label>
        <label className="space-y-1 min-w-0"><span className="block text-pt-muted text-xs">Until</span>
          <select value={cart.end} onChange={e => cart.setWhen(w.date, cart.start, Number(e.target.value))} className={field}>
            {TIMES.filter(t => t > cart.start).map(t => <option key={t} value={t}>{t === GEAR_DAY_END ? 'Midnight' : fmtTime(t)}</option>)}
          </select></label>
      </div>
      {!hoursOnly && w.message && <p className="text-red-300 text-sm">{w.message}</p>}
      {!hoursOnly && !w.message && w.closed && (
        <p className="text-amber-200 text-sm">We're closed that day, so you pick the gear up {formatDay(w.win.pickup)} at {fmtTime(w.start)} and bring it back {formatDay(w.win.to.slice(0, 10))} by 10 AM.</p>
      )}
    </div>
  )
}

const ART: Record<string, string> = {
  Camera: 'M3 8.5A2.5 2.5 0 0 1 5.5 6h8A2.5 2.5 0 0 1 16 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 15.5zM16 10.5l5-2.5v8l-5-2.5',
  Lens: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  Lighting: 'M8 3h8l-1.5 7h-5zM12 10v8M8 21h8M12 18l-4 3M12 18l4 3',
  Audio: 'M9 3h6v11a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6',
  Drones: 'M9 10h6v4H9zM9 11 5 7M15 11l4-4M9 13l-4 4M15 13l4 4',
  Power: 'M3 7h16v10H3zM21 10v4M11 9l-2 3.5h4L11 16',
  Grip: 'M12 3v18M6 21l6-6 6 6M5 8h14',
  Monitors: 'M3 5h18v11H3zM8 20h8M12 16v4',
  Other: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
}

// A bundle's photo, or a calm placeholder with its type's icon.
export function GearArt({ photo, category, className = '' }: { photo?: string | null; category?: GearCategory | string; className?: string }) {
  if (photo) return <img src={photo} alt="" className={`object-cover ${className}`} />
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-[#2a2a2d] to-[#141416] text-pt-accent/80 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="w-1/3 h-1/3">
        <path d={ART[category ?? 'Other'] ?? ART.Other} />
      </svg>
    </div>
  )
}

export function Pill({ tone, children }: { tone: 'free' | 'taken' | 'warn' | 'info' | 'muted'; children: React.ReactNode }) {
  const c = { free: 'bg-green-500/15 text-green-300', taken: 'bg-red-500/15 text-red-300', warn: 'bg-amber-500/15 text-amber-200', info: 'bg-pt-accent/15 text-pt-accent', muted: 'bg-white/10 text-pt-muted' }[tone]
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${c}`}>{children}</span>
}

// The chosen day from 7 AM to midnight: booked blocks striped red, your hours outlined.
export function DayTimeline({ holds, date, start, end }: { holds: GearHold[]; date: string; start: number; end: number }) {
  const from = 7 * 60, to = GEAR_DAY_END
  const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - from) / (to - from)) * 100))}%`
  const toMin = (s: string) => s.slice(0, 10) < date ? 0 : s.slice(0, 10) > date ? GEAR_DAY_END : Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16))
  const blocks = useMemo(() => holds.filter(h => h.from.slice(0, 10) <= date && h.to.slice(0, 10) >= date)
    .map(h => [toMin(h.from), toMin(h.to)] as const), [holds, date])
  return (
    <div>
      <div className="relative h-9 rounded-xl bg-pt-bg shadow-hairline overflow-hidden" aria-label="Bookings that day">
        {blocks.map(([a, b], i) => (
          <div key={i} title={`Booked ${fmtHours(a, b)}`} className="absolute inset-y-0 border-x border-red-400/80"
            style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, background: 'repeating-linear-gradient(135deg, rgba(248,113,113,.35) 0 6px, rgba(248,113,113,.15) 6px 12px)' }} />
        ))}
        <div className="absolute top-1 bottom-1 rounded-lg border-2 border-pt-accent bg-pt-accent/15" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
      </div>
      <div className="flex justify-between text-pt-muted text-xs mt-1 tabular-nums"><span>7 AM</span><span>11 AM</span><span>3 PM</span><span>7 PM</span><span>11 PM</span></div>
    </div>
  )
}

export const STATUS_LABEL: Record<string, { text: string; tone: 'free' | 'taken' | 'warn' | 'info' | 'muted' }> = {
  held: { text: 'Held', tone: 'info' },
  out: { text: 'Out', tone: 'warn' },
  returned: { text: 'Returned', tone: 'free' },
  checked_in: { text: 'Checked in', tone: 'free' },
  cancelled: { text: 'Cancelled', tone: 'muted' },
  declined: { text: 'Declined', tone: 'taken' },
}

// Tick every piece (or mark it missing). Used at pickup (creator) and check-in (team).
export function PieceChecklist({ lines, ticked, missing, onTick, onMissing }: {
  lines: { key: string; name: string; unit: number; of: number }[]
  ticked: Set<string>; missing: Set<string>
  onTick: (key: string) => void; onMissing: (key: string) => void
}) {
  return (
    <div className="space-y-2">
      {lines.map(l => {
        const on = ticked.has(l.key), gone = missing.has(l.key)
        return (
          <div key={l.key} className="flex items-center gap-2">
            <button role="checkbox" aria-checked={on} onClick={() => onTick(l.key)}
              className={`flex-1 flex items-center gap-3 rounded-xl px-3 py-3 text-left border ${on ? 'bg-green-500/10 border-green-500/40' : gone ? 'bg-red-500/10 border-red-500/40' : 'bg-pt-bg border-pt-border'}`}>
              <span className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center font-bold shrink-0 ${on ? 'bg-green-500 border-green-500 text-black' : gone ? 'border-red-400 text-red-300' : 'border-pt-muted'}`}>{on ? '✓' : gone ? '!' : ''}</span>
              <span className="text-pt-text text-[15px]">{l.name}{l.of > 1 ? <span className="text-pt-muted"> · {l.unit} of {l.of}</span> : null}</span>
              {gone && <span className="ml-auto text-xs font-semibold text-red-300">missing</span>}
            </button>
            {!on && <button onClick={() => onMissing(l.key)} className="text-xs text-pt-accent w-16 shrink-0 tap">{gone ? 'Found' : 'Missing?'}</button>}
          </div>
        )
      })}
    </div>
  )
}
