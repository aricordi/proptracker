import { collection, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '../firebase'

// One record in the activity log (written only by the server).
export interface Activity {
  id: string
  at: string
  by: string
  kind: 'prop' | 'booking'
  action: string
  itemIds: string[]
  itemName?: string
  changes?: { field: string; from: string | number | boolean | null; to: string | number | boolean | null }[]
  reservationId?: string
  title?: string
  creatorEmail?: string
  reason?: string
}

export function subscribeToActivity(
  filter: { itemId?: string; creatorEmail?: string; kind?: 'prop' | 'booking' },
  max: number,
  cb: (list: Activity[]) => void,
) {
  const where_: QueryConstraint[] = []
  if (filter.itemId) where_.push(where('itemIds', 'array-contains', filter.itemId))
  if (filter.creatorEmail) where_.push(where('creatorEmail', '==', filter.creatorEmail))
  if (filter.kind) where_.push(where('kind', '==', filter.kind))
  return onSnapshot(query(collection(db, 'activity'), ...where_, orderBy('at', 'desc'), limit(max)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Activity))),
    () => cb([]))
}
