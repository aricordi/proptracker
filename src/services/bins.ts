import {
  collection, updateDoc, deleteDoc,
  doc, onSnapshot, query, getDocs, where, orderBy, setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
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
  const items = await getDocs(query(collection(db, 'items'), where('binId', '==', id)))
  return { canDelete: items.empty, itemCount: items.size }
}

export async function deleteBin(id: string) {
  return deleteDoc(doc(db, 'bins', id))
}

export async function getBinBySlug(qrSlug: string): Promise<Bin | null> {
  const snap = await getDocs(query(col, where('qrSlug', '==', qrSlug)))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as Bin
}
