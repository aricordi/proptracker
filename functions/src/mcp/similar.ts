// Meaning search for the connector, all at once (speed, Nov 24): a video idea with 8 needs used to make 8 separate trips to
// the AI (one per need, 5 at a time). Now the words are turned into "meaning fingerprints" in ONE request (remembered for 30
// minutes, so repeated searches skip it), then the 8 closest-prop lookups run side by side. Same results as searchSimilar.
// Personal props never come out: callers keep only props found in loadCloset() (company props).
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../auth.js'
import { embedTexts, GEMINI_API_KEY } from '../gemini.js'

const vectors = new Map<string, { at: number; v: number[] }>()
const KEEP_MS = 30 * 60_000
const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }
const keyOf = (q: string) => q.trim().toLowerCase().slice(0, 200)

/** query → closest props [{id, score}] (best first). A query the AI can't read just gets no meaning matches. */
export async function similarFor(queries: string[], limit = 15): Promise<Map<string, { id: string; score: number }[]>> {
  const out = new Map<string, { id: string; score: number }[]>()
  const qs = [...new Set(queries.map(keyOf).filter(q => q.length >= 3))]
  if (!qs.length) return out
  const now = Date.now()
  const missing = qs.filter(q => !(vectors.get(q) && now - vectors.get(q)!.at < KEEP_MS))
  if (missing.length) {
    try {
      const vs = await embedTexts(apiKey(), missing, 'RETRIEVAL_QUERY')
      missing.forEach((q, i) => vectors.set(q, { at: now, v: vs[i] }))
      if (vectors.size > 2000) for (const [k, x] of vectors) if (now - x.at >= KEEP_MS) vectors.delete(k)
      const month = new Date().toISOString().slice(0, 7)
      db.doc(`ai_usage/${month}`).set({ month, smartSearches: FieldValue.increment(missing.length) }, { merge: true }).catch(() => undefined)
    } catch { /* AI busy: words still work */ }
  }
  await Promise.all(qs.map(async q => {
    const v = vectors.get(q)?.v
    if (!v) return
    try {
      const snap = await db.collection('item_vectors').findNearest({ vectorField: 'embedding', queryVector: FieldValue.vector(v), limit, distanceMeasure: 'COSINE', distanceResultField: 'distance' }).get()
      out.set(q, snap.docs.map(d => ({ id: d.id, score: 1 - Number(d.get('distance') ?? 1) })))
    } catch { /* skip this one */ }
  }))
  return new Map(queries.map(q => [q, out.get(keyOf(q)) ?? []]))
}
