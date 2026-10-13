import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { updateItem } from './items'
import type { Condition } from '../types'

// "Suggest an edit": a creator points out something wrong with a prop; the arts
// department applies the proposed changes or dismisses it (with an optional reply).
export interface ProposedChanges { name?: string; quantity?: number; condition?: Condition; description?: string }

export interface Suggestion {
  id: string
  itemId: string
  itemName: string
  by: string
  byName: string
  at: string
  status: 'open' | 'applied' | 'dismissed'
  message: string
  changes: ProposedChanges
  photos?: string[]
  resolvedBy?: string
  resolvedAt?: string
  reply?: string
}

const col = collection(db, 'suggestions')
const toList = (cb: (s: Suggestion[]) => void) => (snap: { docs: { id: string; data: () => unknown }[] }) =>
  cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as Suggestion)).sort((a, b) => b.at.localeCompare(a.at)))

export function addSuggestion(s: Omit<Suggestion, 'id' | 'at' | 'status' | 'by'>) {
  const email = auth.currentUser!.email!.toLowerCase()
  return addDoc(col, { ...s, by: email, at: new Date().toISOString(), status: 'open' })
}

// Staff: everything open, or the most recent resolved ones.
export function subscribeToSuggestions(open: boolean, cb: (s: Suggestion[]) => void) {
  const q = open
    ? query(col, where('status', '==', 'open'))
    : query(col, where('status', 'in', ['applied', 'dismissed']), orderBy('at', 'desc'), limit(50))
  return onSnapshot(q, toList(cb), () => cb([]))
}

// One prop: staff see its open suggestions; creators see their own.
export function subscribeToItemSuggestions(itemId: string, mine: string | null, cb: (s: Suggestion[]) => void) {
  const q = mine
    ? query(col, where('itemId', '==', itemId), where('by', '==', mine))
    : query(col, where('itemId', '==', itemId), where('status', '==', 'open'))
  return onSnapshot(q, toList(cb), () => cb([]))
}

export function resolveSuggestion(id: string, status: 'applied' | 'dismissed', reply?: string) {
  return updateDoc(doc(db, 'suggestions', id), {
    status, resolvedBy: auth.currentUser?.email ?? 'unknown', resolvedAt: new Date().toISOString(),
    ...(reply?.trim() ? { reply: reply.trim().slice(0, 500) } : {}),
  })
}

// Apply the proposed changes to the prop (logged in Activity as this person's edit), then close it.
export async function applySuggestion(s: Suggestion) {
  const c = s.changes ?? {}
  const patch = {
    ...(c.name?.trim() ? { name: c.name.trim() } : {}),
    ...(Number.isInteger(c.quantity) && c.quantity! >= 1 ? { quantity: c.quantity } : {}),
    ...(c.condition ? { condition: c.condition } : {}),
    ...(c.description?.trim() ? { description: c.description.trim() } : {}),
  }
  if (Object.keys(patch).length) await updateItem(s.itemId, patch)
  await resolveSuggestion(s.id, 'applied')
}

export const hasChanges = (c: ProposedChanges | undefined) => !!c && Object.values(c).some(v => v !== undefined && v !== '')
