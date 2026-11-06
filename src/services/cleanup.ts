// Clean-up actions for the arts crew (owner, Nov 6). Everything goes through normal prop edits (security rules: staff,
// updatedBy = you), so each change lands in the Activity log. Nothing is deleted: "Remove" archives the prop with a note,
// and "Put back" undoes it.
import { doc, getDoc, getDocs, updateDoc, writeBatch, collection, query, where, documentId } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../firebase'
import type { Item } from '../types'

const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: auth.currentUser!.uid })
const me = () => auth.currentUser?.email?.toLowerCase() ?? ''

/** Props (of these) that are in a current booking: they can't be removed until they're back. */
export async function bookedOf(ids: string[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'item_bookings'), where(documentId(), 'in', ids.slice(i, i + 30))))
    snap.docs.forEach(d => { if (((d.get('entries') as unknown[] | undefined) ?? []).length) out.push(d.id) })
  }
  return out
}

/** How many units are tied up in bookings right now (the most at any one time), so a count isn't lowered below it. */
export async function heldUnits(id: string): Promise<number> {
  const s = await getDoc(doc(db, 'item_bookings', id))
  const entries = (s.get('entries') as { qty?: number; start?: string; end?: string }[] | undefined) ?? []
  // The busiest moment: for each booking, the units of every booking overlapping it (out props count until returned).
  return entries.reduce((most, e) => Math.max(most, entries
    .filter(f => (f.start ?? '') <= (e.end ?? '9') && (e.start ?? '') <= (f.end ?? '9'))
    .reduce((n, f) => n + (Number(f.qty) || 1), 0)), 0)
}

type Changes = Partial<Pick<Item, 'name' | 'quantity' | 'categoryId' | 'binId' | 'locationId' | 'description' | 'notes' | 'condition'>>

/** Save edits and mark the prop as checked ("Looks right"). */
export async function saveChecked(id: string, changes: Changes, checked = true) {
  const { deleteField } = await import('firebase/firestore')
  const data: Record<string, unknown> = { ...changes }
  // "No bin" = no field (like Add a prop); a bin found again clears the bin check's "Needs a bin" mark.
  if ('binId' in data) {
    if (!data.binId) { data.binId = deleteField(); data.locationId = deleteField() }
    else data.lostFromBin = deleteField()
  }
  await updateDoc(doc(db, 'items', id), { ...data, ...(checked ? { reviewedAt: new Date().toISOString(), reviewedBy: me() } : {}), ...stamp() })
}

/** Move props to a bin (or "no bin"), in one go. */
export async function moveToBin(ids: string[], binId: string, locationId: string) {
  const { deleteField } = await import('firebase/firestore')
  await bulkUpdate(ids, binId ? { binId, locationId: locationId || deleteField(), lostFromBin: deleteField() } : { binId: deleteField(), locationId: deleteField() })
}

/** The same change on many props at once (bin, category, checked…), in batches of 400. */
export async function bulkUpdate(ids: string[], changes: Record<string, unknown>) {
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db)
    ids.slice(i, i + 400).forEach(id => b.update(doc(db, 'items', id), { ...changes, ...stamp() }))
    await b.commit()
  }
}

export const markChecked = (ids: string[]) => bulkUpdate(ids, { reviewedAt: new Date().toISOString(), reviewedBy: me() })

/** Take props out of the app (archived + note). Refuses props in a current booking. Returns what it couldn't remove. */
export async function removeProps(ids: string[], note: string): Promise<{ removed: string[]; booked: string[] }> {
  const booked = await bookedOf(ids)
  const ok = ids.filter(id => !booked.includes(id))
  await bulkUpdate(ok, { archived: true, removedAt: new Date().toISOString(), removedBy: me(), removedNote: note.slice(0, 120) })
  return { removed: ok, booked }
}

/** Put removed props back exactly as they were. */
export async function restoreProps(ids: string[]) {
  const { deleteField } = await import('firebase/firestore')
  await bulkUpdate(ids, { archived: false, removedAt: deleteField(), removedBy: deleteField(), removedNote: deleteField() })
}

// Server: props whose photos are the very same picture (same file contents), found from the stored photos' fingerprints.
export interface SamePhotoGroup { ids: string[] }
export const findSamePhotos = httpsCallable<void, { groups: SamePhotoGroup[]; checked: number }>(functions, 'findSamePhotos')

export const REMOVE_REASONS = ['Same prop twice', 'Not a prop', 'Blurry or bad photo', "We don't have it any more", 'Supplies, not a prop'] as const
