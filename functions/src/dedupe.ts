// Finding and merging duplicate props after the big import.
//
//  • findDuplicates (staff): compares every Prime Capitol prop with every other
//    using the smart-search fingerprints that already exist (item_vectors), so
//    it costs nothing. Returns the most alike pairs, minus ones marked
//    "not duplicates" (health/dismissed, shared with the Health page).
//  • comparePropPhotos (staff): optional "Ask AI" — Gemini looks at both photos.
//    Counted against the import's hard cost cap.
//  • mergeProps (owner): keeps one prop, adds the other's photos (and quantity, for
//    identical copies), then removes the other: deleted if it came from the import
//    and was never booked, otherwise archived so no history is lost.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { comparePropPhotos as askGemini, GEMINI_API_KEY } from './gemini.js'
import { reserveBudget, BUDGET, RESERVE_USD, everBooked } from './importer.js'

const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }
export const pairKey = (a: string, b: string) => [a, b].sort().join('|')
export const MIN_SIMILARITY = 0.86

const usable = (d: DocumentData | undefined) => !!d && d.collection === 'company' && d.archived !== true

export const findDuplicates = onCall({ ...CALLABLE, timeoutSeconds: 120, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const min = typeof req.data?.min === 'number' && req.data.min >= 0.5 && req.data.min < 1 ? req.data.min : MIN_SIMILARITY

  const items = (await db.collection('items').where('collection', '==', 'company').get()).docs.filter(d => usable(d.data()))
  const vectors: { id: string; v: Float32Array }[] = []
  for (let i = 0; i < items.length; i += 300) {
    const chunk = items.slice(i, i + 300)
    const snaps = await db.getAll(...chunk.map(d => db.doc(`item_vectors/${d.id}`)))
    snaps.forEach(s => {
      const e = s.get('embedding')
      const arr: number[] | undefined = e?.toArray ? e.toArray() : Array.isArray(e) ? e : undefined
      if (arr?.length) vectors.push({ id: s.id, v: Float32Array.from(arr) })
    })
  }
  const dismissed = new Set<string>(((await db.doc('health/dismissed').get()).get('duplicatePairs') as string[] | undefined) ?? [])

  // Fingerprints are unit length, so the dot product is the similarity (1 = identical).
  const pairs: { a: string; b: string; score: number }[] = []
  for (let i = 0; i < vectors.length; i++) {
    const a = vectors[i].v
    for (let j = i + 1; j < vectors.length; j++) {
      const b = vectors[j].v
      let dot = 0
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k]
      if (dot >= min && !dismissed.has(pairKey(vectors[i].id, vectors[j].id))) pairs.push({ a: vectors[i].id, b: vectors[j].id, score: dot })
    }
  }
  pairs.sort((x, y) => y.score - x.score)
  return { pairs: pairs.slice(0, 300), checked: vectors.length, withoutFingerprint: items.length - vectors.length }
})

async function photoOf(item: DocumentData): Promise<{ base64: string; mimeType: string }> {
  const url = (item.photos as string[] | undefined)?.[0] ?? item.photoUrl
  if (!url) throw new HttpsError('failed-precondition', `"${item.name}" has no photo to compare.`)
  const res = await fetch(url)
  if (!res.ok) throw new HttpsError('unavailable', `Couldn't load the photo of "${item.name}".`)
  return { base64: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg' }
}

export const comparePropPhotos = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: '512MiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const [a, b] = await db.getAll(db.doc(`items/${String(req.data?.a ?? 'x')}`), db.doc(`items/${String(req.data?.b ?? 'x')}`))
  if (!usable(a.data()) || !usable(b.data())) throw new HttpsError('not-found', 'Prop not found')
  const budget = await reserveBudget()
  if (!budget.ok) throw new HttpsError('resource-exhausted', `The AI spending cap ($${budget.capUsd}) has been reached. The owner can raise it on the Import screen.`)
  try {
    const { verdict, costUsd } = await askGemini(apiKey(),
      { name: a.get('name'), image: await photoOf(a.data()!) },
      { name: b.get('name'), image: await photoOf(b.data()!) })
    await BUDGET().set({ spentUsd: FieldValue.increment(costUsd - RESERVE_USD) }, { merge: true })
    return verdict
  } catch (err) {
    await BUDGET().set({ spentUsd: FieldValue.increment(-RESERVE_USD) }, { merge: true })
    if (err instanceof HttpsError) throw err
    throw new HttpsError('unavailable', 'The AI could not compare these photos. Try again.')
  }
})

// Owner + arts (owner decision Oct 13: the arts department clears duplicates too).
export const mergeProps = onCall({ ...CALLABLE, timeoutSeconds: 60 }, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const keepId = String(req.data?.keepId ?? ''), removeId = String(req.data?.removeId ?? '')
  const copies = req.data?.mode !== 'angles'   // 'copies' (add up quantity) or 'angles' (photos only)
  if (!keepId || !removeId || keepId === removeId) throw new HttpsError('invalid-argument', 'Pick two different props.')
  const keepRef = db.doc(`items/${keepId}`), removeRef = db.doc(`items/${removeId}`)
  const removeData = (await removeRef.get()).data()
  const deleteIt = !!removeData?.importedFrom && !(await everBooked(removeId))
  const now = new Date().toISOString()

  await db.runTransaction(async tx => {
    const [keep, remove, holds] = await Promise.all([tx.get(keepRef), tx.get(removeRef), tx.get(db.doc(`item_bookings/${removeId}`))])
    if (!usable(keep.data()) || !usable(remove.data())) throw new HttpsError('failed-precondition', 'One of these props is archived, personal or gone already.')
    if (((holds.get('entries') as unknown[] | undefined) ?? []).length) {
      throw new HttpsError('failed-precondition', `"${remove.get('name')}" is in a current booking. Merge it once that booking is checked back in, or keep the other one instead.`)
    }
    const photos = [...((keep.get('photos') as string[] | undefined) ?? []), ...((remove.get('photos') as string[] | undefined) ?? [])]
    const unique = [...new Set(photos)].slice(0, 20)
    tx.update(keepRef, {
      photos: unique, photoUrl: unique[0] ?? FieldValue.delete(),
      ...(copies ? { quantity: FieldValue.increment(Number(remove.get('quantity')) || 1) } : {}),
      updatedAt: now, updatedBy: caller.email,
    })
    if (deleteIt) {
      tx.delete(removeRef)
      tx.delete(db.doc(`item_private/${removeId}`))
      tx.delete(db.doc(`item_bookings/${removeId}`))
      for (const t of (remove.get('tags') as string[] | undefined) ?? []) tx.set(db.doc(`tags/${t}`), { usageCount: FieldValue.increment(-1) }, { merge: true })
    } else {
      tx.update(removeRef, { archived: true, mergedInto: keepId, updatedAt: now, updatedBy: caller.email })
    }
    tx.set(db.collection('activity').doc(), {
      at: now, by: caller.email, kind: 'prop', action: 'merged', itemIds: [keepId, removeId], itemName: String(keep.get('name') ?? ''),
      reason: `Merged "${remove.get('name')}" into it (${copies ? `+${Number(remove.get('quantity')) || 1} quantity` : 'extra photos'}); the duplicate was ${deleteIt ? 'deleted' : 'archived'}.`,
    })
  })

  // The Drive photos behind the removed prop now belong to the kept one, so a
  // re-import won't bring the duplicate back.
  const records = await db.collection('import_items').where('itemId', '==', removeId).get()
  if (!records.empty) {
    const batch = db.batch()
    records.docs.forEach(r => batch.update(r.ref, { itemId: keepId, mergedInto: keepId }))
    await batch.commit()
  }
  return { keptId: keepId, removed: deleteIt ? 'deleted' : 'archived' }
})

// Bins that are really the same bin ("B.31", "B:31", "B: 31"): move every prop
// in the extra bins into the one being kept, then remove the extra bins.
// Owner + arts. Props themselves are only re-pointed, never removed.
export const mergeBins = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const keepId = String(req.data?.keepId ?? '')
  const removeIds = [...new Set((Array.isArray(req.data?.removeIds) ? req.data.removeIds : []).map(String))]
    .filter(id => id && id !== keepId).slice(0, 20)
  if (!keepId || !removeIds.length) throw new HttpsError('invalid-argument', 'Pick the bin to keep and at least one other.')
  const keep = await db.doc(`bins/${keepId}`).get()
  if (!keep.exists) throw new HttpsError('not-found', 'That bin is gone already.')
  const locationId = keep.get('locationId') as string | undefined
  const now = new Date().toISOString()

  let moved = 0
  const labels: string[] = []
  for (const id of removeIds) {
    const bin = await db.doc(`bins/${id}`).get()
    if (!bin.exists) continue
    labels.push(String(bin.get('label') ?? id))
    const items = await db.collection('items').where('binId', '==', id).get()
    for (let i = 0; i < items.docs.length; i += 400) {
      const batch = db.batch()
      items.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, {
        binId: keepId, ...(locationId ? { locationId } : {}), updatedAt: now, updatedBy: caller.email,
      }))
      await batch.commit()
    }
    moved += items.size
    await bin.ref.delete()
  }
  if (labels.length) {
    await db.collection('activity').add({
      at: now, by: caller.email, kind: 'bin', action: 'merged', itemIds: [], itemName: String(keep.get('label') ?? ''),
      reason: `Merged bin${labels.length === 1 ? '' : 's'} ${labels.map(l => `"${l}"`).join(', ')} into "${keep.get('label')}" (${moved} prop${moved === 1 ? '' : 's'} moved).`,
    })
  }
  return { moved, removed: labels.length }
})
