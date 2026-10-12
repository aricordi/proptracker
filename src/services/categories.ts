import {
  collection, doc, onSnapshot, query, orderBy,
  runTransaction, setDoc, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { DEFAULT_CATEGORIES } from '../config'
import type { Category } from '../types'

const col = collection(db, 'categories')

export function subscribeToCategories(cb: (cats: Category[]) => void) {
  return onSnapshot(
    query(col, orderBy('order')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category))),
    () => cb([]),
  )
}

// Create any missing default categories. Existing ones are never touched,
// so renaming or hiding a default category sticks.
export async function ensureDefaultCategories() {
  await Promise.all(DEFAULT_CATEGORIES.map(({ id, label }, order) =>
    runTransaction(db, async tx => {
      const ref = doc(col, id)
      if ((await tx.get(ref)).exists()) return
      tx.set(ref, { label, order, active: true })
    })
  ))
}

export async function addCategory(label: string, order: number) {
  const ref = doc(col)
  await setDoc(ref, { label: label.trim(), order, active: true })
  return ref.id
}

export async function updateCategory(id: string, data: Partial<Omit<Category, 'id'>>) {
  return updateDoc(doc(col, id), data)
}
