import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

// Arts-department-only details, stored apart from the prop so creators can't read them.
export interface ItemPrivate {
  internalNotes?: string
}

export async function getItemPrivate(id: string): Promise<ItemPrivate> {
  const snap = await getDoc(doc(db, 'item_private', id))
  return snap.exists() ? (snap.data() as ItemPrivate) : {}
}

export async function setItemPrivate(id: string, data: ItemPrivate) {
  return setDoc(doc(db, 'item_private', id), data, { merge: true })
}
