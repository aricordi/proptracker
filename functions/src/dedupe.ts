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
import { comparePropPhotos as askGemini, suggestPropName, GEMINI_API_KEY } from './gemini.js'
import { reserveBudget, BUDGET, RESERVE_USD, everBooked } from './importer.js'
import { getStorage } from 'firebase-admin/storage'
import { buildDoubles, pairKeyOf, type AiVerdict } from './doubles.js'
import { reserveCleanupAi } from './assistant.js'

const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }
export const pairKey = (a: string, b: string) => [a, b].sort().join('|')
export const MIN_SIMILARITY = 0.86

const usable = (d: DocumentData | undefined) => !!d && d.collection === 'company' && d.archived !== true

// The smart-search fingerprints of these props (item_vectors), as unit-length vectors.
async function loadVectors(ids: string[]): Promise<{ id: string; v: Float32Array }[]> {
  const vectors: { id: string; v: Float32Array }[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await db.getAll(...ids.slice(i, i + 300).map(id => db.doc(`item_vectors/${id}`)))
    snaps.forEach(s => {
      const e = s.get('embedding')
      const arr: number[] | undefined = e?.toArray ? e.toArray() : Array.isArray(e) ? e : undefined
      if (arr?.length) vectors.push({ id: s.id, v: Float32Array.from(arr) })
    })
  }
  return vectors
}
// Fingerprints are unit length, so the dot product is the similarity (1 = identical).
function lookPairs(vectors: { id: string; v: Float32Array }[], min: number) {
  const pairs: { a: string; b: string; score: number }[] = []
  for (let i = 0; i < vectors.length; i++) {
    const a = vectors[i].v
    for (let j = i + 1; j < vectors.length; j++) {
      const b = vectors[j].v
      let dot = 0
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k]
      if (dot >= min) pairs.push({ a: vectors[i].id, b: vectors[j].id, score: Math.round(dot * 1000) / 1000 })
    }
  }
  return pairs
}
const dismissedPairs = async () => new Set<string>(((await db.doc('health/dismissed').get()).get('duplicatePairs') as string[] | undefined) ?? [])

export const findDuplicates = onCall({ ...CALLABLE, timeoutSeconds: 120, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const min = typeof req.data?.min === 'number' && req.data.min >= 0.5 && req.data.min < 1 ? req.data.min : MIN_SIMILARITY
  const items = (await db.collection('items').where('collection', '==', 'company').get()).docs.filter(d => usable(d.data()))
  const vectors = await loadVectors(items.map(d => d.id))
  const dismissed = await dismissedPairs()
  const pairs = lookPairs(vectors, min).filter(p => !dismissed.has(pairKey(p.a, p.b)))
  pairs.sort((x, y) => y.score - x.score)
  return { pairs: pairs.slice(0, 1000), checked: vectors.length, withoutFingerprint: items.length - vectors.length }
})

// CLEAN-UP DOUBLES (owner, Nov 6): every clue in one sorted list of pairs (same photo file, fingerprints, names, same bin,
// the AI's cached opinion). See doubles.ts. Free: no AI here. Owner + arts.
export const findDoubles = onCall({ ...CALLABLE, timeoutSeconds: 180, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const docs = (await db.collection('items').where('collection', '==', 'company').get()).docs.filter(d => usable(d.data()))
  const items = docs.map(d => ({ id: d.id, name: String(d.get('name') ?? ''), binId: (d.get('binId') as string | undefined) ?? null, photos: (d.get('photos') as string[] | undefined) ?? [] }))
  const [[files], vectors, dismissed, verdictSnaps] = await Promise.all([
    getStorage().bucket().getFiles({ prefix: 'items/' }),
    loadVectors(docs.map(d => d.id)),
    dismissedPairs(),
    db.collection('dup_verdicts').get(),
  ])
  const md5ByPath = new Map<string, string>()
  for (const f of files) { const h = f.metadata?.md5Hash; if (h) md5ByPath.set(f.name, String(h)) }
  const verdicts = new Map<string, AiVerdict>(verdictSnaps.docs.map(v => [String(v.get('key')), { same: v.get('same') === true, confidence: v.get('confidence'), reason: String(v.get('reason') ?? '') }]))
  const pairs = buildDoubles({ items, md5ByPath, lookPairs: lookPairs(vectors, MIN_SIMILARITY), dismissed, verdicts })
  return { pairs, checked: items.length, withoutFingerprint: items.length - vectors.length }
})

// The AI looks at both photos of up to 30 pairs (small photo versions, 5 at a time). Each answer is kept in dup_verdicts, so
// a pair is never paid for twice. Counts against the monthly AI budget only (the crew goes through thousands). Owner + arts.
const verdictId = (k: string) => k.replace('|', '__')
export const aiCheckPairs = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const asked = (Array.isArray(req.data?.pairs) ? req.data.pairs : []).slice(0, 30)
    .map((p: { a?: unknown; b?: unknown }) => ({ a: String(p?.a ?? ''), b: String(p?.b ?? '') }))
    .filter((p: { a: string; b: string }) => p.a && p.b && p.a !== p.b && !p.a.includes('/') && !p.b.includes('/'))
  const out: Record<string, AiVerdict> = {}
  const todo: { a: string; b: string; k: string }[] = []
  for (const p of asked) {
    const k = pairKeyOf(p.a, p.b)
    const cached = await db.doc(`dup_verdicts/${verdictId(k)}`).get()
    if (cached.exists) out[k] = { same: cached.get('same') === true, confidence: cached.get('confidence'), reason: String(cached.get('reason') ?? '') }
    else todo.push({ ...p, k })
  }
  let resting = false
  for (let i = 0; i < todo.length; i += 5) {
    const chunk = todo.slice(i, i + 5)
    const settle = await reserveCleanupAi('cleanup-compare', chunk.length)
    if (!settle) { resting = true; break }
    let cost = 0
    await Promise.all(chunk.map(async p => {
      try {
        const [A, B] = await db.getAll(db.doc(`items/${p.a}`), db.doc(`items/${p.b}`))
        if (!usable(A.data()) || !usable(B.data())) return
        const { verdict, costUsd } = await askGemini(apiKey(), { name: A.get('name'), image: await photoOf(A.data()!, true) }, { name: B.get('name'), image: await photoOf(B.data()!, true) })
        cost += costUsd
        out[p.k] = verdict
        await db.doc(`dup_verdicts/${verdictId(p.k)}`).set({ key: p.k, ...verdict, at: new Date().toISOString() })
      } catch { /* no photo, or the AI hiccuped: that pair just stays without an AI opinion */ }
    }))
    await settle(cost)
  }
  return { verdicts: out, resting }
})

// AI name suggestions for up to 12 props (owner, Nov 6: "IMG_2034" and other names nobody would search). The crew sees each
// suggestion and accepts or edits it; nothing is renamed here. Monthly AI budget only. Owner + arts.
export const suggestPropNames = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const raw: unknown[] = Array.isArray(req.data?.ids) ? req.data.ids : []
  const ids = [...new Set(raw.map(x => String(x)))].filter(id => !!id && !id.includes('/')).slice(0, 12)
  if (!ids.length) return { names: {}, resting: false }
  const settle = await reserveCleanupAi('cleanup-names', ids.length)
  if (!settle) return { names: {}, resting: true }
  const cats = new Map((await db.collection('categories').get()).docs.map(c => [c.id, String(c.get('label') ?? c.id)]))
  const names: Record<string, string> = {}
  let cost = 0
  await Promise.all(ids.map(async id => {
    try {
      const d = (await db.doc(`items/${id}`).get()).data()
      if (!usable(d)) return
      const image = (d!.photos as string[] | undefined)?.length ? await photoOf(d!, true).catch(() => null) : null
      const r = await suggestPropName(apiKey(), { name: String(d!.name ?? ''), description: String(d!.description ?? ''), category: cats.get(String(d!.categoryId ?? '')) }, image)
      cost += r.costUsd
      if (r.name) names[id] = r.name
    } catch { /* skip this one */ }
  }))
  await settle(cost)
  return { names, resting: false }
})

export async function photoOf(item: DocumentData, small = false): Promise<{ base64: string; mimeType: string }> {
  const first = (item.photos as string[] | undefined)?.[0] ?? item.photoUrl
  // The small version (≤480px, made by the server) is plenty for the AI and far cheaper to send.
  const url = small && first ? ((item.thumbs as Record<string, string> | undefined)?.[first] ?? first) : first
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
  if (!budget.ok) throw new HttpsError('resource-exhausted', 'The AI photo check is resting for now. Compare the photos yourself, or ask the owner.')
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
  // Copies found in different bins: the team moves them together and says which bin they're in now.
  const binId = typeof req.data?.binId === 'string' && req.data.binId ? req.data.binId : null
  const bin = binId ? await db.doc(`bins/${binId}`).get() : null
  if (bin && !bin.exists) throw new HttpsError('not-found', 'That bin no longer exists.')
  const deleteIt = !!removeData?.importedFrom && !(await everBooked(removeId))
  const now = new Date().toISOString()

  await db.runTransaction(async tx => {
    const [keep, remove, holds] = await Promise.all([tx.get(keepRef), tx.get(removeRef), tx.get(db.doc(`item_bookings/${removeId}`))])
    if (!usable(keep.data()) || !usable(remove.data())) throw new HttpsError('failed-precondition', 'One of these props is archived, personal or gone already.')
    if (binId && binId !== keep.get('binId') && binId !== remove.get('binId')) throw new HttpsError('invalid-argument', 'Pick one of the two bins.')
    if (((holds.get('entries') as unknown[] | undefined) ?? []).length) {
      throw new HttpsError('failed-precondition', `"${remove.get('name')}" is in a current booking. Merge it once that booking is checked back in, or keep the other one instead.`)
    }
    const photos = [...((keep.get('photos') as string[] | undefined) ?? []), ...((remove.get('photos') as string[] | undefined) ?? [])]
    const unique = [...new Set(photos)].slice(0, 20)
    tx.update(keepRef, {
      photos: unique, photoUrl: unique[0] ?? FieldValue.delete(),
      // Copies add up; the same prop photographed twice keeps the higher count (one photo may have shown a "x2" sign).
      ...(copies ? { quantity: FieldValue.increment(Number(remove.get('quantity')) || 1) }
        : (Number(remove.get('quantity')) || 1) > (Number(keep.get('quantity')) || 1) ? { quantity: Number(remove.get('quantity')) } : {}),
      ...(bin ? { binId: bin.id, ...(bin.get('locationId') ? { locationId: bin.get('locationId') } : {}) } : {}),
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
