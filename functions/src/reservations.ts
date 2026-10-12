// Reservations: the only way props get booked. Creators can't write
// reservations directly (the database rules forbid it), so every booking goes
// through these checks.
//
// Double-booking protection: each prop has one item_bookings/{itemId} record
// listing its active holds. Creating a reservation reads and rewrites those
// records inside a transaction, so if two people race for the last unit,
// Firestore makes one of them retry, and the retry sees the unit is gone.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import type { Transaction, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore'
import { db, requireRole, type Caller } from './auth.js'
import {
  checkDates, freeForRange, todayInStudio, earliestStart,
  DEFAULT_BOOKING_SETTINGS, type BookingEntry, type BookingSettings, type DateProblem,
} from './booking.js'

export type ReservationStatus = 'requested' | 'declined' | 'cancelled' | 'returned'
const ACTIVE: ReservationStatus[] = ['requested']

export interface ReservationLine { itemId: string; itemName: string; qty: number; photo?: string }

interface HistoryEntry { status: ReservationStatus; at: string; by: string; reason?: string }

async function loadSettings(): Promise<BookingSettings> {
  const snap = await db.doc('app_settings/booking').get()
  const d = snap.data() ?? {}
  const num = (v: unknown, fallback: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 60 ? v as number : fallback
  return {
    leadTimeDays: num(d.leadTimeDays, DEFAULT_BOOKING_SETTINGS.leadTimeDays),
    bufferDays:   num(d.bufferDays,   DEFAULT_BOOKING_SETTINGS.bufferDays),
  }
}

const DATE_MESSAGES: Record<DateProblem, string> = {
  'bad-format':       'Pick a start and end date.',
  'end-before-start': 'The end date is before the start date.',
  'too-long':         'Reservations can be at most 60 days long.',
  'in-past':          'That date has already passed.',
  'too-soon':         'Props must be requested further ahead.',
}

function cleanLines(raw: unknown): { itemId: string; qty: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpsError('invalid-argument', 'Add at least one prop.')
  if (raw.length > 100) throw new HttpsError('invalid-argument', 'Too many props in one reservation (max 100).')
  const merged = new Map<string, number>()
  for (const l of raw) {
    const itemId = typeof l?.itemId === 'string' ? l.itemId : ''
    const qty = l?.qty
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId) || !Number.isInteger(qty) || qty < 1 || qty > 10000) {
      throw new HttpsError('invalid-argument', 'A prop or quantity in the list is not valid.')
    }
    merged.set(itemId, (merged.get(itemId) ?? 0) + qty)
  }
  return [...merged].map(([itemId, qty]) => ({ itemId, qty }))
}

const bookingsRef = (itemId: string) => db.doc(`item_bookings/${itemId}`)
const entriesOf = (snap: DocumentSnapshot): BookingEntry[] => (snap.get('entries') as BookingEntry[] | undefined) ?? []

// ─── Create ──────────────────────────────────────────────────────────────────

export const createReservation = onCall(async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  const { title, startDate, endDate, notes } = req.data ?? {}
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 120) : ''
  if (!cleanTitle) throw new HttpsError('invalid-argument', 'Give the shoot a name.')
  const lines = cleanLines(req.data?.lines)

  const settings = await loadSettings()
  const today = todayInStudio()
  const problem = checkDates(startDate, endDate, today, settings, caller.isStaff)
  if (problem) {
    const extra = problem === 'too-soon'
      ? ` The earliest start date is ${earliestStart(today, settings, false)} (${settings.leadTimeDays} days ahead).`
      : ''
    throw new HttpsError('invalid-argument', DATE_MESSAGES[problem] + extra, { problem })
  }

  const resRef = db.collection('reservations').doc()
  const now = new Date().toISOString()

  await db.runTransaction(async tx => {
    const itemRefs = lines.map(l => db.doc(`items/${l.itemId}`))
    const snaps = await tx.getAll(...itemRefs, ...lines.map(l => bookingsRef(l.itemId)))
    const itemSnaps = snaps.slice(0, lines.length)
    const bookingSnaps = snaps.slice(lines.length)

    const conflicts: { itemId: string; name: string; requested: number; free: number; reason: string }[] = []
    const saved: ReservationLine[] = []

    lines.forEach((line, i) => {
      const item = itemSnaps[i]
      const name = String(item.get('name') ?? 'Unknown prop')
      if (!item.exists || item.get('archived') === true) {
        conflicts.push({ itemId: line.itemId, name, requested: line.qty, free: 0, reason: 'no longer in the inventory' })
        return
      }
      const damaged = item.get('condition') === 'damaged' || item.get('status') === 'damaged'
      if (damaged && !caller.isStaff) {
        conflicts.push({ itemId: line.itemId, name, requested: line.qty, free: 0, reason: 'damaged' })
        return
      }
      const quantity = Number.isInteger(item.get('quantity')) && item.get('quantity') >= 1 ? item.get('quantity') as number : 1
      const free = freeForRange(
        { quantity, legacyCheckedOut: item.get('status') === 'checked-out' },
        entriesOf(bookingSnaps[i]), startDate, endDate, today, settings.bufferDays,
      )
      if (free < line.qty) {
        conflicts.push({ itemId: line.itemId, name, requested: line.qty, free, reason: 'not enough free for those dates' })
        return
      }
      const photos = item.get('photos') as string[] | undefined
      const photo = photos?.[0] ?? item.get('photoUrl')
      saved.push({ itemId: line.itemId, itemName: name, qty: line.qty, ...(photo ? { photo } : {}) })
    })

    if (conflicts.length) {
      throw new HttpsError('failed-precondition', 'Some props are no longer available for those dates.', { conflicts })
    }

    tx.set(resRef, {
      title: cleanTitle,
      notes: typeof notes === 'string' ? notes.trim().slice(0, 2000) : '',
      creatorEmail: caller.email,
      creatorName: caller.name,
      startDate, endDate,
      status: 'requested',
      lines: saved,
      itemIds: saved.map(l => l.itemId),
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'requested', at: now, by: caller.email }] satisfies HistoryEntry[],
    })
    lines.forEach((line, i) => {
      const entry: BookingEntry = { reservationId: resRef.id, start: startDate, end: endDate, qty: line.qty }
      tx.set(bookingsRef(line.itemId), { entries: [...entriesOf(bookingSnaps[i]), entry] })
    })
  })

  return { id: resRef.id }
})

// ─── Ending a reservation (cancel / decline / returned) ─────────────────────

async function endReservation(
  caller: Caller, id: unknown, to: ReservationStatus, check: (res: FirebaseFirestore.DocumentData) => void, reason?: string,
) {
  if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing reservation')
  const ref = db.doc(`reservations/${id}`) as DocumentReference
  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'Reservation not found')
    const res = snap.data()!
    if (!ACTIVE.includes(res.status)) throw new HttpsError('failed-precondition', `This reservation is already ${res.status}.`)
    check(res)
    const itemIds: string[] = res.itemIds ?? []
    const bookingSnaps = itemIds.length ? await tx.getAll(...itemIds.map(bookingsRef)) : []
    const now = new Date().toISOString()
    tx.update(ref, {
      status: to,
      updatedAt: now,
      ...(reason ? { statusReason: reason } : {}),
      history: [...(res.history ?? []), { status: to, at: now, by: caller.email, ...(reason ? { reason } : {}) }],
    })
    // Release the holds so the props become bookable again.
    itemIds.forEach((itemId, i) => {
      tx.set(bookingsRef(itemId), { entries: entriesOf(bookingSnaps[i]).filter(e => e.reservationId !== id) })
    })
  })
  return { ok: true }
}

export const cancelReservation = onCall(async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  return endReservation(caller, req.data?.id, 'cancelled', res => {
    if (!caller.isStaff && res.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not your reservation')
  })
})

export const declineReservation = onCall(async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const reason = typeof req.data?.reason === 'string' ? req.data.reason.trim().slice(0, 500) : ''
  if (!reason) throw new HttpsError('invalid-argument', 'Tell the creator why it was declined.')
  return endReservation(caller, req.data?.id, 'declined', () => {}, reason)
})

// Phase 3 placeholder for the full return check-in (Phase 5): frees the props.
export const markReservationReturned = onCall(async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  return endReservation(caller, req.data?.id, 'returned', () => {})
})
