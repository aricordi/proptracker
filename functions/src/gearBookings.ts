// Gear bookings: creators hold whole bundles and add-on extras by the hour.
// Holds are written in a transaction together with gear_holds/{offerId}, which is
// what makes double-booking impossible (same idea as item_bookings for props).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { loadSettings } from './reservations.js'
import { todayInStudio } from './booking.js'
import { checkGearTimes, holdWindow, freeQty, pruneHolds, GEAR_TIME_MESSAGES, fmtHours, type GearHold } from './gearBooking.js'

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const GEAR_STAFF = ['owner', 'equipment']

function minutesNow(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now).split(':').map(Number)
  return h * 60 + m
}

interface LineIn { offerId: string; qty: number }
function tidyLines(v: unknown): LineIn[] {
  if (!Array.isArray(v)) return []
  const m = new Map<string, number>()
  for (const l of v) {
    const id = typeof l?.offerId === 'string' ? l.offerId : ''
    const q = Number(l?.qty)
    if (id && Number.isInteger(q) && q >= 1) m.set(id, (m.get(id) ?? 0) + q)
  }
  return [...m].map(([offerId, qty]) => ({ offerId, qty })).slice(0, 30)
}

export const createGearBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  const d = req.data ?? {}
  const lines = tidyLines(d.lines)
  if (!lines.length) throw new HttpsError('invalid-argument', 'Add at least one bundle or extra.')
  const settings = await loadSettings()
  const today = todayInStudio()
  const problem = checkGearTimes(d.date, d.start, d.end, today, minutesNow(), settings, caller.role !== 'creator')
  if (problem) throw new HttpsError('failed-precondition', GEAR_TIME_MESSAGES[problem], { problem })
  const date = d.date as string, start = d.start as number, end = d.end as number
  const win = holdWindow(date, start, end, settings)
  const title = str(d.title, 120) || 'Shoot'
  const now = new Date().toISOString()
  const ref = db.collection('gear_bookings').doc()

  await db.runTransaction(async tx => {
    const offerRefs = lines.map(l => db.doc(`gear_bundles/${l.offerId}`))
    const holdRefs = lines.map(l => db.doc(`gear_holds/${l.offerId}`))
    const [offers, holds] = await Promise.all([tx.getAll(...offerRefs), tx.getAll(...holdRefs)])
    const taken: { name: string; free: number; wanted: number }[] = []
    const out = lines.map((l, i) => {
      const o = offers[i]
      if (!o.exists || o.get('archived') === true) throw new HttpsError('failed-precondition', 'One of these is no longer offered. Remove it and try again.')
      const kind = o.get('kind') === 'extra' ? 'extra' : 'bundle'
      const pieces = (o.get('pieces') as { itemId: string; qty: number; name?: string }[] | undefined) ?? []
      const offered = kind === 'extra' ? (pieces[0]?.qty ?? 0) : 1
      if (kind === 'bundle' && l.qty !== 1) throw new HttpsError('invalid-argument', 'A bundle is booked whole, one at a time.')
      const entries = (holds[i].get('entries') as GearHold[] | undefined) ?? []
      const free = freeQty(offered, entries, win.from, win.to)
      if (free < l.qty) taken.push({ name: String(o.get('name')), free, wanted: l.qty })
      return {
        offerId: l.offerId, kind, name: String(o.get('name') ?? ''), qty: l.qty,
        photo: ((o.get('photos') as string[] | undefined) ?? [])[0] ?? null,
        pieces: pieces.map(p => ({ itemId: p.itemId, qty: kind === 'extra' ? l.qty : p.qty, name: p.name ?? '' })),
        entries,
      }
    })
    if (taken.length) {
      throw new HttpsError('failed-precondition',
        taken.map(t => t.free ? `Only ${t.free} "${t.name}" free for those hours.` : `"${t.name}" is taken for those hours.`).join(' '),
        { problem: 'taken', taken })
    }
    out.forEach((l, i) => tx.set(holdRefs[i], {
      entries: [...pruneHolds(l.entries, today), { bookingId: ref.id, from: win.from, to: win.to, qty: l.qty }],
    }, { merge: true }))
    tx.set(ref, {
      title, notes: str(d.notes, 1000), creatorEmail: caller.email, creatorName: caller.name,
      date, start, end, from: win.from, to: win.to, pickupDay: win.pickup, closedDay: win.closedDay,
      lines: out.map(({ entries: _e, ...l }) => l), offerIds: out.map(l => l.offerId),
      status: 'held', createdAt: now, updatedAt: now,
      history: [{ at: now, by: caller.email, action: 'held', note: `${date} ${fmtHours(start, end)}` }],
    })
  })
  return { id: ref.id }
})

// Release a booking's holds (cancel / decline). Bookings that are already finished stay as they are.
async function release(id: string, by: string, status: 'cancelled' | 'declined', allowed: (b: FirebaseFirestore.DocumentData) => boolean, note?: string) {
  const ref = db.doc(`gear_bookings/${id}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (!allowed(b)) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'held') throw new HttpsError('failed-precondition', 'This booking can no longer be changed.')
    const holdRefs: DocumentReference[] = (b.offerIds as string[]).map(o => db.doc(`gear_holds/${o}`))
    const holds = await tx.getAll(...holdRefs)
    holds.forEach((h, i) => {
      if (!h.exists) return
      tx.update(holdRefs[i], { entries: ((h.get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id) })
    })
    const now = new Date().toISOString()
    tx.update(ref, {
      status, updatedAt: now, ...(note ? { declineReason: note } : {}),
      history: FieldValue.arrayUnion({ at: now, by, action: status, ...(note ? { note } : {}) }),
    })
  })
}

export const cancelGearBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  await release(id, caller.email, 'cancelled', b => GEAR_STAFF.includes(caller.role) || b.creatorEmail === caller.email)
  return { ok: true }
})

export const declineGearBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const id = str(req.data?.id, 100), reason = str(req.data?.reason, 500)
  if (!reason) throw new HttpsError('invalid-argument', 'Say why, so the creator knows what to do next.')
  await release(id, caller.email, 'declined', () => true, reason)
  return { ok: true }
})
