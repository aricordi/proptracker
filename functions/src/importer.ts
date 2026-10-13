// Batch import of the existing prop library from Google Drive (Phase 6).
//
//  1. startImport (owner): list the photos in the shared Drive folders and queue
//     one import_items/{driveFileId} record per photo. The record ID is the Drive
//     file ID, so a photo is only ever queued once: re-running a folder skips
//     photos already done, which is what makes stopping and resuming safe.
//  2. processImport (owner, called repeatedly by the Import screen): fetch a few
//     queued photos, shrink them, ask the AI for name/category/tags/description,
//     the bin sign and the "x2" sign. Every AI call first reserves money against
//     the hard cost cap in app_settings/import, so the cap can never be passed.
//  3. approveImports / skipImports (arts department): turn reviewed suggestions
//     into real props (creating tags and new bins as needed), or skip them.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { randomUUID } from 'node:crypto'
import { db, requireRole, CALLABLE } from './auth.js'
import { analyzeImportPhoto, GEMINI_API_KEY, type ImportAnalysis } from './gemini.js'
import { folderIdFrom, resourceKeyFrom, listImages, fetchPhoto, serviceAccountEmail, type DriveImage } from './drive.js'
import { tagIdsFor } from './tags.js'

const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }

export const DEFAULT_CAP_USD = 10
const RESERVE_USD = 0.01          // set aside before each AI call (real cost is ~$0.002)
const PER_CALL = 8                // photos handled per processImport call, in parallel
const DRY_RUN_SIZE = 10
const STALE_MS = 3 * 60_000       // a photo "being worked on" this long is retried
const BUDGET = () => db.doc('app_settings/import')
const IMPORTED_AREA = 'imported'  // storage area for bins first seen on import signs

type Status = 'pending' | 'working' | 'analyzed' | 'failed' | 'approved' | 'skipped'

// Keep the job's tallies in step with each photo's status.
function moveCount(jobRef: DocumentReference, from: Status | null, to: Status) {
  const working = (s: Status | null) => s === 'working' ? 'pending' : s
  const a = working(from), b = working(to)
  if (a === b) return null
  return { ...(a ? { [`counts.${a}`]: FieldValue.increment(-1) } : {}), [`counts.${b}`]: FieldValue.increment(1), updatedAt: new Date().toISOString() }
}

// Bin labels written many ways on signs: "Bin C7", "c 7", "C7" → "C7".
export const binKey = (s: string) => s.toUpperCase().replace(/^BIN\s*/, '').replace(/[\s#.-]+/g, '')

// ─── 0. Info for the Import screen ───────────────────────────────────────────

export const importInfo = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'arts'])
  return { serviceAccount: await serviceAccountEmail() }
})

// ─── 1. Queue the photos ─────────────────────────────────────────────────────

export const startImport = onCall({ ...CALLABLE, timeoutSeconds: 540, memory: '512MiB' }, async req => {
  const caller = await requireRole(req, ['owner'])
  const links: string[] = Array.isArray(req.data?.links) ? req.data.links.filter((l: unknown) => typeof l === 'string' && l.trim()).slice(0, 200) : []
  const dryRun = req.data?.dryRun === true
  if (!links.length) throw new HttpsError('invalid-argument', 'Paste at least one Google Drive folder link.')
  const ids = links.map(l => ({ link: l, id: folderIdFrom(l), key: resourceKeyFrom(l) }))
  const bad = ids.filter(x => !x.id)
  if (bad.length) throw new HttpsError('invalid-argument', `That doesn't look like a Drive folder link: ${bad[0].link.slice(0, 80)}`)

  const all = new Map<string, DriveImage>()
  const folders: { id: string; name: string; count: number }[] = []
  for (const { id, key } of ids) {
    try {
      const { folderName, images } = await listImages(id!, 5000, key)
      folders.push({ id: id!, name: folderName, count: images.length })
      for (const img of images) all.set(img.id, img)
    } catch (err) {
      throw new HttpsError('failed-precondition', err instanceof Error ? err.message : String(err))
    }
  }

  // Skip photos queued by an earlier import (dry run or a stopped run).
  const candidates = [...all.values()]
  const fresh: DriveImage[] = []
  for (let i = 0; i < candidates.length; i += 300) {
    const chunk = candidates.slice(i, i + 300)
    const snaps = await db.getAll(...chunk.map(c => db.doc(`import_items/${c.id}`)))
    chunk.forEach((c, j) => { if (!snaps[j].exists) fresh.push(c) })
  }
  const queued = dryRun ? fresh.slice(0, DRY_RUN_SIZE) : fresh
  if (!queued.length) {
    return { jobId: null, queued: 0, alreadyImported: candidates.length, found: candidates.length }
  }

  const now = new Date().toISOString()
  const jobRef = db.collection('import_jobs').doc()
  await jobRef.set({
    createdBy: caller.email, createdAt: now, updatedAt: now, dryRun, links, folders,
    total: queued.length, counts: { pending: queued.length, analyzed: 0, failed: 0, approved: 0, skipped: 0 }, spentUsd: 0,
  })
  for (let i = 0; i < queued.length; i += 400) {
    const batch = db.batch()
    queued.slice(i, i + 400).forEach((img, j) => batch.set(db.doc(`import_items/${img.id}`), {
      jobId: jobRef.id, order: i + j, fileId: img.id, fileName: img.name, folder: img.folder, mimeType: img.mimeType,
      ...(img.thumbnailLink ? { thumbnailLink: img.thumbnailLink } : {}),
      ...(img.resourceKey ? { resourceKey: img.resourceKey } : {}),
      status: 'pending', createdAt: now,
    }))
    await batch.commit()
  }
  return { jobId: jobRef.id, queued: queued.length, alreadyImported: candidates.length - fresh.length, found: candidates.length }
})

// ─── 2. Analyze a few photos (the Import screen calls this repeatedly) ────────

async function reserveBudget(): Promise<{ ok: boolean; capUsd: number; spentUsd: number }> {
  return db.runTransaction(async tx => {
    const snap = await tx.get(BUDGET())
    const capUsd = typeof snap.get('capUsd') === 'number' ? snap.get('capUsd') as number : DEFAULT_CAP_USD
    const spentUsd = typeof snap.get('spentUsd') === 'number' ? snap.get('spentUsd') as number : 0
    if (spentUsd + RESERVE_USD > capUsd) return { ok: false, capUsd, spentUsd }
    tx.set(BUDGET(), { capUsd, spentUsd: spentUsd + RESERVE_USD }, { merge: true })
    return { ok: true, capUsd, spentUsd: spentUsd + RESERVE_USD }
  })
}

function photoUrl(path: string, token: string, bucket: string) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const base = host ? `http://${host}` : 'https://firebasestorage.googleapis.com'
  return `${base}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

export const processImport = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner'])
  const jobId = typeof req.data?.jobId === 'string' ? req.data.jobId : ''
  const jobRef = db.doc(`import_jobs/${jobId}`)
  if (!jobId || !(await jobRef.get()).exists) throw new HttpsError('not-found', 'Import not found')

  // "Try failed photos again": put them back in the queue.
  if (req.data?.retryFailed === true) {
    const failed = await db.collection('import_items').where('jobId', '==', jobId).where('status', '==', 'failed').get()
    for (const d of failed.docs) {
      await db.runTransaction(async tx => {
        const s = await tx.get(d.ref)
        if (s.get('status') !== 'failed') return
        tx.update(d.ref, { status: 'pending', error: FieldValue.delete() })
        tx.update(jobRef, moveCount(jobRef, 'failed', 'pending')!)
      })
    }
  }

  // Claim up to PER_CALL photos (also ones stuck "working" from a dropped run).
  const pending = await db.collection('import_items').where('jobId', '==', jobId).where('status', '==', 'pending')
    .orderBy('order').limit(PER_CALL).get()
  const stuck = pending.size < PER_CALL
    ? (await db.collection('import_items').where('jobId', '==', jobId).where('status', '==', 'working').get())
      .docs.filter(d => Date.now() - Date.parse(d.get('workingAt') ?? 0) > STALE_MS)
    : []
  const claimed: DocumentReference[] = []
  for (const d of [...pending.docs, ...stuck].slice(0, PER_CALL)) {
    const ok = await db.runTransaction(async tx => {
      const s = await tx.get(d.ref)
      const st = s.get('status')
      if (st !== 'pending' && !(st === 'working' && Date.now() - Date.parse(s.get('workingAt') ?? 0) > STALE_MS)) return false
      tx.update(d.ref, { status: 'working', workingAt: new Date().toISOString() })
      return true
    })
    if (ok) claimed.push(d.ref)
  }

  // What the AI should choose from.
  const [cats, tags, bins] = await Promise.all([db.collection('categories').get(), db.collection('tags').get(), db.collection('bins').get()])
  const categories = cats.docs.filter(d => d.get('active') !== false).map(d => ({ id: d.id, label: String(d.get('label')) }))
  const tagLabels = tags.docs.sort((a, b) => (b.get('usageCount') ?? 0) - (a.get('usageCount') ?? 0)).map(d => String(d.get('label')))
  const binLabels = bins.docs.map(d => String(d.get('label')))
  const bucket = getStorage().bucket()

  let capped = false
  await Promise.all(claimed.map(async ref => {
    const item = (await ref.get()).data()!
    const finish = async (to: Status, data: Record<string, unknown>) => {
      await db.runTransaction(async tx => {
        tx.update(ref, { status: to, ...data, workingAt: FieldValue.delete() })
        tx.update(jobRef, moveCount(jobRef, 'working', to)!)
      })
    }
    const budget = await reserveBudget()
    if (!budget.ok) {
      capped = true
      await ref.update({ status: 'pending', workingAt: FieldValue.delete() })
      return
    }
    let reserved = RESERVE_USD
    try {
      const jpeg = await fetchPhoto({ id: item.fileId, name: item.fileName, folder: item.folder, mimeType: item.mimeType, thumbnailLink: item.thumbnailLink, resourceKey: item.resourceKey })
      const path = `items/imported/${item.fileId}.jpg`
      const token = randomUUID()
      await bucket.file(path).save(jpeg, { contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
      const { analysis, costUsd } = await analyzeImportPhoto(apiKey(), { base64: jpeg.toString('base64'), mimeType: 'image/jpeg' }, categories, tagLabels, binLabels)
      // Swap the reservation for the real cost.
      await BUDGET().set({ spentUsd: FieldValue.increment(costUsd - reserved) }, { merge: true })
      await jobRef.update({ spentUsd: FieldValue.increment(costUsd) })
      reserved = 0
      await finish('analyzed', { photoUrl: photoUrl(path, token, bucket.name), suggestion: analysis satisfies ImportAnalysis, analyzedAt: new Date().toISOString() })
    } catch (err) {
      if (reserved) await BUDGET().set({ spentUsd: FieldValue.increment(-reserved) }, { merge: true })
      await finish('failed', { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
    }
  }))

  const [job, budget] = await Promise.all([jobRef.get(), BUDGET().get()])
  return {
    processed: claimed.length,
    capped,
    counts: job.get('counts'),
    spentUsd: budget.get('spentUsd') ?? 0,
    capUsd: budget.get('capUsd') ?? DEFAULT_CAP_USD,
  }
})

// ─── 3. Review: approve (becomes a real prop) or skip ────────────────────────

interface Approval {
  id: string
  name?: string
  categoryId?: string
  tags?: string[]          // labels
  description?: string
  quantity?: number
  binId?: string | null    // an existing bin
  newBinLabel?: string     // or a bin to create
}

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''

export const approveImports = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const list: Approval[] = Array.isArray(req.data?.items) ? req.data.items.slice(0, 50) : []
  if (!list.length) throw new HttpsError('invalid-argument', 'Nothing to approve')

  const [cats, bins] = await Promise.all([db.collection('categories').get(), db.collection('bins').get()])
  const categoryIds = new Set(cats.docs.map(d => d.id))
  const binsByKey = new Map(bins.docs.map(d => [binKey(String(d.get('label'))), { id: d.id, locationId: d.get('locationId') as string }]))
  const binById = new Map(bins.docs.map(d => [d.id, { id: d.id, locationId: d.get('locationId') as string }]))

  async function binFor(a: Approval, s: ImportAnalysis): Promise<{ id: string; locationId: string } | null> {
    if (a.binId) return binById.get(a.binId) ?? null
    const label = str(a.newBinLabel, 40) || (a.binId === null ? '' : s.binLabel ?? '')
    if (!label) return null
    const known = binsByKey.get(binKey(label))
    if (known) return known
    const area = db.doc(`locations/${IMPORTED_AREA}`)
    if (!(await area.get()).exists) await area.set({ name: 'Imported – needs sorting', notes: 'Bins first seen on photo signs during the batch import.' })
    const ref = db.collection('bins').doc()
    await ref.set({ label, locationId: IMPORTED_AREA, qrSlug: ref.id })
    const bin = { id: ref.id, locationId: IMPORTED_AREA }
    binsByKey.set(binKey(label), bin); binById.set(ref.id, bin)
    return bin
  }

  const results: { id: string; itemId?: string; error?: string }[] = []
  for (const a of list) {
    if (typeof a?.id !== 'string') continue
    const ref = db.doc(`import_items/${a.id}`)
    try {
      const snap = await ref.get()
      const imp = snap.data()
      if (!imp) throw new Error('Not found')
      if (imp.status === 'approved') { results.push({ id: a.id, itemId: imp.itemId }); continue }
      if (imp.status !== 'analyzed') throw new Error('Not ready to approve')
      const s = imp.suggestion as ImportAnalysis
      const name = str(a.name, 200) || s.name || imp.fileName
      const categoryId = a.categoryId && categoryIds.has(a.categoryId) ? a.categoryId : s.categoryId && categoryIds.has(s.categoryId) ? s.categoryId : 'prop'
      const quantity = Number.isInteger(a.quantity) && a.quantity! >= 1 && a.quantity! <= 100000 ? a.quantity! : s.quantity || 1
      const tagIds = await tagIdsFor((Array.isArray(a.tags) ? a.tags : s.tags).filter((t): t is string => typeof t === 'string').slice(0, 15))
      const bin = await binFor(a, s)
      const now = new Date().toISOString()
      const itemRef = db.collection('items').doc()
      const jobRef = db.doc(`import_jobs/${imp.jobId}`)
      const created = await db.runTransaction(async tx => {
        const again = await tx.get(ref)
        if (again.get('status') !== 'analyzed') return false   // someone else just approved/skipped it
        tx.set(itemRef, {
          name, categoryId, quantity, condition: 'good', tags: tagIds, collection: 'company',   // Prime Capitol's
          description: str(a.description, 300) || s.description || '', notes: '',
          photos: [imp.photoUrl], photoUrl: imp.photoUrl,
          ...(bin ? { binId: bin.id, locationId: bin.locationId } : {}),
          status: 'available', archived: false,
          importedFrom: { driveFileId: imp.fileId, fileName: imp.fileName, folder: imp.folder },
          createdAt: now, updatedAt: now, createdBy: caller.email, updatedBy: caller.email,
        })
        tx.update(ref, { status: 'approved', itemId: itemRef.id, approvedBy: caller.email, approvedAt: now })
        tx.update(jobRef, moveCount(jobRef, 'analyzed', 'approved')!)
        return true
      })
      results.push(created ? { id: a.id, itemId: itemRef.id } : { id: a.id, error: 'Already handled by someone else' })
    } catch (err) {
      results.push({ id: a.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
})

export const skipImports = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts'])
  const ids: string[] = Array.isArray(req.data?.ids) ? req.data.ids.filter((x: unknown) => typeof x === 'string').slice(0, 100) : []
  let skipped = 0
  for (const id of ids) {
    const ref = db.doc(`import_items/${id}`)
    await db.runTransaction(async tx => {
      const s = await tx.get(ref)
      const from = s.get('status') as Status
      if (from !== 'analyzed' && from !== 'failed') return
      const jobRef = db.doc(`import_jobs/${s.get('jobId')}`)
      tx.update(ref, { status: 'skipped', skippedBy: caller.email, skippedAt: new Date().toISOString() })
      tx.update(jobRef, moveCount(jobRef, from, 'skipped')!)
      skipped++
    })
  }
  return { skipped }
})
