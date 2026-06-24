import {
  collection, addDoc, updateDoc, doc,
  onSnapshot, query, orderBy, increment,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Character } from '../types'

const col = collection(db, 'characters')

export function normalizeCharacter(input: string): string {
  return input.trim().toLowerCase()
}

export function subscribeToCharacters(cb: (chars: Character[]) => void) {
  return onSnapshot(
    query(col, orderBy('usageCount', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Character))),
    () => cb([]),
  )
}

export async function getOrCreateCharacter(label: string, existing: Character[]): Promise<string> {
  const normalizedKey = normalizeCharacter(label)
  const found = existing.find(c => c.normalizedKey === normalizedKey)
  if (found) return found.id
  const ref = await addDoc(col, { label: label.trim(), normalizedKey, usageCount: 0 })
  return ref.id
}

export async function incrementCharacterUsage(id: string) {
  return updateDoc(doc(db, 'characters', id), { usageCount: increment(1) })
}

export async function decrementCharacterUsage(id: string) {
  return updateDoc(doc(db, 'characters', id), { usageCount: increment(-1) })
}
