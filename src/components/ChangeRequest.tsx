// A creator's props request while it's still "Requested": change how many, take props out,
// add or remove things to make or find, or add more from Browse (a new request for the same shoot).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useActiveShoot } from '../activeShoot'
import { editReservation, type Reservation } from '../services/reservations'

const errText = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'That didn\'t work. Try again.'

export default function ChangeRequest({ res }: { res: Reservation }) {
  const navigate = useNavigate()
  const items = useItems()
  const { choose } = useActiveShoot()
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<Record<string, number>>({})
  const [builds, setBuilds] = useState<{ description: string; qty: number; refPhoto?: string }[]>([])
  const [newBuild, setNewBuild] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const max = (id: string) => items.find(i => i.id === id)?.quantity ?? 99

  function start() {
    setLines(Object.fromEntries(res.lines.map(l => [l.itemId, l.qty])))
    setBuilds((res.builds ?? []).map(b => ({ description: b.description, qty: b.qty, ...(b.refPhoto ? { refPhoto: b.refPhoto } : {}) })))
    setErr(''); setEditing(true)
  }
  async function save() {
    setBusy(true); setErr('')
    try {
      await editReservation({ id: res.id, lines: Object.entries(lines).filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty })), builds })
      setEditing(false)
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  function addMore() {
    if (res.shootId) choose(res.shootId)
    navigate('/browse')
  }

  if (!editing) return (
    <div className="flex gap-2">
      <button onClick={start} className="flex-1 bg-pt-surface border border-pt-border text-pt-text font-semibold rounded-xl py-3">Change</button>
      <button onClick={addMore} className="flex-1 bg-pt-surface border border-pt-border text-pt-text font-semibold rounded-xl py-3">+ Add more</button>
    </div>
  )
  const step = 'w-9 h-9 text-pt-text text-xl disabled:opacity-30'
  return (
    <div className="bg-pt-surface border border-pt-accent/40 rounded-2xl p-3 space-y-3">
      <p className="text-pt-text font-semibold">Change your request</p>
      {res.lines.map(l => {
        const n = lines[l.itemId] ?? 0
        return (
          <div key={l.itemId} className={`flex items-center gap-3 ${n ? '' : 'opacity-40'}`}>
            <div className="w-11 h-11 rounded-xl bg-pt-border overflow-hidden shrink-0">{l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}</div>
            <p className={`flex-1 min-w-0 text-sm truncate ${n ? 'text-pt-text' : 'line-through text-pt-muted'}`}>{l.itemName}</p>
            {n > 0 ? (
              <>
                <div className="flex items-center rounded-xl bg-pt-bg border border-pt-border shrink-0">
                  <button className={step} disabled={n <= 1} onClick={() => setLines({ ...lines, [l.itemId]: n - 1 })} aria-label="One less">−</button>
                  <span className="w-7 text-center text-pt-text font-semibold tabular-nums">{n}</span>
                  <button className={step} disabled={n >= max(l.itemId)} onClick={() => setLines({ ...lines, [l.itemId]: n + 1 })} aria-label="One more">+</button>
                </div>
                <button onClick={() => setLines({ ...lines, [l.itemId]: 0 })} aria-label={`Remove ${l.itemName}`} className="text-pt-muted text-2xl w-7">×</button>
              </>
            ) : <button onClick={() => setLines({ ...lines, [l.itemId]: l.qty })} className="text-pt-accent text-sm">Put back</button>}
          </div>
        )
      })}
      {builds.map((b, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-violet-500/10 grid place-items-center shrink-0">🛠️</div>
          <p className="flex-1 min-w-0 text-sm text-pt-text">{b.description} <span className="text-violet-300">×{b.qty}</span></p>
          <button onClick={() => setBuilds(builds.filter((_, j) => j !== i))} aria-label="Remove" className="text-pt-muted text-2xl w-7">×</button>
        </div>
      ))}
      <div className="flex gap-2">
        <input value={newBuild} onChange={e => setNewBuild(e.target.value)} placeholder="Something we don't have (make or find)"
          className="flex-1 min-w-0 bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent" />
        <button disabled={!newBuild.trim()} onClick={() => { setBuilds([...builds, { description: newBuild.trim(), qty: 1 }]); setNewBuild('') }}
          className="shrink-0 bg-pt-border text-pt-text rounded-xl px-3 text-sm disabled:opacity-40">Add</button>
      </div>
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => setEditing(false)} className="flex-1 bg-pt-border text-pt-text rounded-xl py-3">Never mind</button>
        <button disabled={busy} onClick={save} className="flex-1 bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40">{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
      <p className="text-pt-muted text-xs">You can change this until the arts department starts picking.</p>
    </div>
  )
}
