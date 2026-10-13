// Tags on the server (same rules as src/lib/normalizeTag.ts in the app, so
// "Chairs", "chair " and "CHAIR" all become one tag).
import pluralize from 'pluralize'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './auth.js'

export function normalizeTag(input: string): string {
  return pluralize.singular(input.trim().toLowerCase().replace(/\s+/g, '-'))
}

// Tag IDs for these labels, creating any that don't exist yet, and counting the new use.
export async function tagIdsFor(labels: string[]): Promise<string[]> {
  const wanted = [...new Map(labels.map(l => [normalizeTag(l), l.trim()])).entries()].filter(([k]) => k)
  if (!wanted.length) return []
  const existing = await db.collection('tags').get()
  const byKey = new Map(existing.docs.map(d => [d.get('normalizedKey') as string, d.id]))
  const ids: string[] = []
  const batch = db.batch()
  for (const [key, label] of wanted) {
    let id = byKey.get(key)
    if (!id) {
      const ref = db.collection('tags').doc()
      batch.set(ref, { label, normalizedKey: key, usageCount: 0 })
      id = ref.id
      byKey.set(key, id)
    }
    batch.set(db.doc(`tags/${id}`), { usageCount: FieldValue.increment(1) }, { merge: true })
    ids.push(id)
  }
  await batch.commit()
  return ids
}
