import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { subscribeToGearItems, subscribeToGearBundles, setGearBundleArchived, pieceTotal, type GearItem, type GearBundle } from '../services/gear'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."

// Gear team: the bundles creators can book (whole), and a button to build a new one.
export default function GearBundlesScreen() {
  const navigate = useNavigate()
  const [bundles, setBundles] = useState<GearBundle[] | null>(null)
  const [items, setItems] = useState<GearItem[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => subscribeToGearBundles(setBundles), [])
  useEffect(() => subscribeToGearItems(setItems), [])
  const itemName = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items])
  const list = (bundles ?? []).filter(b => !!b.archived === showArchived)

  async function bringBack(b: GearBundle) {
    setError(null)
    try { await setGearBundleArchived({ id: b.id, archived: false }) } catch (err) { setError(errText(err)) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent flex-1">Bundles</h1>
        <button onClick={() => navigate('/gear/items')} className="text-pt-muted text-sm px-3 py-1.5 rounded-xl border border-pt-border">All gear</button>
      </div>
      <div className="p-4 space-y-3">
        <button onClick={() => navigate('/gear/bundles/new')} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold">+ Build a bundle</button>
        <p className="text-pt-muted text-sm">Creators only see bundles and always get the whole thing. Build them from the pieces in All gear.</p>
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {bundles === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {bundles && list.length === 0 && <p className="text-pt-muted text-sm text-center py-6">{showArchived ? 'No archived bundles.' : 'No bundles yet.'}</p>}
        {list.map(b => (
          <div key={b.id} className="bg-pt-surface border border-pt-border rounded-2xl p-3 flex gap-3">
            <button onClick={() => !b.archived && navigate(`/gear/bundles/${b.id}`)} className="flex gap-3 flex-1 min-w-0 text-left">
              <div className="w-16 h-16 rounded-xl bg-pt-bg overflow-hidden shrink-0 flex items-center justify-center text-pt-muted text-xs">
                {b.photos?.[0] ? <img src={b.photos[0]} alt="" className="w-full h-full object-cover" /> : b.category}
              </div>
              <div className="min-w-0">
                <p className="text-pt-text font-medium truncate">{b.name}</p>
                <p className="text-pt-muted text-xs">{b.category} · {pieceTotal(b.pieces)} pieces</p>
                <p className="text-pt-muted text-xs truncate">{b.pieces.slice(0, 3).map(p => `${p.qty}× ${itemName.get(p.itemId) ?? '…'}`).join(', ')}{b.pieces.length > 3 ? '…' : ''}</p>
              </div>
            </button>
            {b.archived && <button onClick={() => bringBack(b)} className="text-pt-accent text-sm shrink-0">Bring back</button>}
          </div>
        ))}
        <button onClick={() => setShowArchived(v => !v)} className="text-pt-muted text-sm underline">
          {showArchived ? 'Back to current bundles' : 'Show archived bundles'}
        </button>
      </div>
    </div>
  )
}
