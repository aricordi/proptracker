import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ProofPhotos from '../components/ProofPhotos'
import {
  subscribeToGearItems, subscribeToGearBundles, saveGearBundle, setGearBundleArchived,
  bundledCounts, looseCount, bundleProblems, pieceTotal, GEAR_CATEGORIES,
  type GearItem, type GearBundle, type GearCategory, type OfferKind,
} from '../services/gear'
import { friendlyError } from '../lib/errors'

const errText = (e: unknown) => friendlyError(e)

// Gear team: build a bundle (or edit one) from pieces that aren't in another bundle.
export default function GearBundleEditScreen() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [kind, setKind] = useState<OfferKind>(params.get('kind') === 'extra' ? 'extra' : 'bundle')
  const isExtra = kind === 'extra'
  const [items, setItems] = useState<GearItem[] | null>(null)
  const [bundles, setBundles] = useState<GearBundle[] | null>(null)
  const [loaded, setLoaded] = useState(isNew)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<GearCategory>('Camera')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [pick, setPick] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => subscribeToGearItems(setItems), [])
  useEffect(() => subscribeToGearBundles(setBundles), [])

  // Fill the form once when editing.
  useEffect(() => {
    if (isNew || loaded || !bundles) return
    const b = bundles.find(x => x.id === id)
    if (!b) return
    setName(b.name); setKind(b.kind ?? 'bundle'); setCategory(b.category); setDescription(b.description ?? ''); setPhotos(b.photos ?? [])
    setPick(Object.fromEntries(b.pieces.map(p => [p.itemId, p.qty])))
    setLoaded(true)
  }, [bundles, id, isNew, loaded])

  // What's free for THIS bundle: loose pieces plus whatever it already holds.
  const others = useMemo(() => bundledCounts((bundles ?? []).map(b => ({ id: b.id, pieces: b.pieces, archived: b.archived, kind: b.kind })), isNew ? undefined : id), [bundles, id, isNew])
  const stock = (items ?? []).filter(i => !i.archived)
  const freeFor = (i: GearItem) => looseCount({ id: i.id, name: i.name, have: i.have }, others)
  const pieces = Object.entries(pick).filter(([, n]) => n > 0).map(([itemId, qty]) => ({ itemId, qty }))
  const problems = items && bundles ? bundleProblems(pieces, stock.map(i => ({ id: i.id, name: i.name, have: i.have })),
    bundles.map(b => ({ id: b.id, pieces: b.pieces, archived: b.archived, kind: b.kind })), isNew ? undefined : id, kind) : []
  const shown = stock.filter(i => (freeFor(i) > 0 || pick[i.id]) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())))

  function step(i: GearItem, d: number) {
    // An add-on extra is one kind of piece: picking another one replaces it.
    setPick(p => ({ ...(isExtra ? {} : p), [i.id]: Math.max(0, Math.min(freeFor(i), (isExtra && !p[i.id] ? 0 : p[i.id] ?? 0) + d)) }))
    if (isExtra && !name.trim() && d > 0) setName(i.name)
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      await saveGearBundle({ id: isNew ? undefined : id, kind, name, category, description, photos, pieces })
      navigate('/gear/bundles', { replace: true })
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }
  async function archive() {
    if (isNew || !id) return
    setBusy(true); setError(null)
    try { await setGearBundleArchived({ id, archived: true }); navigate('/gear/bundles', { replace: true }) }
    catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  const label = 'text-pt-muted text-[13px]'
  const itemName = new Map(stock.map(i => [i.id, i.name]))
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1" aria-label="Back">‹</button>
        <h1 className="font-display text-xl text-pt-text">{isNew ? (isExtra ? 'Offer an add-on extra' : 'Build a bundle') : (isExtra ? 'Edit add-on extra' : 'Edit bundle')}</h1>
      </div>
      {!loaded ? <p className="text-pt-muted text-sm text-center p-6">Loading…</p> : (
      <div className="px-4 pt-4 pb-8 space-y-6">
        {/* Owner, Oct 21: single pieces are offered from All gear ("Creators can book"), so new add-on extras are no longer offered here. */}
        {isNew && isExtra && (
          <div className="grid grid-cols-2 gap-1 p-1 bg-pt-surface shadow-hairline rounded-xl">
            {([['bundle', 'Bundle'], ['extra', 'Add-on extra']] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setKind(k); setPick({}) }}
                className={`py-2 rounded-lg text-sm font-medium ${kind === k ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>{l}</button>
            ))}
          </div>
        )}
        <p className="text-pt-muted text-sm">
          {isExtra
            ? 'One kind of piece creators can add to their booking, like sandbags or spare batteries. You choose how many to offer; they pick how many they need.'
            : 'A case of pieces creators book as a whole. It can never be split.'}
        </p>
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-3">
          <label className="block space-y-1"><span className={label}>{isExtra ? 'Name creators see' : 'Bundle name'}</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={isExtra ? 'e.g. Sandbag' : 'e.g. Sony FX3 Cinema Bundle'} className={input} /></label>
          <label className="block space-y-1"><span className={label}>Type</span>
            <select value={category} onChange={e => setCategory(e.target.value as GearCategory)} className={input}>
              {GEAR_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select></label>
          <label className="block space-y-1"><span className={label}>Description for creators</span>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional: what it's good for" className={input} /></label>
          <ProofPhotos cameraOnly={false} folder="gear/bundles" urls={photos} onChange={setPhotos} onUploading={setUploading} label={isExtra ? 'Photo' : 'Photo of the case'} hint="Creators see this" max={4} />
        </div>

        <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-1">
          <p className={label}>{isExtra ? `Offered to creators (${pieceTotal(pieces)})` : `In this bundle (${pieceTotal(pieces)} ${pieceTotal(pieces) === 1 ? 'piece' : 'pieces'})`}</p>
          {pieces.length === 0 && <p className="text-pt-muted text-sm">{isExtra ? 'Pick the piece below and how many to offer.' : 'Add pieces from the list below.'}</p>}
          {pieces.map(p => (
            <p key={p.itemId} className="text-pt-text text-sm"><span className="text-pt-accent font-bold tabular-nums">{p.qty}×</span> {itemName.get(p.itemId) ?? 'Unknown piece'}</p>
          ))}
        </div>

        <div className="space-y-2">
          <p className={label}>{isExtra ? 'Choose the piece (only ones not already in a bundle or extra)' : 'Add pieces (only ones not already in another bundle)'}</p>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search gear" className={input} />
          {items && stock.length === 0 && <p className="text-pt-muted text-sm">No gear yet. Add pieces in <button onClick={() => navigate('/gear/items')} className="text-pt-accent">All gear</button> first.</p>}
          {GEAR_CATEGORIES.map(cat => {
            const rows = shown.filter(i => i.category === cat)
            if (!rows.length) return null
            return (
              <div key={cat} className="space-y-2">
                <p className="text-pt-muted text-xs font-semibold">{cat}</p>
                {rows.map(i => {
                  const n = pick[i.id] ?? 0, free = freeFor(i)
                  return (
                    <div key={i.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-pt-text text-sm truncate">{i.name}{i.serial ? <span className="text-pt-muted"> · {i.serial}</span> : null}</p>
                        <p className="text-pt-muted text-xs">{free - n} of {i.have} still free</p>
                      </div>
                      <div className="flex items-center shadow-hairline rounded-lg overflow-hidden shrink-0">
                        <button onClick={() => step(i, -1)} disabled={n === 0} aria-label={`One less ${i.name}`} className="w-9 h-9 bg-pt-surface text-pt-text disabled:opacity-30">−</button>
                        <span className="w-8 text-center text-pt-text tabular-nums font-semibold">{n}</span>
                        <button onClick={() => step(i, 1)} disabled={n >= free} aria-label={`One more ${i.name}`} className="w-9 h-9 bg-pt-surface text-pt-text disabled:opacity-30">+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {(error || (pieces.length > 0 && problems.length > 0)) && (
          <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error ?? problems.join(' ')}</p>
        )}
        <button onClick={save} disabled={busy || uploading || !name.trim() || problems.length > 0}
          className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
          {busy ? 'Saving…' : isNew ? (isExtra ? 'Save add-on extra' : 'Save bundle') : 'Save changes'}
        </button>
        {!isNew && (
          <button onClick={archive} disabled={busy} className="w-full py-2 text-pt-muted text-sm disabled:opacity-40">
            {isExtra ? 'Stop offering this extra (its pieces become free again)' : 'Archive this bundle (its pieces become free again)'}
          </button>
        )}
      </div>
      )}
    </div>
  )
}
