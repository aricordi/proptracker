import { useState, useEffect, useMemo } from 'react'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useCharacters } from '../hooks/useCharacters'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import ItemCard from '../components/ItemCard'
import { generateEmbedding, cosineSimilarity } from '../services/ai'
import type { ItemType } from '../types'

const TYPE_FILTERS: { value: ItemType | null; label: string }[] = [
  { value: null,           label: 'All' },
  { value: 'prop',         label: 'Props' },
  { value: 'costume',      label: 'Costumes' },
  { value: 'set-dressing', label: 'Set Dressing' },
  { value: 'gear',         label: 'Gear' },
]

export default function HomeScreen() {
  const items      = useItems()
  const tags       = useTags()
  const characters = useCharacters()
  const locations  = useLocations()
  const bins       = useBins()

  const [query, setQuery]           = useState('')
  const [typeFilter, setTypeFilter] = useState<ItemType | null>(null)
  const [queryEmbedding, setQueryEmbedding] = useState<number[] | null>(null)

  const q = query.trim().toLowerCase()

  // Debounce: generate query embedding 700ms after typing stops
  useEffect(() => {
    if (!q || q.length < 3) { setQueryEmbedding(null); return }
    let cancelled = false
    const timer = setTimeout(() => {
      generateEmbedding(q).then(emb => { if (!cancelled) setQueryEmbedding(emb) })
    }, 700)
    return () => { clearTimeout(timer); cancelled = true }
  }, [q])

  const tagById       = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const characterById = useMemo(() => Object.fromEntries(characters.map(c => [c.id, c])), [characters])
  const locationById  = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById       = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])

  const matched = useMemo(() => {
    let list = typeFilter ? items.filter(i => i.itemType === typeFilter) : items
    if (!q) return list
    return list.filter(item => {
      const tagLabels  = item.tags.map(id => tagById[id]?.label ?? '').join(' ')
      const charLabels = (item.characters ?? []).map(id => characterById[id]?.label ?? '').join(' ')
      const haystack = [item.name, tagLabels, charLabels, item.character, item.description]
        .filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [items, q, typeFilter, tagById])

  const similar = useMemo(() => {
    if (!q || matched.length === 0) return []
    const matchedIds = new Set(matched.map(i => i.id))
    const candidates = items.filter(i => !matchedIds.has(i.id))

    // Semantic similarity when we have embeddings for both query and candidates
    if (queryEmbedding) {
      const semantic = candidates
        .filter(i => i.embedding?.length)
        .map(i => ({ item: i, score: cosineSimilarity(queryEmbedding, i.embedding!) }))
        .filter(({ score }) => score > 0.6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ item }) => item)
      if (semantic.length > 0) return semantic
    }

    // Fall back to tag-overlap
    const matchedTags = new Set(matched.flatMap(i => i.tags))
    return candidates
      .map(i => ({ item: i, overlap: i.tags.filter(t => matchedTags.has(t)).length }))
      .filter(({ overlap }) => overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5)
      .map(({ item }) => item)
  }, [items, matched, q, queryEmbedding])

  const showEmpty  = items.length === 0
  const showNoHits = !showEmpty && q && matched.length === 0

  return (
    <div className="min-h-full bg-pt-bg">
      {/* Sticky header + search */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">PropTracker</h1>

        {/* Search bar */}
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search props, costumes, gear…"
            className="w-full bg-pt-surface border border-pt-border rounded-xl pl-10 pr-10 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Type filter chips */}
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {TYPE_FILTERS.map(({ value, label }) => (
            <button
              key={label}
              onClick={() => setTypeFilter(value)}
              className={`shrink-0 px-3 py-1 rounded-full text-sm transition-colors ${
                typeFilter === value
                  ? 'bg-pt-accent text-stone-900 font-medium'
                  : 'bg-pt-surface border border-pt-border text-pt-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {/* Empty database state */}
        {showEmpty && (
          <div className="text-center mt-16">
            <p className="text-pt-muted text-sm leading-relaxed">
              No items yet.<br />
              Tap <strong className="text-pt-text">+</strong> in the nav to add your first prop.
            </p>
          </div>
        )}

        {/* No search results */}
        {showNoHits && (
          <div className="text-center mt-12">
            <p className="text-pt-text font-medium mb-1">Nothing found for "{query}"</p>
            <p className="text-pt-muted text-sm">
              You probably don't own it yet.
            </p>
          </div>
        )}

        {/* Result count when searching */}
        {q && matched.length > 0 && (
          <p className="text-pt-muted text-xs px-1 pb-1">
            {matched.length} result{matched.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Main results */}
        {matched.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            tagById={tagById}
            locationById={locationById}
            binById={binById}
          />
        ))}

        {/* Similar items section */}
        {similar.length > 0 && (
          <>
            <div className="flex items-center gap-3 py-3">
              <div className="flex-1 h-px bg-pt-border" />
              <span className="text-pt-muted text-xs whitespace-nowrap">Similar — might work too</span>
              <div className="flex-1 h-px bg-pt-border" />
            </div>
            {similar.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                tagById={tagById}
                locationById={locationById}
                binById={binById}
              />
            ))}
          </>
        )}

        {/* Spacer at bottom so last card isn't behind nav */}
        <div className="h-4" />
      </div>
    </div>
  )
}
