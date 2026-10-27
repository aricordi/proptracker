// Gear bookings: creators hold whole bundles and add-on extras by the hour.
// Holds are written in a transaction together with gear_holds/{offerId}, which is
// what makes double-booking impossible (same idea as item_bookings for props).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE, OWNER_EMAIL, booksLikeCreator } from './auth.js'
import { loadSettings, shootIdOf } from './reservations.js'
import { assertNotPaused } from './strikes.js'
import { shootToAddTo, noteOnShoot } from './shootLinks.js'
import { todayInStudio } from './booking.js'
import { crewProblem, crewHours, isResponsible, type CrewShoot, type CrewMember } from './gearCrew.js'
import { byCount } from './gearStock.js'
import {
  checkGearTimes, holdWindow, freeQty, pruneHolds, GEAR_TIME_MESSAGES, fmtHours, fmtTime, nowStamp, pickupWindow, pickupOpensAt,
  isGearLate, wasGearReturnedLate, checkLines, countMissing, stamp, GEAR_STEP, GEAR_DAY_END, type GearHold,
} from './gearBooking.js'

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const GEAR_STAFF = ['owner', 'equipment']

function minutesNow(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now).split(':').map(Number)
  return h * 60 + m
}

// Friends filming back to back can share one gear booking (owner, Oct 20). Their shoots must be booked,
// on the same day and in the same place, in one unbroken block with the booker's shoot; the gear then covers
// the whole block. Returns the crew (friends only; the booker is creatorEmail).
async function crewFor(shoot: { id: string; date: string; start: number; end: number; place: string; creatorEmail: string } | null, raw: unknown, booker: { email: string; name: string }): Promise<CrewMember[]> {
  const ids = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)))].slice(0, 6) : []
  if (!ids.length) return []
  if (!shoot) throw new HttpsError('invalid-argument', 'Shared gear needs a shoot on the schedule.')
  const snaps = await Promise.all(ids.filter(i => i !== shoot.id).map(i => db.doc(`shoots/${i}`).get()))
  const friends: CrewShoot[] = snaps.map(s => {
    const x = s.data()
    if (!x || x.status !== 'booked') throw new HttpsError('failed-precondition', 'One of your friends\' shoots is no longer booked.', { problem: 'crew' })
    return { id: s.id, email: x.creatorEmail, name: x.creatorName ?? x.creatorEmail, date: x.date, place: x.place, start: x.start, end: x.end }
  })
  const problem = crewProblem({ id: shoot.id, email: shoot.creatorEmail, name: booker.name, date: shoot.date, place: shoot.place, start: shoot.start, end: shoot.end }, friends)
  if (problem) throw new HttpsError('failed-precondition', problem, { problem: 'crew' })
  return friends.map(f => ({ email: f.email, name: f.name, shootId: f.id }))
}
const crewFields = (crew: CrewMember[]) => ({ crew, crewEmails: crew.map(c => c.email), crewShootIds: crew.map(c => c.shootId) })
export function holderOf(b: FirebaseFirestore.DocumentData): string {
  const by = b.pickup?.by as string | undefined
  return by && isResponsible(b, by) ? by : b.creatorEmail
}
const names = (crew: CrewMember[]) => crew.map(c => c.name.split(' ')[0]).join(', ')

// Late gear blocks new holds for everyone responsible for it (the booker and the crew).
async function hasLateGear(email: string) {
  const [own, shared] = await Promise.all([
    db.collection('gear_bookings').where('creatorEmail', '==', email).where('status', '==', 'out').get(),
    db.collection('gear_bookings').where('crewEmails', 'array-contains', email).get(),
  ])
  // Shared gear that's out: whoever signed for it at pickup holds it until it's back (owner, Oct 20: only the
  // people who actually USED it are responsible; that's ticked at the return).
  return [...own.docs, ...shared.docs].some(b => isGearLate({ status: b.get('status'), to: b.get('to') }, nowStamp()) && holderOf(b.data()) === email)
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
  const caller = await requireRole(req, ['owner', 'creator'])   // not arts (owner, Oct 19: arts handle requests, they don't book)
  if (booksLikeCreator(caller)) await assertNotPaused(caller.email)
  const d = req.data ?? {}
  const lines = tidyLines(d.lines)
  if (!lines.length) throw new HttpsError('invalid-argument', 'Add at least one bundle or extra.')
  const settings = await loadSettings()
  // Added to a shoot on the schedule: the gear is for that shoot's day.
  const shoot = await shootToAddTo(caller, d.scheduleShootId)
  if (shoot && d.date !== shoot.date) throw new HttpsError('invalid-argument', `Gear for this shoot is for its day (${shoot.date}).`, { problem: 'shoot-day' })
  const today = todayInStudio()
  const problem = checkGearTimes(d.date, d.start, d.end, today, minutesNow(), settings, !booksLikeCreator(caller))
  if (problem) throw new HttpsError('failed-precondition', GEAR_TIME_MESSAGES[problem], { problem })
  // Creators with gear that's late coming back can't book more until it's returned.
  if (booksLikeCreator(caller) && await hasLateGear(caller.email)) {
    throw new HttpsError('failed-precondition', 'You have gear that is late coming back. Return it first, then you can book more.', { problem: 'late' })
  }
  const crew = await crewFor(shoot, d.crewShootIds, caller)
  const date = d.date as string, start = d.start as number, end = d.end as number
  if (crew.length && shoot) {
    const h = crewHours([shoot, ...(await Promise.all(crew.map(c => db.doc(`shoots/${c.shootId}`).get()))).map(x => ({ start: x.get('start'), end: x.get('end') }))])
    if (h.start !== start || h.end !== end) throw new HttpsError('invalid-argument', `Shared gear covers the whole block (${fmtHours(h.start, h.end)}).`, { problem: 'crew-hours' })
  }
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
      const kind = byCount(o.get('kind')) ? 'extra' : 'bundle'   // single items book like extras (by count)
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
      ...(shoot ? { shootId: shoot.id, scheduleShootId: shoot.id } : shootIdOf(d.shootId) ? { shootId: shootIdOf(d.shootId) } : {}),
      ...(crew.length ? crewFields(crew) : {}),
      date, start, end, from: win.from, to: win.to, pickupDay: win.pickup, closedDay: win.closedDay,
      lines: out.map(({ entries: _e, ...l }) => l), offerIds: out.map(l => l.offerId),
      status: 'held', createdAt: now, updatedAt: now,
      history: [{ at: now, by: caller.email, action: 'held', note: `${date} ${fmtHours(start, end)}${crew.length ? ` · shared with ${names(crew)}` : ''}` }],
    })
  })
  if (shoot) await noteOnShoot(shoot.id, caller.email, 'gear-added', `${lines.length} gear item${lines.length === 1 ? '' : 's'} · ${fmtHours(start, end)}${crew.length ? ` · shared with ${names(crew)}` : ''}`)
  for (const c of crew) await noteOnShoot(c.shootId, caller.email, 'gear-added', `${caller.name.split(' ')[0]}'s gear, shared with you · ${fmtHours(start, end)}`).catch(() => {})
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

// Used when the shoot this gear was for is cancelled.
export const cancelGearForShoot = (by: string, id: string) => release(id, by, 'cancelled', () => true, 'the shoot was cancelled')

export const cancelGearBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  await release(id, caller.email, 'cancelled', b => GEAR_STAFF.includes(caller.role) || b.creatorEmail === caller.email)
  return { ok: true }
})

// Change held gear before pickup: other bundles or extras, or other hours on the same day.
// Anything added (or new hours) follows the usual notice and availability rules; removing is always fine.
export const editGearBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  if (booksLikeCreator(caller)) await assertNotPaused(caller.email)
  const d = req.data ?? {}
  const id = str(d.id, 100)
  const ref = db.doc(`gear_bookings/${id}`)
  // A friend on shared gear can take themselves off it (before pickup).
  if (d.leave === true) {
    await leaveCrew(id, caller.email, caller.email)
    return { ok: true }
  }
  const lines = tidyLines(d.lines)
  if (!lines.length) throw new HttpsError('invalid-argument', 'Nothing left. Cancel this gear booking instead.')
  const settings = await loadSettings()
  const today = todayInStudio()
  // Changing who shares it: the hours become the new block.
  const pre = (await ref.get()).data()
  let crew: CrewMember[] | null = null, crewH: { start: number; end: number } | null = null
  if (pre && Array.isArray(d.crewShootIds)) {
    const own = pre.scheduleShootId ? (await db.doc(`shoots/${pre.scheduleShootId}`).get()).data() : null
    const shoot = own && own.status === 'booked' ? { id: pre.scheduleShootId as string, date: own.date, start: own.start, end: own.end, place: own.place, creatorEmail: own.creatorEmail } : null
    crew = await crewFor(shoot, d.crewShootIds, { email: pre.creatorEmail, name: pre.creatorName ?? '' })
    if (shoot) crewH = crewHours([shoot, ...(await Promise.all(crew.map(c => db.doc(`shoots/${c.shootId}`).get()))).map(x => ({ start: x.get('start'), end: x.get('end') }))])
  }
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (!GEAR_STAFF.includes(caller.role) && b.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not your booking.')
    if (b.status !== 'held') throw new HttpsError('failed-precondition', 'This gear has been picked up already, so it can\'t be changed.')
    const start = crewH ? crewH.start : Number.isInteger(d.start) ? d.start as number : b.start
    const end = crewH ? crewH.end : Number.isInteger(d.end) ? d.end as number : b.end
    const before = new Map(((b.lines ?? []) as { offerId: string; qty: number }[]).map(l => [l.offerId, l.qty]))
    const adding = lines.some(l => l.qty > (before.get(l.offerId) ?? 0)) || start !== b.start || end !== b.end
    if (adding) {
      const problem = checkGearTimes(b.date, start, end, today, minutesNow(), settings, !booksLikeCreator(caller))
      if (problem) throw new HttpsError('failed-precondition', problem === 'too-soon' ? `${GEAR_TIME_MESSAGES[problem]} You can still remove things.` : GEAR_TIME_MESSAGES[problem], { problem })
    }
    const win = holdWindow(b.date, start, end, settings)
    const ids = [...new Set([...before.keys(), ...lines.map(l => l.offerId)])]
    const offerRefs = ids.map(o => db.doc(`gear_bundles/${o}`)), holdRefs = ids.map(o => db.doc(`gear_holds/${o}`))
    const [offers, holds] = await Promise.all([tx.getAll(...offerRefs), tx.getAll(...holdRefs)])
    const taken: { name: string; free: number; wanted: number }[] = []
    const saved = lines.map(l => {
      const i = ids.indexOf(l.offerId), o = offers[i]
      const kept = (b.lines as { offerId: string }[]).find(x => x.offerId === l.offerId) as Record<string, unknown> | undefined
      if (!o.exists || (o.get('archived') === true && !kept)) throw new HttpsError('failed-precondition', 'One of these is no longer offered. Remove it and try again.')
      const kind = byCount(o.get('kind')) ? 'extra' : 'bundle'   // single items book like extras (by count)
      if (kind === 'bundle' && l.qty !== 1) throw new HttpsError('invalid-argument', 'A bundle is booked whole, one at a time.')
      const pieces = (o.get('pieces') as { itemId: string; qty: number; name?: string }[] | undefined) ?? []
      const others = ((holds[i].get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id)
      const free = freeQty(kind === 'extra' ? (pieces[0]?.qty ?? 0) : 1, others, win.from, win.to)
      if (free < l.qty) taken.push({ name: String(o.get('name')), free, wanted: l.qty })
      return {
        offerId: l.offerId, kind, name: String(o.get('name') ?? ''), qty: l.qty,
        photo: ((o.get('photos') as string[] | undefined) ?? [])[0] ?? null,
        pieces: pieces.map(p => ({ itemId: p.itemId, qty: kind === 'extra' ? l.qty : p.qty, name: p.name ?? '' })),
      }
    })
    if (taken.length) {
      throw new HttpsError('failed-precondition',
        taken.map(t => t.free ? `Only ${t.free} "${t.name}" free for those hours.` : `"${t.name}" is taken for those hours.`).join(' '), { problem: 'taken', taken })
    }
    ids.forEach((o, i) => {
      const line = saved.find(l => l.offerId === o)
      const others = pruneHolds(((holds[i].get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id), today)
      tx.set(holdRefs[i], { entries: line ? [...others, { bookingId: id, from: win.from, to: win.to, qty: line.qty }] : others }, { merge: true })
    })
    const now = new Date().toISOString()
    tx.update(ref, {
      lines: saved, offerIds: saved.map(l => l.offerId), start, end, from: win.from, to: win.to, pickupDay: win.pickup, closedDay: win.closedDay, updatedAt: now,
      ...(crew ? crewFields(crew) : {}),
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'edited',
        note: `${saved.length} item${saved.length === 1 ? '' : 's'} · ${fmtHours(start, end)}${crew ? crew.length ? ` · shared with ${names(crew)}` : ' · not shared' : ''}` }),
    })
  })
  return { ok: true }
})

// Take one friend off shared gear (they left it, or their shoot was cancelled or moved). Held gear only:
// once it's picked up everyone on it stays responsible until it's back. The hours stay as they are.
// If they were at the start or end of the block, the gear hours shrink to the people still on it, so that
// slot frees up for someone else (owner, Oct 20).
export async function leaveCrew(id: string, email: string, by: string, note = 'left the shared gear') {
  const ref = db.doc(`gear_bookings/${id}`)
  const pre = (await ref.get()).data()
  const remaining = ((pre?.crew ?? []) as CrewMember[]).filter(c => c.email !== email)
  const shootIds = [pre?.scheduleShootId, ...remaining.map(c => c.shootId)].filter((x): x is string => typeof x === 'string' && !!x)
  const shoots = (await Promise.all(shootIds.map(sid => db.doc(`shoots/${sid}`).get()))).map(x => x.data()).filter(x => x?.status === 'booked') as { start: number; end: number }[]
  const settings = await loadSettings()
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    const crew = ((b.crew ?? []) as CrewMember[])
    const me = crew.find(c => c.email === email)
    if (!me) throw new HttpsError('failed-precondition', "You're not on this gear.")
    if (b.status !== 'held') throw new HttpsError('failed-precondition', 'This gear is already picked up, so everyone on it stays responsible until it\'s back.')
    const left = crew.filter(c => c.email !== email), now = new Date().toISOString()
    // Shrink the hours only when the block is still whole without them and the booker's shoot is still on.
    const h = pre?.scheduleShootId && shoots.length === shootIds.length ? crewHours(shoots) : null
    const shrink = h && h.start >= b.start && h.end <= b.end && (h.start !== b.start || h.end !== b.end) ? h : null
    const win = shrink ? holdWindow(b.date, shrink.start, shrink.end, settings) : null
    if (shrink && win) {
      const holdRefs = (b.offerIds as string[]).map(o => db.doc(`gear_holds/${o}`))
      const holds = await tx.getAll(...holdRefs)
      holds.forEach((hd, i) => {
        if (!hd.exists) return
        tx.update(holdRefs[i], { entries: ((hd.get('entries') as GearHold[] | undefined) ?? []).map(e => e.bookingId === id ? { ...e, from: win.from, to: win.to } : e) })
      })
    }
    tx.update(ref, { ...crewFields(left), updatedAt: now,
      ...(shrink && win ? { start: shrink.start, end: shrink.end, from: win.from, to: win.to, pickupDay: win.pickup, closedDay: win.closedDay } : {}),
      history: FieldValue.arrayUnion({ at: now, by, action: 'edited', note: `${me.name.split(' ')[0]} ${note}${shrink ? ` · gear now ${fmtHours(shrink.start, shrink.end)}` : ''}` }) })
  })
}

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
  // Handed over on the spot: the person who handed it over had it last.
  if (pre.handedFrom?.bookingId) for (const offerId of (pre.offerIds as string[])) previous.set(offerId, pre.handedFrom.bookingId)
  else for (const offerId of (pre.offerIds as string[])) {
    const q = await db.collection('gear_bookings').where('offerIds', 'array-contains', offerId).get()
    const last = q.docs.filter(d => d.id !== id && ['returned', 'checked_in'].includes(d.get('status')) && String(d.get('to')) <= pre.from)
      .sort((a, b) => String(b.get('to')).localeCompare(String(a.get('to'))))[0]
    if (last) previous.set(offerId, last.id)
  }

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()!
    if (!isResponsible(b, caller.email) && !GEAR_STAFF.includes(caller.role)) throw new HttpsError('permission-denied', 'Only the people on this booking (or the equipment team) can pick it up.')
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
      tx.update(p.ref, { problems: FieldValue.arrayUnion(...mine.map(m => ({ kind: 'missing_after', ...m, at: now, reportedOn: id, reportedBy: caller.email, usedBy: p.get('usedBy') ?? [p.get('creatorEmail')] }))) })
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

// Shared gear: the person returning (or handing over) ticks who used it. Only they carry it on their record.
function whoUsed(b: FirebaseFirestore.DocumentData, usedIn: string[] | null) {
  const crew = (b.crew ?? []) as CrewMember[]
  let usedBy: string[] = [b.creatorEmail]
  if (crew.length) {
    const people = [b.creatorEmail, ...crew.map(c => c.email)]
    usedBy = people.filter(e => (usedIn ?? people).includes(e))
    if (!usedBy.length) throw new HttpsError('invalid-argument', 'Tick who used the gear.', { problem: 'used-by' })
  }
  const nameOf = (e: string) => e === b.creatorEmail ? String(b.creatorName ?? e) : crew.find(c => c.email === e)?.name ?? e
  return { usedBy, usedByNames: usedBy.map(nameOf), usedNote: crew.length ? `Used by ${usedBy.map(e => nameOf(e).split(' ')[0]).join(', ')}` : '' }
}
const emailsIn = (v: unknown) => Array.isArray(v) ? v.filter((e: unknown): e is string => typeof e === 'string').slice(0, 10) : null

// Bringing it back: one photo of everything in the case with the batteries charging.
// The gear is free for the next booking straight away (the team may check it in later).
export const returnGear = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  const photos = Array.isArray(req.data?.photos) ? req.data.photos.filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 6) : []
  if (!photos.length) throw new HttpsError('invalid-argument', 'Take the return photo first: everything in the case, batteries plugged in.')
  const usedIn = emailsIn(req.data?.usedBy)
  const ref = db.doc(`gear_bookings/${id}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const b = snap.data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (!isResponsible(b, caller.email) && !GEAR_STAFF.includes(caller.role)) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'out') throw new HttpsError('failed-precondition', "This gear isn't out.")
    const holdRefs = (b.offerIds as string[]).map(o => db.doc(`gear_holds/${o}`))
    const holds = await tx.getAll(...holdRefs)
    holds.forEach((h, i) => { if (h.exists) tx.update(holdRefs[i], { entries: ((h.get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id) }) })
    const { usedBy, usedByNames, usedNote } = whoUsed(b, usedIn)
    const now = new Date().toISOString(), at = nowStamp()
    const late = wasGearReturnedLate({ to: b.to, returnedAt: at })
    tx.update(ref, {
      status: 'returned', updatedAt: now, returnedAt: at, returnedLate: late,
      return: { at: now, by: caller.email, photos },
      usedBy, usedByNames,
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'returned', ...(late || usedNote ? { note: [late ? 'Returned late' : '', usedNote].filter(Boolean).join(' · ') } : {}) }),
    })
  })
  return { ok: true }
})

// HAND IT OVER on the spot (owner, Oct 20): someone else needs the gear before it goes back to the cage
// (e.g. a creator on an offsite shoot walks in). The people using it pick who gets it and until when; their
// booking ends now (no return photo: the next person ticks every piece at their pickup, and anything missing goes
// on the record of whoever handed it over). The new person's booking starts now, skips the usual notice, but must
// be free for its hours (it can't eat into someone else's later booking).
export const handOverGear = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  const toEmail = str(req.data?.toEmail, 200).toLowerCase()
  const end = Number(req.data?.end)
  const usedIn = emailsIn(req.data?.usedBy)
  const at = nowStamp(), today = at.slice(0, 10), startMin = Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16))
  if (!Number.isInteger(end) || end % GEAR_STEP !== 0 || end > GEAR_DAY_END || end < startMin + GEAR_STEP) {
    throw new HttpsError('invalid-argument', 'Pick until when they need it (at least half an hour from now, by midnight).', { problem: 'bad-hours' })
  }
  if (!toEmail || toEmail === caller.email) throw new HttpsError('invalid-argument', 'Pick who you are handing it to.')
  const u = (await db.doc(`users/${toEmail}`).get()).data()
  const toOk = toEmail === OWNER_EMAIL || (u?.active === true && ['creator', 'owner'].includes(u.role))
  if (!toOk) throw new HttpsError('failed-precondition', "That person can't book gear.")
  const toName = String(u?.name || (toEmail === OWNER_EMAIL ? 'Alex' : toEmail))
  if (toEmail !== OWNER_EMAIL && u?.role === 'creator') {
    await assertNotPaused(toEmail).catch(() => { throw new HttpsError('failed-precondition', `${toName.split(' ')[0]}'s gear bookings are paused, so they can't take it.`, { problem: 'paused' }) })
    if (await hasLateGear(toEmail)) throw new HttpsError('failed-precondition', `${toName.split(' ')[0]} has gear that's late coming back, so they can't take more.`, { problem: 'late' })
  }
  const ref = db.doc(`gear_bookings/${id}`), next = db.collection('gear_bookings').doc()
  const from = stamp(today, startMin), to = stamp(today, end)
  let handedBy = ''
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Booking not found.')
    if (!isResponsible(b, caller.email) && !GEAR_STAFF.includes(caller.role)) throw new HttpsError('permission-denied', 'Only the people on this gear (or the equipment team) can hand it over.')
    if (b.status !== 'out') throw new HttpsError('failed-precondition', 'Only gear that is picked up can be handed over.')
    if (isResponsible(b, toEmail)) throw new HttpsError('failed-precondition', `${toName.split(' ')[0]} is already on this gear.`)
    const offerIds = b.offerIds as string[]
    const [offers, holds] = await Promise.all([tx.getAll(...offerIds.map(o => db.doc(`gear_bundles/${o}`))), tx.getAll(...offerIds.map(o => db.doc(`gear_holds/${o}`)))])
    const lines = b.lines as { offerId: string; kind: string; qty: number }[]
    const taken: string[] = []
    const kept = offerIds.map((o, i) => {
      const others = ((holds[i].get('entries') as GearHold[] | undefined) ?? []).filter(e => e.bookingId !== id)
      const l = lines.find(x => x.offerId === o)!
      const pieces = (offers[i].get('pieces') as { qty: number }[] | undefined) ?? []
      const offered = l.kind === 'extra' ? (pieces[0]?.qty ?? l.qty) : 1
      if (freeQty(offered, others, from, to) < l.qty) taken.push(String(offers[i].get('name') ?? o))
      return { ref: holds[i].ref, entries: [...pruneHolds(others, today), { bookingId: next.id, from, to, qty: l.qty }] }
    })
    if (taken.length) throw new HttpsError('failed-precondition', `Someone else has ${taken.join(', ')} booked before ${fmtTime(end)}. Pick an earlier time.`, { problem: 'taken' })
    const { usedBy, usedByNames, usedNote } = whoUsed(b, usedIn)
    const now = new Date().toISOString()
    handedBy = caller.name
    kept.forEach(k => tx.set(k.ref, { entries: k.entries }, { merge: true }))
    const late = wasGearReturnedLate({ to: b.to, returnedAt: at })
    tx.update(ref, {
      status: 'checked_in', updatedAt: now, returnedAt: at, returnedLate: late, usedBy, usedByNames,
      handedTo: { email: toEmail, name: toName, bookingId: next.id, at: now },
      checkIn: { at: now, by: caller.email, missing: [], note: `Handed over to ${toName}. They tick every piece at their pickup.` },
      history: FieldValue.arrayUnion({ at: now, by: caller.email, action: 'handed_over', note: [`To ${toName}`, usedNote, late ? 'late' : ''].filter(Boolean).join(' · ') }),
    })
    tx.set(next, {
      title: str(req.data?.title, 120) || String(b.title ?? 'Shoot'), notes: '', creatorEmail: toEmail, creatorName: toName,
      date: today, start: startMin, end, from, to, pickupDay: today, closedDay: false,
      lines: b.lines, offerIds, status: 'held', createdAt: now, updatedAt: now,
      handedFrom: { bookingId: id, email: caller.email, name: caller.name },
      history: [{ at: now, by: caller.email, action: 'held', note: `Handed over by ${caller.name} · ${fmtHours(startMin, end)}` }],
    })
  })
  return { id: next.id, handedBy }
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
      ...(missing.length ? { problems: FieldValue.arrayUnion(...missing.map(m => ({ kind: 'missing_at_checkin', ...m, at: now, reportedBy: caller.email, usedBy: b.usedBy ?? [b.creatorEmail] }))) } : {}),
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
