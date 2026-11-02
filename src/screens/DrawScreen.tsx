// The monthly Cliff 1 draw, team view (owner + equipment + admin look; only the owner runs or undoes it).
// Shows who made wishes for next month, then the result: everyone's slots and how they got them.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, fmtSlot } from '../services/schedule'
import { DrawExplainer } from '../components/DrawExplainer'
import { useAllWishes, useDraw, runMonthlyDraw, undoMonthlyDraw, wishWindow, drawMonthFor, monthAfter, monthLabel, howLabel } from '../services/draw'

const stampLabel = (st: string) => `${formatDay(st.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))}`

export default function DrawScreen() {
  const navigate = useNavigate()
  const { role } = useSession()
  const owner = role === 'owner'
  const s = useScheduleSettings()
  const first = drawMonthFor(todayInStudio())
  const [month, setMonth] = useState(first)
  const wishes = useAllWishes(month, true)
  const draw = useDraw(month)
  const win = wishWindow(month)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const done = draw?.status === 'done'
  const started = `${month}-01` <= todayInStudio()

  async function act(what: 'run' | 'undo') {
    if (!confirm(what === 'run'
      ? `Run the ${monthLabel(month)} draw now? Everyone gets their ${s.monthlySlots} slots booked and a notification. Wishes after this won't count.`
      : `Undo the ${monthLabel(month)} draw? Its slots come off the schedule (shoots that already have props or gear stay). You can run it again after.`)) return
    setBusy(what); setMsg(null)
    try {
      if (what === 'run') { const r = (await runMonthlyDraw({ month })).data; setMsg({ ok: true, text: `Done ✓ ${r.placed} slots booked.` }) }
      else { const r = (await undoMonthlyDraw({ month })).data; setMsg({ ok: true, text: `Undone ✓ ${r.removed} slots taken off${r.kept.length ? `; kept ${r.kept.length} with props or gear` : ''}.` }) }
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }) } finally { setBusy('') }
  }

  const byPerson = new Map<string, NonNullable<typeof draw>['placements']>()
  for (const p of draw?.placements ?? []) byPerson.set(p.email, [...(byPerson.get(p.email) ?? []), p])

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate(-1)} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">Monthly draw</h1>
      </div>
      <div className="px-4 pt-1 space-y-5">
        <div className="flex gap-2">
          {[first, monthAfter(first)].map(m => (
            <button key={m} onClick={() => setMonth(m)} className={`rounded-full px-4 min-h-[40px] text-sm ${m === month ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>{monthLabel(m)}</button>
          ))}
        </div>
        <p className="text-pt-muted text-sm">Every creator gets {s.monthlySlots} guaranteed {s.houses.cliff1.name} slots. Wishes open <b className="text-pt-text">{formatDay(win.opens.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}</b>; the draw runs by itself on <b className="text-pt-text">{stampLabel(win.closes)}</b>. Nobody gets two slots on the same day or on days next to each other; people without wishes get their usual days, one a week.</p>

        <DrawExplainer team />

        <section className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-pt-text font-semibold">Wishes</h2><span className="text-pt-muted text-sm">{wishes.length} {wishes.length === 1 ? 'person' : 'people'}</span></div>
          {wishes.length === 0 && <p className="text-pt-muted text-sm">{nowStamp() < win.opens ? 'The wishlist isn\'t open yet.' : 'No wishes yet.'}</p>}
          {wishes.sort((a, b) => a.name.localeCompare(b.name)).map(w => (
            <p key={w.email} className="text-sm text-pt-text">{w.name} <span className="text-pt-muted">· {w.wishes.length} wish{w.wishes.length === 1 ? '' : 'es'}</span></p>
          ))}
        </section>

        {owner && !started && (
          <div className="flex gap-2">
            {!done && <button disabled={!!busy} onClick={() => act('run')} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl min-h-[48px] shadow-gold disabled:opacity-40">{busy === 'run' ? 'Running…' : 'Run the draw now'}</button>}
            {done && <button disabled={!!busy} onClick={() => act('undo')} className="flex-1 bg-pt-surface shadow-hairline text-red-300 rounded-xl min-h-[48px] disabled:opacity-40">{busy === 'undo' ? 'Undoing…' : 'Undo this draw'}</button>}
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>}
        {draw?.status === 'failed' && <p className="text-amber-300 text-sm">The draw didn't finish: {draw.error}. {owner ? 'Run it again above.' : 'Tell the owner.'}</p>}
        {draw?.status === 'undone' && <p className="text-pt-muted text-sm">This draw was undone{draw.kept?.length ? ` (kept: ${draw.kept.join(', ')})` : ''}.</p>}

        {done && (
          <section className="space-y-3">
            <h2 className="text-pt-text font-semibold text-[17px]">Result · {draw!.placements?.length ?? 0} slots</h2>
            {!!draw!.short?.length && <p className="text-amber-300 text-sm">Fewer than {s.monthlySlots}: {draw!.short.map(x => `${x.name} (${x.missing} short)`).join(', ')}. {s.houses.cliff1.name} ran out of spread-out slots; book them extras by hand.</p>}
            {[...byPerson.entries()].sort((a, b) => a[1]![0].name.localeCompare(b[1]![0].name)).map(([email, list]) => (
              <div key={email} className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-1">
                <p className="text-pt-text font-semibold">{list![0].name}</p>
                {list!.map(p => <p key={p.shootId} className="text-sm text-pt-muted">{formatDay(p.date)} · {fmtSlot(p.start, s.slotMinutes)} · <span className={p.how === 'auto' ? 'text-sky-300' : 'text-pt-accent'}>{howLabel(p).replace('Your wish', 'Wish')}</span></p>)}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
