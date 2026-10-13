import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { FirebaseError } from 'firebase/app'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useCharacters } from '../hooks/useCharacters'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { mergeTags, deleteUnusedTags } from '../services/tags'
import { subscribeToDismissedPairs, dismissDuplicatePair, pairKey, getAllInternalNotes } from '../services/health'
import { rebuildSearchIndex, improveSearchWords, makeMissingThumbs } from '../services/ai'
import {
  findDuplicateTags, planTagMerge, tagUsage, unusedTags,
  findDuplicateProps, emptyBins, emptyLocations, type TagGroup,
} from '../lib/maintenance'
import { DUPLICATE_NAME_SIMILARITY } from '../config'
import { formatMoney } from '../components/ItemCard'
import type { AiUsageRecord, Item } from '../types'
import { thumbOf } from '../services/itemShape'

export default function HealthScreen() {
  const navigate   = useNavigate()
  const { isOwner } = useSession()
  const allItems   = useItems()
  const items      = useMemo(() => allItems.filter(i => !i.archived), [allItems])
  const tags       = useTags()
  const characters = useCharacters()
  const locations  = useLocations()
  const bins       = useBins()
  const categories = useCategories()

  const [aiUsage, setAiUsage] = useState<AiUsageRecord | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7)
    getDoc(doc(db, 'ai_usage', month))
      .then(d => { if (d.exists()) setAiUsage({ id: d.id, ...d.data() } as AiUsageRecord) })
      .catch(() => {})
  }, [])
  useEffect(() => subscribeToDismissedPairs(setDismissed), [])

  const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map(x => [x.id, x]))
  const tagById       = useMemo(() => byId(tags), [tags])
  const characterById = useMemo(() => byId(characters), [characters])
  const locationById  = useMemo(() => byId(locations), [locations])
  const binById       = useMemo(() => byId(bins), [bins])
  const categoryById  = useMemo(() => byId(categories), [categories])

  // ── Inventory counts
  const counts = useMemo(() => {
    const perCategory: Record<string, number> = {}
    for (const i of items) perCategory[i.categoryId] = (perCategory[i.categoryId] ?? 0) + 1
    return {
      perCategory,
      units:       items.reduce((n, i) => n + i.quantity, 0),
      checkedOut:  items.filter(i => i.status === 'checked-out').length,
      archived:    allItems.length - items.length,
      totalValue:  items.reduce((n, i) => n + (i.replacementCost ?? 0) * i.quantity, 0),
    }
  }, [items, allItems])

  // ── Fix-it list
  const fixit = useMemo(() => [
    { key: 'photo',    title: 'No photo',             list: items.filter(i => i.photos.length === 0) },
    { key: 'tags',     title: 'No tags',              list: items.filter(i => i.tags.length === 0) },
    { key: 'location', title: 'No bin or storage area', list: items.filter(i => !i.locationId && !i.binId) },
    { key: 'cost',     title: 'No replacement cost',  list: items.filter(i => i.replacementCost == null) },
    { key: 'damaged',  title: 'Damaged',              list: items.filter(i => i.condition === 'damaged'), danger: true },
    { key: 'missing',  title: 'Missing after a return', list: items.filter(i => (i.missingQty ?? 0) > 0), danger: true },
  ], [items])
  const fixitTotal = fixit.reduce((n, g) => n + g.list.length, 0)

  // ── Duplicates and tidy-up
  const tagGroups   = useMemo(() => findDuplicateTags(tags, allItems), [tags, allItems])
  const dupProps    = useMemo(
    () => findDuplicateProps(allItems, DUPLICATE_NAME_SIMILARITY).filter(p => !dismissed.has(pairKey(p.a.id, p.b.id))),
    [allItems, dismissed],
  )
  const noTagProps  = useMemo(() => unusedTags(tags, allItems), [tags, allItems])
  const binsEmpty   = useMemo(() => emptyBins(bins, allItems), [bins, allItems])
  const locsEmpty   = useMemo(() => emptyLocations(locations, bins, allItems), [locations, bins, allItems])

  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const internal = await getAllInternalNotes().catch(() => ({} as Record<string, string>))
      const header = ['name', 'category', 'quantity', 'condition', 'status', 'storage area', 'bin', 'tags', 'characters',
        'description', 'notes for creators', 'internal notes', 'replacement cost (CAD)', 'where to rebuy', 'photos', 'archived', 'added']
      const rows = allItems.map(item => [
        item.name,
        categoryById[item.categoryId]?.label ?? item.categoryId,
        item.quantity,
        item.condition,
        item.status,
        item.locationId ? (locationById[item.locationId]?.name ?? '') : '',
        item.binId ? (binById[item.binId]?.label ?? '') : '',
        item.tags.map(id => tagById[id]?.label ?? id).join('; '),
        (item.characters ?? []).map(id => characterById[id]?.label ?? id).join('; ') || (item.character ?? ''),
        item.description ?? '',
        item.notes ?? '',
        internal[item.id] ?? '',
        item.replacementCost != null ? String(item.replacementCost) : '',
        item.whereToRebuy ?? '',
        item.photos.join(' '),
        item.archived ? 'yes' : '',
        item.createdAt,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

      const csv = '﻿' + [header.join(','), ...rows].join('\n') // BOM so Excel reads accents correctly
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `proptracker-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const monthLabel = new Date().toLocaleString('en-CA', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <BackButton onClick={() => navigate(-1)} />
        <h1 className="font-display text-xl text-pt-text">Health</h1>
      </div>

      <div className="p-4 space-y-4">

        {/* Inventory */}
        <Card title="Inventory">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-bold text-pt-text">{items.length}</span>
            <span className="text-pt-muted text-sm">props</span>
            {counts.units !== items.length && <span className="text-pt-muted text-sm">· {counts.units} units</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {categories.filter(c => c.active || counts.perCategory[c.id]).map(c => (
              <Stat key={c.id} value={counts.perCategory[c.id] ?? 0} label={c.label} />
            ))}
            <Stat value={counts.checkedOut} label="Checked out" />
            <Stat value={counts.archived} label="Archived" />
          </div>
          {counts.totalValue > 0 && (
            <p className="text-pt-muted text-sm">
              Total replacement value: <span className="text-pt-text">{formatMoney(counts.totalValue)}</span>
              <span className="text-xs"> (props with a cost entered)</span>
            </p>
          )}
        </Card>

        {/* Fix-it list */}
        <Card title="Fix-it list" badge={fixitTotal === 0 ? <Good>All good ✓</Good> : <Warn>{fixitTotal} to fix</Warn>}>
          {fixitTotal === 0 && <p className="text-pt-muted text-sm">Every prop has a photo, tags, a storage spot and a replacement cost.</p>}
          {fixit.filter(g => g.list.length > 0).map(g => (
            <ItemGroup key={g.key} title={`${g.title}: ${g.list.length}`} items={g.list} danger={g.danger}
              onTap={id => navigate(g.key === 'damaged' || g.key === 'missing' ? `/item/${id}` : `/item/${id}/edit`)} />
          ))}
        </Card>

        {/* Duplicate tags */}
        <Card title="Look-alike tags" badge={tagGroups.length === 0 ? <Good>None ✓</Good> : <Warn>{tagGroups.length}</Warn>}>
          {tagGroups.length === 0
            ? <p className="text-pt-muted text-sm">No near-duplicate tags.</p>
            : <>
                <p className="text-pt-muted text-sm">Tap the spelling to keep, then merge. Every prop using the others switches to it.</p>
                {tagGroups.map(g => <TagMerge key={g.tags.map(t => t.id).join()} group={g} allItems={allItems} />)}
              </>}
        </Card>

        {/* Duplicate props */}
        <Card title="Possible duplicate props" badge={dupProps.length === 0 ? <Good>None ✓</Good> : <Warn>{dupProps.length}</Warn>}>
          {dupProps.length === 0
            ? <p className="text-pt-muted text-sm">No props with near-identical names.</p>
            : <>
                <p className="text-pt-muted text-sm">These names look almost the same. If one was entered twice, open it and archive it.</p>
                {dupProps.slice(0, 20).map(p => (
                  <div key={pairKey(p.a.id, p.b.id)} className="bg-pt-bg rounded-xl p-2 space-y-1">
                    {[p.a, p.b].map(i => <ItemRow key={i.id} item={i} onTap={() => navigate(`/item/${i.id}`)} />)}
                    <button onClick={() => dismissDuplicatePair(p.a.id, p.b.id)} className="w-full text-pt-muted text-xs py-1.5 active:opacity-70">
                      Not duplicates, hide this pair
                    </button>
                  </div>
                ))}
                {dupProps.length > 20 && <p className="text-pt-muted text-xs">Showing the 20 closest of {dupProps.length}.</p>}
              </>}
        </Card>

        {/* Tidy up */}
        <Card title="Tidy up">
          <Tidy title="Empty storage areas" names={locsEmpty.map(l => l.name)} action="Open storage" onAction={() => navigate('/locations')} />
          <Tidy title="Empty bins" names={binsEmpty.map(b => b.label)} action="Open bins" onAction={() => navigate('/bins')} />
          <UnusedTags names={noTagProps.map(t => t.label)} ids={noTagProps.map(t => t.id)} />
        </Card>

        {/* AI usage */}
        <Card title={`AI usage · ${monthLabel}`}>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={aiUsage?.photoAnalyses ?? 0} label="Photos analyzed" />
            <Stat value={aiUsage?.smartSearches ?? 0} label="Smart searches" />
            <Stat value={aiUsage?.indexUpdates ?? 0} label="Search index updates" />
          </div>
          <p className="text-pt-muted text-xs">Each costs a fraction of a cent. Expect well under $2/month at your size.</p>
          {isOwner && <RebuildIndex />}
          {isOwner && <ImproveSearchWords />}
          {isOwner && <SpeedUpPhotos />}
        </Card>

        {/* Export */}
        <Card title="Export">
          <p className="text-pt-muted text-sm">Every prop as a spreadsheet (opens in Excel or Google Sheets), including archived props and internal notes.</p>
          <button onClick={handleExport} disabled={allItems.length === 0 || exporting}
            className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold text-sm active:opacity-80 disabled:opacity-40">
            {exporting ? 'Preparing…' : `Download spreadsheet (${allItems.length} props)`}
          </button>
        </Card>
      </div>
    </div>
  )
}

// ─── Small building blocks ───────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Back" className="text-pt-text active:text-pt-muted py-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
      </svg>
    </button>
  )
}

function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-pt-muted text-xs uppercase tracking-wider">{title}</p>
        {badge}
      </div>
      {children}
    </div>
  )
}

const Good = ({ children }: { children: ReactNode }) => <span className="text-green-400 text-xs font-medium">{children}</span>
const Warn = ({ children }: { children: ReactNode }) => <span className="text-amber-400 text-xs font-medium">{children}</span>

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-pt-bg rounded-xl px-3 py-2">
      <p className="text-pt-text font-semibold text-lg">{value}</p>
      <p className="text-pt-muted text-xs">{label}</p>
    </div>
  )
}

function ItemRow({ item, onTap }: { item: Item; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left active:opacity-70">
      <div className="w-9 h-9 rounded-lg bg-pt-border overflow-hidden shrink-0">
        {item.photos[0] && <img src={thumbOf(item, item.photos[0])} alt="" className="w-full h-full object-cover" loading="lazy" />}
      </div>
      <span className="text-pt-text text-sm truncate flex-1">{item.name}</span>
      {item.archived && <span className="text-pt-muted text-xs">archived</span>}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

function ItemGroup({ title, items, onTap, danger }: { title: string; items: Item[]; onTap: (id: string) => void; danger?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, 3)
  return (
    <div>
      <p className={`text-sm font-medium mb-1 ${danger ? 'text-red-400' : 'text-pt-text'}`}>{title}</p>
      <div className="bg-pt-bg rounded-xl p-1">
        {shown.map(i => <ItemRow key={i.id} item={i} onTap={() => onTap(i.id)} />)}
      </div>
      {items.length > 3 && (
        <button type="button" onClick={() => setExpanded(v => !v)} className="mt-1.5 text-pt-accent text-xs active:opacity-70">
          {expanded ? 'Show less' : `Show ${items.length - 3} more`}
        </button>
      )}
    </div>
  )
}

function TagMerge({ group, allItems }: { group: TagGroup; allItems: Item[] }) {
  const [keepId, setKeepId] = useState(group.tags[0].id)
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle')
  const keep = group.tags.find(t => t.id === keepId)!
  const others = group.tags.filter(t => t.id !== keepId)

  async function merge() {
    setState('busy')
    try {
      const plan = planTagMerge(keepId, others.map(t => t.id), allItems)
      const after = allItems.map(i => plan.find(p => p.itemId === i.id) ? { ...i, tags: plan.find(p => p.itemId === i.id)!.tags } : i)
      await mergeTags(keepId, others.map(t => t.id), plan, tagUsage(after)[keepId] ?? 0)
    } catch {
      setState('error')
    }
  }

  return (
    <div className="bg-pt-bg rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {group.tags.map(t => (
          <button key={t.id} onClick={() => { setKeepId(t.id); setState('idle') }}
            className={`text-sm px-3 py-1 rounded-full ${t.id === keepId ? 'bg-violet-500 text-white' : 'bg-violet-500/20 text-violet-300'}`}>
            {t.label} <span className="opacity-70">· {group.usage[t.id] ?? 0}</span>
          </button>
        ))}
      </div>
      {state === 'confirm' ? (
        <div className="flex gap-2">
          <button onClick={() => setState('idle')} className="flex-1 py-2 rounded-lg border border-pt-border text-pt-muted text-sm">Cancel</button>
          <button onClick={merge} className="flex-1 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium">
            Yes, merge into "{keep.label}"
          </button>
        </div>
      ) : (
        <button onClick={() => setState('confirm')} disabled={state === 'busy'}
          className="w-full py-2 rounded-lg bg-pt-surface border border-pt-border text-pt-text text-sm active:opacity-70 disabled:opacity-40">
          {state === 'busy' ? 'Merging…' : `Merge ${others.map(t => `"${t.label}"`).join(', ')} into "${keep.label}"`}
        </button>
      )}
      {state === 'error' && <p className="text-red-400 text-xs">Merge didn't finish. Check your connection and try again; nothing is lost.</p>}
    </div>
  )
}

function Tidy({ title, names, action, onAction }: { title: string; names: string[]; action: string; onAction: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-pt-text text-sm font-medium">{title}: {names.length}</p>
        {names.length > 0 && <p className="text-pt-muted text-xs truncate">{names.slice(0, 6).join(', ')}{names.length > 6 ? '…' : ''}</p>}
      </div>
      {names.length > 0 && <button onClick={onAction} className="text-pt-accent text-xs shrink-0 py-1 active:opacity-70">{action}</button>}
    </div>
  )
}

function UnusedTags({ names, ids }: { names: string[]; ids: string[] }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle')
  async function remove() {
    setState('busy')
    try { await deleteUnusedTags(ids); setState('idle') } catch { setState('error') }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-pt-text text-sm font-medium">Unused tags: {names.length}</p>
          {names.length > 0 && <p className="text-pt-muted text-xs truncate">{names.slice(0, 8).join(', ')}{names.length > 8 ? '…' : ''}</p>}
        </div>
        {names.length > 0 && state === 'idle' && (
          <button onClick={() => setState('confirm')} className="text-pt-accent text-xs shrink-0 py-1 active:opacity-70">Remove</button>
        )}
      </div>
      {state === 'confirm' && (
        <div className="flex gap-2">
          <button onClick={() => setState('idle')} className="flex-1 py-2 rounded-lg border border-pt-border text-pt-muted text-sm">Cancel</button>
          <button onClick={remove} className="flex-1 py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-medium">Remove {names.length} unused</button>
        </div>
      )}
      {state === 'busy' && <p className="text-pt-muted text-xs">Removing…</p>}
      {state === 'error' && <p className="text-red-400 text-xs">Couldn't remove them. Try again.</p>}
    </div>
  )
}

function RebuildIndex() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<string>('')
  async function run() {
    setState('busy')
    try {
      const r = await rebuildSearchIndex()
      setResult(`${r.updated} updated, ${r.unchanged} already up to date${r.failed ? `, ${r.failed} failed (run again)` : ''}.`)
      setState('done')
    } catch {
      setState('error')
    }
  }
  return (
    <div className="pt-1 space-y-1">
      <button onClick={run} disabled={state === 'busy'}
        className="w-full py-2.5 rounded-xl bg-pt-bg border border-pt-border text-pt-text text-sm font-medium active:opacity-70 disabled:opacity-40">
        {state === 'busy' ? 'Rebuilding… (can take a few minutes)' : 'Rebuild smart search'}
      </button>
      <p className="text-pt-muted text-xs">
        {state === 'done' ? result
          : state === 'error' ? "Didn't finish. It's safe to run again."
          : 'Owner only. Run once after the update goes live so existing props show up in "Similar" results. Safe to repeat.'}
      </p>
    </div>
  )
}

// Owner: the AI writes hidden extra search words for props that don't have them
// yet (a Lincoln mask → "president"). Runs in rounds while this screen is open.
function ImproveSearchWords() {
  const [counts, setCounts] = useState<{ total: number; remaining: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const stop = useRef(false)
  useEffect(() => { improveSearchWords({ countOnly: true }).then(r => setCounts(r.data)).catch(() => setCounts(null)) }, [])
  useEffect(() => () => { stop.current = true }, [])

  async function run() {
    stop.current = false; setRunning(true); setMessage('')
    let failed = 0, stalls = 0
    try {
      while (!stop.current) {
        const r = (await improveSearchWords({})).data
        failed += r.failed
        setCounts({ total: r.total, remaining: r.remaining })
        if (r.capped) { setMessage('Stopped: the AI spending cap was reached. Raise it on Admin → Import to continue.'); break }
        if (r.slowDown) {
          if (++stalls >= 6) { setMessage('Google keeps asking us to slow down. Tap the button again later; nothing is lost.'); break }
          setMessage('Google asked us to slow down. Waiting 30 seconds…')
          for (let i = 0; i < 30 && !stop.current; i++) await new Promise(res => setTimeout(res, 1000))
          continue
        }
        stalls = 0
        if (r.remaining <= 0 || r.processed + r.failed === 0) { setMessage(`Done.${failed ? ` ${failed} prop${failed === 1 ? '' : 's'} couldn't be done and kept their current words.` : ''}`); break }
        setMessage('')
      }
    } catch (err) {
      setMessage(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Tap the button to continue.")
    } finally { setRunning(false) }
  }

  if (!counts) return null
  const cost = (counts.remaining * 0.002).toFixed(2)
  return (
    <div className="pt-2 space-y-1">
      <button onClick={running ? () => { stop.current = true } : run} disabled={!running && counts.remaining === 0}
        className="w-full py-2.5 rounded-xl bg-pt-bg border border-pt-border text-pt-text text-sm font-medium active:opacity-70 disabled:opacity-40">
        {running ? `Improving… ${counts.total - counts.remaining} of ${counts.total} · tap to stop` : counts.remaining ? `Improve search words (${counts.remaining} props)` : 'Search words: all done ✓'}
      </button>
      <p className="text-pt-muted text-xs">
        {message || (counts.remaining
          ? `The AI looks at each prop's photo and adds hidden search words (a Lincoln mask gets "president", "civil war"…). About $${cost} in total, counted in the import spending cap. Keep this screen open; you can stop and continue later.`
          : 'Every prop has extra search words. New props get them automatically.')}
      </p>
    </div>
  )
}

// Owner: make small list versions of photos for props added before this existed.
// Free (no AI); runs in rounds while this screen is open. New photos get one automatically.
function SpeedUpPhotos() {
  const [counts, setCounts] = useState<{ total: number; remaining: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const stop = useRef(false)
  useEffect(() => { makeMissingThumbs({ countOnly: true }).then(r => setCounts(r.data)).catch(() => setCounts(null)) }, [])
  useEffect(() => () => { stop.current = true }, [])

  async function run() {
    stop.current = false; setRunning(true); setMessage('')
    try {
      let last = Infinity
      while (!stop.current) {
        const r = (await makeMissingThumbs({})).data
        setCounts({ total: r.total, remaining: r.remaining })
        if (r.remaining <= 0) { setMessage('Done. Lists now load the small photos.'); break }
        if (r.remaining >= last) { setMessage(`Done. ${r.remaining} prop${r.remaining === 1 ? '' : 's'} have a photo that couldn't be read; they keep showing the full photo.`); break }
        last = r.remaining
      }
    } catch (err) {
      setMessage(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Tap the button to continue.")
    } finally { setRunning(false) }
  }

  if (!counts) return null
  return (
    <div className="pt-2 space-y-1">
      <button onClick={running ? () => { stop.current = true } : run} disabled={!running && counts.remaining === 0}
        className="w-full py-2.5 rounded-xl bg-pt-bg border border-pt-border text-pt-text text-sm font-medium active:opacity-70 disabled:opacity-40">
        {running ? `Speeding up… ${counts.total - counts.remaining} of ${counts.total} · tap to stop` : counts.remaining ? `Speed up photos (${counts.remaining} props)` : 'Photos: all fast ✓'}
      </button>
      <p className="text-pt-muted text-xs">
        {message || (counts.remaining
          ? 'Makes a small version of each photo for the lists, so they load much faster. Free (no AI). Keep this screen open; you can stop and continue later.'
          : 'Every prop has small list photos. New photos get them automatically.')}
      </p>
    </div>
  )
}
