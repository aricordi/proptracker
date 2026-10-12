// Pure checks behind the Health page. No database access here, so they're easy to test.
import type { Item, Tag, Bin, Location } from '../types'
import { normalizeTag } from './normalizeTag'

// ─── Near-duplicate tags ─────────────────────────────────────────────────────

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

// "chair"/"chairs"/"Chair" always match; small typos match only on longer
// words so "cat" and "hat" aren't flagged.
export function tagsLookAlike(a: string, b: string): boolean {
  const x = normalizeTag(a), y = normalizeTag(b)
  if (x === y) return true
  const shorter = Math.min(x.length, y.length)
  const allowed = shorter >= 9 ? 2 : shorter >= 5 ? 1 : 0
  return allowed > 0 && editDistance(x, y) <= allowed
}

export interface TagGroup {
  tags: Tag[]                       // most-used first: the suggested one to keep
  usage: Record<string, number>     // tag id → number of props using it
}

export function findDuplicateTags(tags: Tag[], items: Item[]): TagGroup[] {
  const usage = tagUsage(items)
  const parent = new Map(tags.map(t => [t.id, t.id]))
  const find = (id: string): string => parent.get(id) === id ? id : find(parent.get(id)!)
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      if (tagsLookAlike(tags[i].label, tags[j].label)) parent.set(find(tags[i].id), find(tags[j].id))
    }
  }
  const groups = new Map<string, Tag[]>()
  for (const t of tags) groups.set(find(t.id), [...(groups.get(find(t.id)) ?? []), t])
  return [...groups.values()]
    .filter(g => g.length > 1)
    .map(g => ({ tags: g.sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0)), usage }))
}

export function tagUsage(items: Item[]): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const i of items) for (const t of new Set(i.tags)) usage[t] = (usage[t] ?? 0) + 1
  return usage
}

// Which props need their tags rewritten to merge `mergeIds` into `keepId`.
export function planTagMerge(keepId: string, mergeIds: string[], items: Item[]) {
  const merging = new Set(mergeIds)
  return items
    .filter(i => i.tags.some(t => merging.has(t)))
    .map(i => ({
      itemId: i.id,
      tags: [...new Set(i.tags.map(t => merging.has(t) ? keepId : t))],
    }))
}

export function unusedTags(tags: Tag[], items: Item[]): Tag[] {
  const usage = tagUsage(items)
  return tags.filter(t => !usage[t.id])
}

// ─── Possible duplicate props ────────────────────────────────────────────────

function bigrams(s: string): Set<string> {
  const clean = ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()} `
  const out = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
  return out
}

// 0–1 similarity of two names (1 = same letters in the same pairs).
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(a), y = bigrams(b)
  if (x.size === 0 || y.size === 0) return 0
  let shared = 0
  for (const g of x) if (y.has(g)) shared++
  return (2 * shared) / (x.size + y.size)
}

export interface DuplicatePair { a: Item; b: Item; score: number }

export function findDuplicateProps(items: Item[], threshold: number): DuplicatePair[] {
  const live = items.filter(i => !i.archived)
  const grams = live.map(i => bigrams(i.name))
  const pairs: DuplicatePair[] = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const x = grams[i], y = grams[j]
      if (x.size === 0 || y.size === 0) continue
      let shared = 0
      for (const g of x) if (y.has(g)) shared++
      const score = (2 * shared) / (x.size + y.size)
      if (score >= threshold) pairs.push({ a: live[i], b: live[j], score })
    }
  }
  return pairs.sort((p, q) => q.score - p.score)
}

// ─── Empty storage ───────────────────────────────────────────────────────────

export function emptyBins(bins: Bin[], items: Item[]): Bin[] {
  const used = new Set(items.filter(i => !i.archived).map(i => i.binId))
  return bins.filter(b => !used.has(b.id))
}

export function emptyLocations(locations: Location[], bins: Bin[], items: Item[]): Location[] {
  const used = new Set([
    ...items.filter(i => !i.archived).map(i => i.locationId),
    ...bins.map(b => b.locationId),
  ])
  return locations.filter(l => !used.has(l.id))
}
