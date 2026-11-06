// Doubles finder for the clean-up (owner, Nov 6: "auto try to match certain things that seem similar… collapse duplicate stuff
// into each other"). Pure (no Firebase), shared by the server and the app, unit-tested.
//
// Every clue the app has about two props being the same thing is merged into ONE list of pairs, sorted by how sure it is:
//   • photo: one of their stored photo files is exactly the same picture (md5)          → SURE
//   • look:  the AI fingerprint of name + description + tags is very close (item_vectors) → 0.86–1
//   • name:  the names share most of their words ("Red rotary phone" / "Rotary phones")  → 0–1
//   • bin:   they're in the same bin
//   • ai:    the AI looked at both photos (cached verdict)
// Tiers: 'sure' (combine without a second look), 'likely' (almost always the same), 'maybe' (worth a look).

export interface DoubleItem { id: string; name: string; binId?: string | null; photos?: string[] }
export interface AiVerdict { same: boolean; confidence: 'high' | 'medium' | 'low'; reason: string }
export interface Signals { photo?: boolean; look?: number; name?: number; bin?: boolean; ai?: AiVerdict }
export type Tier = 'sure' | 'likely' | 'maybe'
export interface DoublePair { a: string; b: string; tier: Tier; score: number; signals: Signals }

export const pairKeyOf = (a: string, b: string) => [a, b].sort().join('|')

// ─── Names ────────────────────────────────────────────────────────────────────
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'set', 'pair', 'x2', 'x3', 'x4'])
export function nameWords(name: string): string[] {
  return (name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}
/** Share of words two names have in common (0–1). */
export function nameLikeness(a: string, b: string): number {
  const wa = new Set(nameWords(a)), wb = new Set(nameWords(b))
  if (!wa.size || !wb.size) return 0
  let shared = 0
  wa.forEach(w => { if (wb.has(w)) shared++ })
  return shared / (wa.size + wb.size - shared)
}

// ─── Photos ───────────────────────────────────────────────────────────────────
/** A storage path from a download link ("…/o/items%2Fabc.jpg?alt=media…" → "items/abc.jpg"). */
export function storagePath(url: string): string | null {
  const m = String(url ?? '').match(/\/o\/([^?#]+)/)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

// ─── Tiers ────────────────────────────────────────────────────────────────────
export function tierOf(s: Signals): Tier | null {
  if (s.photo) return 'sure'
  const look = s.look ?? 0, name = s.name ?? 0
  if (s.ai?.same && s.ai.confidence === 'high') return 'likely'
  if (look >= 0.93 || name >= 0.99 || (look >= 0.88 && s.bin) || (name >= 0.6 && s.bin)) return 'likely'
  if (look >= 0.86 || (name >= 0.5 && s.bin) || name >= 0.75) return 'maybe'
  return null
}
/** For sorting inside a tier: the more clues agree, the higher. The AI saying "different" pushes it to the bottom. */
export function scoreOf(s: Signals): number {
  let v = (s.photo ? 2 : 0) + (s.look ?? 0) + 0.5 * (s.name ?? 0) + (s.bin ? 0.15 : 0)
  if (s.ai) v += s.ai.same ? 0.5 : -1.5
  return Math.round(v * 1000) / 1000
}
const TIER_RANK: Record<Tier, number> = { sure: 0, likely: 1, maybe: 2 }

/** Merges every clue into one list of pairs, best first. `lookPairs` = fingerprint pairs found by the server (score ≥ 0.86).
 *  `dismissed` = pair keys someone already said are NOT the same (Health's list); they never come back. */
export function buildDoubles(input: {
  items: DoubleItem[]
  md5ByPath?: Map<string, string>
  lookPairs?: { a: string; b: string; score: number }[]
  dismissed?: Set<string>
  verdicts?: Map<string, AiVerdict>
  max?: number
}): DoublePair[] {
  const byId = new Map(input.items.map(i => [i.id, i]))
  const dismissed = input.dismissed ?? new Set<string>()
  const sig = new Map<string, Signals & { a: string; b: string }>()
  const at = (a: string, b: string) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return null
    const k = pairKeyOf(a, b)
    if (dismissed.has(k)) return null
    let s = sig.get(k)
    if (!s) { const [x, y] = [a, b].sort(); s = { a: x, b: y }; sig.set(k, s) }
    return s
  }
  // 1. Same photo file.
  if (input.md5ByPath) {
    const byHash = new Map<string, string[]>()
    for (const it of input.items) for (const url of it.photos ?? []) {
      const p = storagePath(url), h = p ? input.md5ByPath.get(p) : undefined
      if (!h) continue
      const list = byHash.get(h) ?? []
      if (!list.includes(it.id)) list.push(it.id)
      byHash.set(h, list)
    }
    for (const ids of byHash.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const s = at(ids[i], ids[j]); if (s) s.photo = true
    }
  }
  // 2. Fingerprints.
  for (const p of input.lookPairs ?? []) { const s = at(p.a, p.b); if (s) s.look = Math.max(s.look ?? 0, p.score) }
  // 3. Names: every pair sharing at least one meaningful word (via a word index, so it stays fast with thousands).
  const words = new Map(input.items.map(i => [i.id, nameWords(i.name)]))
  const index = new Map<string, string[]>()
  for (const [id, ws] of words) for (const w of new Set(ws)) if (w.length > 2) index.set(w, [...(index.get(w) ?? []), id])
  const seen = new Set<string>()
  for (const ids of index.values()) {
    if (ids.length > 200) continue   // a word on hundreds of props ("black", "box") says nothing
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = pairKeyOf(ids[i], ids[j])
      if (seen.has(k)) continue
      seen.add(k)
      const n = nameLikeness(byId.get(ids[i])!.name, byId.get(ids[j])!.name)
      if (n < 0.5) continue
      const s = at(ids[i], ids[j]); if (s) s.name = Math.round(n * 100) / 100
    }
  }
  // Names and bins for pairs found another way, then the AI's cached opinion.
  const out: DoublePair[] = []
  for (const [k, s] of sig) {
    const A = byId.get(s.a)!, B = byId.get(s.b)!
    if (s.name === undefined) { const n = nameLikeness(A.name, B.name); if (n > 0) s.name = Math.round(n * 100) / 100 }
    if (A.binId && A.binId === B.binId) s.bin = true
    const v = input.verdicts?.get(k)
    if (v) s.ai = v
    const { a, b, ...signals } = s
    const tier = tierOf(signals)
    if (tier) out.push({ a, b, tier, score: scoreOf(signals), signals })
  }
  out.sort((x, y) => TIER_RANK[x.tier] - TIER_RANK[y.tier] || y.score - x.score)
  return out.slice(0, input.max ?? 3000)
}

/** After two props are combined, pairs that pointed at the removed one now point at the one kept (so chains of three
 *  collapse naturally), and pairs that became the same prop twice disappear. */
export function afterMerge(pairs: DoublePair[], keptId: string, removedId: string): DoublePair[] {
  const seen = new Set<string>()
  const out: DoublePair[] = []
  for (const p of pairs) {
    const a = p.a === removedId ? keptId : p.a, b = p.b === removedId ? keptId : p.b
    if (a === b) continue
    const k = pairKeyOf(a, b)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a === p.a && b === p.b ? p : { ...p, a, b })
  }
  return out
}

/** Plain-language reasons for the chips on each pair. */
export function reasonsOf(s: Signals): string[] {
  const r: string[] = []
  if (s.photo) r.push('Same picture')
  if ((s.name ?? 0) >= 0.99) r.push('Same name'); else if ((s.name ?? 0) >= 0.5) r.push('Similar name')
  if (s.bin) r.push('Same bin')
  if ((s.look ?? 0) >= 0.86) r.push(`${Math.round((s.look ?? 0) * 100)}% alike`)
  return r
}
