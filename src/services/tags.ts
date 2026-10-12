import {
  collection, addDoc, updateDoc, doc,
  onSnapshot, query, orderBy, increment, writeBatch,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { Tag } from '../types'
import { normalizeTag } from '../lib/normalizeTag'

const col = collection(db, 'tags')

export { normalizeTag }

export function subscribeToTags(cb: (tags: Tag[]) => void) {
  return onSnapshot(
    query(col, orderBy('usageCount', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Tag))),
    () => cb([]),
  )
}

export async function getOrCreateTag(label: string, existingTags: Tag[]): Promise<string> {
  const normalizedKey = normalizeTag(label)
  const existing = existingTags.find(t => t.normalizedKey === normalizedKey)
  if (existing) return existing.id
  const ref = await addDoc(col, { label: label.trim(), normalizedKey, usageCount: 0 })
  return ref.id
}

export async function incrementTagUsage(tagId: string) {
  return updateDoc(doc(db, 'tags', tagId), { usageCount: increment(1) })
}

export async function decrementTagUsage(tagId: string) {
  return updateDoc(doc(db, 'tags', tagId), { usageCount: increment(-1) })
}

// Merge look-alike tags into one: every prop using a merged tag switches to
// the kept tag, then the merged tags (now unused) are removed.
export async function mergeTags(
  keepId: string,
  mergeIds: string[],
  plan: { itemId: string; tags: string[] }[],
  keptUsage: number,
) {
  const uid = auth.currentUser!.uid
  const now = new Date().toISOString()
  // Firestore allows 500 writes per batch.
  for (let i = 0; i < plan.length; i += 400) {
    const batch = writeBatch(db)
    for (const p of plan.slice(i, i + 400)) {
      batch.update(doc(db, 'items', p.itemId), { tags: p.tags, updatedAt: now, updatedBy: uid })
    }
    await batch.commit()
  }
  const batch = writeBatch(db)
  batch.update(doc(db, 'tags', keepId), { usageCount: keptUsage })
  for (const id of mergeIds) batch.delete(doc(db, 'tags', id))
  await batch.commit()
}

// Only called for tags no prop uses.
export async function deleteUnusedTags(ids: string[]) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 400)) batch.delete(doc(db, 'tags', id))
    await batch.commit()
  }
}
