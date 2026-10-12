import { collection, doc, onSnapshot, query, where, orderBy, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '../firebase'
import {
  DEFAULT_BOOKING_SETTINGS, type BookingEntry, type BookingSettings,
} from '../../functions/src/booking'

export type ReservationStatus = 'requested' | 'declined' | 'cancelled' | 'returned'

export interface ReservationLine { itemId: string; itemName: string; qty: number; photo?: string }

export interface Reservation {
  id: string
  title: string
  notes?: string
  creatorEmail: string
  creatorName: string
  startDate: string
  endDate: string
  status: ReservationStatus
  statusReason?: string
  lines: ReservationLine[]
  createdAt: string
  updatedAt: string
  history: { status: ReservationStatus; at: string; by: string; reason?: string }[]
}

export const ACTIVE_STATUSES: ReservationStatus[] = ['requested']

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
    snap => cb({ ...DEFAULT_BOOKING_SETTINGS, ...(snap.data() ?? {}) } as BookingSettings),
    () => cb(DEFAULT_BOOKING_SETTINGS))
}

export function saveBookingSettings(s: BookingSettings) {
  return setDoc(doc(db, 'app_settings', 'booking'), {
    leadTimeDays: s.leadTimeDays,
    bufferDays: s.bufferDays,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.currentUser?.email ?? 'unknown',
  })
}

export interface Conflict { itemId: string; name: string; requested: number; free: number; reason: string }

export const createReservation = httpsCallable<
  { title: string; startDate: string; endDate: string; notes: string; lines: { itemId: string; qty: number }[] },
  { id: string }
>(functions, 'createReservation')

export const cancelReservation  = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'cancelReservation')
export const declineReservation = httpsCallable<{ id: string; reason: string }, { ok: boolean }>(functions, 'declineReservation')
export const markReservationReturned = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'markReservationReturned')
