import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import {
  subscribeToImportJob, subscribeToImportItems, approveImports, skipImports, binKey,
  type ImportJob, type ImportItem, type ImportStatus, type Approval,
} from '../services/importer'
import { useCategories } from '../hooks/useCategories'
import { useBins } from '../hooks/useBins'
import type { Bin, Category } from '../types'

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

  useEffect(() => subscribeToImportJob(jobId, setJob), [jobId])
  useEffect(() => { setItems(null); return subscribeToImportItems(jobId, tab, max, setItems) }, [jobId, tab, max])

  const draftOf = (it: ImportItem) => drafts[it.id] ?? draftFrom(it, bins)
  const edit = (it: ImportItem, patch: Partial<Draft>) => setDrafts(d => ({ ...d, [it.id]: { ...draftOf(it), ...patch } }))
  const newBinLabels = useMemo(() => [...new Set((items ?? []).map(it => draftOf(it).bin).filter(b => b.startsWith('new:')))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, drafts, bins])

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
      setError(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server.")
    } finally {
      setBusy(b => new Set([...b].filter(x => !ids.includes(x))))
    }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-2.5 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent'
  const shown = items ?? []
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate('/import')} className="text-pt-text py-1">‹</button>
          <h1 className="font-display text-xl text-pt-text">Review import</h1>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map(t => {
            const n = job?.counts?.[t.key as keyof ImportJob['counts']] ?? 0
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setMax(PAGE) }}
                className={`shrink-0 px-3 py-1 rounded-full text-sm ${tab === t.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>
                {t.label} ({n})
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {job === null && <p className="text-pt-muted text-sm">Import not found.</p>}
        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}
        {items === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {items?.length === 0 && <p className="text-pt-muted text-sm text-center py-6">Nothing here.</p>}

        {tab === 'analyzed' && shown.length > 1 && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-3 space-y-2">
            <p className="text-pt-muted text-sm">Checked the {shown.length} below? Approve them all at once (with any edits you made).</p>
            {newBinLabels.length > 0 && <p className="text-amber-300 text-xs">This creates new bins: {newBinLabels.map(b => b.slice(4)).join(', ')}.</p>}
            <button onClick={() => act(shown.map(i => i.id), 'approve')} disabled={busy.size > 0}
              className="w-full py-2.5 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">Approve all {shown.length}</button>
          </div>
        )}

        {shown.map(it => {
          const d = draftOf(it)
          const working = busy.has(it.id)
          return (
            <div key={it.id} className={`bg-pt-surface border border-pt-border rounded-2xl overflow-hidden ${working ? 'opacity-50' : ''}`}>
              <div className="flex gap-3 p-3">
                {it.photoUrl
                  ? <a href={it.photoUrl} target="_blank" rel="noreferrer" className="shrink-0"><img src={it.photoUrl} alt="" className="w-28 h-28 object-cover rounded-xl bg-pt-bg" /></a>
                  : <div className="w-28 h-28 rounded-xl bg-pt-bg shrink-0" />}
                <div className="min-w-0 flex-1 space-y-1.5">
                  {tab === 'analyzed' ? (
                    <>
                      <input value={d.name} onChange={e => edit(it, { name: e.target.value })} aria-label="Name" className={`${input} font-medium`} />
                      <select value={d.categoryId} onChange={e => edit(it, { categoryId: e.target.value })} aria-label="Category" className={input}>
                        {categories.filter((c: Category) => c.active || c.id === d.categoryId).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <div className="flex gap-1.5">
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
                      {it.itemId && <button onClick={() => navigate(`/item/${it.itemId}`)} className="text-pt-accent text-sm">Open prop ›</button>}
                    </>
                  )}
                  <p className="text-pt-muted text-[11px] truncate">{it.folder} / {it.fileName}</p>
                </div>
              </div>
              {tab === 'analyzed' && (
                <div className="px-3 pb-3 space-y-1.5">
                  <input value={d.tags} onChange={e => edit(it, { tags: e.target.value })} aria-label="Tags" placeholder="tags, comma, separated" className={input} />
                  <input value={d.description} onChange={e => edit(it, { description: e.target.value })} aria-label="Description" placeholder="Description" className={input} />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => act([it.id], 'skip')} disabled={working} className="py-2 rounded-xl border border-pt-border text-pt-muted text-sm">Skip</button>
                    <button onClick={() => act([it.id], 'approve')} disabled={working || !d.name.trim()} className="py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">Approve</button>
                  </div>
                </div>
              )}
              {tab === 'failed' && (
                <div className="px-3 pb-3"><button onClick={() => act([it.id], 'skip')} disabled={working} className="w-full py-2 rounded-xl border border-pt-border text-pt-muted text-sm">Skip this photo</button></div>
              )}
            </div>
          )
        })}

        {shown.length >= max && <button onClick={() => setMax(m => m + PAGE)} className="w-full py-2.5 text-pt-accent text-sm">Show more</button>}
        {tab === 'failed' && shown.length > 0 && <p className="text-pt-muted text-xs">To retry failed photos, go back and tap "Try failed again".</p>}
      </div>
    </div>
  )
}
