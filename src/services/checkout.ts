import {
  collection, addDoc, deleteDoc, updateDoc,
  doc, onSnapshot, query, orderBy, deleteField,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { ActiveCheckout } from '../types'

const col = collection(db, 'checkouts')

export function subscribeToCheckouts(cb: (checkouts: ActiveCheckout[]) => void) {
  return onSnapshot(
    query(col, orderBy('startedAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActiveCheckout))),
    () => cb([]),
  )
}

export async function createCheckout(label: string, itemIds: string[]) {
  const now = new Date().toISOString()
  await addDoc(col, { label, startedAt: now, itemIds })
  await Promise.all(itemIds.map(id =>
    updateDoc(doc(db, 'items', id), {
      status: 'checked-out',
      checkedOutInfo: { label, checkedOutAt: now },
      updatedAt: now,
      updatedBy: auth.currentUser!.uid,
    })
  ))
}

export async function returnCheckout(checkout: ActiveCheckout) {
  const now = new Date().toISOString()
  const uid = auth.currentUser!.uid
  await Promise.all(checkout.itemIds.map(id =>
    updateDoc(doc(db, 'items', id), {
      status: 'available',
      checkedOutInfo: deleteField(),
      updatedAt: now,
      updatedBy: uid,
    })
  ))
  await deleteDoc(doc(col, checkout.id))
}
