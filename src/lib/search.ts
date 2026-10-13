import type { Item, Tag } from '../types'

export type Availability = 'available' | 'checked-out' | 'damaged'

// What a prop counts as for the Availability filter. Becomes date-based in Phase 3.
export function availabilityOf(item: Item): Availability {
  if (item.status === 'checked-out') return 'checked-out'
  if (item.condition === 'damaged') return 'damaged'
  return 'available'
}

// Search matches name, tag labels, description, creator-facing notes and the
// hidden extra search words (a Lincoln mask has "president", "civil war"…).
// Every word typed must appear somewhere ("red chair" finds "Chair" tagged "red").
export function matchesQuery(item: Item, query: string, tagById: Record<string, Tag>): boolean {
  // Plurals find singulars too: "presidents" matches "president".
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
  if (words.length === 0) return true
  const haystack = [
    item.name,
    item.tags.map(id => tagById[id]?.label ?? '').join(' '),
    item.description,
    item.notes,
    item.searchWords?.join(' '),
  ].filter(Boolean).join(' ').toLowerCase()
  return words.every(w => haystack.includes(w))
}

export function byName(a: Item, b: Item) {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
}
