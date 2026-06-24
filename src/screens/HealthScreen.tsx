import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import type { AiUsageRecord, Item } from '../types'

export default function HealthScreen() {
  const navigate  = useNavigate()
  const items     = useItems()
  const tags      = useTags()
  const locations = useLocations()
  const bins      = useBins()

  const [aiUsage, setAiUsage] = useState<AiUsageRecord | null>(null)

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7)
    getDoc(doc(db, 'ai_usage', month))
      .then(d => { if (d.exists()) setAiUsage({ id: d.id, ...d.data() } as AiUsageRecord) })
      .catch(() => {})
  }, [])

  const tagById      = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const locationById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById      = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])

  const typeCounts = useMemo(() => ({
    prop:            items.filter(i => i.itemType === 'prop').length,
    costume:         items.filter(i => i.itemType === 'costume').length,
    'set-dressing':  items.filter(i => i.itemType === 'set-dressing').length,
    gear:            items.filter(i => i.itemType === 'gear').length,
  }), [items])

  const checkedOutCount = useMemo(() => items.filter(i => i.status === 'checked-out').length, [items])

  const noTags     = useMemo(() => items.filter(i => i.tags.length === 0), [items])
  const noPhoto    = useMemo(() => items.filter(i => !i.photoUrl), [items])
  const noLocation = useMemo(() => items.filter(i => !i.locationId), [items])

  const totalIssues = noTags.length + noPhoto.length + noLocation.length

  function handleExport() {
    const header = ['name','type','status','location','bin','tags','character','description','cost','whereToRebuy','photoUrl','createdAt']
    const rows = items.map(item => [
      item.name,
      item.itemType,
      item.status,
      item.locationId ? (locationById[item.locationId]?.name ?? '') : '',
      item.binId ? (binById[item.binId]?.label ?? '') : '',
      item.tags.map(id => tagById[id]?.label ?? id).join('; '),
      item.character ?? '',
      item.description ?? '',
      item.cost != null ? String(item.cost) : '',
      item.whereToRebuy ?? '',
      item.photoUrl ?? '',
      item.createdAt,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `proptracker-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const monthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">Health</h1>
      </div>

      <div className="p-4 space-y-4">

        {/* Inventory stats */}
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <p className="text-pt-muted text-xs uppercase tracking-wider">Inventory</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-pt-text">{items.length}</span>
            <span className="text-pt-muted text-sm">items total</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['prop',          'Props'],
              ['costume',       'Costumes'],
              ['set-dressing',  'Set Dressing'],
              ['gear',          'Gear'],
            ] as const).map(([key, label]) => (
              <div key={key} className="bg-pt-bg rounded-xl px-3 py-2">
                <p className="text-pt-text font-semibold text-lg">{typeCounts[key]}</p>
                <p className="text-pt-muted text-xs">{label}</p>
              </div>
            ))}
          </div>
          {checkedOutCount > 0 && (
            <p className="text-amber-400 text-sm">
              {checkedOutCount} item{checkedOutCount !== 1 ? 's' : ''} currently checked out
            </p>
          )}
        </div>

        {/* Fix-it queue */}
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-pt-muted text-xs uppercase tracking-wider">Fix-it Queue</p>
            {totalIssues === 0
              ? <span className="text-green-400 text-xs font-medium">All good ✓</span>
              : <span className="text-amber-400 text-xs font-medium">{totalIssues} issue{totalIssues !== 1 ? 's' : ''}</span>
            }
          </div>

          {totalIssues === 0 && (
            <p className="text-pt-muted text-sm">Every item has tags, a photo, and a location.</p>
          )}

          {noTags.length > 0 && (
            <FixitGroup
              title={`No tags — ${noTags.length} item${noTags.length !== 1 ? 's' : ''}`}
              items={noTags}
              onTap={id => navigate(`/item/${id}/edit`)}
            />
          )}
          {noPhoto.length > 0 && (
            <FixitGroup
              title={`No photo — ${noPhoto.length} item${noPhoto.length !== 1 ? 's' : ''}`}
              items={noPhoto}
              onTap={id => navigate(`/item/${id}/edit`)}
            />
          )}
          {noLocation.length > 0 && (
            <FixitGroup
              title={`No location — ${noLocation.length} item${noLocation.length !== 1 ? 's' : ''}`}
              items={noLocation}
              onTap={id => navigate(`/item/${id}/edit`)}
            />
          )}
        </div>

        {/* AI usage */}
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <p className="text-pt-muted text-xs uppercase tracking-wider">AI Usage — {monthLabel}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-pt-bg rounded-xl px-3 py-2">
              <p className="text-pt-text font-semibold text-lg">{aiUsage?.taggingCalls ?? 0}</p>
              <p className="text-pt-muted text-xs">Photo analyses</p>
              <p className="text-pt-muted text-xs opacity-60">free ≤ 1,000/day</p>
            </div>
            <div className="bg-pt-bg rounded-xl px-3 py-2">
              <p className="text-pt-text font-semibold text-lg">{aiUsage?.embeddingCalls ?? 0}</p>
              <p className="text-pt-muted text-xs">Embeddings</p>
              <p className="text-pt-muted text-xs opacity-60">free tier</p>
            </div>
          </div>
        </div>

        {/* Export */}
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <p className="text-pt-muted text-xs uppercase tracking-wider">Export</p>
          <p className="text-pt-muted text-sm">Full inventory as a CSV spreadsheet — name, type, location, tags, cost, and more.</p>
          <button
            onClick={handleExport}
            disabled={items.length === 0}
            className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold text-sm active:opacity-80 disabled:opacity-40"
          >
            Download CSV ({items.length} item{items.length !== 1 ? 's' : ''})
          </button>
        </div>

      </div>
    </div>
  )
}

interface FixitGroupProps {
  title: string
  items: Item[]
  onTap: (id: string) => void
}

function FixitGroup({ title, items, onTap }: FixitGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, 3)

  return (
    <div>
      <p className="text-pt-text text-sm font-medium mb-1.5">{title}</p>
      <div className="space-y-1">
        {shown.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTap(item.id)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-pt-bg text-left active:opacity-70"
          >
            <div className="w-8 h-8 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
              {item.photoUrl
                ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-pt-muted">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  </svg>
              }
            </div>
            <span className="text-pt-text text-sm truncate flex-1">{item.name}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </button>
        ))}
      </div>
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1.5 text-pt-accent text-xs active:opacity-70"
        >
          {expanded ? 'Show less' : `Show ${items.length - 3} more`}
        </button>
      )}
    </div>
  )
}
