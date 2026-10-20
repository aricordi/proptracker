import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { GearArt } from '../components/GearUi'
import { subscribeToGearItems, subscribeToGearBundles, setGearBundleArchived, markGearFound, pieceTotal, type GearItem, type GearBundle } from '../services/gear'

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
  const shown = (bundles ?? []).filter(b => !!b.archived === showArchived)
  const sections = [
    { title: 'Bundles', note: 'Booked whole, never split', list: shown.filter(b => (b.kind ?? 'bundle') === 'bundle') },
    { title: 'Add-on extras', note: 'Creators pick how many', list: shown.filter(b => b.kind === 'extra') },
  ]

  async function bringBack(b: GearBundle) {
    setError(null)
    try { await setGearBundleArchived({ id: b.id, archived: false }) } catch (err) { setError(errText(err)) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <h1 className="font-display text-[34px] text-pt-text flex-1">Bundles</h1>
        <button onClick={() => navigate('/gear/items')} className="text-pt-muted text-sm px-3 py-2 rounded-xl shadow-hairline">All gear</button>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/gear/bundles/new')} className="py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">+ Bundle</button>
          <button onClick={() => navigate('/gear/bundles/new?kind=extra')} className="py-3 rounded-xl border border-pt-accent text-pt-accent font-semibold">+ Add-on extra</button>
        </div>
        <p className="text-pt-muted text-sm">Creators only see what's here, never the loose pieces in All gear.</p>
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {bundles === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {bundles && shown.length === 0 && <p className="text-pt-muted text-sm text-center py-6">{showArchived ? 'Nothing archived.' : 'Nothing offered to creators yet.'}</p>}
        {sections.filter(s => s.list.length).map(s => (
          <div key={s.title} className="space-y-2">
            <p className="text-pt-muted text-xs">{s.title} <span className="normal-case tracking-normal">· {s.note}</span></p>
        {s.list.map(b => (
          <div key={b.id} className="bg-pt-surface shadow-hairline rounded-2xl p-3 flex gap-3">
            <button onClick={() => !b.archived && navigate(`/gear/bundles/${b.id}`)} className="flex gap-3 flex-1 min-w-0 text-left">
              <GearArt photo={b.photos?.[0]} category={b.category} className="w-16 h-16 rounded-xl shrink-0" />
              <div className="min-w-0">
                <p className="text-pt-text font-medium truncate">{b.name}</p>
                {b.kind === 'extra'
                  ? <p className="text-pt-muted text-xs">{pieceTotal(b.pieces)} offered</p>
                  : <>
                      <p className="text-pt-muted text-xs">{b.category} · {pieceTotal(b.pieces)} pieces</p>
                      <p className="text-pt-muted text-xs truncate">{b.pieces.slice(0, 3).map(p => `${p.qty}× ${itemName.get(p.itemId) ?? '…'}`).join(', ')}{b.pieces.length > 3 ? '…' : ''}</p>
                    </>}
              </div>
            </button>
            {b.archived && <button onClick={() => bringBack(b)} className="text-pt-accent text-sm shrink-0 tap">Bring back</button>}
          </div>
        ))}
        {s.list.filter(b => b.missing?.length).map(b => (
          <div key={`${b.id}-missing`} className="bg-amber-500/10 rounded-2xl px-3 py-2 space-y-1">
            <p className="text-amber-200 text-xs font-medium">{b.name}: reported missing</p>
            {b.missing!.map((m, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-pt-text">{m.qty}× {m.name} · {new Date(m.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                <button onClick={async () => { setError(null); try { await markGearFound({ offerId: b.id, index: i }) } catch (err) { setError(errText(err)) } }}
                  className="text-pt-accent text-sm tap">Found it</button>
              </div>
            ))}
          </div>
        ))}
          </div>
        ))}
        <button onClick={() => setShowArchived(v => !v)} className="text-pt-muted text-sm underline">
          {showArchived ? 'Back to current bundles' : 'Show archived bundles'}
        </button>
      </div>
    </div>
  )
}
