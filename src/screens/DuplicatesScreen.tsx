import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { findDuplicates, comparePropPhotos, mergeProps, type DuplicatePair, type PairVerdict } from '../services/importer'
import { dismissDuplicatePairs, subscribeToLaterPairs, setPairsLater } from '../services/health'
import { groupPairs, isSpread, spreadOf, shelfList, pairKey, type Group } from '../lib/duplicates'
import ImageLightbox from '../components/ImageLightbox'
import type { Item } from '../types'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server."

// Admin → Find duplicates: after the import, go through look-alike groups and merge them.
export default function DuplicatesScreen() {
  const navigate = useNavigate()
  const { isStaff } = useSession()
  const items = useItems()
  const bins = useBins()
  // Archived props (e.g. ones just merged away) are never shown again.
  const byId = useMemo(() => new Map(items.filter(i => !i.archived).map(i => [i.id, i])), [items])
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

  // Once a prop is merged away (or pairs are dismissed), drop those pairs.
  const dropProps = (gone: string[]) => setPairs(p => (p ?? []).filter(x => !gone.includes(x.a) && !gone.includes(x.b)))
  const dropKeys = (keys: string[]) => setPairs(p => (p ?? []).filter(x => !keys.includes(pairKey(x.a, x.b))))

  const groups = useMemo(() => groupPairs((pairs ?? []).filter(p => byId.has(p.a) && byId.has(p.b))), [pairs, byId])
  const isLater = (g: Group) => g.keys.some(k => later.has(k))
  const isSplit = (g: Group) => isSpread(g.ids.map(id => byId.get(id)!))
  const all = groups.filter(g => !isLater(g))
  const laterList = groups.filter(isLater)
  const splitCount = all.filter(isSplit).length
  const live = view === 'later' ? laterList : view === 'split' ? all.filter(isSplit) : all
  // Every look-alike group spread over several bins (incl. ones set aside), as a list for the arts team.
  const moveList = shelfList(groups.filter(isSplit).map(g => g.ids.map(id => byId.get(id)!)), id => binLabel(id) ?? 'unknown bin')
  const [copied, setCopied] = useState(false)

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Find duplicates</h1>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">
          Compares every Prime Capitol prop with every other one and groups the ones that look alike. Free.
          Tap <b>Ask AI</b> on a group to have the AI compare the photos (about $0.001 per photo).
        </p>
        <button onClick={scan} disabled={busy} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Comparing…' : pairs ? 'Check again' : 'Find duplicates'}
        </button>
        {info && <p className="text-pt-muted text-xs">{info}</p>}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {pairs && (
          <div className="flex gap-2 flex-wrap">
            {([['all', `To check (${all.length})`], ['split', `⚠ In different bins (${splitCount})`], ['later', `Later (${laterList.length})`]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-full text-sm ${view === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>{label}</button>
            ))}
          </div>
        )}
        {view === 'split' && moveList && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
            <p className="text-amber-200 text-sm">
              These props are spread over several bins. Send the list to the arts department so they gather each one into a
              single bin; then come back, tap the bin it's in now and merge.
            </p>
            <pre className="text-pt-text text-xs whitespace-pre-wrap max-h-48 overflow-y-auto bg-pt-bg rounded-lg p-2">{moveList}</pre>
            <button onClick={() => { navigator.clipboard?.writeText(moveList).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
              className="w-full py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-semibold">{copied ? 'Copied ✓' : 'Copy list (to text or email the team)'}</button>
          </div>
        )}
        {pairs && live.length === 0 && <p className="text-green-400 text-sm text-center py-4">{view === 'later' ? 'Nothing set aside.' : 'No likely duplicates. 🎉'}</p>}
        {live.map(g => (
          <GroupCard key={g.keys.join(',')} group={g} props={g.ids.map(id => byId.get(id)!)} binLabel={binLabel}
            canMerge={isStaff} later={isLater(g)} onMerged={dropProps} onDismissed={dropKeys} />
        ))}
      </div>
    </div>
  )
}

function GroupCard({ group, props, binLabel, canMerge, later, onMerged, onDismissed }: {
  group: Group; props: Item[]; binLabel: (id?: string) => string | undefined
  canMerge: boolean; later: boolean; onMerged: (gone: string[]) => void; onDismissed: (keys: string[]) => void
}) {
  const navigate = useNavigate()
  // Keep the one with the most photos (then most units) by default. Tap a photo to change it.
  const [keepId, setKeepId] = useState(() =>
    [...props].sort((x, y) => y.photos.length - x.photos.length || y.quantity - x.quantity)[0].id)
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set())   // not the same prop after all
  const [verdicts, setVerdicts] = useState<Record<string, PairVerdict>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)   // full-size photo

  const keeper = props.find(p => p.id === keepId) ?? props[0]
  const included = props.filter(p => !leftOut.has(p.id))
  const others = included.filter(p => p.id !== keeper.id)
  // Different bins: they get moved onto one shelf first, then the team says which bin.
  const binChoices = [...new Set(included.map(p => p.binId).filter((x): x is string => !!x))]
  const spread = spreadOf(included)
  const split = spread.length > 1
  const [bin, setBin] = useState<string | null>(null)
  const chosenBin = bin && binChoices.includes(bin) ? bin : binChoices.length === 1 ? binChoices[0] : null
  const needBin = split && binChoices.length > 1 && !chosenBin
  const totalQty = included.reduce((n, p) => n + p.quantity, 0)

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null)
    try { await fn() } catch (err) { setError(errText(err)) } finally { setBusy(null) }
  }

  function toggleLeftOut(id: string) {
    setLeftOut(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
    if (id === keepId) setKeepId(props.find(p => p.id !== id && !leftOut.has(p.id))?.id ?? keepId)
  }

  async function merge(mode: 'copies' | 'angles') {
    // The server only accepts a bin belonging to one of the two props being merged,
    // so merge the one already in the chosen bin first; after that the kept prop is in it.
    const ordered = [...others].sort((x, y) => Number(y.binId === chosenBin) - Number(x.binId === chosenBin))
    const merged: string[] = []
    try {
      for (const o of ordered) {
        await mergeProps({ keepId: keeper.id, removeId: o.id, mode, ...(chosenBin ? { binId: chosenBin } : {}) })
        merged.push(o.id)
      }
    } finally {
      // If one fails (e.g. it's out on a booking), the ones already merged stay merged.
      if (merged.length) onMerged(merged)
    }
    // Props left out of the merge aren't duplicates of the one kept: don't group them again.
    const notSame = props.filter(p => leftOut.has(p.id)).map(p => pairKey(p.id, keeper.id))
    await dismissDuplicatePairs(notSame)
    if (notSame.length) onDismissed(notSame)
  }

  async function askAi() {
    for (const o of others) {
      if (verdicts[o.id]) continue
      const v = (await comparePropPhotos({ a: keeper.id, b: o.id })).data
      setVerdicts(prev => ({ ...prev, [o.id]: v }))
    }
  }

  const tile = (it: Item) => {
    const isKeeper = it.id === keeper.id, out = leftOut.has(it.id)
    const v = verdicts[it.id]
    return (
      <div key={it.id} className={`min-w-0 rounded-xl border-2 p-1.5 ${out ? 'border-transparent opacity-40' : isKeeper ? 'border-pt-accent' : 'border-transparent'}`}>
        <div className="relative">
          {/* Tap the photo to keep this one. The magnifier shows the whole photo. */}
          <button onClick={() => !out && setKeepId(it.id)} className="block w-full" aria-label="Keep this one">
            {it.photos[0]
              ? <img src={it.photos[0]} alt="" className="w-full aspect-square object-cover rounded-lg bg-pt-bg" />
              : <div className="w-full aspect-square rounded-lg bg-pt-bg" />}
          </button>
          {it.photos[0] && (
            <button onClick={() => setZoom({ src: it.photos[0], alt: it.name })} aria-label="See the whole photo"
              className="absolute top-1 right-1 w-9 h-9 rounded-full bg-black/60 text-white text-base flex items-center justify-center">🔍</button>
          )}
        </div>
        {it.photos.length > 1 && (
          <div className="flex gap-1 mt-1 overflow-x-auto">
            {it.photos.slice(1).map(u => (
              <button key={u} onClick={() => setZoom({ src: u, alt: it.name })} className="shrink-0">
                <img src={u} alt="" className="w-9 h-9 object-cover rounded" />
              </button>
            ))}
          </div>
        )}
        <p className="text-pt-text text-sm font-medium truncate mt-1">{it.name}</p>
        <p className="text-pt-muted text-xs truncate">×{it.quantity} · {binLabel(it.binId) ?? 'no bin'}</p>
        {it.importedFrom?.fileName && <p className="text-pt-muted text-xs truncate" title={`${it.importedFrom.folder} / ${it.importedFrom.fileName}`}>📄 {it.importedFrom.fileName}</p>}
        {v && !isKeeper && <p className={`text-xs ${v.same ? 'text-green-300' : 'text-amber-300'}`}>AI: {v.same ? 'same' : 'different'} ({v.confidence})</p>}
        <p className={`text-xs ${isKeeper && !out ? 'text-pt-accent' : 'text-pt-muted'}`}>{out ? 'Left out' : isKeeper ? '✓ Keep this one' : 'Tap photo to keep'}</p>
        <div className="flex gap-2 mt-0.5">
          <button onClick={() => navigate(`/item/${it.id}`)} className="text-pt-accent text-xs">Open</button>
          {props.length > 2 && <button onClick={() => toggleLeftOut(it.id)} className="text-pt-muted text-xs underline">{out ? 'Put back' : 'Not the same'}</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-pt-muted text-xs">{props.length > 2 ? `${props.length} look-alikes` : `${Math.round(group.score * 100)}% alike`}</span>
        {split && <span className="text-amber-300 text-xs">⚠ different bins</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">{props.map(tile)}</div>

      {others.length > 0 && Object.keys(verdicts).length < others.length && (
        <button onClick={() => run('ai', askAi)} disabled={!!busy}
          className="w-full py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">
          {busy === 'ai' ? 'Asking AI…' : `Ask AI to compare the photos${others.length > 1 ? ` (${others.length})` : ''}`}
        </button>
      )}
      {error && <p className="text-red-300 text-xs">{error}</p>}

      {split && binChoices.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1.5">
          <p className="text-amber-200 text-sm">
            ⚠ Spread over {spread.length} spots ({spread.map(s => `${s.binId ? binLabel(s.binId) ?? '?' : 'no bin'} ×${s.qty}`).join(', ')}).
            Put them all in one bin, then tap the bin they're in now:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {binChoices.map(id => (
              <button key={id} onClick={() => setBin(id)}
                className={`px-3 py-1 rounded-lg text-sm ${chosenBin === id ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg border border-pt-border text-pt-text'}`}>{binLabel(id) ?? 'Unknown bin'}</button>
            ))}
          </div>
        </div>
      )}
      {canMerge && others.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!!busy || needBin} onClick={() => run('copies', () => merge('copies'))}
            className="py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">
            {busy === 'copies' ? 'Merging…' : `Copies: ×${totalQty}`}
          </button>
          <button disabled={!!busy || needBin} onClick={() => run('angles', () => merge('angles'))}
            className="py-2 rounded-xl border border-pt-accent text-pt-accent text-sm font-medium disabled:opacity-40">
            {busy === 'angles' ? 'Merging…' : `Same one: ×${keeper.quantity}`}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={!!busy} onClick={() => run('later', () => setPairsLater(group.keys, !later))}
          className="py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">
          {later ? '↩ Back to the list' : '⏸ Decide later'}
        </button>
        <button disabled={!!busy} onClick={() => run('no', async () => {
          await dismissDuplicatePairs(group.keys); await setPairsLater(group.keys, false); onDismissed(group.keys)
        })}
          className="py-2 rounded-xl text-pt-muted text-sm">{props.length > 2 ? 'None are duplicates' : 'Not duplicates'}</button>
      </div>
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
      {canMerge && <p className="text-pt-muted text-[11px]">
        "Copies" adds up the quantities; "Same one" just adds the extra photos. The others are then removed (archived if they were ever booked).
        {props.length > 2 && ' Tap "Not the same" on any that don\'t belong.'}
      </p>}
    </div>
  )
}
