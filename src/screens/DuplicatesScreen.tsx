import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { findDuplicates, comparePropPhotos, mergeProps, type DuplicatePair, type PairVerdict } from '../services/importer'
import { dismissDuplicatePair, subscribeToLaterPairs, setPairLater, pairKey } from '../services/health'
import ImageLightbox from '../components/ImageLightbox'
import type { Item } from '../types'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server."

// Admin → Find duplicates: after the import, go through look-alike pairs and merge them.
export default function DuplicatesScreen() {
  const navigate = useNavigate()
  const { isStaff } = useSession()
  const items = useItems()
  const bins = useBins()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const binLabel = (id?: string) => bins.find(b => b.id === id)?.label
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'all' | 'split' | 'later'>('all')
  const [later, setLater] = useState<Set<string>>(new Set())
  useEffect(() => subscribeToLaterPairs(setLater), [])

  async function scan() {
    setBusy(true); setError(null)
    try {
      const r = (await findDuplicates({})).data
      setPairs(r.pairs)
      setInfo(`Checked ${r.checked} props${r.withoutFingerprint ? ` (${r.withoutFingerprint} still being indexed; check again in a minute)` : ''}.`)
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  // Once a prop is merged away, drop every pair that mentions it.
  const done = (gone: string[]) => setPairs(p => (p ?? []).filter(x => !gone.includes(x.a) && !gone.includes(x.b)))
  const found = (pairs ?? []).filter(p => byId.has(p.a) && byId.has(p.b))
  const isLater = (p: DuplicatePair) => later.has(pairKey(p.a, p.b))
  const isSplit = (p: DuplicatePair) => (byId.get(p.a)!.binId ?? '') !== (byId.get(p.b)!.binId ?? '')
  const all = found.filter(p => !isLater(p))
  const laterList = found.filter(isLater)
  const splitCount = all.filter(isSplit).length
  const live = view === 'later' ? laterList : view === 'split' ? all.filter(isSplit) : all

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Find duplicates</h1>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">
          Compares every Prime Capitol prop with every other one and lists the pairs that look most alike. Free.
          Tap <b>Ask AI</b> on a pair to have the AI compare the two photos (about $0.001).
        </p>
        <button onClick={scan} disabled={busy} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Comparing…' : pairs ? 'Check again' : 'Find duplicates'}
        </button>
        {info && <p className="text-pt-muted text-xs">{info}</p>}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {pairs && (
          <div className="flex gap-2 flex-wrap">
            {([['all', `To check (${all.length})`], ['split', `In different bins (${splitCount})`], ['later', `Later (${laterList.length})`]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-full text-sm ${view === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>{label}</button>
            ))}
          </div>
        )}
        {pairs && live.length === 0 && <p className="text-green-400 text-sm text-center py-4">{view === 'later' ? 'Nothing set aside.' : 'No likely duplicates. 🎉'}</p>}
        {live.map(p => (
          <PairCard key={`${p.a}|${p.b}`} pair={p} a={byId.get(p.a)!} b={byId.get(p.b)!} binLabel={binLabel}
            canMerge={isStaff} later={isLater(p)} onDone={done} onDismissed={() => setPairs(ps => (ps ?? []).filter(x => x !== p))} />
        ))}
      </div>
    </div>
  )
}

function PairCard({ pair, a, b, binLabel, canMerge, later, onDone, onDismissed }: {
  pair: DuplicatePair; a: Item; b: Item; binLabel: (id?: string) => string | undefined
  canMerge: boolean; later: boolean; onDone: (gone: string[]) => void; onDismissed: () => void
}) {
  const navigate = useNavigate()
  // Keep the one with more photos (or more units) by default.
  const [keep, setKeep] = useState<'a' | 'b'>(() => (b.photos.length > a.photos.length || b.quantity > a.quantity) ? 'b' : 'a')
  const [verdict, setVerdict] = useState<PairVerdict | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)   // full-size photo
  const kept = keep === 'a' ? a : b, other = keep === 'a' ? b : a
  // Different bins: they get moved onto one shelf first, then the team says which bin.
  const split = (a.binId ?? '') !== (b.binId ?? '')
  const binChoices = [...new Set([a.binId, b.binId].filter((x): x is string => !!x))]
  const [bin, setBin] = useState<string | null>(binChoices.length === 1 ? binChoices[0] : null)
  const needBin = split && binChoices.length > 1 && !bin

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null)
    try { await fn() } catch (err) { setError(errText(err)) } finally { setBusy(null) }
  }

  // The whole photo (not cropped); tap it to see it full screen and zoom. Extra photos underneath.
  const tile = (it: Item, side: 'a' | 'b') => (
    <div className={`flex-1 min-w-0 rounded-xl border-2 p-1.5 ${keep === side ? 'border-pt-accent' : 'border-transparent'}`}>
      {it.photos[0]
        ? <button onClick={() => setZoom({ src: it.photos[0], alt: it.name })} className="block w-full" aria-label="See the whole photo">
            <img src={it.photos[0]} alt="" className="w-full aspect-square object-contain rounded-lg bg-black" />
          </button>
        : <div className="w-full aspect-square rounded-lg bg-pt-bg" />}
      {it.photos.length > 1 && (
        <div className="flex gap-1 mt-1 overflow-x-auto">
          {it.photos.slice(1).map(u => (
            <button key={u} onClick={() => setZoom({ src: u, alt: it.name })} className="shrink-0">
              <img src={u} alt="" className="w-10 h-10 object-cover rounded" />
            </button>
          ))}
        </div>
      )}
      <button onClick={() => setKeep(side)} className="block w-full text-left">
      <p className="text-pt-text text-sm font-medium truncate mt-1">{it.name}</p>
      <p className="text-pt-muted text-xs truncate">×{it.quantity} · {it.photos.length} photo{it.photos.length === 1 ? '' : 's'}{binLabel(it.binId) ? ` · ${binLabel(it.binId)}` : ''}</p>
      {it.importedFrom?.fileName && <p className="text-pt-muted text-xs truncate" title={`${it.importedFrom.folder} / ${it.importedFrom.fileName}`}>📄 {it.importedFrom.fileName}</p>}
      <p className={`text-xs ${keep === side ? 'text-pt-accent' : 'text-pt-muted'}`}>{keep === side ? '✓ Keep this one' : 'Tap here to keep this one'}</p>
      </button>
    </div>
  )

  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-pt-muted text-xs">{Math.round(pair.score * 100)}% alike</span>
        <span className="flex gap-3">
          <button onClick={() => navigate(`/item/${a.id}`)} className="text-pt-accent text-xs">Open left</button>
          <button onClick={() => navigate(`/item/${b.id}`)} className="text-pt-accent text-xs">Open right</button>
        </span>
      </div>
      <div className="flex gap-2">{tile(a, 'a')}{tile(b, 'b')}</div>

      {verdict ? (
        <p className={`text-sm rounded-lg px-3 py-2 ${verdict.same ? 'bg-green-500/10 text-green-300' : 'bg-pt-bg text-pt-muted'}`}>
          AI: {verdict.same ? 'same prop' : 'different props'} ({verdict.confidence} confidence). {verdict.reason}
        </p>
      ) : (
        <button onClick={() => run('ai', async () => setVerdict((await comparePropPhotos({ a: a.id, b: b.id })).data))} disabled={!!busy}
          className="w-full py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">{busy === 'ai' ? 'Asking AI…' : 'Ask AI to compare the photos'}</button>
      )}
      {error && <p className="text-red-300 text-xs">{error}</p>}

      {split && binChoices.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1.5">
          <p className="text-amber-200 text-sm">⚠ In different bins: {binLabel(a.binId) ?? 'no bin'} and {binLabel(b.binId) ?? 'no bin'}. Put them together on the shelf, then tap the bin they're in now:</p>
          <div className="flex flex-wrap gap-1.5">
            {binChoices.map(id => (
              <button key={id} onClick={() => setBin(id)}
                className={`px-3 py-1 rounded-lg text-sm ${bin === id ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg border border-pt-border text-pt-text'}`}>{binLabel(id) ?? 'Unknown bin'}</button>
            ))}
          </div>
        </div>
      )}
      {canMerge && (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!!busy || needBin} onClick={() => run('copies', async () => { await mergeProps({ keepId: kept.id, removeId: other.id, mode: 'copies', ...(bin ? { binId: bin } : {}) }); onDone([other.id]) })}
            className="py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">
            {busy === 'copies' ? 'Merging…' : `Copies: ×${kept.quantity + other.quantity}`}
          </button>
          <button disabled={!!busy || needBin} onClick={() => run('angles', async () => { await mergeProps({ keepId: kept.id, removeId: other.id, mode: 'angles', ...(bin ? { binId: bin } : {}) }); onDone([other.id]) })}
            className="py-2 rounded-xl border border-pt-accent text-pt-accent text-sm font-medium disabled:opacity-40">
            {busy === 'angles' ? 'Merging…' : `Same one: ×${kept.quantity}`}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={!!busy} onClick={() => run('later', () => setPairLater(a.id, b.id, !later))}
          className="py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">
          {later ? '↩ Back to the list' : '⏸ Decide later'}
        </button>
        <button disabled={!!busy} onClick={() => run('no', async () => { await dismissDuplicatePair(a.id, b.id); await setPairLater(a.id, b.id, false); onDismissed() })}
          className="py-2 rounded-xl text-pt-muted text-sm">Not duplicates</button>
      </div>
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
      {canMerge && <p className="text-pt-muted text-[11px]">"Copies" adds up the quantities; "Same one" just adds the extra photos. The other prop is then removed (archived if it was ever booked).</p>}
    </div>
  )
}
