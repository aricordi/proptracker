// PropTracker server functions. These run on Firebase's servers (Montréal),
// hold the Gemini key, and check the caller's role before doing anything.
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { analyzePhoto, embedText, hashText, GEMINI_API_KEY } from './gemini.js'

import { db, requireRole, CALLABLE } from './auth.js'
import { collectionOf } from './collections.js'
export * from './reservations.js'


function apiKey() {
  // Empty in the local emulator unless a real key is supplied; gemini.ts then uses fake answers.
  try { return GEMINI_API_KEY.value() || undefined } catch { return undefined }
}

type UsageField = 'photoAnalyses' | 'smartSearches' | 'indexUpdates'

function trackUsage(field: UsageField, n = 1) {
  const month = new Date().toISOString().slice(0, 7)
  return db.doc(`ai_usage/${month}`).set({ month, [field]: FieldValue.increment(n) }, { merge: true })
    .catch(() => {})
}

// ─── 1. Fill in a new prop from its photo ───────────────────────────────────

export const analyzePropPhoto = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], memory: '512MiB' }, async req => {
  await requireRole(req, ['owner', 'arts'])
  const { imageBase64, mimeType } = req.data ?? {}
  if (typeof imageBase64 !== 'string' || imageBase64.length > 6_000_000) {
    throw new HttpsError('invalid-argument', 'Photo is missing or too large')
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
    throw new HttpsError('invalid-argument', 'Not an image')
  }

  const [cats, tags] = await Promise.all([db.collection('categories').get(), db.collection('tags').get()])
  const categories = cats.docs
    .filter(d => d.data().active !== false)
    .map(d => ({ id: d.id, label: String(d.data().label) }))
  const tagLabels = tags.docs
    .sort((a, b) => (b.data().usageCount ?? 0) - (a.data().usageCount ?? 0))
    .map(d => String(d.data().label))

  try {
    const result = await analyzePhoto(apiKey(), { base64: imageBase64, mimeType }, categories, tagLabels)
    await trackUsage('photoAnalyses')
    return result
  } catch (err) {
    console.error('analyzePropPhoto failed', err)
    throw new HttpsError('unavailable', 'The AI could not analyze this photo. Try again.')
  }
})

// ─── 2. "Similar, might work too" search ────────────────────────────────────

export const searchSimilar = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY] }, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'admin'])
  const query = typeof req.data?.query === 'string' ? req.data.query.trim().slice(0, 200) : ''
  if (query.length < 3) return { results: [] }

  const vector = await embedText(apiKey(), query, 'RETRIEVAL_QUERY')
  await trackUsage('smartSearches')
  const snap = await db.collection('item_vectors')
    .findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(vector),
      limit: 15,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance',
    })
    .get()
  let docs = snap.docs
  // Only the owner may see (even the IDs of) their personal props.
  if (caller.role !== 'owner' && docs.length) {
    const items = await db.getAll(...docs.map(d => db.doc(`items/${d.id}`)))
    docs = docs.filter((_, i) => collectionOf(items[i].data()) === 'company')
  }
  return {
    results: docs.map(d => ({ id: d.id, score: 1 - Number(d.get('distance') ?? 1) })),
  }
})

// ─── 3. Keep the smart-search index up to date ──────────────────────────────
// Each prop gets a hidden "meaning fingerprint" in item_vectors/{id}. Phones
// never download these; only searchSimilar reads them. Internal notes are
// never included.

async function searchTextFor(item: DocumentData) {
  const [cat, ...tagSnaps] = await Promise.all([
    item.categoryId ?? item.itemType ? db.doc(`categories/${item.categoryId ?? item.itemType}`).get() : null,
    ...((item.tags ?? []) as string[]).map(id => db.doc(`tags/${id}`).get()),
  ])
  return [
    item.name,
    cat?.exists ? cat.get('label') : '',
    tagSnaps.map(t => t.exists ? t.get('label') : '').join(' '),
    item.description,
    item.notes,
    Array.isArray(item.searchWords) ? item.searchWords.join(', ') : '',
  ].filter(Boolean).join('. ')
}

async function indexItem(id: string, item: DocumentData | undefined): Promise<'updated' | 'unchanged'> {
  const ref = db.doc(`item_vectors/${id}`)
  if (!item) { await ref.delete(); return 'updated' }
  const text = await searchTextFor(item)
  const textHash = hashText(text)
  const existing = await ref.get()
  if (existing.exists && existing.get('textHash') === textHash) return 'unchanged'
  const vector = await embedText(apiKey(), text, 'RETRIEVAL_DOCUMENT')
  await ref.set({ embedding: FieldValue.vector(vector), textHash, updatedAt: new Date().toISOString() })
  await trackUsage('indexUpdates')
  return 'updated'
}

export const onItemWritten = onDocumentWritten({ document: 'items/{id}', secrets: [GEMINI_API_KEY] }, async event => {
  try {
    await indexItem(event.params.id, event.data?.after.data())
  } catch (err) {
    // Search still works without this prop's fingerprint; "Rebuild" on the Health page fixes gaps.
    console.error(`Indexing item ${event.params.id} failed`, err)
  }
})

// Owner-only button on the Health page: (re)build fingerprints for every prop.
// Safe to run repeatedly; props whose text hasn't changed are skipped for free.
export const rebuildSearchIndex = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 540 }, async req => {
  await requireRole(req, ['owner'])
  const items = await db.collection('items').get()
  let updated = 0, unchanged = 0, failed = 0
  const queue = [...items.docs]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      try { (await indexItem(d.id, d.data())) === 'updated' ? updated++ : unchanged++ }
      catch { failed++ }
    }
  }))
  return { total: items.size, updated, unchanged, failed }
})
export * from './email.js'
export * from './notices.js'
export * from './activity.js'
export * from './importer.js'
export * from './dedupe.js'
export * from './searchWords.js'
export * from './gear.js'
export * from './gearBookings.js'
export * from './thumbs.js'
export * from './scheduling.js'
export * from './calendar.js'
export * from './googleAccount.js'
export * from './attendance.js'
export * from './assistant.js'
export * from './costs.js'
export * from './push.js'
