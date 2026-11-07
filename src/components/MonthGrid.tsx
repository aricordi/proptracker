// The month calendar (owner, Nov 2: "creators book based on what's already available… a monthly view that's very visual").
// ONE grid for both sides: creators see how many 2-hour spots are free each day; the equipment team (mode 'team') sees how
// many requests wait on each day and how full it is. Tapping a day calls onPick. Colours carry the meaning; words stay short.
import { addDays, weekday } from '../../functions/src/booking'
import { useState, type ReactNode } from 'react'
import { slotState, headsUps, HOUSES, BOOK_AHEAD_DAYS, type House, type ScheduleDay, type ScheduleSettings } from '../services/schedule'

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

// ALL view (owner, Nov 5: "no combined free count, that's silly; an All to see Cliff 1, Cliff 2 and offsite shoots"): who is
// filming that day, one dot per shoot coloured by place. Held invites and blocks aren't shoots.
export const PLACE_DOT: Record<House | 'offsite', string> = { cliff1: 'bg-white', cliff2: 'bg-sky-400', offsite: 'bg-violet-400' }
export function shootsOn(day: ScheduleDay | undefined) {
  const out: { place: House | 'offsite'; pending: boolean }[] = []
  for (const h of HOUSES) {
    const seen = new Set<string>()
    for (const e of Object.values(day?.[h] ?? {})) {
      if (!e.shootId || e.move || seen.has(e.shootId)) continue
      seen.add(e.shootId); out.push({ place: h, pending: !!e.pending })
    }
  }
  for (const o of day?.offsite ?? []) if (!o.move) out.push({ place: 'offsite', pending: !!o.pending })
  return out
}

const fmtHour = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthGrid({ month, days, s, email, now, today, team = false, lockFree = team, selected, onPick }: {
  month: string; days: Record<string, ScheduleDay> | null; s: ScheduleSettings; email: string; now: string; today: string
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
          const hint = alt > c.free ? alt : 0
          const n = Number(date.slice(8))
          const level = past ? 'past' : c.total === 0 ? 'full' : c.free === 0 ? 'full' : c.free <= 3 ? 'few' : 'lots'
          const tone = level === 'few' ? 'text-amber-300' : 'text-green-400'
          const bar = level === 'few' ? 'bg-amber-300' : 'bg-green-400'
          // Owner, Nov 4: your filming days stand out (gold tint + gold edge), and today is a white circle on the date.
          const mine = c.mine && !team
          const ring = date === selected ? 'shadow-[inset_0_0_0_2px_#F5F5F7]' : mine ? 'shadow-[inset_0_0_0_2px_#C9A961]' : ''
          return (
            <button key={date} disabled={past} onClick={() => onPick(date)} aria-label={`${date}${date === today ? ' (today)' : ''}${mine ? ', you film this day' : ''}: ${team ? `${c.requested} requests, ` : ''}${house === 'all' ? `${shootsOn(days?.[date]).length} shoots` : `${c.free} free at ${HOUSE_NAME[house]}`}${hint ? `, ${HOUSE_NAME[other!]} has ${hint} free` : ''}`}
              className={`relative aspect-[0.82] rounded-xl ${mine ? 'bg-pt-accent/20' : 'bg-pt-surface'} flex flex-col items-center justify-between pt-1.5 pb-2 lg:pt-3 lg:pb-3 px-0.5 tabular-nums ${past ? 'opacity-30' : 'active:opacity-80'} ${ring}`}>
              {!past && headsUps(days?.[date]).length > 0 && <i className="absolute top-1.5 right-1.5 w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-amber-300" aria-label="Heads-up that day" />}
              <span className={`text-[18px] lg:text-[22px] font-bold ${date === today ? 'w-8 h-8 lg:w-10 lg:h-10 -mt-0.5 rounded-full bg-white text-stone-900 grid place-items-center' : mine ? 'text-pt-accent' : 'text-pt-text'}`}>{n}</span>
              {house === 'all' ? <AllCell list={shootsOn(days?.[date])} past={past} team={team} requested={c.requested} /> : <>
              {!past && (
                <span className="flex flex-col items-center leading-none gap-0.5">
                  {team && c.requested > 0 && <span className="min-w-5 h-5 px-1 mb-0.5 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{c.requested}</span>}
                  {hint > 0
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
        {house === 'all' ? <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 basis-full">One dot per shoot:
          <span><i className={`inline-block w-2 h-2 rounded-full mr-1 ${PLACE_DOT.cliff1}`} />Cliff 1</span>
          <span><i className={`inline-block w-2 h-2 rounded-full mr-1 ${PLACE_DOT.cliff2}`} />Cliff 2</span>
          <span><i className={`inline-block w-2 h-2 rounded-full mr-1 ${PLACE_DOT.offsite}`} />Offsite</span>
          <span><i className="inline-block w-2 h-2 rounded-full mr-1 border border-white/70" />Waiting for OK</span></span>
        : <span className="inline-flex items-center gap-1.5 basis-full"><span className="inline-flex gap-px w-12 h-1.5">{[1, 1, 0, 0, 0, 0, 1, 1, 0].map((f, i) => <i key={i} className={`flex-1 h-full first:rounded-l-full last:rounded-r-full ${f ? 'bg-green-400' : 'bg-pt-border'}`} />)}</span>The bar is the day, {s.slots.length ? `${fmtHour(s.slots[0])} on the left to ${fmtHour(s.slots[s.slots.length - 1])} on the right` : 'morning to night'}: lit = free then at {HOUSE_NAME[house as House]}</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Lots free</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1" />A few left</span>}
        {house !== 'all' && <span><i className="inline-block w-2 h-2 rounded-full bg-pt-muted mr-1" />Full</span>}
        {other && <span><b className="text-sky-300 font-semibold mr-1">{other === 'cliff2' ? 'C2: 3' : 'C1: 3'}</b>{HOUSE_NAME[house as House]} is full, {HOUSE_NAME[other]} has 3 free spots</span>}
        <span><i className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 mr-1 align-[2px]" />Heads-up (you can still film)</span>
        {team ? <span><i className="inline-block w-3 h-3 rounded-full bg-amber-400 mr-1 align-[-2px]" />Requests waiting</span>
          : <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-pt-accent/30 shadow-[inset_0_0_0_2px_#C9A961] mr-1 align-[-1px]" />You're filming</span>}
        <span><i className="inline-block w-3 h-3 rounded-full bg-white mr-1 align-[-2px]" />Today</span>
      </div>
      </MonthKey>
    </div>
  )
}

// One day in the ALL view: how many shoots, then a dot per shoot (Cliff 1 white, Cliff 2 sky, offsite violet; hollow = waiting for OK).
const RING: Record<House | 'offsite', string> = { cliff1: 'border-white', cliff2: 'border-sky-400', offsite: 'border-violet-400' }
function AllCell({ list, past, team, requested }: { list: { place: House | 'offsite'; pending: boolean }[]; past: boolean; team: boolean; requested: number }) {
  const order = { cliff1: 0, cliff2: 1, offsite: 2 }
  const dots = list.slice().sort((a, b) => order[a.place] - order[b.place])
  const shown = dots.slice(0, 8)
  return <>
    {!past && (
      <span className="flex flex-col items-center leading-none gap-0.5">
        {team && requested > 0 && <span className="min-w-5 h-5 px-1 mb-0.5 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{requested}</span>}
        <span className={`text-xs lg:text-[13px] font-semibold ${list.length ? 'text-pt-text' : 'text-pt-muted'}`}>{list.length ? `${list.length}` : '–'}<span className="hidden lg:inline">{list.length === 1 ? ' shoot' : list.length ? ' shoots' : ''}</span></span>
      </span>
    )}
    <span className="w-[86%] min-h-[6px] flex flex-wrap justify-center gap-[3px]" aria-hidden>
      {shown.map((d, i) => <i key={i} className={`w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full ${d.pending ? `border ${RING[d.place]}` : PLACE_DOT[d.place]}`} />)}
      {dots.length > shown.length && <span className="text-xs leading-[6px] text-pt-muted">+</span>}
    </span>
  </>
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
