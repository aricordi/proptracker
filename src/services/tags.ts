import {
  collection, addDoc, updateDoc, doc,
  onSnapshot, query, orderBy, increment,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Tag } from '../types'
import pluralize from 'pluralize'

const col = collection(db, 'tags')

export function normalizeTag(input: string): string {
  return pluralize.singular(input.trim().toLowerCase().replace(/\s+/g, '-'))
}

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
