import {
  collection, updateDoc, deleteDoc,
  doc, onSnapshot, query, getDocs, where, orderBy, setDoc,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { OWNER_EMAIL } from '../config'
import type { Bin } from '../types'

const col = collection(db, 'bins')

export function subscribeToBins(cb: (bins: Bin[]) => void) {
  return onSnapshot(
    query(col, orderBy('label')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Bin))),
    () => cb([]),
  )
}

export async function addBin(data: Omit<Bin, 'id' | 'qrSlug'>) {
  // Use the Firestore-generated ID as the QR slug so it's stable and URL-safe
  const ref = doc(col)
  await setDoc(ref, { ...data, qrSlug: ref.id })
  return ref
}

export async function updateBin(id: string, data: Partial<Omit<Bin, 'id' | 'qrSlug'>>) {
  return updateDoc(doc(db, 'bins', id), data)
}

export async function canDeleteBin(id: string) {
  // Only the owner may read every prop; everyone else may only ask about Prime Capitol's (the rules refuse a wider query).
  const owner = auth.currentUser?.email?.toLowerCase() === OWNER_EMAIL
  const items = await getDocs(owner
    ? query(collection(db, 'items'), where('binId', '==', id))
    : query(collection(db, 'items'), where('collection', '==', 'company'), where('binId', '==', id)))
  // Removed (archived) props keep their old bin but aren't on the shelf, so they don't stop the bin being deleted.
  const onShelf = items.docs.filter(d => d.get('archived') !== true).length
  return { canDelete: onShelf === 0, itemCount: onShelf }
}

export async function deleteBin(id: string) {
  return deleteDoc(doc(db, 'bins', id))
}

