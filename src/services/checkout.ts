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

// Returns a subset of items. Deletes the checkout when the last item is returned.
export async function returnItems(checkout: ActiveCheckout, itemIdsToReturn: string[]) {
  const now = new Date().toISOString()
  const uid = auth.currentUser!.uid
  await Promise.all(itemIdsToReturn.map(id =>
    updateDoc(doc(db, 'items', id), {
      status: 'available',
      checkedOutInfo: deleteField(),
      updatedAt: now,
      updatedBy: uid,
    })
  ))
  const remaining = checkout.itemIds.filter(id => !itemIdsToReturn.includes(id))
  if (remaining.length === 0) {
    await deleteDoc(doc(col, checkout.id))
  } else {
    await updateDoc(doc(col, checkout.id), { itemIds: remaining })
  }
}

export async function returnCheckout(checkout: ActiveCheckout) {
  return returnItems(checkout, checkout.itemIds)
}
