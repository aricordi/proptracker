// "More like this" for one prop (owner, Nov 7), two callables that read the fingerprints that already exist
// (item_vectors), so no AI is paid for:
//
//  • propsLike (everyone who can see props, Props-only creators too): for the prop page's "Similar props" and
//    "Booked together" rows, like a shop's "people who viewed this also viewed". Similar = the closest fingerprints;
//    booked together = props asked for in the same request (totals only: no names, titles or dates leave the server).
//  • doublesOf (owner + arts): "Find duplicates" on the prop page ("you often don't notice a duplicate until you're
//    looking at it"). Every clue the clean-up uses (same photo file, fingerprint, name, bin, the AI's cached opinion),
//    for this ONE prop, plus a few looser look-alikes the crew can glance at.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { db, requireRole, CALLABLE } from './auth.js'
import { collectionOf, type PropCollection } from './collections.js'
import { buildDoubles, pairKeyOf, nameWords, storagePath, type AiVerdict, type DoubleItem } from './doubles.js'
import { goesWith, signalsFrom } from './ideaHelpers.js'
import { addDays, todayInStudio } from './booking.js'

const SIMILAR_MAX = 10
const TOGETHER_MAX = 10
const NEAR_MIN = 0.78   // looser look-alikes shown under "Could be the same" on the duplicate check

/** Props asked for in the same requests as this one (last 365 days, not cancelled or declined). Only the requests with
 *  this prop in them are read, so it's always up to date. */
async function togetherWith(id: string) {
  const since = addDays(todayInStudio(), -365)
  const snap = await db.collection('reservations').where('itemIds', 'array-contains', id).select('itemIds', 'status', 'startDate').get()
  const reqs = snap.docs.filter(d => !['cancelled', 'declined'].includes(d.get('status')) && String(d.get('startDate') ?? '') >= since)
    .map(d => ({ itemIds: ((d.get('itemIds') ?? []) as unknown[]).filter((x): x is string => typeof x === 'string') }))
  return goesWith([id], signalsFrom(reqs), new Set([id]), 20, 1)
}

const live = (d: DocumentData | undefined, col: PropCollection) => !!d && d.archived !== true && !d.mergedInto && collectionOf(d) === col
const idOk = (id: unknown): id is string => typeof id === 'string' && !!id && id.length < 200 && !id.includes('/')

/** The prop, if this person may see it (someone else's personal prop reads as "not found"). */
async function propFor(id: unknown, role: string): Promise<{ snap: DocumentSnapshot; col: PropCollection }> {
  if (!idOk(id)) throw new HttpsError('invalid-argument', 'Which prop?')
  const snap = await db.doc(`items/${id}`).get()
  const col = collectionOf(snap.data())
  if (!snap.exists || (col === 'personal' && role !== 'owner')) throw new HttpsError('not-found', "That prop isn't in the app any more.")
  return { snap, col }
}

/** The closest fingerprints to this prop's own (cosine), best first, without the prop itself. */
async function nearest(id: string, limit: number): Promise<{ id: string; score: number }[]> {
  const own = await db.doc(`item_vectors/${id}`).get()
  const e = own.get('embedding')
  const arr: number[] | undefined = e?.toArray ? e.toArray() : Array.isArray(e) ? e : undefined
  if (!arr?.length) return []
  const snap = await db.collection('item_vectors').findNearest({
    vectorField: 'embedding', queryVector: FieldValue.vector(arr), limit: limit + 1, distanceMeasure: 'COSINE', distanceResultField: 'distance',
  }).get()
  return snap.docs.filter(d => d.id !== id).map(d => ({ id: d.id, score: Math.round((1 - Number(d.get('distance') ?? 1)) * 1000) / 1000 }))
}

export const propsLike = onCall({ ...CALLABLE, timeoutSeconds: 30 }, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'admin'], { demoOk: true })
  const { snap, col } = await propFor(req.data?.id, caller.role)
  const id = snap.id
  const [near, together] = await Promise.all([
    nearest(id, 24).catch(() => []),
    togetherWith(id).catch(() => [] as { id: string; times: number }[]),
  ])
  // Only props this person can see and borrow: same collection as this one, not archived, not merged away.
  const ids = [...new Set([...near.map(n => n.id), ...together.map(t => t.id)])]
  const snaps = ids.length ? await db.getAll(...ids.map(x => db.doc(`items/${x}`))) : []
  const ok = new Set(snaps.filter(s => s.exists && live(s.data(), col)).map(s => s.id))
  return {
    similar: near.filter(n => ok.has(n.id) && n.score >= 0.6).slice(0, SIMILAR_MAX),
    together: together.filter(t => ok.has(t.id)).slice(0, TOGETHER_MAX),
    indexed: near.length > 0,
  }
})

export const doublesOf = onCall({ ...CALLABLE, timeoutSeconds: 60, memory: '512MiB' }, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const { snap, col } = await propFor(req.data?.id, caller.role)
  const id = snap.id
  const docs = (await db.collection('items').where('collection', '==', col).get()).docs.filter(d => live(d.data(), col) || d.id === id)
  const items: DoubleItem[] = docs.map(d => ({ id: d.id, name: String(d.get('name') ?? ''), binId: (d.get('binId') as string | undefined) ?? null, photos: (d.get('photos') as string[] | undefined) ?? [] }))
  const [[files], near, dismissedDoc] = await Promise.all([
    getStorage().bucket().getFiles({ prefix: 'items/' }),
    nearest(id, 30).catch(() => []),
    db.doc('health/dismissed').get(),
  ])
  const md5ByPath = new Map<string, string>()
  for (const f of files) { const h = f.metadata?.md5Hash; if (h) md5ByPath.set(f.name, String(h)) }
  const dismissed = new Set<string>((dismissedDoc.get('duplicatePairs') as string[] | undefined) ?? [])
  // Only props that could pair with this one: a shared name word, the same photo file, or a close fingerprint.
  const me = items.find(i => i.id === id)!
  const myWords = new Set(nameWords(me.name).filter(w => w.length > 2))
  const myHashes = new Set(me.photos!.map(u => md5ByPath.get(storagePath(u) ?? '')).filter(Boolean))
  const nearIds = new Set(near.map(n => n.id))
  const cands = items.filter(i => i.id !== id && (nearIds.has(i.id)
    || nameWords(i.name).some(w => myWords.has(w))
    || (i.photos ?? []).some(u => myHashes.has(md5ByPath.get(storagePath(u) ?? '')))))
    .slice(0, 400)
  const known = new Set(items.map(i => i.id))
  const lookPairs = near.filter(n => known.has(n.id)).map(n => ({ a: id, b: n.id, score: n.score }))
  const vs = cands.length ? await db.getAll(...cands.map(c => db.doc(`dup_verdicts/${pairKeyOf(id, c.id).replace('|', '__')}`))) : []
  const verdicts = new Map<string, AiVerdict>(vs.filter(v => v.exists).map(v => [String(v.get('key')), { same: v.get('same') === true, confidence: v.get('confidence'), reason: String(v.get('reason') ?? '') }]))
  const pairs = buildDoubles({ items: [me, ...cands], md5ByPath, lookPairs, dismissed, verdicts }).filter(p => p.a === id || p.b === id)
  const inPairs = new Set(pairs.map(p => (p.a === id ? p.b : p.a)))
  return {
    pairs: pairs.slice(0, 20).map(p => ({ id: p.a === id ? p.b : p.a, tier: p.tier, score: p.score, signals: p.signals })),
    near: near.filter(n => known.has(n.id) && !inPairs.has(n.id) && !dismissed.has(pairKeyOf(id, n.id)) && n.score >= NEAR_MIN).slice(0, 8),
    indexed: near.length > 0,
  }
})
