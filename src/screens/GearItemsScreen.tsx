import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import BottomSheet from '../components/BottomSheet'
import ProofPhotos from '../components/ProofPhotos'
import {
  subscribeToGearItems, subscribeToGearBundles, saveGearItem, bundledCounts, looseCount,
  GEAR_CATEGORIES, type GearItem, type GearBundle, type GearCategory,
} from '../services/gear'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."

// Gear team: every piece of gear the company owns, and how many are in bundles.
export default function GearItemsScreen() {
  const navigate = useNavigate()
  const [items, setItems] = useState<GearItem[] | null>(null)
  const [bundles, setBundles] = useState<GearBundle[]>([])
  const [editing, setEditing] = useState<Partial<GearItem> | null>(null)
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  useEffect(() => subscribeToGearItems(setItems), [])
  useEffect(() => subscribeToGearBundles(setBundles), [])

  const bundled = useMemo(() => bundledCounts(bundles.map(b => ({ id: b.id, pieces: b.pieces, archived: b.archived }))), [bundles])
  const live = (items ?? []).filter(i => showArchived ? i.archived : !i.archived)
    .filter(i => !q.trim() || `${i.name} ${i.serial ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const looseTotal = (items ?? []).reduce((n, i) => n + looseCount({ id: i.id, name: i.name, have: i.have, archived: i.archived }, bundled), 0)

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(-1)} className="text-pt-text py-1" aria-label="Back">‹</button>
          <h1 className="font-display text-xl text-pt-text flex-1">All gear</h1>
          <button onClick={() => setEditing({ category: 'Camera', have: 1 })} className="text-pt-accent text-sm font-medium tap">+ Add gear</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search gear"
          className="w-full bg-pt-surface border border-pt-border rounded-xl px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent" />
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <p className="text-pt-muted text-sm">
          Every piece of gear you own. Creators can't book pieces on their own: put them into a <button onClick={() => navigate('/gear/bundles')} className="text-pt-accent">bundle</button>.
        </p>
        {looseTotal > 0 && !showArchived && (
          <p className="text-sky-200 text-sm bg-sky-500/10 border border-sky-500/30 rounded-xl px-3 py-2">
            {looseTotal} piece{looseTotal === 1 ? ' isn\'t' : 's aren\'t'} in any bundle yet, so creators can't book {looseTotal === 1 ? 'it' : 'them'}.
          </p>
        )}
        {items === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {items?.length === 0 && <p className="text-pt-muted text-sm text-center py-6">No gear yet. Tap "+ Add gear" to add the first piece.</p>}
        {GEAR_CATEGORIES.map(cat => {
          const rows = live.filter(i => i.category === cat)
          if (!rows.length) return null
          return (
            <div key={cat} className="space-y-2">
              <p className="text-pt-muted text-xs uppercase tracking-wider">{cat}</p>
              {rows.map(i => {
                const inB = bundled.get(i.id) ?? 0
                const loose = looseCount({ id: i.id, name: i.name, have: i.have, archived: i.archived }, bundled)
                return (
                  <button key={i.id} onClick={() => setEditing(i)}
                    className="w-full flex items-center gap-3 bg-pt-surface shadow-hairline rounded-xl px-3 py-2 text-left active:opacity-75">
                    <div className="w-10 h-10 rounded-lg bg-pt-bg overflow-hidden shrink-0">
                      {i.photos?.[0] && <img loading="lazy" decoding="async" src={i.photos[0]} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-pt-text text-sm truncate">{i.name}</p>
                      <p className="text-pt-muted text-xs truncate">
                        {i.serial ? `Serial ${i.serial} · ` : ''}{inB ? `${inB} in bundles` : 'Not in a bundle'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-pt-text font-semibold tabular-nums">{i.have}</p>
                      {loose > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{loose} loose</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
        <button onClick={() => setShowArchived(v => !v)} className="text-pt-muted text-sm underline">
          {showArchived ? 'Back to current gear' : 'Show archived gear'}
        </button>
      </div>
      {editing && <ItemSheet item={editing} inBundles={editing.id ? bundled.get(editing.id) ?? 0 : 0} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ItemSheet({ item, inBundles, onClose }: { item: Partial<GearItem>; inBundles: number; onClose: () => void }) {
  const [name, setName] = useState(item.name ?? '')
  const [category, setCategory] = useState<GearCategory>(item.category ?? 'Camera')
  const [have, setHave] = useState(String(item.have ?? 1))
  const [serial, setSerial] = useState(item.serial ?? '')
  const [value, setValue] = useState(item.value != null ? String(item.value) : '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [photos, setPhotos] = useState<string[]>(item.photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(archived = item.archived === true) {
    setBusy(true); setError(null)
    try {
      await saveGearItem({
        id: item.id, name, category, have: serial.trim() ? 1 : Number(have), serial: serial.trim() || null,
        value: value.trim() === '' ? null : Number(value), notes, photos, archived,
      })
      onClose()
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  const label = 'text-pt-muted text-xs uppercase tracking-wider'
  return (
    <BottomSheet open onClose={onClose} title={item.id ? 'Edit gear' : 'Add gear'}>
      <div className="space-y-3">
        <label className="block space-y-1"><span className={label}>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. NP-FZ100 battery" className={input} autoFocus={!item.id} /></label>
        <label className="block space-y-1"><span className={label}>Type</span>
          <select value={category} onChange={e => setCategory(e.target.value as GearCategory)} className={input}>
            {['Camera', 'Lens', 'Lighting', 'Audio', 'Drones', 'Power', 'Grip', 'Monitors', 'Other'].map(c => <option key={c}>{c}</option>)}
          </select></label>
        <div className="flex gap-2">
          <label className="block space-y-1 w-28"><span className={label}>How many</span>
            <input type="number" min={0} value={serial.trim() ? '1' : have} disabled={!!serial.trim()} onChange={e => setHave(e.target.value)} className={input} /></label>
          <label className="block space-y-1 flex-1"><span className={label}>Serial number</span>
            <input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Cameras & drones (optional)" className={input} /></label>
        </div>
        {inBundles > 0 && <p className="text-pt-muted text-xs">{inBundles} of these {inBundles === 1 ? 'is' : 'are'} in bundles.</p>}
        <label className="block space-y-1"><span className={label}>Replacement value ($, staff only)</span>
          <input type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="Optional" className={input} /></label>
        <label className="block space-y-1"><span className={label}>Notes</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className={input} /></label>
        <ProofPhotos cameraOnly={false} folder="gear/items" urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo (optional)" max={3} />
        {error && <p className="text-red-300 text-sm">{error}</p>}
        <button onClick={() => save()} disabled={busy || uploading || !name.trim()}
          className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">{busy ? 'Saving…' : 'Save'}</button>
        {item.id && (
          <button onClick={() => save(!item.archived)} disabled={busy}
            className="w-full py-2 text-pt-muted text-sm disabled:opacity-40">{item.archived ? 'Bring it back' : 'Archive (we no longer have it)'}</button>
        )}
      </div>
    </BottomSheet>
  )
}
