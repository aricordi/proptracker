import { collection, onSnapshot, doc, query, where, orderBy, limit } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { BundlePiece, GearCategory, OfferKind } from '../../functions/src/gearStock'
import type { GearHold } from '../../functions/src/gearBooking'

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
  missing?: { itemId: string; name: string; qty: number; at: string; bookingId: string }[]   // reported missing, until found
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

// ─── Booking gear (step 2) ───────────────────────────────────────────────────
export * from '../../functions/src/gearBooking'

export interface GearBookingLine {
  offerId: string; kind: OfferKind; name: string; qty: number; photo?: string | null
  pieces: { itemId: string; qty: number; name: string }[]
}
export interface GearMissing { offerId: string; itemId: string; name: string; qty: number }
export interface GearBooking {
  id: string
  title: string; notes?: string
  creatorEmail: string; creatorName?: string
  date: string; start: number; end: number; from: string; to: string; pickupDay: string; closedDay?: boolean
  lines: GearBookingLine[]; offerIds: string[]
  shootId?: string   // set when booked together with props (one shoot)
  status: 'held' | 'out' | 'returned' | 'checked_in' | 'cancelled' | 'declined'
  declineReason?: string
  pickup?: { at: string; by: string; missing: GearMissing[] }
  return?: { at: string; by: string; photos: string[] }
  returnedAt?: string; returnedLate?: boolean
  checkIn?: { at: string; by: string; missing: GearMissing[]; note?: string }
  problems?: (GearMissing & { kind: 'missing_after' | 'missing_at_checkin'; at: string; reportedOn?: string })[]
  alerts?: { kind: string; at: string; count: number }[]
  createdAt: string
  history: { at: string; by: string; action: string; note?: string }[]
}

// Every bundle's/extra's holds (times only), for showing what's free.
export function subscribeToGearHolds(cb: (byOffer: Record<string, GearHold[]>) => void) {
  return onSnapshot(collection(db, 'gear_holds'),
    snap => cb(Object.fromEntries(snap.docs.map(d => [d.id, (d.get('entries') ?? []) as GearHold[]]))),
    () => cb({}))
}

// Creators: their own gear bookings. Owner + equipment team: everyone's (newest shoots first).
export function subscribeToGearBookings(mine: string | null, cb: (b: GearBooking[]) => void) {
  const col = collection(db, 'gear_bookings')
  const q = mine ? query(col, where('creatorEmail', '==', mine), orderBy('date', 'desc'), limit(100))
                 : query(col, orderBy('date', 'desc'), limit(200))
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as GearBooking))), () => cb([]))
}

export function subscribeToGearBooking(id: string, cb: (b: GearBooking | null) => void) {
  return onSnapshot(doc(db, 'gear_bookings', id), snap => cb(snap.exists() ? { id: snap.id, ...snap.data() } as GearBooking : null), () => cb(null))
}

export const createGearBooking = httpsCallable<{ title: string; notes?: string; date: string; start: number; end: number; lines: { offerId: string; qty: number }[]; shootId?: string }, { id: string }>(functions, 'createGearBooking')
export const cancelGearBooking = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'cancelGearBooking')
export const declineGearBooking = httpsCallable<{ id: string; reason: string }, { ok: boolean }>(functions, 'declineGearBooking')
export const pickUpGear = httpsCallable<{ id: string; missing: string[]; signed: true }, { ok: boolean }>(functions, 'pickUpGear')
export const returnGear = httpsCallable<{ id: string; photos: string[] }, { ok: boolean }>(functions, 'returnGear')
export const checkInGear = httpsCallable<{ id: string; missing: string[]; note?: string }, { ok: boolean }>(functions, 'checkInGear')
export const markGearFound = httpsCallable<{ offerId: string; index: number }, { ok: boolean }>(functions, 'markGearFound')
