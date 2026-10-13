import { collection, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { BundlePiece, GearCategory, OfferKind } from '../../functions/src/gearStock'

export { GEAR_CATEGORIES, bundledCounts, looseCount, bundleProblems, pieceTotal } from '../../functions/src/gearStock'
export type { BundlePiece, GearCategory, OfferKind } from '../../functions/src/gearStock'

// One kind of gear the company owns ("NP-FZ100 battery", have 6). Gear team only.
export interface GearItem {
  id: string
  name: string
  category: GearCategory
  have: number
  serial?: string | null     // for cameras/drones tracked one by one
  value?: number | null      // replacement value (staff only)
  notes?: string
  photos?: string[]
  archived?: boolean
}

// What creators see and book: a bundle (a case of pieces, booked whole) or an
// add-on extra (one kind of piece; the team sets how many are offered).
export interface GearBundle {
  id: string
  kind?: OfferKind           // missing = 'bundle'
  name: string
  category: GearCategory
  description?: string
  photos?: string[]
  pieces: BundlePiece[]
  archived?: boolean
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })

export function subscribeToGearItems(cb: (items: GearItem[]) => void) {
  return onSnapshot(collection(db, 'gear_items'),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as GearItem)).sort(byName)),
    () => cb([]))
}

export function subscribeToGearBundles(cb: (bundles: GearBundle[]) => void) {
  return onSnapshot(collection(db, 'gear_bundles'),
    snap => cb(snap.docs.map(d => ({ id: d.id, pieces: [], ...d.data() } as unknown as GearBundle)).sort(byName)),
    () => cb([]))
}

export const saveGearItem = httpsCallable<Partial<GearItem>, { id: string }>(functions, 'saveGearItem')
export const saveGearBundle = httpsCallable<Partial<GearBundle>, { id: string }>(functions, 'saveGearBundle')
export const setGearBundleArchived = httpsCallable<{ id: string; archived: boolean }, { ok: boolean }>(functions, 'setGearBundleArchived')
