import { collectionOf } from '../../functions/src/collections'
import type { Item } from '../types'

// Older records predate photos/category/quantity/condition/etc. Fill those in
// when reading so the rest of the app sees one shape. Nothing is written back
// here — a record only gains the new fields when someone edits and saves it.
export function normalizeItem(id: string, raw: Record<string, any>): Item {
  const photos: string[] = Array.isArray(raw.photos) && raw.photos.length > 0
    ? raw.photos
    : raw.photoUrl ? [raw.photoUrl] : []
  const legacyDamaged = raw.status === 'damaged'
  return {
    ...raw,
    id,
    name: raw.name ?? '',
    tags: raw.tags ?? [],
    photos,
    photoUrl: photos[0],
    categoryId: raw.categoryId ?? raw.itemType ?? 'prop',
    quantity: typeof raw.quantity === 'number' && raw.quantity >= 1 ? raw.quantity : 1,
    condition: raw.condition ?? (legacyDamaged ? 'damaged' : 'good'),
    status: legacyDamaged ? 'available' : (raw.status ?? 'available'),
    replacementCost: raw.replacementCost ?? raw.cost,
    archived: raw.archived === true,
    collection: collectionOf(raw),
    missingQty: typeof raw.missingQty === 'number' && raw.missingQty > 0 ? raw.missingQty : 0,
  } as Item
}

// The small version of a prop photo for lists and tiles (made by the server a few
// seconds after a photo is added); the full photo until it exists.
export function thumbOf(item: { thumbs?: Record<string, string> } | undefined | null, url: string | undefined): string | undefined {
  if (!url) return url
  return item?.thumbs?.[url] ?? url
}
