import { collection, doc, onSnapshot, query, where, orderBy, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '../firebase'
import {
  DEFAULT_BOOKING_SETTINGS, cleanClosedDays, type BookingEntry, type BookingSettings,
} from '../../functions/src/booking'

export type ReservationStatus =
  | 'requested' | 'preparing' | 'packed' | 'collected' | 'return_pending' | 'returned'
  | 'declined' | 'cancelled'

export interface ReservationLine {
  itemId: string; itemName: string; qty: number; photo?: string
  pick?: { state: 'picked' | 'unavailable'; reason?: string; by: string; at: string }
  checkIn?: { result: 'ok' | 'damaged' | 'missing'; missingQty?: number; note?: string; by: string; at: string }
}

export interface BuildLine {
  id: string; description: string; qty: number; refPhoto?: string
  state: 'todo' | 'done' | 'unavailable'; reason?: string; addedItemId?: string
}

export interface Reservation {
  id: string
  title: string
  notes?: string
  creatorEmail: string
  creatorName: string
  shootId?: string   // set when booked together with gear (one shoot)
  startDate: string
  endDate: string
  status: ReservationStatus
  statusReason?: string
  lines: ReservationLine[]
  builds?: BuildLine[]
  packPhotos?: string[]
  packNote?: string
  packedAt?: string
  packedBy?: string
  pickup?: { at: string; by: string; allReceived: boolean; issue?: string }
  returnInfo?: { at: string; by: string; photos: string[]; note?: string; byStaff?: boolean }
  checkInPhotos?: string[]
  checkedInAt?: string
  checkedInBy?: string
  returnedWithoutCreatorPhoto?: boolean
  createdAt: string
  updatedAt: string
  history: { status: ReservationStatus; at: string; by: string; reason?: string; event?: string }[]
}

// Statuses in which props are still tied up (mirrors functions/src/reservations.ts).
export const ACTIVE_STATUSES: ReservationStatus[] = ['requested', 'preparing', 'packed', 'collected', 'return_pending']

export function subscribeToReservations(
  scope: { email: string; all: boolean },
  cb: (list: Reservation[]) => void,
) {
  const col = collection(db, 'reservations')
  const q = scope.all
    ? query(col, orderBy('startDate'))
    : query(col, where('creatorEmail', '==', scope.email), orderBy('startDate'))
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))), () => cb([]))
}

// Every booking that included one prop, newest first (staff only).
export function subscribeToItemReservations(itemId: string, cb: (list: Reservation[]) => void) {
  return onSnapshot(query(collection(db, 'reservations'), where('itemIds', 'array-contains', itemId), orderBy('startDate', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))), () => cb([]))
}

export function subscribeToReservation(id: string, cb: (r: Reservation | null) => void) {
  return onSnapshot(doc(db, 'reservations', id),
    snap => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Reservation) : null),
    () => cb(null))
}

// Every prop's active holds, keyed by item ID. Small: only props with bookings have entries.
export function subscribeToBookings(cb: (byItem: Record<string, BookingEntry[]>) => void) {
  return onSnapshot(collection(db, 'item_bookings'),
    snap => cb(Object.fromEntries(snap.docs.map(d => [d.id, (d.data().entries ?? []) as BookingEntry[]]))),
    () => cb({}))
}

export function subscribeToBookingSettings(cb: (s: BookingSettings) => void) {
  return onSnapshot(doc(db, 'app_settings', 'booking'),
    snap => cb({ ...DEFAULT_BOOKING_SETTINGS, ...(snap.data() ?? {}), ...cleanClosedDays(snap.data() ?? {}) } as BookingSettings),
    () => cb(DEFAULT_BOOKING_SETTINGS))
}

export function saveBookingSettings(s: BookingSettings) {
  return setDoc(doc(db, 'app_settings', 'booking'), {
    leadTimeDays: s.leadTimeDays,
    buildLeadDays: s.buildLeadDays,
    bufferDays: s.bufferDays,
    maxDays: s.maxDays,
    closedWeekdays: s.closedWeekdays,
    closedDates: s.closedDates,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.currentUser?.email ?? 'unknown',
  })
}

export interface Conflict { itemId: string; name: string; requested: number; free: number; reason: string }

export interface NewBuild { description: string; qty: number; refPhoto?: string }

export const createReservation = httpsCallable<
  { title: string; startDate: string; endDate: string; notes: string; lines: { itemId: string; qty: number }[]; builds: NewBuild[]; shootId?: string; scheduleShootId?: string },
  { id: string }
>(functions, 'createReservation')

export const cancelReservation  = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'cancelReservation')
// Change a request while it's still "Requested" (quantities, props out/in, things to make or find).
export const editReservation = httpsCallable<{ id: string; lines: { itemId: string; qty: number }[]; builds: NewBuild[]; notes?: string }, { ok: boolean }>(functions, 'editReservation')
export const declineReservation = httpsCallable<{ id: string; reason: string }, { ok: boolean }>(functions, 'declineReservation')
type Ok = { ok: boolean }
export const setLinePick    = httpsCallable<{ id: string; itemId: string; state: 'picked' | 'todo' | 'unavailable'; reason?: string }, Ok>(functions, 'setLinePick')
export const setBuildState  = httpsCallable<{ id: string; buildId: string; state: 'todo' | 'done' | 'unavailable'; reason?: string }, Ok>(functions, 'setBuildState')
export const markPacked     = httpsCallable<{ id: string; photos: string[]; note?: string }, Ok>(functions, 'markPacked')
export const confirmPickup  = httpsCallable<{ id: string; allReceived: boolean; issue?: string }, Ok>(functions, 'confirmPickup')
export const startReturn    = httpsCallable<{ id: string; photos: string[]; note?: string }, Ok>(functions, 'startReturn')
export const checkIn        = httpsCallable<{
  id: string
  lines: { itemId: string; result: 'ok' | 'damaged' | 'missing'; missingQty?: number; note?: string }[]
  builds: { buildId: string; addToInventory: boolean }[]
  photos: string[]
}, Ok>(functions, 'checkIn')
