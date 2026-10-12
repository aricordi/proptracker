import { useState, useEffect, useMemo } from 'react'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { useSession } from '../auth'
import ItemCard from '../components/ItemCard'
import { searchSimilar } from '../services/ai'
import { matchesQuery, availabilityOf, byName, type Availability } from '../lib/search'
import { SIMILAR_MIN_SCORE } from '../config'
import type { Item } from '../types'

type AvailabilityFilter = Availability | 'all' | 'archived'

const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string; staffOnly?: boolean }[] = [
  { value: 'all',         label: 'Any status' },
  { value: 'available',   label: 'Available now' },
  { value: 'checked-out', label: 'Checked out' },
  { value: 'damaged',     label: 'Damaged' },
  { value: 'archived',    label: 'Archived', staffOnly: true },
]

export default function HomeScreen() {
  const { isStaff } = useSession()
  const allItems   = useItems()
  const tags       = useTags()
  const locations  = useLocations()
  const bins       = useBins()
  const categories = useCategories()

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [availability, setAvailability] = useState<AvailabilityFilter>('all')
  const [similarIds, setSimilarIds] = useState<string[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  const q = query.trim()

  // Ask the server for similar-meaning props 600ms after typing stops.
  useEffect(() => {
    setSimilarIds([])
    if (q.length < 3) { setSimilarLoading(false); return }
    let cancelled = false
    setSimilarLoading(true)
    const timer = setTimeout(() => {
      searchSimilar(q).then(results => {
        if (cancelled) return
        setSimilarIds(results.filter(r => r.score >= SIMILAR_MIN_SCORE).map(r => r.id))
        setSimilarLoading(false)
      })
    }, 600)
    return () => { clearTimeout(timer); cancelled = true }
  }, [q])

  const tagById      = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const locationById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById      = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])
  const categoryById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  // Filters apply to both exact and similar results.
  const filtered = useMemo(
    () => allItems
      .filter(i =>
        (availability === 'archived' ? i.archived : !i.archived)
        && (availability === 'all' || availability === 'archived' || availabilityOf(i) === availability)
        && (!categoryFilter || i.categoryId === categoryFilter))
      .sort(byName),
    [allItems, availability, categoryFilter],
  )

  const matched = useMemo(
    () => q ? filtered.filter(i => matchesQuery(i, q, tagById)) : filtered,
    [filtered, q, tagById],
  )

  const similar = useMemo(() => {
    if (!q) return []
    const exact = new Set(matched.map(i => i.id))
    const byId = new Map(filtered.map(i => [i.id, i]))
    return similarIds.filter(id => !exact.has(id)).map(id => byId.get(id)).filter((i): i is Item => !!i).slice(0, 8)
  }, [q, matched, filtered, similarIds])

  function subtitle(item: Item) {
    const category = categoryById[item.categoryId]?.label ?? ''
    if (!isStaff) return category
    const where = [item.locationId && locationById[item.locationId]?.name, item.binId && binById[item.binId]?.label]
      .filter(Boolean).join(' › ')
    return where || category
  }

  const filtersActive = !!categoryFilter || availability !== 'all'
  const nothingAtAll = allItems.length === 0

  return (
    <div className="min-h-full bg-pt-bg">
      {/* Sticky header + search */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">PropTracker</h1>

        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search props, costumes, gear…"
            enterKeyHint="search"
            className="w-full bg-pt-surface border border-pt-border rounded-xl pl-10 pr-10 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Category chips */}
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {[{ id: null as string | null, label: 'All' }, ...categories.filter(c => c.active).map(c => ({ id: c.id as string | null, label: c.label }))].map(({ id, label }) => (
            <button
              key={label}
              onClick={() => setCategoryFilter(id)}
              className={`shrink-0 px-3 py-1 rounded-full text-sm transition-colors ${
                categoryFilter === id
                  ? 'bg-pt-accent text-stone-900 font-medium'
                  : 'bg-pt-surface border border-pt-border text-pt-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Availability */}
        <div className="flex items-center justify-between gap-3 mt-2">
          <select
            value={availability}
            onChange={e => setAvailability(e.target.value as AvailabilityFilter)}
            aria-label="Availability"
            className={`bg-pt-surface border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none ${
              availability === 'all' ? 'border-pt-border text-pt-muted' : 'border-pt-accent text-pt-accent'
            }`}
          >
            {AVAILABILITY_OPTIONS.filter(o => isStaff || !o.staffOnly).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-pt-muted text-xs">
            {matched.length} prop{matched.length !== 1 ? 's' : ''}
            {filtersActive && (
              <button onClick={() => { setCategoryFilter(null); setAvailability('all') }} className="ml-2 text-pt-accent">
                Clear filters
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="p-4">
        {nothingAtAll && (
          <p className="text-center mt-16 text-pt-muted text-sm leading-relaxed">
            No props yet.
            {isStaff && <><br />Tap <strong className="text-pt-text">Add</strong> in the bar below to add your first prop.</>}
          </p>
        )}

        {!nothingAtAll && matched.length === 0 && (
          <div className="text-center mt-10 mb-6">
            <p className="text-pt-text font-medium mb-1">
              {q ? `No exact matches for "${q}"` : 'Nothing matches these filters'}
            </p>
            {q && similarLoading && <p className="text-pt-muted text-sm">Looking for similar props…</p>}
            {q && !similarLoading && similar.length === 0 && (
              <p className="text-pt-muted text-sm">Try a different word{isStaff ? '' : ', or ask the arts department'}.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {matched.map(item => <ItemCard key={item.id} item={item} subtitle={subtitle(item)} />)}
        </div>

        {similar.length > 0 && (
          <>
            <div className="flex items-center gap-3 py-4">
              <div className="flex-1 h-px bg-pt-border" />
              <span className="text-pt-muted text-xs whitespace-nowrap">Similar, might work too</span>
              <div className="flex-1 h-px bg-pt-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {similar.map(item => <ItemCard key={item.id} item={item} subtitle={subtitle(item)} />)}
            </div>
          </>
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}
