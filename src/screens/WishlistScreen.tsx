// Monthly Cliff 1 wishlist (owner, Nov 1): between the 15th and the 20th at 6 PM, rank up to 8 Cliff 1 slots for next
// month (optionally with a friend right after you). The fair draw on the 20th gives everyone their guaranteed slots,
// spread out (never two on the same or next day). No wishes? The app picks from your usual days and times.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import BottomSheet from '../components/BottomSheet'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'
import { todayInStudio, weekday } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, useScheduleDays, listFilmingFriends, blockAt, slotKey, fmtSlot } from '../services/schedule'
import { useMyWishes, useDraw, saveWishlist, wishWindow, drawMonthFor, daysOfMonth, monthShort, howLabel, MAX_WISHES, type Wish } from '../services/draw'

const stampLabel = (st: string) => `${formatDay(st.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))}`

export default function WishlistScreen() {
  const navigate = useNavigate()
  const { profile } = useSession()
  const email = profile.email
  const s = useScheduleSettings()
  const month = drawMonthFor(todayInStudio())
  const win = wishWindow(month)
  const now = nowStamp()
  const saved = useMyWishes(month, email)
  const draw = useDraw(month)
  const [wishes, setWishes] = useState<Wish[] | null>(null)
  useEffect(() => { if (saved !== undefined && wishes === null) setWishes(saved?.wishes ?? []) }, [saved, wishes])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  useEffect(() => { listFilmingFriends({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [])
  const nameOf = (e?: string) => people.find(p => p.email === e)?.name ?? e ?? ''

  const done = draw?.status === 'done'
  const open = now >= win.opens && now < win.closes && !done
  const mine = (draw?.placements ?? []).filter(p => p.email === email)
  const dirty = JSON.stringify(wishes ?? []) !== JSON.stringify(saved?.wishes ?? [])

  const move = (i: number, d: number) => setWishes(w => { const x = [...(w ?? [])]; const j = i + d; if (j < 0 || j >= x.length) return x; [x[i], x[j]] = [x[j], x[i]]; return x })
  async function save() {
    setBusy(true); setMsg(null)
    try { const r = await saveWishlist({ month, wishes: wishes ?? [] }); setMsg({ ok: true, text: `Saved ✓ ${r.data.count} wish${r.data.count === 1 ? '' : 'es'} for ${monthShort(month)}.` }) }
    catch (e) { setMsg({ ok: false, text: friendlyError(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate(-1)} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">{monthShort(month)} wishlist</h1>
      </div>
      <div className="px-4 pt-1 space-y-5">
        <p className="text-pt-muted text-sm">Everyone gets <b className="text-pt-text">{s.monthlySlots} guaranteed {s.houses.cliff1.name} slots</b> in {monthShort(month)}. Rank the ones you'd like; a fair draw on <b className="text-pt-text">{stampLabel(win.closes)}</b> hands them out. It's not a race: when you save doesn't matter.</p>

        {done ? (
          <section className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
            <h2 className="text-pt-text font-semibold text-[17px]">Your {monthShort(month)} slots ✓</h2>
            {mine.length === 0 && <p className="text-pt-muted text-sm">No slots this time. Book extra slots on the schedule.</p>}
            {mine.map(p => (
              <div key={p.shootId} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
                <span className="flex-1 min-w-0"><span className="block text-pt-text font-semibold">{formatDay(p.date, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                  <span className="block text-pt-muted text-xs">{s.houses.cliff1.name} · {fmtSlot(p.start, s.slotMinutes)} · {howLabel(p)}</span></span>
              </div>
            ))}
            <button onClick={() => navigate('/shoots')} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl min-h-[44px] shadow-gold">See them in My shoots</button>
            <p className="text-pt-muted text-xs">Need a different time? Move or swap any of them from the shoot, like any other shoot.</p>
          </section>
        ) : now < win.opens ? (
          <section className="bg-pt-surface shadow-hairline rounded-2xl p-4">
            <p className="text-pt-text font-semibold">Opens {formatDay(win.opens.slice(0, 10), { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <p className="text-pt-muted text-sm mt-1">You'll get a notification. Until {stampLabel(win.closes)} you can add, reorder and change your wishes as often as you like.</p>
          </section>
        ) : !open ? (
          <section className="bg-pt-surface shadow-hairline rounded-2xl p-4">
            <p className="text-pt-text font-semibold">The wishlist is closed</p>
            <p className="text-pt-muted text-sm mt-1">The draw is running. Your slots will show up here and in My shoots, with a notification.</p>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-end justify-between"><h2 className="text-pt-text font-semibold text-[17px]">Your wishes</h2><span className="text-pt-muted text-xs">{(wishes ?? []).length} of {MAX_WISHES} · closes {stampLabel(win.closes)}</span></div>
            {(wishes ?? []).length === 0 && <p className="text-pt-muted text-sm">No wishes yet. No wishes at all? The app picks your slots from the days and times you usually film.</p>}
            {(wishes ?? []).map((w, i) => (
              <div key={`${w.date}${w.start}`} className="flex items-center gap-2 bg-pt-surface shadow-hairline rounded-xl p-3">
                <span className="w-7 h-7 rounded-full bg-pt-accent/20 text-pt-accent text-sm font-bold grid place-items-center shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0"><span className="block text-pt-text font-semibold truncate">{formatDay(w.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtSlot(w.start, s.slotMinutes)}</span>
                  {w.partner && <span className="block text-pt-muted text-xs truncate">With {nameOf(w.partner)} right after (if they wish it too)</span>}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="tap w-9 h-9 text-pt-muted disabled:opacity-30" aria-label="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === (wishes ?? []).length - 1} className="tap w-9 h-9 text-pt-muted disabled:opacity-30" aria-label="Move down">↓</button>
                <button onClick={() => setWishes(x => (x ?? []).filter((_, j) => j !== i))} className="tap w-9 h-9 text-pt-muted" aria-label="Remove">✕</button>
              </div>
            ))}
            {(wishes ?? []).length < MAX_WISHES && <button onClick={() => setAdding(true)} className="w-full bg-pt-surface shadow-hairline rounded-xl min-h-[48px] text-pt-accent font-semibold">+ Add a wish</button>}
            <ul className="text-pt-muted text-xs space-y-1 list-disc pl-4">
              <li>Higher up = more wanted. Each round everyone gets one slot, in a random order that flips every round.</li>
              <li>You never get two slots on the same day or on days right next to each other, so pick a few spread-out options.</li>
              <li>Filming with a friend? Add them to the wish; you're placed back to back only if they wish the slot right after you, naming you.</li>
            </ul>
          </section>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>}
      </div>
      {open && dirty && (
        <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
          <button disabled={busy} onClick={save} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold disabled:opacity-40">{busy ? 'Saving…' : 'Save my wishlist'}</button>
        </div>
      )}
      {adding && <AddWish month={month} email={email} have={wishes ?? []} people={people} onClose={() => setAdding(false)} onAdd={w => { setWishes(x => [...(x ?? []), w]); setAdding(false) }} />}
    </div>
  )
}

function AddWish({ month, email, have, people, onClose, onAdd }: { month: string; email: string; have: Wish[]; people: { email: string; name: string }[]; onClose: () => void; onAdd: (w: Wish) => void }) {
  const s = useScheduleSettings()
  const dates = useMemo(() => daysOfMonth(month), [month])
  const days = useScheduleDays(dates[0], dates[dates.length - 1])
  const priority = s.priority.some(p => p.email === email)
  const locked = (d: string) => !priority && s.priorityWeekdays.includes(weekday(d))
  const [date, setDate] = useState(() => dates.find(d => !locked(d)) ?? dates[0])
  const [start, setStart] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [partner, setPartner] = useState<{ email: string; name: string } | null>(null)
  const taken = (d: string, k: number) => !!days?.[d]?.cliff1?.[slotKey(k)] || !!blockAt(days?.[d], 'cliff1', k, s.slotMinutes)
  const term = q.trim().toLowerCase()
  const matches = term ? people.filter(p => p.name.toLowerCase().includes(term)).slice(0, 5) : []
  return (
    <BottomSheet open onClose={onClose} title="Add a wish">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1">
        {dates.map(d => (
          <button key={d} disabled={locked(d)} onClick={() => { setDate(d); setStart(null) }}
            className={`shrink-0 w-12 rounded-xl py-2 text-center disabled:opacity-30 ${d === date ? 'bg-pt-accent text-stone-900' : 'bg-pt-bg text-pt-text'}`}>
            <span className="block text-[11px]">{formatDay(d, { weekday: 'short' })}</span><span className="block font-bold">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      <p className="text-pt-muted text-xs mt-2">{formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })} · {s.houses.cliff1.name}{locked(date) ? ' · priority day' : ''}</p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {s.slots.map(k => {
          const no = taken(date, k) || have.some(w => w.date === date && w.start === k)
          return <button key={k} disabled={no} onClick={() => setStart(k)}
            className={`rounded-xl min-h-[44px] text-sm ${start === k ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-text'} disabled:opacity-30 disabled:line-through`}>{fmtSlot(k, s.slotMinutes)}</button>
        })}
      </div>
      {start !== null && (
        <div className="mt-4 space-y-2">
          <p className="text-pt-muted text-xs">Filming with a friend right after you? (optional)</p>
          {partner
            ? <button onClick={() => setPartner(null)} className="bg-pt-raised rounded-full px-3 min-h-[40px] text-sm text-pt-text">{partner.name} ×</button>
            : <><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name" className="w-full bg-pt-bg rounded-xl px-3 py-2.5 text-pt-text placeholder-pt-muted shadow-hairline focus:outline-none" />
              {matches.map(p => <button key={p.email} onClick={() => { setPartner(p); setQ('') }} className="block w-full text-left px-2 py-2 text-pt-text text-sm">{p.name}</button>)}</>}
          <button onClick={() => onAdd({ date, start, ...(partner ? { partner: partner.email } : {}) })} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl min-h-[48px] shadow-gold">Add wish #{have.length + 1}</button>
        </div>
      )}
    </BottomSheet>
  )
}
