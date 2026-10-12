import {
  collection, addDoc, updateDoc, getDoc,
  doc, onSnapshot, query, orderBy,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { Item } from '../types'
import { normalizeItem } from './itemShape'

export { normalizeItem }

const col = collection(db, 'items')

export function subscribeToItems(cb: (items: Item[]) => void) {
  return onSnapshot(
    query(col, orderBy('updatedAt', 'desc')),
    snap => cb(snap.docs.map(d => normalizeItem(d.id, d.data()))),
    () => cb([]),
  )
}

export async function getItem(id: string): Promise<Item | null> {
  const snap = await getDoc(doc(db, 'items', id))
  return snap.exists() ? normalizeItem(snap.id, snap.data()) : null
}

export type NewItem = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>

export async function addItem(data: NewItem) {
  const uid = auth.currentUser!.uid
  const now = new Date().toISOString()
  return addDoc(col, { ...data, createdAt: now, updatedAt: now, createdBy: uid, updatedBy: uid })
}

export async function updateItem(id: string, data: Partial<Omit<Item, 'id'>>) {
  const uid = auth.currentUser!.uid
  return updateDoc(doc(db, 'items', id), {
    ...data,
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  })
}

// Props are never deleted — archiving hides them from search but keeps their history.
export async function setItemArchived(id: string, archived: boolean) {
  return updateItem(id, { archived })
}
