// Reservations: the only way props get booked, packed, collected and returned.
// Creators can't write reservations directly (the database rules forbid it),
// so every step goes through these checks and is logged in `history`.
//
// Journey:  requested → preparing → packed → collected → return_pending → returned
//           (or declined / cancelled before collection)
//
// Double-booking protection: each prop has one item_bookings/{itemId} record
// listing its active holds. Creating a reservation reads and rewrites those
// records inside a transaction, so if two people race for the last unit,
// Firestore makes one of them retry, and the retry sees the unit is gone.
import { assertNotPaused } from './strikes.js'
import { shootToAddTo, noteOnShoot } from './shootLinks.js'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type Transaction, type DocumentSnapshot, type DocumentData } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE, type Caller } from './auth.js'
import { collectionOf } from './collections.js'
import {
  checkDates, freeForRange, todayInStudio, earliestStart, addOpenDays, turnaroundFor, cleanClosedDays, isLate,
  DEFAULT_BOOKING_SETTINGS, type BookingEntry, type BookingSettings, type DateProblem,
} from './booking.js'

export type ReservationStatus =
  | 'requested' | 'preparing' | 'packed' | 'collected' | 'return_pending' | 'returned'
  | 'declined' | 'cancelled'

// Statuses in which the props are still tied up.
const HOLDING: ReservationStatus[] = ['requested', 'preparing', 'packed', 'collected', 'return_pending']
const BEFORE_PACKED: ReservationStatus[] = ['requested', 'preparing']

export interface PickState { state: 'picked' | 'unavailable'; reason?: string; by: string; at: string }
export interface CheckInResult { result: 'ok' | 'damaged' | 'missing'; missingQty?: number; note?: string; by: string; at: string }

export interface ReservationLine {
  itemId: string; itemName: string; qty: number; photo?: string
  pick?: PickState
  checkIn?: CheckInResult
}

export interface BuildLine {
  id: string; description: string; qty: number; refPhoto?: string
  state: 'todo' | 'done' | 'unavailable'; reason?: string
  addedItemId?: string
}

interface HistoryEntry { status: ReservationStatus; at: string; by: string; reason?: string; event?: string }

const STATUS_WORDS: Record<ReservationStatus, string> = {
  requested: 'requested', preparing: 'being prepared', packed: 'packed and ready for pickup',
  collected: 'collected', return_pending: 'returned and being checked', returned: 'returned',
  declined: 'declined', cancelled: 'cancelled',
}

// ─── Small helpers ───────────────────────────────────────────────────────────

export async function loadSettings(): Promise<BookingSettings> {
  const snap = await db.doc('app_settings/booking').get()
  const d = snap.data() ?? {}
  const num = (v: unknown, fallback: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 60 ? v as number : fallback
  return {
    leadTimeDays: num(d.leadTimeDays, DEFAULT_BOOKING_SETTINGS.leadTimeDays),
    buildLeadDays: num(d.buildLeadDays, DEFAULT_BOOKING_SETTINGS.buildLeadDays),
    bufferDays:   num(d.bufferDays,   DEFAULT_BOOKING_SETTINGS.bufferDays),
    maxDays:      Math.max(1, num(d.maxDays, DEFAULT_BOOKING_SETTINGS.maxDays)),
    ...cleanClosedDays(d),
  }
}

const DATE_MESSAGES: Record<DateProblem, string> = {
  'bad-format':       'Pick a start and end date.',
  'end-before-start': 'The end date is before the start date.',
  'too-long':         'That booking is too long.',
  'in-past':          'That date has already passed.',
  'too-soon':         'Props must be requested further ahead.',
}

function text(v: unknown, max: number) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// Photos must be files uploaded to this project's storage.
function cleanPhotos(raw: unknown, { min, max }: { min: number; max: number }): string[] {
  const list = Array.isArray(raw) ? raw : []
  const ok = list.filter((u): u is string => typeof u === 'string' && u.length < 2000 && (
    u.startsWith('https://firebasestorage.googleapis.com/') || u.startsWith('http://127.0.0.1:9199/')))
  if (ok.length !== list.length) throw new HttpsError('invalid-argument', 'A photo link is not valid.')
  if (ok.length < min) throw new HttpsError('invalid-argument', min === 1 ? 'Take at least one photo.' : `Take at least ${min} photos.`)
  return ok.slice(0, max)
}

function cleanLines(raw: unknown): { itemId: string; qty: number }[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new HttpsError('invalid-argument', 'Prop list is not valid.')
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

function cleanBuilds(raw: unknown): BuildLine[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 30) throw new HttpsError('invalid-argument', 'Build requests are not valid.')
  return raw.map((b, i) => {
    const description = text(b?.description, 500)
    const qty = b?.qty
    if (!description || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
      throw new HttpsError('invalid-argument', 'Each build request needs a description and a quantity.')
    }
    const photos = b?.refPhoto ? cleanPhotos([b.refPhoto], { min: 1, max: 1 }) : []
    return { id: `b${i + 1}`, description, qty, state: 'todo' as const, ...(photos[0] ? { refPhoto: photos[0] } : {}) }
  })
}

const bookingsRef = (itemId: string) => db.doc(`item_bookings/${itemId}`)
const entriesOf = (snap: DocumentSnapshot): BookingEntry[] => (snap.get('entries') as BookingEntry[] | undefined) ?? []

// Status-change emails are queued here; a sender plugs in once an email
// service is chosen. 'arts-team' means every active arts user plus the owner.
function queueEmail(tx: Transaction, to: string, subject: string, body: string, reservationId: string) {
  tx.set(db.collection('outbox').doc(), {
    to, subject, body, reservationId, createdAt: new Date().toISOString(), sent: false,
  })
}

function creatorUpdate(tx: Transaction, res: DocumentData, id: string, status: ReservationStatus, extra = '') {
  queueEmail(tx, res.creatorEmail, `"${res.title}" is ${STATUS_WORDS[status]}`,
    `Your booking "${res.title}" (${res.startDate} to ${res.endDate}) is now ${STATUS_WORDS[status]}.${extra ? `\n\n${extra}` : ''}`, id)
}

// Load a reservation inside a transaction and check the caller may act on it.
async function loadForUpdate(tx: Transaction, id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(id)) throw new HttpsError('invalid-argument', 'Missing reservation')
  const ref = db.doc(`reservations/${id}`)
  const snap = await tx.get(ref)
  if (!snap.exists) throw new HttpsError('not-found', 'Reservation not found')
  return { ref, id, res: snap.data()! }
}

function requireStatus(res: DocumentData, allowed: ReservationStatus[]) {
  if (!allowed.includes(res.status)) {
    throw new HttpsError('failed-precondition', `This booking is ${STATUS_WORDS[res.status as ReservationStatus] ?? res.status}, so that can't be done now.`)
  }
}

function historyWith(res: DocumentData, entry: HistoryEntry) {
  return [...(res.history ?? []), entry]
}

// Remove this reservation's holds from the given props.
async function releaseHolds(tx: Transaction, reservationId: string, itemIds: string[]) {
  if (!itemIds.length) return
  const snaps = await tx.getAll(...itemIds.map(bookingsRef))
  return () => itemIds.forEach((itemId, i) => {
    tx.set(bookingsRef(itemId), { entries: entriesOf(snaps[i]).filter(e => e.reservationId !== reservationId) })
  })
}

// ─── 1. Create ───────────────────────────────────────────────────────────────

// A shoot id from the app: short letters/digits only (it's just a link between bookings).
export const shootIdOf = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(v) ? v : null

export const createReservation = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])   // not arts (owner, Oct 19: arts handle requests, they don't book)
  if (caller.role === 'creator') await assertNotPaused(caller.email)
  const { startDate, endDate } = req.data ?? {}
  const title = text(req.data?.title, 120)
  if (!title) throw new HttpsError('invalid-argument', 'Give the shoot a name.')
  const lines = cleanLines(req.data?.lines)
  const builds = cleanBuilds(req.data?.builds)
  if (lines.length === 0 && builds.length === 0) throw new HttpsError('invalid-argument', 'Add at least one prop.')

  const settings = await loadSettings()
  // Added to a shoot on the schedule: the props are for that shoot's day.
  const shoot = await shootToAddTo(caller, req.data?.scheduleShootId)
  if (shoot && (startDate !== shoot.date || endDate !== shoot.date)) {
    throw new HttpsError('invalid-argument', `Props for this shoot are for its day (${shoot.date}).`, { problem: 'shoot-day' })
  }

  // Creators with props out late can't book more until they bring them back
  // (owner's rule). The arts department is never blocked.
  if (!caller.isStaff) {
    const out = await db.collection('reservations')
      .where('creatorEmail', '==', caller.email).where('status', '==', 'collected').get()
    const late = out.docs.filter(d => isLate('collected', d.get('endDate'), settings))
    if (late.length) {
      const names = late.map(d => `"${d.get('title')}"`).join(', ')
      throw new HttpsError('failed-precondition',
        `Props from ${names} are late. Bring them back to the arts department before booking more.`,
        { problem: 'late', reservationIds: late.map(d => d.id) })
    }
  }

  const today = todayInStudio()
  const problem = checkDates(startDate, endDate, today, settings, caller.isStaff)
  if (problem) {
    const extra = problem === 'too-soon'
      ? ` The earliest start date is ${earliestStart(today, settings, false)} (${settings.leadTimeDays} open days ahead).`
      : problem === 'too-long'
        ? ` Bookings can be at most ${settings.maxDays} day${settings.maxDays === 1 ? '' : 's'}.`
        : ''
    throw new HttpsError('invalid-argument', DATE_MESSAGES[problem] + extra, { problem })
  }
  // New props (things to make or find) need more notice than props from the inventory.
  if (!caller.isStaff && builds.length && startDate < addOpenDays(today, settings.buildLeadDays, settings)) {
    throw new HttpsError('invalid-argument',
      `New props (things to make or find) need ${settings.buildLeadDays} open days' notice. The earliest shoot day for them is ${addOpenDays(today, settings.buildLeadDays, settings)}.`,
      { problem: 'too-soon-build' })
  }

  const resRef = db.collection('reservations').doc()
  const now = new Date().toISOString()
  // Per-category turnaround (e.g. costumes need washing).
  const cats = await db.collection('categories').get()
  const categoryTurnaround = Object.fromEntries(cats.docs.map(d => [d.id, d.get('turnaroundDays') as number | undefined]))

  await db.runTransaction(async tx => {
    const snaps = lines.length
      ? await tx.getAll(...lines.map(l => db.doc(`items/${l.itemId}`)), ...lines.map(l => bookingsRef(l.itemId)))
      : []
    const itemSnaps = snaps.slice(0, lines.length)
    const bookingSnaps = snaps.slice(lines.length)

    const conflicts: { itemId: string; name: string; requested: number; free: number; reason: string }[] = []
    const saved: ReservationLine[] = []

    lines.forEach((line, i) => {
      const item = itemSnaps[i]
      const hidden = collectionOf(item.data()) === 'personal' && caller.role !== 'owner'
      const name = hidden ? 'Unknown prop' : String(item.get('name') ?? 'Unknown prop')
      // The owner's personal props don't exist as far as anyone else is concerned.
      if (!item.exists || item.get('archived') === true || hidden) {
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
        { quantity, missingQty: Number(item.get('missingQty') ?? 0), legacyCheckedOut: item.get('status') === 'checked-out' },
        entriesOf(bookingSnaps[i]), startDate, endDate, today,
        turnaroundFor(item.get('categoryId') ?? item.get('itemType') ?? 'prop', categoryTurnaround, settings.bufferDays),
        settings,
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
      title,
      notes: text(req.data?.notes, 2000),
      // Links the props and gear halves of one shoot request (step 4).
      ...(shoot ? { shootId: shoot.id, scheduleShootId: shoot.id } : shootIdOf(req.data?.shootId) ? { shootId: shootIdOf(req.data?.shootId) } : {}),
      creatorEmail: caller.email,
      creatorName: caller.name,
      startDate, endDate,
      status: 'requested',
      lines: saved,
      builds,
      itemIds: saved.map(l => l.itemId),
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'requested', at: now, by: caller.email }] satisfies HistoryEntry[],
    })
    lines.forEach((line, i) => {
      const entry: BookingEntry = { reservationId: resRef.id, start: startDate, end: endDate, qty: line.qty }
      tx.set(bookingsRef(line.itemId), { entries: [...entriesOf(bookingSnaps[i]), entry] })
    })
    queueEmail(tx, 'arts-team', `New request: "${title}" (${startDate})`,
      `${caller.name} requested ${saved.length} prop(s)${builds.length ? ` and ${builds.length} build(s)` : ''} for ${startDate} to ${endDate}.`, resRef.id)
  })
  if (shoot) await noteOnShoot(shoot.id, caller.email, 'props-added', `${lines.length + builds.length} prop request${lines.length + builds.length === 1 ? '' : 's'}`)

  return { id: resRef.id }
})

// ─── 2. Cancel / decline (before pickup) ─────────────────────────────────────

async function endEarly(caller: Caller, id: unknown, to: 'cancelled' | 'declined', reason: string | undefined,
  check: (res: DocumentData) => void) {
  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, id)
    requireStatus(r.res, ['requested', 'preparing', 'packed'])
    check(r.res)
    const apply = await releaseHolds(tx, r.id, r.res.itemIds ?? [])
    const now = new Date().toISOString()
    apply?.()
    tx.update(r.ref, {
      status: to, updatedAt: now,
      ...(reason ? { statusReason: reason } : {}),
      history: historyWith(r.res, { status: to, at: now, by: caller.email, ...(reason ? { reason } : {}) }),
    })
    if (to === 'declined') creatorUpdate(tx, r.res, r.id, 'declined', `Reason: ${reason}`)
    else if (caller.email === r.res.creatorEmail) queueEmail(tx, 'arts-team', `Cancelled: "${r.res.title}"`, `${caller.name} cancelled their booking.`, r.id)
  })
  return { ok: true }
}

// Used when the shoot these props were for is cancelled.
export const cancelForShoot = (by: Caller, id: string) => endEarly(by, id, 'cancelled', undefined, () => {})

export const cancelReservation = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  return endEarly(caller, req.data?.id, 'cancelled', undefined, res => {
    if (!caller.isStaff && res.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not your reservation')
  })
})

// Change a request before the arts team starts on it: other quantities, props added or
// taken out, new things to make or find. Anything added follows the same notice and
// availability rules as a new request; taking things out is always fine.
export const editReservation = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  if (caller.role === 'creator') await assertNotPaused(caller.email)
  const lines = cleanLines(req.data?.lines)
  const builds = cleanBuilds(req.data?.builds)
  if (lines.length === 0 && builds.length === 0) throw new HttpsError('invalid-argument', 'Nothing left in this request. Cancel it instead.')
  const settings = await loadSettings()
  const today = todayInStudio()
  const cats = await db.collection('categories').get()
  const categoryTurnaround = Object.fromEntries(cats.docs.map(d => [d.id, d.get('turnaroundDays') as number | undefined]))

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    if (!caller.isStaff && r.res.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not your request.')
    if (r.res.status !== 'requested') {
      throw new HttpsError('failed-precondition', 'The arts department has started on this request, so it can\'t be changed here. Message them, or add a new request for the same shoot.')
    }
    const start = r.res.startDate as string, end = r.res.endDate as string
    const oldLines = (r.res.lines ?? []) as ReservationLine[]
    const before = new Map(oldLines.map(l => [l.itemId, l.qty]))
    const adding = lines.some(l => l.qty > (before.get(l.itemId) ?? 0))
    if (!caller.isStaff && adding && start < earliestStart(today, settings, false)) {
      throw new HttpsError('failed-precondition', `It's too late to add props for this day (they need ${settings.leadTimeDays} open days' notice). You can still lower or remove them.`, { problem: 'too-soon' })
    }
    const oldBuilds = (r.res.builds ?? []) as BuildLine[]
    const known = new Set(oldBuilds.map(b => b.description))
    const newBuilds = builds.filter(b => !known.has(b.description))
    if (!caller.isStaff && newBuilds.length && start < addOpenDays(today, settings.buildLeadDays, settings)) {
      throw new HttpsError('failed-precondition', `New props (things to make or find) need ${settings.buildLeadDays} open days' notice, so they can't be added for this day.`, { problem: 'too-soon-build' })
    }

    const ids = [...new Set([...before.keys(), ...lines.map(l => l.itemId)])]
    const snaps = ids.length ? await tx.getAll(...ids.map(id => db.doc(`items/${id}`)), ...ids.map(bookingsRef)) : []
    const itemSnap = new Map(ids.map((id, i) => [id, snaps[i]]))
    const bookingSnap = new Map(ids.map((id, i) => [id, snaps[ids.length + i]]))
    const conflicts: { itemId: string; name: string; requested: number; free: number; reason: string }[] = []
    const saved: ReservationLine[] = []
    for (const line of lines) {
      const item = itemSnap.get(line.itemId)!
      const hidden = collectionOf(item.data()) === 'personal' && caller.role !== 'owner'
      const name = hidden ? 'Unknown prop' : String(item.get('name') ?? 'Unknown prop')
      const had = before.get(line.itemId) ?? 0
      if (line.qty > had) {
        if (!item.exists || item.get('archived') === true || hidden) { conflicts.push({ itemId: line.itemId, name, requested: line.qty, free: 0, reason: 'no longer in the inventory' }); continue }
        if ((item.get('condition') === 'damaged' || item.get('status') === 'damaged') && !caller.isStaff) { conflicts.push({ itemId: line.itemId, name, requested: line.qty, free: 0, reason: 'damaged' }); continue }
        const quantity = Number.isInteger(item.get('quantity')) && item.get('quantity') >= 1 ? item.get('quantity') as number : 1
        const others = entriesOf(bookingSnap.get(line.itemId)!).filter(e => e.reservationId !== r.id)
        const free = freeForRange({ quantity, missingQty: Number(item.get('missingQty') ?? 0), legacyCheckedOut: item.get('status') === 'checked-out' },
          others, start, end, today, turnaroundFor(item.get('categoryId') ?? item.get('itemType') ?? 'prop', categoryTurnaround, settings.bufferDays), settings)
        if (free < line.qty) { conflicts.push({ itemId: line.itemId, name, requested: line.qty, free, reason: 'not enough free for that day' }); continue }
      }
      const kept = oldLines.find(l => l.itemId === line.itemId)
      const photos = item.get('photos') as string[] | undefined
      const photo = kept?.photo ?? photos?.[0] ?? item.get('photoUrl')
      saved.push({ itemId: line.itemId, itemName: kept?.itemName ?? name, qty: line.qty, ...(photo ? { photo } : {}) })
    }
    if (conflicts.length) throw new HttpsError('failed-precondition', 'Some props aren\'t free for that day.', { conflicts })

    // Things to make or find: kept ones stay as they are; new ones are added.
    let n = oldBuilds.reduce((m, b) => Math.max(m, Number(String(b.id).slice(1)) || 0), 0)
    const wanted = new Map(builds.map(b => [b.description, b]))
    const keptBuilds = oldBuilds.filter(b => wanted.has(b.description)).map(b => ({ ...b, qty: wanted.get(b.description)!.qty }))
    const addedBuilds = newBuilds.map(b => ({ ...b, id: `b${++n}` }))

    const now = new Date().toISOString()
    for (const id of ids) {
      const line = saved.find(l => l.itemId === id)
      const others = entriesOf(bookingSnap.get(id)!).filter(e => e.reservationId !== r.id)
      tx.set(bookingsRef(id), { entries: line ? [...others, { reservationId: r.id, start, end, qty: line.qty }] : others })
    }
    tx.update(r.ref, {
      lines: saved, itemIds: saved.map(l => l.itemId), builds: [...keptBuilds, ...addedBuilds], updatedAt: now,
      ...(typeof req.data?.notes === 'string' ? { notes: text(req.data.notes, 2000) } : {}),
      history: historyWith(r.res, { status: 'requested', at: now, by: caller.email, event: 'edited' }),
    })
    if (caller.email === r.res.creatorEmail) queueEmail(tx, 'arts-team', `Changed: "${r.res.title}"`, `${caller.name} changed their request (${saved.length} prop(s)${addedBuilds.length + keptBuilds.length ? `, ${addedBuilds.length + keptBuilds.length} to make or find` : ''}).`, r.id)
  })
  return { ok: true }
})

export const declineReservation = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const reason = text(req.data?.reason, 500)
  if (!reason) throw new HttpsError('invalid-argument', 'Tell the creator why it was declined.')
  return endEarly(caller, req.data?.id, 'declined', reason, () => {})
})

// ─── 3. Picking (arts) ───────────────────────────────────────────────────────

// Tick a prop as picked (or untick it), or mark it not available with a reason.
// "Not available" is final for this booking: its hold is released straight away.
export const setLinePick = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const { itemId, state } = req.data ?? {}
  const reason = text(req.data?.reason, 300)
  if (!['picked', 'todo', 'unavailable'].includes(state)) throw new HttpsError('invalid-argument', 'Unknown pick state')
  if (state === 'unavailable' && !reason) throw new HttpsError('invalid-argument', 'Say why it isn\'t available.')

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    requireStatus(r.res, BEFORE_PACKED)
    const lines = (r.res.lines ?? []) as ReservationLine[]
    const idx = lines.findIndex(l => l.itemId === itemId)
    if (idx < 0) throw new HttpsError('not-found', 'That prop is not in this booking')
    if (lines[idx].pick?.state === 'unavailable') throw new HttpsError('failed-precondition', 'Already marked not available.')

    const apply = state === 'unavailable' ? await releaseHolds(tx, r.id, [itemId]) : undefined
    const now = new Date().toISOString()
    const next = [...lines]
    if (state === 'todo') { const { pick: _drop, ...rest } = next[idx]; next[idx] = rest }
    else next[idx] = { ...next[idx], pick: { state, by: caller.email, at: now, ...(reason ? { reason } : {}) } }

    apply?.()
    const starting = r.res.status === 'requested'
    tx.update(r.ref, {
      lines: next,
      updatedAt: now,
      ...(starting ? { status: 'preparing', history: historyWith(r.res, { status: 'preparing', at: now, by: caller.email }) } : {}),
    })
    if (starting) creatorUpdate(tx, r.res, r.id, 'preparing')
    if (state === 'unavailable') {
      creatorUpdate(tx, r.res, r.id, starting ? 'preparing' : r.res.status,
        `"${lines[idx].itemName}" isn't available: ${reason}`)
    }
  })
  return { ok: true }
})

export const setBuildState = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const { buildId, state } = req.data ?? {}
  const reason = text(req.data?.reason, 300)
  if (!['todo', 'done', 'unavailable'].includes(state)) throw new HttpsError('invalid-argument', 'Unknown build state')
  if (state === 'unavailable' && !reason) throw new HttpsError('invalid-argument', 'Say why it can\'t be made.')

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    requireStatus(r.res, BEFORE_PACKED)
    const builds = (r.res.builds ?? []) as BuildLine[]
    const idx = builds.findIndex(b => b.id === buildId)
    if (idx < 0) throw new HttpsError('not-found', 'That build request is not in this booking')
    const now = new Date().toISOString()
    const next = [...builds]
    const { reason: _old, ...rest } = next[idx]
    next[idx] = { ...rest, state, ...(state === 'unavailable' ? { reason } : {}) }
    const starting = r.res.status === 'requested'
    tx.update(r.ref, {
      builds: next, updatedAt: now,
      ...(starting ? { status: 'preparing', history: historyWith(r.res, { status: 'preparing', at: now, by: caller.email }) } : {}),
    })
    if (starting) creatorUpdate(tx, r.res, r.id, 'preparing')
    if (state === 'unavailable') creatorUpdate(tx, r.res, r.id, starting ? 'preparing' : r.res.status,
      `"${builds[idx].description}" can't be made: ${reason}`)
  })
  return { ok: true }
})

// Everything is picked (or marked not available), photographed, and ready.
export const markPacked = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const photos = cleanPhotos(req.data?.photos, { min: 1, max: 20 })
  const note = text(req.data?.note, 1000)

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    requireStatus(r.res, BEFORE_PACKED)
    const lines = (r.res.lines ?? []) as ReservationLine[]
    const builds = (r.res.builds ?? []) as BuildLine[]
    const unresolved = lines.filter(l => !l.pick).length + builds.filter(b => b.state === 'todo').length
    if (unresolved) throw new HttpsError('failed-precondition', `${unresolved} item(s) still need to be picked or marked not available.`)
    const going = lines.filter(l => l.pick?.state === 'picked').length + builds.filter(b => b.state === 'done').length
    if (!going) throw new HttpsError('failed-precondition', 'Nothing in this booking is available. Decline it instead.')

    const now = new Date().toISOString()
    tx.update(r.ref, {
      status: 'packed', packPhotos: photos, ...(note ? { packNote: note } : {}),
      packedAt: now, packedBy: caller.email, updatedAt: now,
      history: historyWith(r.res, { status: 'packed', at: now, by: caller.email }),
    })
    creatorUpdate(tx, r.res, r.id, 'packed', note ? `Note from the arts department: ${note}` : '')
  })
  return { ok: true }
})

// Mark this reservation's holds as out with the creator (or back), so the app can
// tell which props are late and warn people who booked them next.
async function setOut(tx: Transaction, reservationId: string, itemIds: string[], out: boolean) {
  if (!itemIds.length) return () => {}
  const snaps = await tx.getAll(...itemIds.map(bookingsRef))
  return () => itemIds.forEach((itemId, i) => {
    tx.set(bookingsRef(itemId), {
      entries: entriesOf(snaps[i]).map(e => {
        if (e.reservationId !== reservationId) return e
        const { out: _was, ...rest } = e
        return out ? { ...rest, out: true } : rest
      }),
    })
  })
}

// ─── 4. Pickup (creator signs off) ───────────────────────────────────────────

export const confirmPickup = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  const allReceived = req.data?.allReceived === true
  const issue = text(req.data?.issue, 1000)
  if (!allReceived && !issue) throw new HttpsError('invalid-argument', 'Say what is missing or wrong.')

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    // The point is the creator's own confirmation, so only they can sign.
    if (r.res.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Only the person who booked can confirm pickup.')
    requireStatus(r.res, ['packed'])
    const markOut = await setOut(tx, r.id, r.res.itemIds ?? [], true)
    const now = new Date().toISOString()
    markOut()
    tx.update(r.ref, {
      status: 'collected',
      pickup: { at: now, by: caller.email, allReceived, ...(issue ? { issue } : {}) },
      updatedAt: now,
      history: historyWith(r.res, { status: 'collected', at: now, by: caller.email, ...(issue ? { reason: `Reported at pickup: ${issue}` } : {}) }),
    })
    if (issue) queueEmail(tx, 'arts-team', `Pickup issue: "${r.res.title}"`, `${caller.name} reported at pickup: ${issue}`, r.id)
  })
  return { ok: true }
})

// ─── 5. Return (creator photographs what they left) ──────────────────────────

export const startReturn = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  const photos = cleanPhotos(req.data?.photos, { min: 1, max: 20 })
  const note = text(req.data?.note, 1000)

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    if (r.res.creatorEmail !== caller.email && !caller.isStaff) throw new HttpsError('permission-denied', 'Not your booking')
    requireStatus(r.res, ['collected'])
    const markBack = await setOut(tx, r.id, r.res.itemIds ?? [], false)
    const now = new Date().toISOString()
    markBack()
    tx.update(r.ref, {
      status: 'return_pending',
      returnInfo: { at: now, by: caller.email, photos, ...(note ? { note } : {}), byStaff: r.res.creatorEmail !== caller.email },
      updatedAt: now,
      history: historyWith(r.res, { status: 'return_pending', at: now, by: caller.email }),
    })
    queueEmail(tx, 'arts-team', `Returned: "${r.res.title}"`, `${r.res.creatorName}'s props are back and need checking in.${note ? ` Note: ${note}` : ''}`, r.id)
  })
  return { ok: true }
})

// ─── 6. Check-in (arts confirms each prop's condition) ───────────────────────

export const checkIn = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const photos = cleanPhotos(req.data?.photos ?? [], { min: 0, max: 20 })
  const results = Array.isArray(req.data?.lines) ? req.data.lines : []
  const buildChoices = Array.isArray(req.data?.builds) ? req.data.builds : []

  await db.runTransaction(async tx => {
    const r = await loadForUpdate(tx, req.data?.id)
    // Normally after the creator's return photo; staff can also check in a
    // booking that was dropped off without using the app (flagged).
    requireStatus(r.res, ['return_pending', 'collected'])
    const lines = (r.res.lines ?? []) as ReservationLine[]
    const builds = (r.res.builds ?? []) as BuildLine[]
    const now = new Date().toISOString()

    const nextLines = lines.map(l => {
      if (l.pick?.state !== 'picked') return l
      const given = results.find((x: { itemId?: string }) => x?.itemId === l.itemId)
      if (!given || !['ok', 'damaged', 'missing'].includes(given.result)) {
        throw new HttpsError('invalid-argument', `Check in "${l.itemName}" (fine, damaged or missing).`)
      }
      const missingQty = given.result === 'missing'
        ? Math.min(l.qty, Math.max(1, Number.isInteger(given.missingQty) ? given.missingQty : l.qty))
        : undefined
      const note = text(given.note, 500)
      if (given.result !== 'ok' && !note) throw new HttpsError('invalid-argument', `Add a note for "${l.itemName}".`)
      return { ...l, checkIn: { result: given.result, by: caller.email, at: now, ...(missingQty ? { missingQty } : {}), ...(note ? { note } : {}) } }
    })

    const apply = await releaseHolds(tx, r.id, r.res.itemIds ?? [])

    // Writes start here (all reads are done).
    apply?.()
    for (const l of nextLines) {
      if (!l.checkIn || l.checkIn.result === 'ok') continue
      const ref = db.doc(`items/${l.itemId}`)
      if (l.checkIn.result === 'damaged') {
        tx.set(ref, { condition: 'damaged', updatedAt: now, updatedBy: caller.email }, { merge: true })
      } else {
        tx.set(ref, { missingQty: FieldValue.increment(l.checkIn.missingQty ?? 1), updatedAt: now, updatedBy: caller.email }, { merge: true })
      }
    }

    const nextBuilds = builds.map(b => {
      const choice = buildChoices.find((x: { buildId?: string }) => x?.buildId === b.id)
      if (b.state !== 'done' || choice?.addToInventory !== true) return b
      const itemRef = db.collection('items').doc()
      // No photo yet on purpose: the pack photo shows the whole booking, not this
      // prop. It appears on the Health fix-it list so someone photographs it.
      tx.set(itemRef, {
        name: b.description.slice(0, 120), description: `Built for "${r.res.title}"`,
        categoryId: 'prop', quantity: b.qty, condition: 'good', tags: [], photos: [], collection: 'company',
        status: 'available', archived: false,
        createdAt: now, updatedAt: now, createdBy: caller.email, updatedBy: caller.email,
      })
      return { ...b, addedItemId: itemRef.id }
    })

    const problems = nextLines.filter(l => l.checkIn && l.checkIn.result !== 'ok')
    tx.update(r.ref, {
      status: 'returned',
      lines: nextLines,
      builds: nextBuilds,
      ...(photos.length ? { checkInPhotos: photos } : {}),
      checkedInAt: now, checkedInBy: caller.email,
      ...(r.res.status === 'collected' ? { returnedWithoutCreatorPhoto: true } : {}),
      updatedAt: now,
      history: historyWith(r.res, { status: 'returned', at: now, by: caller.email,
        ...(problems.length ? { reason: problems.map(l => `${l.itemName}: ${l.checkIn!.result}`).join('; ') } : {}) }),
    })
    creatorUpdate(tx, r.res, r.id, 'returned', problems.length
      ? `The arts department noted: ${problems.map(l => `${l.itemName} ${l.checkIn!.result} (${l.checkIn!.note})`).join('; ')}`
      : 'Everything was checked in fine. Thank you!')
  })
  return { ok: true }
})
