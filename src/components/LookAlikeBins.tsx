import { useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { lookAlikeBins } from '../../functions/src/binNames'
import { mergeBins } from '../services/importer'
import { useItems } from '../hooks/useItems'
import type { Bin, Location } from '../types'

// Bins screen: bins that are really the same one ("B.31", "B:31", "B: 31").
// Pick the name to keep, then merge: every prop moves into it.
export default function LookAlikeBins({ bins, locationMap }: { bins: Bin[]; locationMap: Record<string, Location> }) {
  const groups = useMemo(() => lookAlikeBins(bins), [bins])
  const items = useItems()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) if (i.binId) m.set(i.binId, (m.get(i.binId) ?? 0) + 1)
    return m
  }, [items])
  if (!groups.length) return null
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 mb-5 space-y-3">
      <div>
        <p className="text-amber-200 text-sm font-medium">Look-alike bins ({groups.length})</p>
        <p className="text-pt-muted text-xs">These names look like the same bin written differently. Tap the name to keep, then merge: all their props move into it.</p>
      </div>
      {groups.map(g => <Group key={g.map(b => b.id).join('|')} bins={g} counts={counts} locationMap={locationMap} />)}
    </div>
  )
}

function Group({ bins, counts, locationMap }: { bins: Bin[]; counts: Map<string, number>; locationMap: Record<string, Location> }) {
  // Keep the bin with the most props by default (its label is probably on the shelf already).
  const best = [...bins].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0]
  const [keepId, setKeepId] = useState(best.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keep = bins.find(b => b.id === keepId) ?? best

  async function merge() {
    if (!window.confirm(`Merge these bins into "${keep.label}"?\n\nEvery prop in the others moves into "${keep.label}", and the other bins are removed (old QR stickers for them stop working).`)) return
    setBusy(true); setError(null)
    try { await mergeBins({ keepId: keep.id, removeIds: bins.filter(b => b.id !== keep.id).map(b => b.id) }) }
    catch (err) { setError(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server.") ; setBusy(false) }
  }

  return (
    <div className="bg-pt-surface border border-pt-border rounded-xl p-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {bins.map(b => (
          <button key={b.id} onClick={() => setKeepId(b.id)}
            className={`px-3 py-1.5 rounded-lg text-sm text-left ${b.id === keep.id ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg border border-pt-border text-pt-text'}`}>
            {b.label} <span className="opacity-70 text-xs">· {counts.get(b.id) ?? 0} props{locationMap[b.locationId] ? ` · ${locationMap[b.locationId].name}` : ''}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-red-300 text-xs">{error}</p>}
      <button onClick={merge} disabled={busy}
        className="w-full py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">
        {busy ? 'Merging…' : `Merge into "${keep.label}"`}
      </button>
    </div>
  )
}
