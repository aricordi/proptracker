import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { Item } from '../types'

const col = collection(db, 'items')

export function subscribeToItems(cb: (items: Item[]) => void) {
  return onSnapshot(
    query(col, orderBy('updatedAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Item))),
    () => cb([]),
  )
}

export async function addItem(
  data: Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>,
) {
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

export async function deleteItem(id: string) {
  return deleteDoc(doc(db, 'items', id))
}
