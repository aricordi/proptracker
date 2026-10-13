// Gear bookings: creators hold whole bundles and add-on extras by the hour.
// Holds are written in a transaction together with gear_holds/{offerId}, which is
// what makes double-booking impossible (same idea as item_bookings for props).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { loadSettings } from './reservations.js'
import { todayInStudio } from './booking.js'
import {
  checkGearTimes, holdWindow, freeQty, pruneHolds, GEAR_TIME_MESSAGES, fmtHours, fmtTime, nowStamp, pickupWindow, pickupOpensAt,
  isGearLate, wasGearReturnedLate, checkLines, countMissing, type GearHold,
} from './gearBooking.js'

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
  // Creators with gear that's late coming back can't book more until it's returned.
  if (caller.role === 'creator') {
    const out = await db.collection('gear_bookings').where('creatorEmail', '==', caller.email).where('status', '==', 'out').get()
    if (out.docs.some(b => isGearLate({ status: 'out', to: b.get('to') }, nowStamp()))) {
      throw new HttpsError('failed-precondition', 'You have gear that is late coming back. Return it first, then you can book more.', { problem: 'late' })
    }
  }
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

// ─── Step 3: pickup check, return photo, check-in ────────────────────────────

type Missing = { offerId: string; itemId: string; name: string; qty: number }
const missingKeysIn = (v: unknown) => Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, 500) : []

// Add (or take back) missing pieces on the bundles themselves, so everyone sees a warning.
function noteMissingOnBundles(tx: FirebaseFirestore.Transaction, bundles: Map<string, FirebaseFirestore.DocumentSnapshot>, missing: Missing[], bookingId: string, at: string) {
  const byOffer = new Map<string, Missing[]>()
  for (const m of missing) byOffer.set(m.offerId, [...(byOffer.get(m.offerId) ?? []), m])
  for (const [offerId, list] of byOffer) {
    const snap = bundles.get(offerId)
    if (!snap?.exists) continue
    const current = (snap.get('missing') as (Missing & { at: string; bookingId: string })[] | undefined) ?? []
    tx.update(snap.ref, { missing: [...current, ...list.map(m => ({ itemId: m.itemId, name: m.name, qty: m.qty, at, bookingId }))] })
  }
}

// The creator (or the team, with them) checks the case at pickup time, reports anything
// missing, and signs. Missing pieces go on the record of whoever had it last.
export const pickUpGear = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  const missingKeys = missingKeysIn(req.data?.missing)
  if (req.data?.signed !== true) throw new HttpsError('invalid-argument', 'Sign to confirm you have the gear.')
  const ref = db.doc(`gear_bookings/${id}`)
  const now = new Date().toISOString(), stampNowText = nowStamp()

  // Who had each bundle last (returned before this booking started).
  const pre = (await ref.get()).data()
  if (!pre) throw new HttpsError('not-found', 'Booking not found.')
  const previous = new Map<string, string>()
  for (const offerId of (pre.offerIds as string[])) {
    const q = await db.collection('gear_bookings').where('offerIds', 'array-contains', offerId).get()
    const last = q.docs.filter(d => d.id !== id && ['returned', 'checked_in'].includes(d.get('status')) && String(d.get('to')) <= pre.from)
      .sort((a, b) => String(b.get('to')).localeCompare(String(a.get('to'))))[0]
    if (last) previous.set(offerId, last.id)
  }

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()!
    if (b.creatorEmail !== caller.email && !['owner', 'equipment'].includes(caller.role)) throw new HttpsError('permission-denied', 'Only the creator who booked it (or the equipment team) can pick it up.')
    if (b.status !== 'held') throw new HttpsError('failed-precondition', 'This booking has already been picked up, or was cancelled.')
    const win = pickupWindow(b as { from: string; to: string }, stampNowText)
    if (win === 'early') throw new HttpsError('failed-precondition', `Pickup opens at ${fmtTime(Number(pickupOpensAt(b.from).slice(11, 13)) * 60 + Number(pickupOpensAt(b.from).slice(14, 16)))}.`)
    if (win === 'over') throw new HttpsError('failed-precondition', 'The booked time is over. Ask the equipment team.')
    const lines = checkLines(b.lines)
    const missing = countMissing(lines, missingKeys)
    const offerIds = [...new Set(missing.map(m => m.offerId))]
    const bundleSnaps = new Map((await Promise.all(offerIds.map(o => tx.get(db.doc(`gear_bundles/${o}`))))).map(s => [s.id, s]))
    const prevRefs = [...new Set(missing.map(m => previous.get(m.offerId)).filter((x): x is string => !!x))].map(p => db.doc(`gear_bookings/${p}`))
    const prevSnaps = prevRefs.length ? await tx.getAll(...prevRefs) : []

    noteMissingOnBundles(tx, bundleSnaps, missing, id, now)
    // Recorded against the previous holder (records only, no billing).
    for (const p of prevSnaps) {
      const mine = missing.filter(m => previous.get(m.offerId) === p.id)
      tx.update(p.ref, { problems: FieldValue.arrayUnion(...mine.map(m => ({ kind: 'missing_after', ...m, at: now, reportedOn: id, reportedBy: caller.email }))) })
    }
    tx.update(ref, {
      status: 'out', updatedAt: now,
      pickup: { at: now, by: caller.email, missing },
      ...(missing.length ? { alerts: FieldValue.arrayUnion({ kind: 'missing_at_pickup', at: now, count: missing.reduce((n, m) => n + m.qty, 0) }) } : {}),
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'picked_up',
        ...(missing.length ? { note: `Missing at pickup: ${missing.map(m => `${m.qty}× ${m.name}`).join(', ')}` } : {}) }),
    })
  })
  return { ok: true }
})

// Bringing it back: one photo of everything in the case with the batteries charging.
// The gear is free for the next booking straight away (the team may check it in later).
export const returnGear = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  const photos = Array.isArray(req.data?.photos) ? req.data.photos.filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 6) : []
  if (!photos.length) throw new HttpsError('invalid-argument', 'Take the return photo first: everything in the case, batteries plugged in.')
  const ref = db.doc(`gear_bookings/${id}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (b.creatorEmail !== caller.email && !['owner', 'equipment'].includes(caller.role)) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'out') throw new HttpsError('failed-precondition', "This gear isn't out.")
    const holdRefs = (b.offerIds as string[]).map(o => db.doc(`gear_holds/${o}`))
    const holds = await tx.getAll(...holdRefs)
    holds.forEach((h, i) => { if (h.exists) tx.update(holdRefs[i], { entries: ((h.get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id) }) })
    const now = new Date().toISOString(), at = nowStamp()
    const late = wasGearReturnedLate({ to: b.to, returnedAt: at })
    tx.update(ref, {
      status: 'returned', updatedAt: now, returnedAt: at, returnedLate: late,
      return: { at: now, by: caller.email, photos },
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'returned', ...(late ? { note: 'Returned late' } : {}) }),
    })
  })
  return { ok: true }
})

// The equipment team ticks every piece back in (optional between uses). Missing pieces go on
// this booking's record and show as a warning on the bundle until someone marks them found.
export const checkInGear = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const id = str(req.data?.id, 100)
  const missingKeys = missingKeysIn(req.data?.missing)
  const note = str(req.data?.note, 500)
  const ref = db.doc(`gear_bookings/${id}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (b.status !== 'returned') throw new HttpsError('failed-precondition', 'Only gear that has been returned can be checked in.')
    const missing = countMissing(checkLines(b.lines), missingKeys)
    const offerIds = [...new Set(missing.map(m => m.offerId))]
    const bundleSnaps = new Map((await Promise.all(offerIds.map(o => tx.get(db.doc(`gear_bundles/${o}`))))).map(s => [s.id, s]))
    const now = new Date().toISOString()
    noteMissingOnBundles(tx, bundleSnaps, missing, id, now)
    tx.update(ref, {
      status: 'checked_in', updatedAt: now,
      checkIn: { at: now, by: caller.email, missing, note },
      ...(missing.length ? { problems: FieldValue.arrayUnion(...missing.map(m => ({ kind: 'missing_at_checkin', ...m, at: now, reportedBy: caller.email }))) } : {}),
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'checked_in',
        ...(missing.length ? { note: `Missing: ${missing.map(m => `${m.qty}× ${m.name}`).join(', ')}` } : note ? { note } : {}) }),
    })
  })
  return { ok: true }
})

// "Found it": take a missing-piece warning off a bundle.
export const markGearFound = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const offerId = str(req.data?.offerId, 100), index = Number(req.data?.index)
  const ref = db.doc(`gear_bundles/${offerId}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const list = (snap.get('missing') as unknown[] | undefined) ?? []
    if (!snap.exists || !Number.isInteger(index) || index < 0 || index >= list.length) throw new HttpsError('not-found', 'Already cleared.')
    tx.update(ref, { missing: list.filter((_, i) => i !== index) })
  })
  return { ok: true }
})
