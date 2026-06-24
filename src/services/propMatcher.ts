import { generateEmbedding, cosineSimilarity } from './ai'
import { PROP_MATCH_CONFIDENT_THRESHOLD, PROP_MATCH_POSSIBLE_THRESHOLD } from '../config'
import type { Item, VideoChecklistProp, MatchStatus, PropAlternative } from '../types'

export interface MatchResult {
  status: MatchStatus
  matchedItemId?: string
  matchScore?: number
  alternatives: PropAlternative[] // top candidates (always populated for 'none', useful elsewhere)
  propEmbedding: number[] | null  // cached so we never re-embed
}

// Embed a prop's text and compare against all inventory items that have embeddings.
// Returns match bucket + top alternatives (sorted by score descending).
// Gracefully returns {status:'none', alternatives:[]} if embeddings unavailable.
export async function matchProp(
  prop: VideoChecklistProp,
  inventoryItems: Item[],
  cachedEmbedding?: number[],
): Promise<MatchResult> {
  const text = [prop.name, prop.notes].filter(Boolean).join(' ')

  // Use cached embedding if available to avoid re-generating
  const embedding = cachedEmbedding ?? await generateEmbedding(text)

  const candidates = inventoryItems.filter(i => i.embedding && i.embedding.length > 0)

  if (!embedding || candidates.length === 0) {
    // Fall back to text match — tag overlap won't work well here, just return none
    const textFallback = candidates
      .filter(i => i.name.toLowerCase().includes(prop.name.toLowerCase().slice(0, 4)))
      .slice(0, 3)
      .map(i => ({ itemId: i.id, score: 0 }))
    return { status: 'none', alternatives: textFallback, propEmbedding: null }
  }

  const scored = candidates
    .map(item => ({ item, score: cosineSimilarity(embedding, item.embedding!) }))
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  let status: MatchStatus = 'none'
  let matchedItemId: string | undefined
  let matchScore: number | undefined

  if (top && top.score >= PROP_MATCH_CONFIDENT_THRESHOLD) {
    status = 'confident'
    matchedItemId = top.item.id
    matchScore = top.score
  } else if (top && top.score >= PROP_MATCH_POSSIBLE_THRESHOLD) {
    status = 'possible'
    matchedItemId = top.item.id
    matchScore = top.score
  }

  // Top 3 alternatives (excluding the matched item, for "use this instead" suggestions)
  const alternatives: PropAlternative[] = scored
    .filter(({ item }) => item.id !== matchedItemId)
    .slice(0, 3)
    .map(({ item, score }) => ({ itemId: item.id, score }))

  return { status, matchedItemId, matchScore, alternatives, propEmbedding: embedding }
}

// Run matching for all physical props in a checklist, using cached embeddings
// where available. Returns an updated props array with match data filled in.
// onProgress fires before each prop is embedded so the UI can show a progress bar.
export async function matchAllPhysicalProps(
  props: VideoChecklistProp[],
  inventoryItems: Item[],
  onProgress?: (current: number, total: number, propName: string) => void,
): Promise<VideoChecklistProp[]> {
  const updated = [...props]

  const needsMatch = updated.filter(p => p.type === 'physical' && !(p.propEmbedding && p.matchStatus))
  const total = needsMatch.length
  let matched = 0

  for (let i = 0; i < updated.length; i++) {
    const prop = updated[i]
    if (prop.type !== 'physical') continue
    if (prop.propEmbedding && prop.matchStatus) continue

    onProgress?.(matched, total, prop.name)
    matched++

    const result = await matchProp(prop, inventoryItems, prop.propEmbedding ?? undefined)
    updated[i] = {
      ...prop,
      matchStatus: result.status,
      matchedItemId: result.matchedItemId,
      matchScore: result.matchScore,
      alternatives: result.alternatives,
      propEmbedding: result.propEmbedding ?? prop.propEmbedding,
    }
  }

  return updated
}
