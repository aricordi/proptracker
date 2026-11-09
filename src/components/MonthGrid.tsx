// The month calendar (owner, Nov 2: "creators book based on what's already available… a monthly view that's very visual").
// ONE grid for both sides: creators see how many 2-hour spots are free each day; the equipment team (mode 'team') sees how
// many requests wait on each day and how full it is. Tapping a day calls onPick. Colours carry the meaning; words stay short.
import { addDays, weekday } from '../../functions/src/booking'
import { useState, type ReactNode } from 'react'
import { slotState, headsUps, HOUSES, BOOK_AHEAD_DAYS, PRIORITY_HOUSE, type House, type ScheduleDay, type ScheduleSettings } from '../services/schedule'
import { fmtTime } from '../../functions/src/gearBooking'
import { Icon } from './Icon'

export const monthStart = (month: string) => `${month}-01`
export const monthAdd = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number); const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`
}
export const monthTitle = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export function daysOfMonth(month: string) { const out: string[] = []; for (let d = monthStart(month); d.startsWith(month); d = addDays(d, 1)) out.push(d); return out }

// freeAt: one entry per slot of the day (morning → night): free at either house? null = already over.
// locked: empty slots on a Cliff 1 priority day that only the priority group can book until the Sunday release.
export interface DayCount { free: number; total: number; booked: number; requested: number; locked: number; mine: boolean; freeAt: (boolean | null)[] }
export function countDay(day: ScheduleDay | undefined, date: string, houses: House[], s: ScheduleSettings, email: string, now: string, team: boolean): DayCount {
  const c: DayCount = { free: 0, total: 0, booked: 0, requested: 0, locked: 0, mine: false, freeAt: s.slots.map(() => null) }
  for (const h of houses) s.slots.forEach((st, i) => {
    const x = slotState(day, date, h, st, s, email, now, team)
    if (x.t === 'past') return
    c.total++
    c.freeAt[i] = c.freeAt[i] === true || x.t === 'free'
    if (x.t === 'free') c.free++
    else if (x.t === 'locked') c.locked++
    else if (x.t === 'booked') { if (x.entry.pending) c.requested++; else c.booked++; if (x.entry.email === email) c.mine = true }
  })
  for (const o of day?.offsite ?? []) { if (o.pending) c.requested++; if (o.email === email) c.mine = true }
  return c
}

// Which house the month shows (owner, Nov 4, option B: people prefer Cliff 1, so it opens on Cliff 1; remembered per phone).
export type MonthHouse = House | 'all'
const HOUSE_KEY = 'pc.monthHouse'
const HOUSE_NAME: Record<House, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2' }
export function useMonthHouse(): [MonthHouse, (h: MonthHouse) => void] {
  const [h, setH] = useState<MonthHouse>(() => {
    try { const v = localStorage.getItem(HOUSE_KEY); if (v === 'cliff1' || v === 'cliff2' || v === 'all') return v } catch { /* private mode */ }
    return 'cliff1'
  })
  return [h, (v: MonthHouse) => { setH(v); try { localStorage.setItem(HOUSE_KEY, v) } catch { /* private mode */ } }]
}
export function HouseSwitch({ value, onChange }: { value: MonthHouse; onChange: (h: MonthHouse) => void }) {
  const opts: [MonthHouse, string][] = [['cliff1', 'Cliff 1'], ['cliff2', 'Cliff 2'], ['all', 'All']]
  return (
    <div role="radiogroup" aria-label="Which house" className="grid grid-cols-3 gap-1 p-1 rounded-full bg-pt-surface">
      {opts.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`min-h-[40px] rounded-full text-sm font-semibold ${value === v ? 'bg-pt-text text-stone-900' : 'text-pt-muted'}`}>{label}</button>
      ))}
    </div>
  )
}

const fmtHour = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthGrid({ month, days, s, email, now, today, team = false, lockFree = team, selected, myDates, onPick }: {
  month: string; days: Record<string, ScheduleDay> | null; s: ScheduleSettings; email: string; now: string; today: string
  // myDates: days you film, from your own shoots (owner, Nov 9: the owner's own days weren't marked because the owner counts as
  // the team; shared back-to-back imports can also sit outside the slot map). Marks the square whatever the role.
  myDates?: Set<string>
  // lockFree: priority days count as free (the equipment team books for anyone). The owner booking for themselves follows the lock.
  team?: boolean; lockFree?: boolean; selected?: string | null; onPick: (date: string) => void
}) {
  const list = daysOfMonth(month)
  const lead = weekday(list[0])
  const [house, setHouse] = useMonthHouse()
  const houses: House[] = house === 'all' ? HOUSES : [house]
  const other: House | null = house === 'cliff1' ? 'cliff2' : house === 'cliff2' ? 'cliff1' : null
  return (
    <div>
      <div className="mb-3"><HouseSwitch value={house} onChange={setHouse} /></div>
      <div className="grid grid-cols-7 gap-1 lg:gap-2 mb-1">{DOW.map(d => <span key={d} className="text-center text-pt-muted text-xs">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1 lg:gap-2">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {list.map(date => {
          // Before today, or further ahead than anyone can book (audit, Nov 5: those days showed free slots the server refused).
          const past = date < today || date > addDays(today, BOOK_AHEAD_DAYS)
          const c = countDay(days?.[date], date, houses, s, email, now, lockFree)
          // Your shoots and waiting requests show whichever house is picked; only the free spots follow the switch.
          const all = house === 'all' ? c : countDay(days?.[date], date, HOUSES, s, email, now, lockFree)
          c.mine = all.mine; c.requested = all.requested
          // Full here but the other house has room (owner, Nov 7: one line, in place of "Full", so the day never grows taller) → a small hint so nobody gives up on the day.
          const alt = other && !past && c.free === 0 ? countDay(days?.[date], date, [other], s, email, now, lockFree).free : 0
          // Nothing free only because it's a priority day (audit, Nov 7: it read "Full" though the slots are empty and open to
          // everyone on Sunday): say "Priority" with a lock instead of "Full" or the other-house hint.
          const prio = !past && c.free === 0 && c.locked > 0
          // Owner, Nov 9: a locked priority day still says when the other house has room ("C2: 3" next to the lock), on the same line.
          const hint = alt > c.free ? alt : 0
          const n = Number(date.slice(8))
          const level = past ? 'past' : c.total === 0 ? 'full' : c.free === 0 ? 'full' : c.free <= 3 ? 'few' : 'lots'
          const tone = level === 'few' ? 'text-amber-300' : 'text-green-400'
          const bar = level === 'few' ? 'bg-amber-300' : 'bg-green-400'
          // Owner, Nov 4: your filming days stand out (gold tint + gold edge), and today is a white circle on the date.
          const mine = !!myDates?.has(date) || (c.mine && !team)
          const ring = date === selected ? 'shadow-[inset_0_0_0_2px_#F5F5F7]' : mine ? 'shadow-[inset_0_0_0_2px_#C9A961]' : ''
          return (
            <button key={date} disabled={past} onClick={() => onPick(date)} aria-label={`${date}${date === today ? ' (today)' : ''}${mine ? ', you film this day' : ''}: ${team ? `${c.requested} requests, ` : ''}${house === 'all' ? HOUSES.map(h => { const x = countDay(days?.[date], date, [h], s, email, now, lockFree); return `${HOUSE_NAME[h]} ${x.free === 0 && x.locked > 0 ? 'priority only' : `${x.free} free`}` }).join(', ') : prio ? `priority day at ${HOUSE_NAME[house]}, opens to everyone Sunday ${fmtTime(s.releaseMinute)}` : `${c.free} free at ${HOUSE_NAME[house]}`}${hint ? `, ${HOUSE_NAME[other!]} has ${hint} free` : ''}`}
              className={`relative ${house === 'all' ? 'aspect-[0.7] lg:aspect-[0.95] pt-1 pb-1.5' : 'aspect-[0.82] pt-1.5 pb-2'} rounded-xl ${mine ? 'bg-pt-accent/20' : 'bg-pt-surface'} flex flex-col items-center justify-between lg:pt-3 lg:pb-3 px-0.5 tabular-nums ${past ? 'opacity-30' : 'active:opacity-80'} ${ring}`}>
              {!past && headsUps(days?.[date]).length > 0 && <i className="absolute top-1.5 right-1.5 w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-amber-300" aria-label="Heads-up that day" />}
              {/* Requests waiting sit in the corner (owner, Nov 9: nothing may make a square taller). */}
              {!past && team && c.requested > 0 && <span className="absolute -top-1.5 -right-1.5 z-10 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{c.requested}</span>}
              {/* Owner, Nov 9: a small gold marker on the days you film, on top of the gold tint and edge. */}
              {mine && <i className="absolute top-1 left-1 lg:top-2 lg:left-2 w-1.5 h-1.5 lg:w-2.5 lg:h-2.5 rounded-full bg-pt-accent" aria-hidden />}
              <span className={`text-[18px] lg:text-[22px] font-bold leading-tight ${date === today ? `${house === 'all' ? 'w-7 h-7' : 'w-8 h-8 -mt-0.5'} lg:w-10 lg:h-10 rounded-full bg-white text-stone-900 grid place-items-center` : mine ? 'text-pt-accent' : 'text-pt-text'}`}>{n}</span>
              {house === 'all' ? <AllCell days={days?.[date]} date={date} s={s} email={email} now={now} lockFree={lockFree} past={past} /> : <>
              {!past && (
                <span className="flex flex-col items-center leading-none gap-0.5">
                  {prio
                    ? <span className={`inline-flex items-center ${hint > 0 ? 'gap-0.5' : 'gap-1'} text-xs lg:text-[13px] font-semibold text-pt-text/80 whitespace-nowrap`}><Icon name="lock" className={hint > 0 ? 'w-3 h-3 lg:w-3.5 lg:h-3.5' : 'w-3.5 h-3.5'} />{hint > 0
                        ? <span className="text-sky-300">{other === 'cliff2' ? 'C2' : 'C1'}<span className="hidden lg:inline">:</span> {hint}<span className="hidden lg:inline"> free</span></span>
                        : <span className="hidden lg:inline">Priority</span>}</span>
                    : hint > 0
                    ? <span className="text-xs lg:text-[13px] font-semibold text-sky-300 whitespace-nowrap">{other === 'cliff2' ? 'C2' : 'C1'}: {hint}<span className="hidden lg:inline"> free</span></span>
                    : c.free === 0
                    ? <span className="text-xs font-semibold text-pt-muted">Full</span>
                    : <span className={`text-xs lg:text-[13px] font-semibold ${tone}`}>{c.free} free</span>}
                </span>
              )}
              {/* Owner, Nov 4: the bar shows WHICH times are free, morning (left) to night (right), not how many. */}
              <span className="w-[80%] flex gap-px h-1.5 lg:h-2" aria-hidden>
                {c.freeAt.map((f, i) => <i key={i} className={`flex-1 h-full first:rounded-l-full last:rounded-r-full ${!past && f ? bar : 'bg-pt-border'} ${f === null && !past ? 'opacity-40' : ''}`} />)}
              </span>
              </>}
            </button>
          )
        })}
      </div>
      <MonthKey>
      <div className="flex flex-wrap gap-3 text-xs text-pt-muted">
        {house === 'all' ? <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 basis-full">Each day shows the free spots per house:
          <span className={`${CHIP} ${CHIP_TONE.lots}`}>C1 5</span><span>lots free</span>
          <span className={`${CHIP} ${CHIP_TONE.few}`}>C2 2</span><span>a few left</span>
          <span className={`${CHIP} ${CHIP_TONE.full}`}>C1 0</span><span>full</span></span>
        : <span className="inline-flex items-center gap-1.5 basis-full"><span className="inline-flex gap-px w-12 h-1.5">{[1, 1, 0, 0, 0, 0, 1, 1, 0].map((f, i) => <i key={i} className={`flex-1 h-full first:rounded-l-full last:rounded-r-full ${f ? 'bg-green-400' : 'bg-pt-border'}`} />)}</span>The bar is the day, {s.slots.length ? `${fmtHour(s.slots[0])} on the left to ${fmtHour(s.slots[s.slots.length - 1])} on the right` : 'morning to night'}: lit = free then at {HOUSE_NAME[house as House]}</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Lots free</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1" />A few left</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-pt-muted mr-1" />Full</span>}
        {other && <span><b className="text-sky-300 font-semibold mr-1">{other === 'cliff2' ? 'C2: 3' : 'C1: 3'}</b>{HOUSE_NAME[house as House]} is full, {HOUSE_NAME[other]} has 3 free spots</span>}
        {(house === PRIORITY_HOUSE || house === 'all') && !lockFree && s.priorityWeekdays.length > 0 && <span className="inline-flex items-center gap-1"><Icon name="lock" className="w-3.5 h-3.5 text-pt-text/80" />Priority day: open to everyone from Sunday {fmtTime(s.releaseMinute)}</span>}
        <span><i className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 mr-1 align-[2px]" />Heads-up (you can still film)</span>
        {team && <span><i className="inline-block w-3 h-3 rounded-full bg-amber-400 mr-1 align-[-2px]" />Requests waiting</span>}
        {(!team || myDates) && <span><i className="inline-block w-2 h-2 rounded-full bg-pt-accent mr-1" /><i className="inline-block w-2.5 h-2.5 rounded-sm bg-pt-accent/30 shadow-[inset_0_0_0_2px_#C9A961] mr-1 align-[-1px]" />You're filming</span>}
        <span><i className="inline-block w-3 h-3 rounded-full bg-white mr-1 align-[-2px]" />Today</span>
      </div>
      </MonthKey>
    </div>
  )
}

// One day in the ALL view (owner, Nov 9: "tough to see what's free on Cliff 1 versus Cliff 2"): two chips, one per house, with
// the free count in the same colours as the single-house view (green lots, amber a few, grey full; lock = priority day).
const CHIP = 'inline-flex items-center justify-center gap-[5px] lg:gap-1.5 h-[18px] lg:h-6 min-w-[38px] lg:min-w-[64px] px-1.5 rounded-full text-xs lg:text-[13px] font-bold leading-none whitespace-nowrap'
const CHIP_TONE = { lots: 'bg-green-400/20 text-green-300', few: 'bg-amber-300/20 text-amber-200', full: 'bg-white/[0.06] text-pt-muted', lock: 'bg-white/10 text-pt-text/85' }
function AllCell({ days, date, s, email, now, lockFree, past }: {
  days: ScheduleDay | undefined; date: string; s: ScheduleSettings; email: string; now: string; lockFree: boolean; past: boolean
}) {
  if (past) return <span className="h-[18px]" />
  return (
    <span className="flex flex-col items-center gap-[3px] lg:gap-1">
      {HOUSES.map(h => {
        const c = countDay(days, date, [h], s, email, now, lockFree)
        const short = h === 'cliff1' ? 'C1' : 'C2'
        const locked = c.free === 0 && c.locked > 0
        const tone = locked ? CHIP_TONE.lock : c.free === 0 ? CHIP_TONE.full : c.free <= 3 ? CHIP_TONE.few : CHIP_TONE.lots
        return (
          <span key={h} className={`${CHIP} ${tone}`}>
            <span className="font-medium text-pt-text/55">{short}</span>
            {locked ? <Icon name="lock" className="w-3 h-3" /> : <span>{c.free}</span>}
            <span className="hidden lg:inline font-semibold opacity-80">{locked ? '' : ' free'}</span>
          </span>
        )
      })}
    </span>
  )
}

/** The symbols under the calendar fold away (owner, Nov 7): open the first time, then each phone remembers what you chose. */
function MonthKey({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('pc.monthKey') !== 'closed' } catch { return true } })
  const toggle = () => setOpen(o => { try { localStorage.setItem('pc.monthKey', o ? 'closed' : 'open') } catch { /* fine */ } return !o })
  return (
    <div className="mt-2">
      <button onClick={toggle} aria-expanded={open} className="min-h-[40px] inline-flex items-center gap-1.5 text-pt-muted text-[13px]">
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>{open ? 'Hide what the colours mean' : 'What the colours mean'}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}
