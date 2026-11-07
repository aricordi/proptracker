// "Wanted but booked" (functions/src/propWants.ts): a creator opened a prop that's booked out on their shoot's day.
// The prop page notes it quietly (nothing shown); Prop insights reads the records (owner, arts, admins).
import { collection, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { PropWant } from '../lib/propInsights'

const noteFn = httpsCallable<{ itemId: string; day: string }, { noted: boolean }>(functions, 'noteWanted')

// At most once per prop + day for this visit to the app (the server also keeps only one per person).
const sent = new Set<string>()
export function noteWanted(itemId: string, day: string) {
  const key = `${itemId}|${day}`
  if (sent.has(key)) return
  sent.add(key)
  noteFn({ itemId, day }).catch(() => {})   // fire and forget: never bother the creator
}

/** Every record (small: one per prop, day and person). Empty when it can't be read. */
export function subscribeToPropWants(cb: (list: PropWant[]) => void) {
  return onSnapshot(collection(db, 'prop_wants'),
    snap => cb(snap.docs.map(d => ({ itemId: String(d.get('itemId') ?? ''), day: String(d.get('day') ?? ''), email: String(d.get('email') ?? '') }))
      .filter(w => w.itemId && w.day)),
    () => cb([]))
}
