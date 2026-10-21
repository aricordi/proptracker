// Gear (equipment team): the list of every piece of gear, and the bundles built from it.
// Owner + equipment team only. Writes go through these functions (the security rules
// block direct writes) so the "a piece is in one bundle at a time" rule always holds.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, requireRole, CALLABLE } from './auth.js'
import { nowStamp as stampNow, type GearHold } from './gearBooking.js'

const activeHolds = (entries: GearHold[] | undefined) => (entries ?? []).filter(h => h.to > stampNow())
const samePieces = (a: { itemId: string; qty: number }[], b: { itemId: string; qty: number }[]) =>
  a.length === b.length && a.every(p => b.some(q => q.itemId === p.itemId && q.qty === p.qty))
import {
  GEAR_CATEGORIES, tidyPieces, bundleProblems, haveProblem, bundledCounts, looseCount, peakHeld, itemOfferId,
  type StockItem, type StockBundle, type GearCategory, type OfferKind,
} from './gearStock.js'

const GEAR_STAFF = ['owner', 'equipment'] as const
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const category = (v: unknown): GearCategory => GEAR_CATEGORIES.includes(v as GearCategory) ? v as GearCategory : 'Other'
const photosOf = (v: unknown) => Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10) : []

const asItem = (id: string, d: FirebaseFirestore.DocumentData): StockItem => ({ id, name: String(d.name ?? ''), have: Number(d.have) || 0, archived: d.archived === true })
const asBundle = (id: string, d: FirebaseFirestore.DocumentData): StockBundle => ({ id, pieces: Array.isArray(d.pieces) ? d.pieces : [], archived: d.archived === true, kind: d.kind })

// "Creators can book" pieces (owner, Oct 21): the app keeps an offer per piece (gear_bundles/item-<id>, kind 'item')
// that offers every unit not in a bundle. Call after all reads in a transaction, with the bundles as they will be.
// Refuses when creators already have more booked at once than would be left, or when a booked piece goes internal.
type Tx = FirebaseFirestore.Transaction
async function readItemHolds(tx: Tx, itemIds: string[]) {
  const snaps = itemIds.length ? await tx.getAll(...itemIds.map(id => db.doc(`gear_holds/${itemOfferId(id)}`))) : []
  return new Map(itemIds.map((id, i) => [id, (snaps[i].get('entries') as GearHold[] | undefined) ?? []]))
}
function writeItemOffers(tx: Tx, itemIds: string[], items: Map<string, FirebaseFirestore.DocumentData>, bundlesAfter: StockBundle[],
  offers: Map<string, FirebaseFirestore.DocumentData>, holds: Map<string, GearHold[]>, by: string) {
  const bundled = bundledCounts(bundlesAfter), now = stampNow(), at = new Date().toISOString()
  for (const id of new Set(itemIds)) {
    const d = items.get(id), offer = offers.get(itemOfferId(id)), entries = holds.get(id) ?? []
    const name = String(d?.name ?? '')
    if (d && d.public === true && d.archived !== true) {
      const loose = looseCount({ id, name, have: Number(d.have) || 0 }, bundled), peak = peakHeld(entries, now)
      if (peak > loose) throw new HttpsError('failed-precondition', `Creators have ${peak} "${name}" booked at the same time, so only ${loose} would be left to book. Change it after those bookings (or cancel them).`)
      tx.set(db.doc(`gear_bundles/${itemOfferId(id)}`), { name, kind: 'item', itemId: id, category: category(d.category), description: '', photos: photosOf(d.photos),
        pieces: [{ itemId: id, qty: loose, name }], archived: false, updatedAt: at, updatedBy: by, ...(offer ? {} : { createdAt: at, createdBy: by }) }, { merge: true })
    } else if (offer && offer.archived !== true) {
      if (activeHolds(entries).length) throw new HttpsError('failed-precondition', `Creators have "${name}" booked. It can go internal (or be archived) after those bookings are done, or cancel them.`)
      tx.set(db.doc(`gear_bundles/${itemOfferId(id)}`), { archived: true, updatedAt: at, updatedBy: by }, { merge: true })
    }
  }
}
const offerMap = (bundles: FirebaseFirestore.QuerySnapshot) => new Map(bundles.docs.filter(b => b.get('kind') === 'item').map(b => [b.id, b.data()]))

// Add or edit a piece of gear (e.g. "NP-FZ100 battery", have 6).
export const saveGearItem = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...GEAR_STAFF])
  const d = req.data ?? {}
  const name = str(d.name, 120)
  if (!name) throw new HttpsError('invalid-argument', 'Give it a name.')
  const serial = str(d.serial, 60)
  const have = serial ? 1 : Number(d.have)
  if (!Number.isInteger(have) || have < 0 || have > 10000) throw new HttpsError('invalid-argument', 'How many you have must be a whole number.')
  const value = d.value === null || d.value === '' || d.value === undefined ? null : Number(d.value)
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) throw new HttpsError('invalid-argument', 'Replacement value must be a number.')
  const archived = d.archived === true
  const isPublic = d.public === true   // owner, Oct 21: "Creators can book" vs "Internal only" (the default)
  const now = new Date().toISOString()

  const ref = typeof d.id === 'string' && d.id ? db.doc(`gear_items/${d.id}`) : db.collection('gear_items').doc()
  await db.runTransaction(async tx => {
    const [snap, bundles] = await Promise.all([tx.get(ref), tx.get(db.collection('gear_bundles'))])
    const holds = await readItemHolds(tx, [ref.id])
    if (typeof d.id === 'string' && d.id && !snap.exists) throw new HttpsError('not-found', 'That piece of gear no longer exists.')
    const item = asItem(ref.id, { name, have })
    const all = bundles.docs.map(b => asBundle(b.id, b.data()))
    const problem = haveProblem(item, archived ? 0 : have, all)
    if (problem) throw new HttpsError('failed-precondition', archived ? `Can't archive it: ${problem}` : problem)
    // Bundles keep a copy of each piece's name (creators can't read the gear list).
    for (const b of bundles.docs) {
      const ps = (b.get('pieces') as { itemId: string; qty: number; name?: string }[] | undefined) ?? []
      if (b.get('kind') !== 'item' && ps.some(p => p.itemId === ref.id && p.name !== name)) tx.update(b.ref, { pieces: ps.map(p => p.itemId === ref.id ? { ...p, name } : p) })
    }
    const next = { name, category: category(d.category), have, photos: photosOf(d.photos), archived, public: isPublic }
    writeItemOffers(tx, [ref.id], new Map([[ref.id, next]]), all, offerMap(bundles), holds, caller.email)
    tx.set(ref, {
      name, category: category(d.category), have, serial: serial || null, value, notes: str(d.notes, 500),
      photos: photosOf(d.photos), archived, public: isPublic,
      updatedAt: now, updatedBy: caller.email,
      ...(snap.exists ? {} : { createdAt: now, createdBy: caller.email }),
    }, { merge: true })
  })
  return { id: ref.id }
})

// Build or edit a bundle (or an add-on extra). Only pieces that aren't already in
// another bundle or extra can be used. Creators only ever see these, never loose pieces.
export const saveGearBundle = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...GEAR_STAFF])
  const d = req.data ?? {}
  const name = str(d.name, 120)
  if (!name) throw new HttpsError('invalid-argument', 'Give the bundle a name.')
  const pieces = tidyPieces(d.pieces)
  const kind: OfferKind = d.kind === 'extra' ? 'extra' : 'bundle'
  const now = new Date().toISOString()

  const ref = typeof d.id === 'string' && d.id ? db.doc(`gear_bundles/${d.id}`) : db.collection('gear_bundles').doc()
  await db.runTransaction(async tx => {
    const [snap, items, bundles, holds] = await Promise.all([tx.get(ref), tx.get(db.collection('gear_items')), tx.get(db.collection('gear_bundles')), tx.get(db.doc(`gear_holds/${ref.id}`))])
    if (typeof d.id === 'string' && d.id && !snap.exists) throw new HttpsError('not-found', 'That bundle no longer exists.')
    if (snap.get('kind') === 'item') throw new HttpsError('failed-precondition', 'Single pieces are offered from All gear (Creators can book).')
    const touched = [...new Set([...pieces.map(p => p.itemId), ...((snap.get('pieces') ?? []) as { itemId: string }[]).map(p => p.itemId)])]
    const itemHolds = await readItemHolds(tx, touched)
    if (snap.get('archived') === true) throw new HttpsError('failed-precondition', 'Bring the bundle back before editing it.')
    // What's in it can't change while it's booked or out (the name, photo and description can).
    if (snap.exists && activeHolds(holds.get('entries')).length && !samePieces(pieces, (snap.get('pieces') ?? []) as { itemId: string; qty: number }[])) {
      throw new HttpsError('failed-precondition', "It's booked or out, so what's in it can't change right now. You can still change the name, photo and description.")
    }
    if (snap.exists && (snap.get('kind') ?? 'bundle') !== kind) throw new HttpsError('failed-precondition', "A bundle can't become an add-on extra (or the other way round). Make a new one instead.")
    const problems = bundleProblems(pieces, items.docs.map(i => asItem(i.id, i.data())), bundles.docs.map(b => asBundle(b.id, b.data())), ref.id, kind)
    if (problems.length) throw new HttpsError('failed-precondition', problems.join(' '))
    const after = [...bundles.docs.filter(b => b.id !== ref.id).map(b => asBundle(b.id, b.data())), { id: ref.id, pieces, kind }]
    writeItemOffers(tx, touched, new Map(items.docs.map(i => [i.id, i.data()])), after, offerMap(bundles), itemHolds, caller.email)
    tx.set(ref, {
      name, kind, category: category(d.category), description: str(d.description, 500), photos: photosOf(d.photos),
      // Each piece carries its name so creators can see what's in the case.
      pieces: pieces.map(p => ({ ...p, name: String(items.docs.find(i => i.id === p.itemId)?.get('name') ?? '') })),
      archived: false, updatedAt: now, updatedBy: caller.email,
      ...(snap.exists ? {} : { createdAt: now, createdBy: caller.email }),
    }, { merge: true })
  })
  return { id: ref.id }
})

// Retire a bundle (its pieces become loose again) or bring it back (if the pieces are still free).
export const setGearBundleArchived = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...GEAR_STAFF])
  const id = str(req.data?.id, 100), archived = req.data?.archived === true
  if (!id) throw new HttpsError('invalid-argument', 'Which bundle?')
  const ref = db.doc(`gear_bundles/${id}`)
  await db.runTransaction(async tx => {
    const [snap, items, bundles] = await Promise.all([tx.get(ref), tx.get(db.collection('gear_items')), tx.get(db.collection('gear_bundles'))])
    if (!snap.exists) throw new HttpsError('not-found', 'That bundle no longer exists.')
    if (snap.get('kind') === 'item') throw new HttpsError('failed-precondition', 'Single pieces are offered from All gear (switch it to Internal only).')
    const touched = ((snap.get('pieces') ?? []) as { itemId: string }[]).map(p => p.itemId)
    const itemHolds = await readItemHolds(tx, touched)
    if (archived && activeHolds((await tx.get(db.doc(`gear_holds/${id}`))).get('entries')).length) {
      throw new HttpsError('failed-precondition', "It's booked or out. Archive it after those bookings are done (or cancel them).")
    }
    if (!archived) {
      const problems = bundleProblems(asBundle(id, snap.data()!).pieces, items.docs.map(i => asItem(i.id, i.data())), bundles.docs.map(b => asBundle(b.id, b.data())), id)
      if (problems.length) throw new HttpsError('failed-precondition', `Can't bring it back: ${problems.join(' ')}`)
    }
    const after = bundles.docs.map(b => b.id === id ? { ...asBundle(b.id, b.data()), archived } : asBundle(b.id, b.data()))
    writeItemOffers(tx, touched, new Map(items.docs.map(i => [i.id, i.data()])), after, offerMap(bundles), itemHolds, caller.email)
    tx.update(ref, { archived, updatedAt: new Date().toISOString(), updatedBy: caller.email })
  })
  return { ok: true }
})
