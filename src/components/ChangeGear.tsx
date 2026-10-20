// A creator's held gear before pickup: change how many extras, take bundles out, change the hours
// (same day), or add more from Browse (a new hold for the same shoot).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveShoot } from '../activeShoot'
import { editGearBooking, subscribeToGearBundles, fmtTime, GEAR_DAY_START, GEAR_DAY_END, GEAR_STEP, type GearBooking, type GearBundle } from '../services/gear'

const errText = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'That didn\'t work. Try again.'
const TIMES: number[] = []
for (let t = GEAR_DAY_START; t <= GEAR_DAY_END; t += GEAR_STEP) TIMES.push(t)

export default function ChangeGear({ b }: { b: GearBooking }) {
  const navigate = useNavigate()
  const { choose } = useActiveShoot()
  const [offers, setOffers] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setOffers), [])
  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [start, setStart] = useState(b.start), [end, setEnd] = useState(b.end)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const offered = (id: string) => offers.find(o => o.id === id)?.pieces[0]?.qty ?? 99

  function begin() { setQty(Object.fromEntries(b.lines.map(l => [l.offerId, l.qty]))); setStart(b.start); setEnd(b.end); setErr(''); setEditing(true) }
  async function save() {
    setBusy(true); setErr('')
    try {
      await editGearBooking({ id: b.id, lines: Object.entries(qty).filter(([, q]) => q > 0).map(([offerId, q]) => ({ offerId, qty: q })), start, end })
      setEditing(false)
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  function addMore() { if (b.shootId) choose(b.shootId); navigate('/gear') }

  if (!editing) return (
    <div className="flex gap-2">
      <button onClick={begin} className="flex-1 bg-pt-surface text-pt-text font-semibold rounded-xl py-3">Change</button>
      <button onClick={addMore} className="flex-1 bg-pt-surface text-pt-text font-semibold rounded-xl py-3">+ Add more</button>
    </div>
  )
  const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-2.5 py-2 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
  return (
    <div className="bg-pt-surface border border-pt-accent/40 rounded-2xl p-3 space-y-3">
      <p className="text-pt-text font-semibold">Change your gear</p>
      {b.lines.map(l => {
        const n = qty[l.offerId] ?? 0
        return (
          <div key={l.offerId} className={`flex items-center gap-3 ${n ? '' : 'opacity-40'}`}>
            <p className={`flex-1 min-w-0 text-sm truncate ${n ? 'text-pt-text' : 'line-through text-pt-muted'}`}>{l.name}</p>
            {n > 0 ? (
              <>
                {l.kind === 'extra' && (
                  <div className="flex items-center rounded-xl bg-pt-bg shadow-hairline shrink-0">
                    <button className="w-9 h-9 text-xl disabled:opacity-30" disabled={n <= 1} onClick={() => setQty({ ...qty, [l.offerId]: n - 1 })} aria-label="One less">−</button>
                    <span className="w-7 text-center font-semibold tabular-nums">{n}</span>
                    <button className="w-9 h-9 text-xl disabled:opacity-30" disabled={n >= offered(l.offerId)} onClick={() => setQty({ ...qty, [l.offerId]: n + 1 })} aria-label="One more">+</button>
                  </div>
                )}
                <button onClick={() => setQty({ ...qty, [l.offerId]: 0 })} aria-label={`Remove ${l.name}`} className="text-pt-muted text-2xl w-7">×</button>
              </>
            ) : <button onClick={() => setQty({ ...qty, [l.offerId]: l.qty })} className="text-pt-accent text-sm tap">Put back</button>}
          </div>
        )
      })}
      {/* Gear for a booked shoot keeps the shoot's own hours (owner, Oct 20). */}
      {b.scheduleShootId ? <p className="text-pt-muted text-sm">Hours: {fmtTime(b.start)}–{fmtTime(b.end)}, the same as your shoot.</p> : <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="block text-pt-muted text-xs">Gear from</span>
          <select value={start} onChange={e => { const v = Number(e.target.value); setStart(v); if (end <= v) setEnd(v + GEAR_STEP) }} className={field}>
            {TIMES.slice(0, -1).map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-pt-muted text-xs">Until</span>
          <select value={end} onChange={e => setEnd(Number(e.target.value))} className={field}>
            {TIMES.filter(t => t > start).map(t => <option key={t} value={t}>{t === GEAR_DAY_END ? 'Midnight' : fmtTime(t)}</option>)}</select></label>
      </div>}
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => setEditing(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-3">Never mind</button>
        <button disabled={busy} onClick={save} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40 shadow-gold">{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
      <p className="text-pt-muted text-xs">You can change this until you pick it up.</p>
    </div>
  )
}
