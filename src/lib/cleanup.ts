// Clean-up tools for the arts crew (owner, Nov 6: "the crew is having a tough time… duplicate pictures… change the number
// of certain props… very simple for somebody that's never seen this app"). Pure helpers, unit-tested, no Firebase.
//
// Words used on screen (keep them this simple):
//   • "Checked"  = someone looked at the prop and said it's right (item.reviewedAt).
//   • "Removed"  = taken out of the app (archived + removedAt). It sits in "Removed props" and can be put back any time.
import type { Item } from '../types'
import { compareBinLabels } from '../../functions/src/binNames'

export type CleanupFilter = 'todo' | 'all' | 'nobin' | 'many' | 'nophoto' | 'names' | 'costumes' | 'imported' | 'checked'

export const FILTER_LABELS: Record<CleanupFilter, string> = {
  todo: 'Not checked yet', all: 'Everything', nobin: 'No bin', many: 'More than 1', nophoto: 'No photo',
  names: 'Odd names', costumes: 'Costumes', imported: 'From the photo import', checked: 'Checked',
}

/** In the clean-up at all: Prime Capitol props that aren't removed or archived. */
export const inCleanup = (i: Item) => i.collection === 'company' && !i.archived
export const isRemoved = (i: Item) => i.collection === 'company' && !!i.archived && !!i.removedAt
export const isChecked = (i: Item) => !!i.reviewedAt

// Names the AI or a file gave that nobody would search for.
const GENERIC = new Set(['item', 'object', 'prop', 'props', 'thing', 'things', 'stuff', 'misc', 'miscellaneous', 'unknown', 'untitled',
  'photo', 'image', 'picture', 'img', 'none', 'n/a', 'na', 'test', 'other', 'various', 'assorted', 'box', 'bin', 'bag', 'sign'])
export function oddName(name: string | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase()
  if (n.length < 3) return true
  if (/^(img|dsc|pxl|photo|image)[_\- ]?\d+/i.test(n) || /\.(jpe?g|png|heic|webp)$/i.test(n)) return true
  if (/^[\d\s.\-_#]+$/.test(n)) return true
  if (GENERIC.has(n) || GENERIC.has(n.replace(/^(a|an|the)\s+/, ''))) return true
  return false
}

export function matchesFilter(i: Item, f: CleanupFilter): boolean {
  switch (f) {
    case 'todo': return !isChecked(i)
    case 'all': return true
    case 'nobin': return !i.binId
    case 'many': return i.quantity > 1
    case 'nophoto': return !i.photos?.length
    case 'names': return oddName(i.name)
    case 'costumes': return i.categoryId === 'costume'
    case 'imported': return !!i.importedFrom
    case 'checked': return isChecked(i)
  }
}

export interface CleanupCounts { total: number; checked: number; todo: number; nobin: number; many: number; nophoto: number; names: number; costumes: number; imported: number; removed: number }
export function cleanupCounts(items: Item[]): CleanupCounts {
  const live = items.filter(inCleanup)
  const n = (f: CleanupFilter) => live.filter(i => matchesFilter(i, f)).length
  return {
    total: live.length, checked: n('checked'), todo: n('todo'), nobin: n('nobin'), many: n('many'), nophoto: n('nophoto'),
    names: n('names'), costumes: n('costumes'), imported: n('imported'), removed: items.filter(isRemoved).length,
  }
}

/** Shelf by shelf: bin number order (no bin last), then name. Walking the room in this order means one bin at a time. */
export function shelfOrder(items: Item[], binLabel: (id?: string) => string | undefined): Item[] {
  return [...items].sort((a, b) => {
    const la = binLabel(a.binId), lb = binLabel(b.binId)
    if (!la !== !lb) return la ? -1 : 1
    if (la && lb && la !== lb) return compareBinLabels(la, lb)
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
}

// ─── Look-alikes by name (no AI, instant) ────────────────────────────────────
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'set', 'pair', 'x2', 'x3', 'x4'])
export function nameWords(name: string): string[] {
  return (name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}
export const sameName = (a: string, b: string) => { const x = nameWords(a).join(' '), y = nameWords(b).join(' '); return !!x && x === y }

/** How alike two props look on paper: shared words in the name (0–1), plus a little for the same bin / category. */
export function likeness(a: Item, b: Item): number {
  const wa = new Set(nameWords(a.name)), wb = new Set(nameWords(b.name))
  if (!wa.size || !wb.size) return 0
  let shared = 0
  wa.forEach(w => { if (wb.has(w)) shared++ })
  const words = shared / (wa.size + wb.size - shared)
  if (!words) return 0
  return words + (a.binId && a.binId === b.binId ? 0.25 : 0) + (a.categoryId && a.categoryId === b.categoryId ? 0.05 : 0)
}

/** The props most likely to be the same as this one (for "It's a double"): best first, never itself. */
export function likelyDoubles(item: Item, items: Item[], max = 6): Item[] {
  return items.filter(o => o.id !== item.id && inCleanup(o))
    .map(o => ({ o, s: likeness(item, o) })).filter(x => x.s >= 0.34)
    .sort((x, y) => y.s - x.s).slice(0, max).map(x => x.o)
}

/** Same name in the same bin: almost always the same prop added twice (or copies that should be one prop with a count). */
export function sameNameSameBin(items: Item[]): Item[][] {
  const groups = new Map<string, Item[]>()
  for (const i of items.filter(inCleanup)) {
    const words = nameWords(i.name).join(' ')
    if (!words) continue
    const k = `${i.binId ?? ''}|${words}`
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  return [...groups.values()].filter(g => g.length > 1)
}

/** Which prop of a double to keep: the one already checked, then the one with a bin, more photos, more words. */
export function bestToKeep(group: Item[]): Item {
  const score = (i: Item) => (i.reviewedAt ? 1000 : 0) + (i.binId ? 100 : 0) + (i.categoryId ? 10 : 0) + Math.min(9, i.photos?.length ?? 0)
    + Math.min(0.9, (i.description?.length ?? 0) / 1000)
  return [...group].sort((a, b) => score(b) - score(a) || a.createdAt.localeCompare(b.createdAt))[0]
}

/** Pair keys of a group, the same format as Health's "not duplicates" list. */
export const groupPairKeys = (ids: string[]) => {
  const out: string[] = []
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]].sort().join('|'))
  return out
}
