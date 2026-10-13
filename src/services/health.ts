import { doc, onSnapshot, setDoc, arrayUnion, arrayRemove, collection, getDocs } from 'firebase/firestore'
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

export function setPairLater(a: string, b: string, later: boolean) {
  return setDoc(laterRef, { duplicatePairs: later ? arrayUnion(pairKey(a, b)) : arrayRemove(pairKey(a, b)) }, { merge: true })
}

// For the spreadsheet export: every prop's internal notes in one read.
export async function getAllInternalNotes(): Promise<Record<string, string>> {
  const snap = await getDocs(collection(db, 'item_private'))
  return Object.fromEntries(snap.docs.map(d => [d.id, String(d.data().internalNotes ?? '')]))
}
