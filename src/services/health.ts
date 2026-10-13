import { doc, onSnapshot, setDoc, updateDoc, deleteField, arrayUnion, arrayRemove, collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

// "Not a duplicate" decisions on the Health page, shared by the whole arts team.
const ref = doc(db, 'health', 'dismissed')

export function pairKey(a: string, b: string) {
  return [a, b].sort().join('|')
}

export function subscribeToDismissedPairs(cb: (keys: Set<string>) => void) {
  return onSnapshot(ref, snap => cb(new Set(snap.data()?.duplicatePairs ?? [])), () => cb(new Set()))
}

export function dismissDuplicatePair(a: string, b: string) {
  return setDoc(ref, { duplicatePairs: arrayUnion(pairKey(a, b)) }, { merge: true })
}

// Find duplicates: pairs set aside to decide later with the prop people (shared by the team).
const laterRef = doc(db, 'health', 'later')

export function subscribeToLaterPairs(cb: (keys: Set<string>) => void) {
  return onSnapshot(laterRef, snap => cb(new Set(snap.data()?.duplicatePairs ?? [])), () => cb(new Set()))
}

// keys from pairKey(); a whole look-alike group at once.
export function setPairsLater(keys: string[], later: boolean) {
  if (!keys.length) return Promise.resolve()
  return setDoc(laterRef, { duplicatePairs: later ? arrayUnion(...keys) : arrayRemove(...keys) }, { merge: true })
}

export function dismissDuplicatePairs(keys: string[]) {
  if (!keys.length) return Promise.resolve()
  return setDoc(ref, { duplicatePairs: arrayUnion(...keys) }, { merge: true })
}

// Find duplicates: props someone CONFIRMED are the same prop but sit in different
// bins. They wait here ("To gather") until the arts department puts them in one bin
// and someone merges them. Shared by the team.
export interface GatherGroup { id: string; ids: string[]; at: string }
const gatherRef = doc(db, 'health', 'gather')

export function subscribeToGatherGroups(cb: (groups: GatherGroup[]) => void) {
  return onSnapshot(gatherRef, snap => {
    const g = (snap.data()?.groups ?? {}) as Record<string, { ids: string[]; at: string }>
    cb(Object.entries(g).map(([id, v]) => ({ id, ids: v.ids ?? [], at: v.at ?? '' })).sort((a, b) => a.at.localeCompare(b.at)))
  }, () => cb([]))
}

export function addGatherGroup(ids: string[]) {
  const id = [...ids].sort().join('_').slice(0, 300)
  return setDoc(gatherRef, { groups: { [id]: { ids, at: new Date().toISOString() } } }, { merge: true })
}

export function removeGatherGroup(id: string) {
  return updateDoc(gatherRef, { [`groups.${id}`]: deleteField() })
}

// For the spreadsheet export: every prop's internal notes in one read.
export async function getAllInternalNotes(): Promise<Record<string, string>> {
  const snap = await getDocs(collection(db, 'item_private'))
  return Object.fromEntries(snap.docs.map(d => [d.id, String(d.data().internalNotes ?? '')]))
}
