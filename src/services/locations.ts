import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, getDocs, where, orderBy,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Location } from '../types'

const col = collection(db, 'locations')

export function subscribeToLocations(cb: (locs: Location[]) => void) {
  return onSnapshot(
    query(col, orderBy('name')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Location))),
    () => cb([]),
  )
}

export async function addLocation(data: Omit<Location, 'id'>) {
  return addDoc(col, data)
}

export async function updateLocation(id: string, data: Partial<Omit<Location, 'id'>>) {
  return updateDoc(doc(db, 'locations', id), data)
}

export async function canDeleteLocation(id: string) {
  const [items, bins] = await Promise.all([
    getDocs(query(collection(db, 'items'), where('locationId', '==', id))),
    getDocs(query(collection(db, 'bins'), where('locationId', '==', id))),
  ])
  return { canDelete: items.empty && bins.empty, itemCount: items.size, binCount: bins.size }
}

export async function deleteLocation(id: string) {
  return deleteDoc(doc(db, 'locations', id))
}
