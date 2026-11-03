// The month calendar (owner, Nov 2: "creators book based on what's already available… a monthly view that's very visual").
// ONE grid for both sides: creators see how many 2-hour spots are free each day; the equipment team (mode 'team') sees how
// many requests wait on each day and how full it is. Tapping a day calls onPick. Colours carry the meaning; words stay short.
import { addDays, weekday } from '../../functions/src/booking'
import { slotState, HOUSES, type House, type ScheduleDay, type ScheduleSettings } from '../services/schedule'

export const monthStart = (month: string) => `${month}-01`
export const monthAdd = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number); const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`
}
export const monthTitle = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export function daysOfMonth(month: string) { const out: string[] = []; for (let d = monthStart(month); d.startsWith(month); d = addDays(d, 1)) out.push(d); return out }

export interface DayCount { free: number; total: number; booked: number; requested: number; mine: boolean }
export function countDay(day: ScheduleDay | undefined, date: string, houses: House[], s: ScheduleSettings, email: string, now: string, team: boolean): DayCount {
  const c: DayCount = { free: 0, total: 0, booked: 0, requested: 0, mine: false }
  for (const h of houses) for (const st of s.slots) {
    const x = slotState(day, date, h, st, s, email, now, team)
    if (x.t === 'past') continue
    c.total++
    if (x.t === 'free') c.free++
    else if (x.t === 'booked') { if (x.entry.pending) c.requested++; else c.booked++; if (x.entry.email === email) c.mine = true }
  }
  for (const o of day?.offsite ?? []) { if (o.pending) c.requested++; if (o.email === email) c.mine = true }
  return c
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthGrid({ month, days, s, email, now, today, team = false, houses = HOUSES, selected, onPick }: {
  month: string; days: Record<string, ScheduleDay> | null; s: ScheduleSettings; email: string; now: string; today: string
  team?: boolean; houses?: House[]; selected?: string | null; onPick: (date: string) => void
}) {
  const list = daysOfMonth(month)
  const lead = weekday(list[0])
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">{DOW.map(d => <span key={d} className="text-center text-pt-muted text-xs">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {list.map(date => {
          const past = date < today
          const c = countDay(days?.[date], date, houses, s, email, now, team)
          const n = Number(date.slice(8))
          const level = past ? 'past' : c.total === 0 ? 'full' : c.free === 0 ? 'full' : c.free <= 3 ? 'few' : 'lots'
          const ring = date === selected ? 'shadow-[inset_0_0_0_2px_#F5F5F7]' : c.mine && !team ? 'shadow-[inset_0_0_0_2px_#C9A961]' : ''
          return (
            <button key={date} disabled={past} onClick={() => onPick(date)} aria-label={`${date}: ${team ? `${c.requested} requests, ` : ''}${c.free} free`}
              className={`relative aspect-[0.82] lg:aspect-[1.35] rounded-xl bg-pt-surface flex flex-col items-center justify-between py-1.5 px-0.5 tabular-nums ${past ? 'opacity-30' : 'active:opacity-80'} ${ring}`}>
              <span className={`text-[15px] font-semibold ${date === today ? 'text-pt-accent' : 'text-pt-text'}`}>{n}</span>
              {!past && (team
                ? <span className="flex flex-col items-center gap-0.5">
                    {c.requested > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{c.requested}</span>}
                    <span className={`text-xs font-bold leading-tight whitespace-nowrap ${level === "full" ? "text-pt-muted" : level === "few" ? "text-amber-300" : "text-green-400"}`}>{c.free === 0 ? "Full" : `${c.free} free`}</span>
                  </span>
                : <span className={`text-xs font-bold leading-tight whitespace-nowrap ${level === 'full' ? 'text-pt-muted' : level === 'few' ? 'text-amber-300' : 'text-green-400'}`}>{c.free === 0 ? 'Full' : `${c.free} free`}</span>)}
              <span className="w-[70%] h-1 rounded bg-pt-border overflow-hidden">
                {!past && <i className="block h-full bg-green-400" style={{ width: `${c.total ? Math.round(c.free / c.total * 100) : 0}%` }} />}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-xs text-pt-muted">
        <span><i className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Lots free</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1" />A few left</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-pt-muted mr-1" />Full</span>
        {team ? <span><i className="inline-block w-3 h-3 rounded-full bg-amber-400 mr-1 align-[-2px]" />Requests waiting</span>
          : <span><i className="inline-block w-2.5 h-2.5 rounded-sm shadow-[inset_0_0_0_2px_#C9A961] mr-1 align-[-1px]" />Your shoot</span>}
      </div>
    </div>
  )
}
