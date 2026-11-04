// The month calendar (owner, Nov 2: "creators book based on what's already available… a monthly view that's very visual").
// ONE grid for both sides: creators see how many 2-hour spots are free each day; the equipment team (mode 'team') sees how
// many requests wait on each day and how full it is. Tapping a day calls onPick. Colours carry the meaning; words stay short.
import { addDays, weekday } from '../../functions/src/booking'
import { useState } from 'react'
import { slotState, headsUps, HOUSES, type House, type ScheduleDay, type ScheduleSettings } from '../services/schedule'

export const monthStart = (month: string) => `${month}-01`
export const monthAdd = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number); const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`
}
export const monthTitle = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export function daysOfMonth(month: string) { const out: string[] = []; for (let d = monthStart(month); d.startsWith(month); d = addDays(d, 1)) out.push(d); return out }

// freeAt: one entry per slot of the day (morning → night): free at either house? null = already over.
export interface DayCount { free: number; total: number; booked: number; requested: number; mine: boolean; freeAt: (boolean | null)[] }
export function countDay(day: ScheduleDay | undefined, date: string, houses: House[], s: ScheduleSettings, email: string, now: string, team: boolean): DayCount {
  const c: DayCount = { free: 0, total: 0, booked: 0, requested: 0, mine: false, freeAt: s.slots.map(() => null) }
  for (const h of houses) s.slots.forEach((st, i) => {
    const x = slotState(day, date, h, st, s, email, now, team)
    if (x.t === 'past') return
    c.total++
    c.freeAt[i] = c.freeAt[i] === true || x.t === 'free'
    if (x.t === 'free') c.free++
    else if (x.t === 'booked') { if (x.entry.pending) c.requested++; else c.booked++; if (x.entry.email === email) c.mine = true }
  })
  for (const o of day?.offsite ?? []) { if (o.pending) c.requested++; if (o.email === email) c.mine = true }
  return c
}

// Which house the month shows (owner, Nov 4, option B: people prefer Cliff 1, so it opens on Cliff 1; remembered per phone).
export type MonthHouse = House | 'both'
const HOUSE_KEY = 'pc.monthHouse'
const HOUSE_NAME: Record<House, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2' }
export function useMonthHouse(): [MonthHouse, (h: MonthHouse) => void] {
  const [h, setH] = useState<MonthHouse>(() => {
    try { const v = localStorage.getItem(HOUSE_KEY); if (v === 'cliff1' || v === 'cliff2' || v === 'both') return v } catch { /* private mode */ }
    return 'cliff1'
  })
  return [h, (v: MonthHouse) => { setH(v); try { localStorage.setItem(HOUSE_KEY, v) } catch { /* private mode */ } }]
}
export function HouseSwitch({ value, onChange }: { value: MonthHouse; onChange: (h: MonthHouse) => void }) {
  const opts: [MonthHouse, string][] = [['cliff1', 'Cliff 1'], ['cliff2', 'Cliff 2'], ['both', 'Both']]
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

export default function MonthGrid({ month, days, s, email, now, today, team = false, selected, onPick }: {
  month: string; days: Record<string, ScheduleDay> | null; s: ScheduleSettings; email: string; now: string; today: string
  team?: boolean; selected?: string | null; onPick: (date: string) => void
}) {
  const list = daysOfMonth(month)
  const lead = weekday(list[0])
  const [house, setHouse] = useMonthHouse()
  const houses: House[] = house === 'both' ? HOUSES : [house]
  const other: House | null = house === 'cliff1' ? 'cliff2' : house === 'cliff2' ? 'cliff1' : null
  return (
    <div>
      <div className="mb-3"><HouseSwitch value={house} onChange={setHouse} /></div>
      <div className="grid grid-cols-7 gap-1 lg:gap-2 mb-1">{DOW.map(d => <span key={d} className="text-center text-pt-muted text-xs">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1 lg:gap-2">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {list.map(date => {
          const past = date < today
          const c = countDay(days?.[date], date, houses, s, email, now, team)
          // Your shoots and waiting requests show whichever house is picked; only the free spots follow the switch.
          const all = house === 'both' ? c : countDay(days?.[date], date, HOUSES, s, email, now, team)
          c.mine = all.mine; c.requested = all.requested
          // Full (or one left) here but the other house has room → a small hint so nobody gives up on the day.
          const alt = other && !past && c.free <= 1 ? countDay(days?.[date], date, [other], s, email, now, team).free : 0
          const hint = alt > c.free ? alt : 0
          const n = Number(date.slice(8))
          const level = past ? 'past' : c.total === 0 ? 'full' : c.free === 0 ? 'full' : c.free <= 3 ? 'few' : 'lots'
          const tone = level === 'few' ? 'text-amber-300' : 'text-green-400'
          const bar = level === 'few' ? 'bg-amber-300' : 'bg-green-400'
          // Owner, Nov 4: your filming days stand out (gold tint + gold edge), and today is a white circle on the date.
          const mine = c.mine && !team
          const ring = date === selected ? 'shadow-[inset_0_0_0_2px_#F5F5F7]' : mine ? 'shadow-[inset_0_0_0_2px_#C9A961]' : ''
          return (
            <button key={date} disabled={past} onClick={() => onPick(date)} aria-label={`${date}${date === today ? ' (today)' : ''}${mine ? ', you film this day' : ''}: ${team ? `${c.requested} requests, ` : ''}${c.free} free${house === 'both' ? '' : ` at ${HOUSE_NAME[house]}`}${hint ? `, ${HOUSE_NAME[other!]} has ${hint} free` : ''}`}
              className={`relative aspect-[0.82] rounded-xl ${mine ? 'bg-pt-accent/20' : 'bg-pt-surface'} flex flex-col items-center justify-between pt-1.5 pb-2 lg:pt-3 lg:pb-3 px-0.5 tabular-nums ${past ? 'opacity-30' : 'active:opacity-80'} ${ring}`}>
              {!past && headsUps(days?.[date]).length > 0 && <i className="absolute top-1.5 right-1.5 w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-amber-300" aria-label="Heads-up that day" />}
              <span className={`text-[18px] lg:text-[22px] font-bold ${date === today ? 'w-8 h-8 lg:w-10 lg:h-10 -mt-0.5 rounded-full bg-white text-stone-900 grid place-items-center' : mine ? 'text-pt-accent' : 'text-pt-text'}`}>{n}</span>
              {!past && (
                <span className="flex flex-col items-center leading-none gap-0.5">
                  {team && c.requested > 0 && <span className="min-w-5 h-5 px-1 mb-0.5 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{c.requested}</span>}
                  {c.free === 0
                    ? <span className="text-xs font-semibold text-pt-muted">Full</span>
                    : <span className={`text-xs lg:text-[13px] font-semibold ${tone}`}>{c.free} free</span>}
                  {hint > 0 && <span className="mt-0.5 text-xs lg:text-[13px] font-semibold text-sky-300 whitespace-nowrap">{other === 'cliff2' ? 'C2' : 'C1'}: {hint}<span className="hidden lg:inline"> free</span></span>}
                </span>
              )}
              {/* Owner, Nov 4: the bar shows WHICH times are free, morning (left) to night (right), not how many. */}
              <span className="w-[80%] flex gap-px h-1.5 lg:h-2" aria-hidden>
                {c.freeAt.map((f, i) => <i key={i} className={`flex-1 h-full first:rounded-l-full last:rounded-r-full ${!past && f ? bar : 'bg-pt-border'} ${f === null && !past ? 'opacity-40' : ''}`} />)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-xs text-pt-muted">
        <span className="inline-flex items-center gap-1.5 basis-full"><span className="inline-flex gap-px w-12 h-1.5">{[1, 1, 0, 0, 0, 0, 1, 1, 0].map((f, i) => <i key={i} className={`flex-1 h-full first:rounded-l-full last:rounded-r-full ${f ? 'bg-green-400' : 'bg-pt-border'}`} />)}</span>The bar is the day, {s.slots.length ? `${fmtHour(s.slots[0])} on the left to ${fmtHour(s.slots[s.slots.length - 1])} on the right` : 'morning to night'}: lit = free then{house === 'both' ? ' at either house' : ` at ${HOUSE_NAME[house]}`}</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Lots free</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1" />A few left</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-pt-muted mr-1" />Full</span>
        {other && <span><b className="text-sky-300 font-semibold mr-1">{other === 'cliff2' ? 'C2: 3' : 'C1: 3'}</b>{HOUSE_NAME[house as House]} is full, {HOUSE_NAME[other]} has 3 free</span>}
        <span><i className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 mr-1 align-[2px]" />Heads-up (you can still film)</span>
        {team ? <span><i className="inline-block w-3 h-3 rounded-full bg-amber-400 mr-1 align-[-2px]" />Requests waiting</span>
          : <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-pt-accent/30 shadow-[inset_0_0_0_2px_#C9A961] mr-1 align-[-1px]" />You're filming</span>}
        <span><i className="inline-block w-3 h-3 rounded-full bg-white mr-1 align-[-2px]" />Today</span>
      </div>
    </div>
  )
}
