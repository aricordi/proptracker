import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { useLocations } from '../hooks/useLocations'
import { findDuplicates, comparePropPhotos, mergeProps, type DuplicatePair, type PairVerdict } from '../services/importer'
import {
  dismissDuplicatePairs, subscribeToLaterPairs, setPairsLater,
  subscribeToGatherGroups, addGatherGroup, removeGatherGroup, type GatherGroup,
} from '../services/health'
import { groupPairs, spreadOf, isSpread, shelfList, pairKey, crossKeys, insideKeys, type Group } from '../lib/duplicates'
import ImageLightbox from '../components/ImageLightbox'
import type { Item } from '../types'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server."

// Admin → Find duplicates. Look-alikes are shown in groups; staff tick the ones that are
// really the same prop and merge them (same bin) or flag them "to gather" (different bins).
// The rest are released: they stay candidates with every other prop, just not with these.
export default function DuplicatesScreen() {
  const navigate = useNavigate()
  const { isStaff } = useSession()
  const items = useItems()
  const bins = useBins()
  // Archived props (e.g. ones just merged away) are never shown again.
  const byId = useMemo(() => new Map(items.filter(i => !i.archived).map(i => [i.id, i])), [items])
  const locations = useLocations()
  const binLabel = (id?: string) => bins.find(b => b.id === id)?.label
  // "A1 (Main room)": the bin and the storage area it's in.
  const binWhere = (id: string) => {
    const b = bins.find(x => x.id === id)
    const area = b?.locationId ? locations.find(l => l.id === b.locationId)?.name : undefined
    return b ? (area ? `${b.label} (${area})` : b.label) : 'unknown bin'
  }
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'check' | 'gather' | 'later'>('check')
  const [later, setLater] = useState<Set<string>>(new Set())
  const [gather, setGather] = useState<GatherGroup[]>([])
  const [copied, setCopied] = useState(false)
  useEffect(() => subscribeToLaterPairs(setLater), [])
  useEffect(() => subscribeToGatherGroups(setGather), [])

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

  // Confirmed "same prop, different bins" groups (props still around).
  const gatherLive = gather.map(g => ({ ...g, ids: g.ids.filter(id => byId.has(id)) })).filter(g => g.ids.length > 1)
  const confirmed = useMemo(() => new Set(gatherLive.flatMap(g => insideKeys(g.ids))), [gatherLive])
  const groups = useMemo(() => groupPairs((pairs ?? [])
    .filter(p => byId.has(p.a) && byId.has(p.b) && !confirmed.has(pairKey(p.a, p.b)))), [pairs, byId, confirmed])
  const isLater = (g: Group) => g.keys.some(k => later.has(k))
  const toCheck = groups.filter(g => !isLater(g))
  const laterList = groups.filter(isLater)
  const gatherProps = gatherLive.map(g => g.ids.map(id => byId.get(id)!)).filter(isSpread)
  const moveList = shelfList(gatherProps, binWhere)
  async function sendList() {
    try {
      if (navigator.share) { await navigator.share({ title: 'Props to gather', text: moveList }); return }
    } catch { /* closed the share sheet: fall back to copying */ }
    await navigator.clipboard?.writeText(moveList)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Find duplicates</h1>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">
          Groups the Prime Capitol props that look alike. In each group, <b>tap the photos of the ones that are the same prop</b>,
          then merge them or flag them to be gathered into one bin. The others are released and can still match other props.
        </p>
        <button onClick={scan} disabled={busy} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Comparing…' : pairs ? 'Check again' : 'Find duplicates'}
        </button>
        {info && <p className="text-pt-muted text-xs">{info}</p>}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        <div className="flex gap-2 flex-wrap">
          {([
            ['check', pairs ? `To check (${toCheck.length})` : 'To check'],
            ['gather', `📦 To gather (${gatherLive.length})`],
            ['later', pairs ? `Later (${laterList.length})` : 'Later'],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-full text-sm ${view === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>{label}</button>
          ))}
        </div>

        {view === 'gather' && (gatherProps.length ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-3">
            <div>
              <p className="text-amber-200 font-medium">📦 {gatherProps.length} prop{gatherProps.length === 1 ? '' : 's'} to gather</p>
              <p className="text-pt-muted text-xs">Each one is split between bins. Ask the arts department to put all copies of each prop in one bin.</p>
            </div>
            <ul className="space-y-2">
              {gatherProps.map(props => (
                <li key={props.map(p => p.id).join()} className="flex gap-3 bg-pt-surface rounded-xl p-2">
                  <div className="w-14 h-14 rounded-lg bg-pt-bg overflow-hidden shrink-0">
                    {props[0].photos[0] && <img src={props[0].photos[0]} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-pt-text text-sm font-medium truncate">{props[0].name}</p>
                    {spreadOf(props).map(sp => (
                      <p key={sp.binId ?? 'none'} className="text-pt-muted text-xs">
                        <span className="text-pt-text font-medium">{sp.qty}</span> in {sp.binId ? binWhere(sp.binId) : 'no bin yet'}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <button onClick={sendList} className="w-full py-2.5 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold">
              {copied ? 'Copied ✓ Paste it in a text or email' : 'Send this list to the team'}
            </button>
            <p className="text-pt-muted text-xs">When they're done, tap the bin each prop is in now on its card below, then "Copies".</p>
          </div>
        ) : !gatherLive.length && <p className="text-pt-muted text-sm text-center py-4">Nothing to gather. When you confirm look-alikes are the same prop but in different bins, they show up here.</p>)}

        {view === 'gather' && gatherLive.map(g => (
          <GroupCard key={g.id} mode="gather" gatherId={g.id} ids={g.ids} keys={insideKeys(g.ids)} props={g.ids.map(id => byId.get(id)!)}
            binLabel={binLabel} canMerge={isStaff} later={false} onMerged={dropProps} onDismissed={dropKeys} />
        ))}

        {view !== 'gather' && !pairs && <p className="text-pt-muted text-sm text-center py-4">Tap "Find duplicates" to load the groups.</p>}
        {view !== 'gather' && pairs && (view === 'later' ? laterList : toCheck).length === 0 && (
          <p className="text-green-400 text-sm text-center py-4">{view === 'later' ? 'Nothing set aside.' : 'No likely duplicates. 🎉'}</p>
        )}
        {view !== 'gather' && (view === 'later' ? laterList : toCheck).map(g => (
          <GroupCard key={g.keys.join(',')} mode="check" ids={g.ids} keys={g.keys} score={g.score} props={g.ids.map(id => byId.get(id)!)}
            binLabel={binLabel} canMerge={isStaff} later={isLater(g)} onMerged={dropProps} onDismissed={dropKeys} />
        ))}
      </div>
    </div>
  )
}

function GroupCard({ mode, gatherId, ids, keys, score, props, binLabel, canMerge, later, onMerged, onDismissed }: {
  mode: 'check' | 'gather'; gatherId?: string; ids: string[]; keys: string[]; score?: number; props: Item[]
  binLabel: (id?: string) => string | undefined; canMerge: boolean; later: boolean
  onMerged: (gone: string[]) => void; onDismissed: (keys: string[]) => void
}) {
  const navigate = useNavigate()
  // Which ones are the same prop: tap photos to tick. A confirmed "to gather" group starts all ticked.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mode === 'gather' ? ids : []))
  const [keepId, setKeepId] = useState<string | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, PairVerdict>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)   // full-size photo
  const [bin, setBin] = useState<string | null>(null)

  const chosen = props.filter(p => selected.has(p.id))
  const released = props.filter(p => !selected.has(p.id))
  // The one kept: picked with ★, else the ticked one with the most photos (then units).
  const best = [...chosen].sort((x, y) => y.photos.length - x.photos.length || y.quantity - x.quantity)[0]
  const keeper = chosen.find(p => p.id === keepId) ?? best
  const others = chosen.filter(p => p.id !== keeper?.id)
  const spread = spreadOf(chosen)
  const split = spread.length > 1
  const binChoices = [...new Set(chosen.map(p => p.binId).filter((x): x is string => !!x))]
  const chosenBin = bin && binChoices.includes(bin) ? bin : binChoices.length === 1 ? binChoices[0] : null
  const needBin = split && binChoices.length > 1 && !chosenBin
  const totalQty = chosen.reduce((n, p) => n + p.quantity, 0)
  const ready = chosen.length >= 2

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null)
    try { await fn() } catch (err) { setError(errText(err)) } finally { setBusy(null) }
  }

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  // The unticked ones aren't the same prop as the ticked ones: remember only THAT, so
  // they can still be matched with each other and with any other prop.
  async function releaseRest() {
    const keysOut = crossKeys(chosen.map(p => p.id), released.map(p => p.id))
    await dismissDuplicatePairs(keysOut)
    await setPairsLater(keysOut, false)
    if (keysOut.length) onDismissed(keysOut)
  }

  async function merge(kind: 'copies' | 'angles') {
    if (!keeper) return
    // The server only accepts a bin belonging to one of the two props being merged,
    // so merge the one already in the chosen bin first; after that the kept prop is in it.
    const ordered = [...others].sort((x, y) => Number(y.binId === chosenBin) - Number(x.binId === chosenBin))
    const merged: string[] = []
    try {
      for (const o of ordered) {
        await mergeProps({ keepId: keeper.id, removeId: o.id, mode: kind, ...(chosenBin ? { binId: chosenBin } : {}) })
        merged.push(o.id)
      }
    } finally {
      // If one fails (e.g. it's out on a booking), the ones already merged stay merged.
      if (merged.length) onMerged(merged)
    }
    await releaseRest()
    if (gatherId) await removeGatherGroup(gatherId)
  }

  async function flagToGather() {
    await addGatherGroup(chosen.map(p => p.id))
    await setPairsLater(insideKeys(chosen.map(p => p.id)), false)
    await releaseRest()
  }

  async function askAi() {
    const ref = keeper ?? props[0]
    for (const o of props) {
      if (o.id === ref.id || verdicts[o.id]) continue
      const v = (await comparePropPhotos({ a: ref.id, b: o.id })).data
      setVerdicts(prev => ({ ...prev, [o.id]: v }))
    }
  }

  const tile = (it: Item) => {
    const on = selected.has(it.id), isKeeper = on && it.id === keeper?.id
    const v = verdicts[it.id]
    return (
      <div key={it.id} className={`min-w-0 rounded-xl border-2 p-1.5 ${on ? 'border-pt-accent bg-pt-accent/5' : 'border-transparent'}`}>
        <div className="relative">
          {/* Tap the photo to tick it as "the same prop". The magnifier shows the whole photo. */}
          <button onClick={() => toggle(it.id)} className="block w-full" aria-label={on ? 'Untick' : 'Tick as the same prop'}>
            {it.photos[0]
              ? <img src={it.photos[0]} alt="" className="w-full aspect-square object-cover rounded-lg bg-pt-bg" />
              : <div className="w-full aspect-square rounded-lg bg-pt-bg" />}
          </button>
          {on && <span className="absolute top-1 left-1 w-8 h-8 rounded-full bg-pt-accent text-stone-900 font-bold flex items-center justify-center pointer-events-none">✓</span>}
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
        {v && <p className={`text-xs ${v.same ? 'text-green-300' : 'text-amber-300'}`}>AI: {v.same ? 'same' : 'different'} ({v.confidence})</p>}
        <div className="flex gap-2 mt-0.5 items-center">
          <button onClick={() => navigate(`/item/${it.id}`)} className="text-pt-accent text-xs">Open</button>
          {on && chosen.length > 1 && (isKeeper
            ? <span className="text-pt-accent text-xs">★ Kept</span>
            : <button onClick={() => setKeepId(it.id)} className="text-pt-muted text-xs underline">Keep this one</button>)}
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-pt-surface border rounded-2xl p-3 space-y-2 ${mode === 'gather' ? 'border-amber-500/40' : 'border-pt-border'}`}>
      <div className="flex items-center justify-between">
        <span className="text-pt-muted text-xs">
          {mode === 'gather' ? '📦 Same prop, different bins' : props.length > 2 ? `${props.length} look-alikes` : `${Math.round((score ?? 0) * 100)}% alike`}
        </span>
        <span className="text-pt-muted text-xs">{chosen.length ? `${chosen.length} ticked` : 'Tap the ones that are the same'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">{props.map(tile)}</div>

      {props.length > 1 && Object.keys(verdicts).length < props.length - 1 && (
        <button onClick={() => run('ai', askAi)} disabled={!!busy}
          className="w-full py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">
          {busy === 'ai' ? 'Asking AI…' : `Ask AI to compare the photos (${props.length - 1})`}
        </button>
      )}
      {error && <p className="text-red-300 text-xs">{error}</p>}

      {ready && split && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1.5">
          <p className="text-amber-200 text-sm">
            ⚠ The ticked ones are spread over {spread.length} spots ({spread.map(s => `${s.binId ? binLabel(s.binId) ?? '?' : 'no bin'} ×${s.qty}`).join(', ')}).
            {mode === 'check' ? ' Flag them to be gathered into one bin, or if they\'re already together, tap the bin they\'re in now:' : ' Once they\'re all in one bin, tap it:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {binChoices.map(id => (
              <button key={id} onClick={() => setBin(id)}
                className={`px-3 py-1 rounded-lg text-sm ${chosenBin === id ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg border border-pt-border text-pt-text'}`}>{binLabel(id) ?? 'Unknown bin'}</button>
            ))}
          </div>
          {mode === 'check' && canMerge && (
            <button disabled={!!busy} onClick={() => run('flag', flagToGather)}
              className="w-full py-2 rounded-lg bg-amber-400 text-stone-900 text-sm font-semibold disabled:opacity-40">
              {busy === 'flag' ? 'Flagging…' : `📦 Flag ${chosen.length} to gather into one bin`}
            </button>
          )}
        </div>
      )}

      {canMerge && ready && (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!!busy || needBin} onClick={() => run('copies', () => merge('copies'))}
            className="py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">
            {busy === 'copies' ? 'Merging…' : `Copies: ×${totalQty}`}
          </button>
          <button disabled={!!busy || needBin} onClick={() => run('angles', () => merge('angles'))}
            className="py-2 rounded-xl border border-pt-accent text-pt-accent text-sm font-medium disabled:opacity-40">
            {busy === 'angles' ? 'Merging…' : `Same one: ×${keeper?.quantity ?? 1}`}
          </button>
        </div>
      )}
      {ready && released.length > 0 && (
        <p className="text-pt-muted text-[11px]">The {released.length} not ticked will be released: they stay in the search for duplicates, just not with these.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {mode === 'check' ? (
          <>
            <button disabled={!!busy} onClick={() => run('later', () => setPairsLater(keys, !later))}
              className="py-2 rounded-xl border border-pt-border text-pt-text text-sm disabled:opacity-40">
              {later ? '↩ Back to the list' : '⏸ Decide later'}
            </button>
            <button disabled={!!busy} onClick={() => run('no', async () => {
              await dismissDuplicatePairs(keys); await setPairsLater(keys, false); onDismissed(keys)
            })} className="py-2 rounded-xl text-pt-muted text-sm">{props.length > 2 ? 'None are duplicates' : 'Not duplicates'}</button>
          </>
        ) : (
          <button disabled={!!busy} onClick={() => run('unflag', () => removeGatherGroup(gatherId!))}
            className="col-span-2 py-2 rounded-xl text-pt-muted text-sm">Unflag (back to "To check")</button>
        )}
      </div>
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
      {canMerge && ready && <p className="text-pt-muted text-[11px]">
        "Copies" adds up the quantities; "Same one" just adds the extra photos. The others are then removed (archived if they were ever booked).
      </p>}
    </div>
  )
}
