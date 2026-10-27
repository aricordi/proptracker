import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  subscribeToImportJob, subscribeToImportItems, approveImports, skipImports, mergeImports, binKey,
  type ImportJob, type ImportItem, type ImportStatus, type Approval,
} from '../services/importer'
import { useCategories } from '../hooks/useCategories'
import { useBins } from '../hooks/useBins'
import { useItems } from '../hooks/useItems'
import BottomSheet from '../components/BottomSheet'
import type { Bin, Category, Item } from '../types'
import { thumbOf } from '../services/itemShape'
import { friendlyError } from '../lib/errors'

const PAGE = 20
const TABS: { key: ImportStatus; label: string }[] = [
  { key: 'analyzed', label: 'To review' }, { key: 'failed', label: 'Failed' },
  { key: 'approved', label: 'Approved' }, { key: 'skipped', label: 'Skipped' },
]

// What's on screen for one photo; starts as the AI's suggestion.
interface Draft { name: string; categoryId: string; tags: string; description: string; quantity: number; bin: string }  // bin: binId | 'new:Label' | 'none'

function draftFrom(it: ImportItem, bins: Bin[]): Draft {
  const s = it.suggestion
  const match = s?.binLabel ? bins.find(b => binKey(b.label) === binKey(s.binLabel!)) : undefined
  return {
    name: s?.name ?? '', categoryId: s?.categoryId ?? 'prop', tags: (s?.tags ?? []).join(', '), description: s?.description ?? '',
    quantity: s?.quantity ?? 1, bin: match ? match.id : s?.binLabel ? `new:${s.binLabel}` : 'none',
  }
}

function approvalFrom(id: string, d: Draft): Approval {
  return {
    id, name: d.name.trim(), categoryId: d.categoryId, description: d.description.trim(), quantity: d.quantity,
    tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
    ...(d.bin === 'none' ? { binId: null } : d.bin.startsWith('new:') ? { newBinLabel: d.bin.slice(4) } : { binId: d.bin }),
  }
}

// Photos the AI named the same and placed in the same bin are probably the same prop.
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const lookKey = (d: Draft) => `${normName(d.name)}|${d.bin}`
const words = (s: string) => new Set(normName(s).split(' ').filter(w => w.length > 2))

export default function ImportReviewScreen() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const categories = useCategories()
  const bins = useBins()
  const [job, setJob] = useState<ImportJob | null | undefined>(undefined)
  const [tab, setTab] = useState<ImportStatus>('analyzed')
  const [max, setMax] = useState(PAGE)
  const [items, setItems] = useState<ImportItem[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<'merge' | 'existing' | null>(null)
  const allItems = useItems()

  useEffect(() => subscribeToImportJob(jobId, setJob), [jobId])
  useEffect(() => { setItems(null); return subscribeToImportItems(jobId, tab, max, setItems) }, [jobId, tab, max])

  const draftOf = (it: ImportItem) => drafts[it.id] ?? draftFrom(it, bins)
  const edit = (it: ImportItem, patch: Partial<Draft>) => setDrafts(d => ({ ...d, [it.id]: { ...draftOf(it), ...patch } }))
  const newBinLabels = useMemo(() => [...new Set((items ?? []).map(it => draftOf(it).bin).filter(b => b.startsWith('new:')))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, drafts, bins])

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Look-alike groups among the photos on screen (2 or more with the same name and bin).
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    if (tab === 'analyzed') for (const it of items ?? []) { const k = lookKey(draftOf(it)); m.set(k, [...(m.get(k) ?? []), it.id]) }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, drafts, bins, tab])
  useEffect(() => { setSelected(new Set()) }, [tab, jobId])
  const approvedGroups = useMemo(() => {
    const m = new Map<string, ImportItem[]>()
    if (tab === 'approved') for (const it of items ?? []) { const k = it.itemId ?? it.id; m.set(k, [...(m.get(k) ?? []), it]) }
    return [...m.entries()]
  }, [items, tab])

  async function merge(args: { item?: Approval; addToItemId?: string; addQuantity?: number }) {
    const ids = (items ?? []).filter(it => selected.has(it.id)).map(it => it.id)
    setError(null)
    setBusy(b => new Set([...b, ...ids]))
    try {
      const { id: _drop, ...item } = args.item ?? { id: '' }
      await mergeImports({ ids, ...(args.item ? { item } : {}), ...(args.addToItemId ? { addToItemId: args.addToItemId, addQuantity: args.addQuantity ?? 0 } : {}) })
      setSelected(new Set()); setSheet(null)
    } catch (err) {
      setError(friendlyError(err, "Couldn't reach the server."))
      setSheet(null)
    } finally {
      setBusy(b => new Set([...b].filter(x => !ids.includes(x))))
    }
  }

  async function act(ids: string[], what: 'approve' | 'skip') {
    setError(null)
    setBusy(b => new Set([...b, ...ids]))
    try {
      if (what === 'skip') await skipImports({ ids })
      else {
        const byId = new Map((items ?? []).map(it => [it.id, it]))
        const r = await approveImports({ items: ids.map(id => approvalFrom(id, draftOf(byId.get(id)!))) })
        const failed = r.data.results.filter(x => x.error)
        if (failed.length) setError(`${failed.length} couldn't be approved: ${failed[0].error}`)
      }
    } catch (err) {
      setError(friendlyError(err, "Couldn't reach the server."))
    } finally {
      setBusy(b => new Set([...b].filter(x => !ids.includes(x))))
    }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-2.5 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent'
  const shown = items ?? []
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate('/import')} className="text-pt-text py-1">‹</button>
          <h1 className="font-display text-xl text-pt-text">Review import</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map(t => {
            const n = job?.counts?.[t.key as keyof ImportJob['counts']] ?? 0
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setMax(PAGE) }}
                className={`shrink-0 px-3 py-1 rounded-full text-sm ${tab === t.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
                {t.label} ({n})
              </button>
            )
          })}
        </div>
        {selected.size > 0 && (
          <div className="mt-2 flex items-center gap-2 bg-pt-surface border border-pt-accent/50 rounded-xl px-3 py-2">
            <span className="text-pt-text text-sm flex-1">{selected.size} selected</span>
            {selected.size > 1 && <button onClick={() => setSheet('merge')} className="px-3 py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-semibold">Merge into one</button>}
            <button onClick={() => setSheet('existing')} className="px-3 py-2 rounded-lg shadow-hairline text-pt-text text-sm">Add to existing…</button>
            <button onClick={() => setSelected(new Set())} aria-label="Clear selection" className="text-pt-muted px-1">✕</button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {job === null && <p className="text-pt-muted text-sm">Import not found.</p>}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {items === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {items?.length === 0 && <p className="text-pt-muted text-sm text-center py-6">Nothing here.</p>}

        {tab === 'analyzed' && shown.length > 1 && (
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2">
            <p className="text-pt-muted text-sm">Checked the {shown.length} below? Approve them all at once (with any edits you made).</p>
            {newBinLabels.length > 0 && <p className="text-amber-300 text-xs">This creates new bins: {newBinLabels.map(b => b.slice(4)).join(', ')}.</p>}
            <button onClick={() => act(shown.map(i => i.id), 'approve')} disabled={busy.size > 0}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Approve all {shown.length}</button>
          </div>
        )}

        {/* Approved: one entry per prop (several photos can have been merged into one). */}
        {tab === 'approved' && approvedGroups.map(([itemId, its]) => {
          const prop = allItems.find(i => i.id === itemId)
          return (
            <div key={itemId} className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {its.map(it => <img loading="lazy" decoding="async" key={it.id} src={it.photoUrl} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0 bg-pt-bg" />)}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-pt-text text-sm font-medium truncate">{prop?.name ?? its[0].suggestion?.name ?? its[0].fileName}</p>
                  <p className="text-pt-muted text-xs">{prop ? `×${prop.quantity}` : 'Deleted or merged into another prop'}{its.length > 1 ? ` · from ${its.length} photos` : ''}</p>
                </div>
                {prop && <button onClick={() => navigate(`/item/${itemId}`)} className="text-pt-accent text-sm shrink-0 tap">Open prop ›</button>}
              </div>
            </div>
          )
        })}

        {tab !== 'approved' && shown.map(it => {
          const d = draftOf(it)
          const working = busy.has(it.id)
          return (
            <div key={it.id} className={`bg-pt-surface shadow-hairline rounded-2xl overflow-hidden ${working ? 'opacity-50' : ''}`}>
              <div className="flex gap-3 p-3">
                <div className="relative shrink-0">
                  {it.photoUrl
                    ? <a href={it.photoUrl} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={it.photoUrl} alt="" className="w-28 h-28 object-cover rounded-xl bg-pt-bg" /></a>
                    : <div className="w-28 h-28 rounded-xl bg-pt-bg" />}
                  {tab === 'analyzed' && (
                    <button onClick={() => toggle(it.id)} aria-label="Select" aria-pressed={selected.has(it.id)}
                      className={`absolute top-1.5 left-1.5 w-7 h-7 rounded-lg border-2 flex items-center justify-center text-sm font-bold ${selected.has(it.id) ? 'bg-pt-accent border-pt-accent text-stone-900' : 'bg-black/50 border-white/80 text-transparent'}`}>✓</button>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {tab === 'analyzed' ? (
                    <>
                      <input value={d.name} onChange={e => edit(it, { name: e.target.value })} aria-label="Name" className={`${input} font-medium`} />
                      <select value={d.categoryId} onChange={e => edit(it, { categoryId: e.target.value })} aria-label="Category" className={input}>
                        {categories.filter((c: Category) => c.active || c.id === d.categoryId).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <select value={d.bin} onChange={e => edit(it, { bin: e.target.value })} aria-label="Bin" className={`${input} flex-1 min-w-0`}>
                          <option value="none">No bin</option>
                          {/* suggested-but-unknown bins from other photos on this page, so they can be reused */}
                          {newBinLabels.filter(b => b !== d.bin).map(b => <option key={b} value={b}>New: {b.slice(4)}</option>)}
                          {d.bin.startsWith('new:') && <option value={d.bin}>New: {d.bin.slice(4)}</option>}
                          {bins.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                        </select>
                        <input type="number" min={1} value={d.quantity} onChange={e => edit(it, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                          aria-label="Quantity" title="How many" className="w-14 shrink-0 bg-pt-bg border border-pt-border rounded-lg px-1 py-2 text-pt-text text-sm text-center focus:outline-none focus:border-pt-accent" />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-pt-text text-sm font-medium">{it.suggestion?.name ?? it.fileName}</p>
                      {it.error && <p className="text-red-300 text-xs">{it.error}</p>}
                      {it.itemId && <button onClick={() => navigate(`/item/${it.itemId}`)} className="text-pt-accent text-sm tap">Open prop ›</button>}
                    </>
                  )}
                  {tab === 'analyzed' && (groups.get(lookKey(d))?.length ?? 0) > 1 && (
                    <button onClick={() => setSelected(s => new Set([...s, ...groups.get(lookKey(d))!]))}
                      className="text-amber-300 text-xs">⧉ {groups.get(lookKey(d))!.length} look-alikes · select them</button>
                  )}
                  <p className="text-pt-muted text-xs truncate">{it.folder} / {it.fileName}</p>
                </div>
              </div>
              {tab === 'analyzed' && (
                <div className="px-3 pb-3 space-y-2">
                  <input value={d.tags} onChange={e => edit(it, { tags: e.target.value })} aria-label="Tags" placeholder="tags, comma, separated" className={input} />
                  <input value={d.description} onChange={e => edit(it, { description: e.target.value })} aria-label="Description" placeholder="Description" className={input} />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => act([it.id], 'skip')} disabled={working} className="py-2 rounded-xl shadow-hairline text-pt-muted text-sm">Skip</button>
                    <button onClick={() => act([it.id], 'approve')} disabled={working || !d.name.trim()} className="py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">Approve</button>
                  </div>
                </div>
              )}
              {tab === 'failed' && (
                <div className="px-3 pb-3"><button onClick={() => act([it.id], 'skip')} disabled={working} className="w-full py-2 rounded-xl shadow-hairline text-pt-muted text-sm">Skip this photo</button></div>
              )}
            </div>
          )
        })}

        {shown.length >= max && <button onClick={() => setMax(m => m + PAGE)} className="w-full py-3 text-pt-accent text-sm">Show more</button>}
        {tab === 'failed' && shown.length > 0 && <p className="text-pt-muted text-xs">To retry failed photos, go back and tap "Try failed again".</p>}
      </div>

      {sheet && (
        <MergeSheet
          mode={sheet}
          picked={shown.filter(it => selected.has(it.id)).map(it => ({ it, d: draftOf(it) }))}
          props={allItems.filter(i => i.collection === 'company' && !i.archived)}
          busy={busy.size > 0}
          onClose={() => setSheet(null)}
          onMerge={merge}
        />
      )}
    </div>
  )
}

// Several photos → one prop: a new one, or added to one already in the app.
function MergeSheet({ mode, picked, props, busy, onClose, onMerge }: {
  mode: 'merge' | 'existing'
  picked: { it: ImportItem; d: Draft }[]
  props: Item[]
  busy: boolean
  onClose: () => void
  onMerge: (args: { item?: Approval; addToItemId?: string; addQuantity?: number }) => void
}) {
  const first = picked[0]
  const units = picked.reduce((n, p) => n + (p.d.quantity || 1), 0)
  const [kind, setKind] = useState<'copies' | 'angles'>('copies')
  const [qty, setQty] = useState(units)
  const [name, setName] = useState(first?.d.name ?? '')
  const [query, setQuery] = useState(first?.d.name ?? '')
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => { setQty(kind === 'copies' ? units : mode === 'merge' ? 1 : 0) }, [kind, units, mode])

  const candidates = useMemo(() => {
    const q = words(query)
    return props
      .map(p => ({ p, score: [...words(p.name)].filter(w => q.has(w)).length + (normName(p.name).includes(normName(query)) && query.trim() ? 2 : 0) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
      .slice(0, 8)
  }, [props, query])
  if (!first) return null

  const choice = (k: 'copies' | 'angles', title: string, detail: string) => (
    <button onClick={() => setKind(k)} className={`w-full text-left rounded-xl border px-3 py-2 ${kind === k ? 'border-pt-accent bg-pt-accent/10' : 'border-pt-border'}`}>
      <p className="text-pt-text text-sm font-medium">{title}</p>
      <p className="text-pt-muted text-xs">{detail}</p>
    </button>
  )
  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent'

  return (
    <BottomSheet open onClose={onClose} title={mode === 'merge' ? `Merge ${picked.length} photos into one prop` : `Add ${picked.length} photo${picked.length > 1 ? 's' : ''} to a prop`}>
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {picked.map(p => <img loading="lazy" decoding="async" key={p.it.id} src={p.it.photoUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-pt-bg" />)}
        </div>
        {mode === 'merge'
          ? <>
              {choice('copies', 'Identical copies', 'Each photo is another one of the same prop (e.g. 3 matching chairs).')}
              {choice('angles', 'Same prop, more angles', 'One prop, photographed more than once. Extra photos are added to it.')}
            </>
          : <>
              {choice('copies', 'More copies of it', 'These are extra units of a prop already in the app.')}
              {choice('angles', 'More photos of it', 'Just extra photos; how many there are stays the same.')}
            </>}
        <label className="flex items-center justify-between gap-3">
          <span className="text-pt-text text-sm">{mode === 'merge' ? 'How many in total' : 'Units to add'}</span>
          <input type="number" min={mode === 'merge' ? 1 : 0} value={qty} onChange={e => setQty(Math.max(mode === 'merge' ? 1 : 0, Math.floor(Number(e.target.value) || 0)))}
            className="w-20 bg-pt-bg shadow-hairline rounded-lg px-2 py-2 text-pt-text text-center" />
        </label>

        {mode === 'merge' ? (
          <>
            <label className="block space-y-1">
              <span className="text-pt-muted text-xs">Name</span>
              <input value={name} onChange={e => setName(e.target.value)} className={input} />
            </label>
            <p className="text-pt-muted text-xs">Category, bin, tags and description come from the first photo; you can edit the prop afterwards.</p>
            <button disabled={busy || !name.trim()} onClick={() => onMerge({ item: approvalFrom(first.it.id, { ...first.d, name, quantity: qty }) })}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
              {busy ? 'Saving…' : `Create one prop (${qty})`}
            </button>
          </>
        ) : (
          <>
            <input value={query} onChange={e => { setQuery(e.target.value); setTarget(null) }} placeholder="Search props already in the app" className={input} />
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {candidates.length === 0 && <p className="text-pt-muted text-sm">No matching props. Try another word.</p>}
              {candidates.map(({ p }) => (
                <button key={p.id} onClick={() => setTarget(p.id)}
                  className={`w-full flex items-center gap-2 text-left rounded-xl border px-2 py-2 ${target === p.id ? 'border-pt-accent bg-pt-accent/10' : 'border-pt-border'}`}>
                  {p.photos[0] ? <img loading="lazy" decoding="async" src={thumbOf(p, p.photos[0])} alt="" className="w-10 h-10 rounded-lg object-cover bg-pt-bg" /> : <div className="w-10 h-10 rounded-lg bg-pt-bg" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-pt-text text-sm truncate">{p.name}</span>
                    <span className="block text-pt-muted text-xs">×{p.quantity} · {p.photos.length} photo{p.photos.length === 1 ? '' : 's'}</span>
                  </span>
                </button>
              ))}
            </div>
            <button disabled={busy || !target} onClick={() => onMerge({ addToItemId: target!, addQuantity: qty })}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
              {busy ? 'Saving…' : target ? `Add to "${props.find(p => p.id === target)?.name}"${qty ? ` (+${qty})` : ''}` : 'Pick a prop above'}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
