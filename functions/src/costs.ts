// Owner only: what the app costs to run, and a photo clean-up so old and unused files don't pile up.
//
// CLEAN-UP RULES (owner, Oct 17). A stored photo is removed only when ONE of these is true:
//  1. It's a PROOF photo (pack / return / check-in / gear return / shoot set photo) older than 6 months.
//  2. NOTHING in the database points to it any more AND it's at least 14 days old
//     (e.g. a photo taken but never sent, a replaced profile photo, a thumbnail of a removed photo).
// Before deciding, every record in every collection is read and every photo link in it is noted,
// so a photo any prop, booking, shoot, profile, suggestion or import still uses is never touched.
// If that check can't be completed, nothing is deleted. Each run removes at most MAX_DELETE files,
// and the bucket keeps deleted files for 7 days (soft delete), so a mistake can be undone.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getStorage } from 'firebase-admin/storage'
import type { DocumentData } from 'firebase-admin/firestore'
import { GoogleAuth } from 'google-auth-library'
import { db, requireRole, CALLABLE } from './auth.js'
import { todayInStudio } from './booking.js'

export const PROOF_FOLDERS = ['reservation-photos/', 'gear-returns/', 'shoot-photos/']
export const PROOF_KEEP_DAYS = 183        // about 6 months (owner, Oct 17)
export const UNUSED_KEEP_DAYS = 14
const MAX_DELETE = 500
const CLEANABLE = ['items/', 'thumbs/', 'gear/', 'avatars/', 'request-photos/', ...PROOF_FOLDERS]

// A storage path from a download link ("…/o/items%2Fabc.jpg?alt=media…" → "items/abc.jpg").
export function pathFromUrl(url: string): string | null {
  const m = url.match(/\/o\/([^?#]+)/)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

// Every photo path any record points to (walks every field of every document).
async function referencedPaths(): Promise<Set<string>> {
  const refs = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.includes('/o/')) { const p = pathFromUrl(v); if (p) refs.add(p) } }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v as DocumentData).forEach(walk)
  }
  for (const col of await db.listCollections()) {
    const snap = await col.get()
    for (const d of snap.docs) {
      const data = d.data()
      walk(data)
      if (col.id === 'import_items' && typeof data.fileId === 'string') refs.add(`items/imported/${data.fileId}.jpg`)
      // Sub-collections (e.g. ai_usage/{month}/people) hold no photos; skipped on purpose.
    }
  }
  return refs
}

// Keep or remove one file. Anything outside the photo folders (and anything new) is always kept.
export function cleanupReason(path: string, ageDays: number, referenced: boolean): 'old-proof' | 'unused' | null {
  if (!CLEANABLE.some(p => path.startsWith(p)) || !(ageDays >= 0)) return null
  if (PROOF_FOLDERS.some(p => path.startsWith(p)) && ageDays > PROOF_KEEP_DAYS) return 'old-proof'
  if (!referenced && ageDays > UNUSED_KEEP_DAYS) return 'unused'
  return null
}

export interface CleanupPlan {
  files: number; bytes: number
  byFolder: Record<string, { files: number; bytes: number }>
  remove: { path: string; bytes: number; reason: 'old-proof' | 'unused' }[]
  removeBytes: number
}

export async function planCleanup(now = Date.now()): Promise<CleanupPlan> {
  const [files] = await getStorage().bucket().getFiles()
  const refs = await referencedPaths()
  if (files.length > 50 && refs.size === 0) throw new Error('Could not read the photo links; nothing was removed.')
  const plan: CleanupPlan = { files: files.length, bytes: 0, byFolder: {}, remove: [], removeBytes: 0 }
  for (const f of files) {
    const bytes = Number(f.metadata.size ?? 0)
    const folder = f.name.includes('/') ? f.name.split('/')[0] : '(top)'
    plan.bytes += bytes
    const b = plan.byFolder[folder] ??= { files: 0, bytes: 0 }
    b.files++; b.bytes += bytes
    const ageDays = (now - Date.parse(String(f.metadata.timeCreated ?? new Date(now).toISOString()))) / 86_400_000
    const reason = cleanupReason(f.name, ageDays, refs.has(f.name))
    if (reason) { plan.remove.push({ path: f.name, bytes, reason }); plan.removeBytes += bytes }
  }
  return plan
}

export async function runCleanup(by: string) {
  const plan = await planCleanup()
  const batch = plan.remove.slice(0, MAX_DELETE)
  const bucket = getStorage().bucket()
  let removed = 0, freed = 0, failed = 0
  for (let i = 0; i < batch.length; i += 20) {
    await Promise.all(batch.slice(i, i + 20).map(async r => {
      try { await bucket.file(r.path).delete(); removed++; freed += r.bytes } catch { failed++ }
    }))
  }
  const run = { at: new Date().toISOString(), by, removed, freedBytes: freed, failed, left: plan.remove.length - batch.length,
    oldProof: batch.filter(r => r.reason === 'old-proof').length, unused: batch.filter(r => r.reason === 'unused').length }
  await db.collection('cleanup_runs').add(run)
  return run
}

// ─── Usage from Google Cloud Monitoring (real counts this month) ────────────

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] })
async function monthTotal(metric: string, since: string): Promise<number | null> {
  try {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
    if (!project || process.env.FUNCTIONS_EMULATOR === 'true') return null
    const client = await auth.getClient()
    const start = new Date(`${since}T00:00:00-05:00`), end = new Date()
    const secs = Math.max(60, Math.floor((end.getTime() - start.getTime()) / 1000))
    const params = new URLSearchParams({
      filter: `metric.type="${metric}"`, 'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': `${secs}s`, 'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    })
    const res = await client.request<any>({ url: `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}` })
    const pts = (res.data.timeSeries ?? []).flatMap((t: any) => t.points ?? [])
    return pts.reduce((n: number, p: any) => n + Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0), 0)
  } catch { return null }
}

// Rough list prices (US$, Google's published rates; this region may differ slightly). Free amounts first.
const PRICE = { readPer100k: 0.06, writePer100k: 0.18, storageGbMonth: 0.026, egressGb: 0.12, freeReadsPerDay: 50_000, freeWritesPerDay: 20_000 }

export const costReport = onCall({ ...CALLABLE, timeoutSeconds: 300, memory: '512MiB' }, async req => {
  await requireRole(req, ['owner'])
  const month = todayInStudio().slice(0, 7), first = `${month}-01`
  const dayOfMonth = Number(todayInStudio().slice(8)), daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const [plan, reads, writes, sent, ai, imp, lastRun] = await Promise.all([
    planCleanup(),
    monthTotal('firestore.googleapis.com/document/read_count', first),
    monthTotal('firestore.googleapis.com/document/write_count', first),
    monthTotal('storage.googleapis.com/network/sent_bytes_count', first),
    db.doc(`ai_usage/${month}`).get(),
    db.doc('app_settings/import').get(),
    db.collection('cleanup_runs').orderBy('at', 'desc').limit(1).get(),
  ])
  const scale = daysInMonth / Math.max(1, dayOfMonth)   // so far this month → whole month
  const gb = plan.bytes / 1e9
  const est = {
    storage: gb * PRICE.storageGbMonth,
    reads: reads === null ? null : Math.max(0, reads * scale - PRICE.freeReadsPerDay * daysInMonth) / 100_000 * PRICE.readPer100k,
    writes: writes === null ? null : Math.max(0, writes * scale - PRICE.freeWritesPerDay * daysInMonth) / 100_000 * PRICE.writePer100k,
    downloads: sent === null ? null : (sent * scale / 1e9) * PRICE.egressGb,
    ai: Math.max(0, Number(ai.get('spentUsd') ?? 0)) * scale,
  }
  return {
    month, measured: reads !== null,
    storage: { files: plan.files, bytes: plan.bytes, byFolder: plan.byFolder },
    usage: { reads, writes, downloadedBytes: sent },
    estimate: est,
    cleanup: {
      wouldRemove: plan.remove.length, wouldFreeBytes: plan.removeBytes,
      oldProof: plan.remove.filter(r => r.reason === 'old-proof').length, unused: plan.remove.filter(r => r.reason === 'unused').length,
      lastRun: lastRun.docs[0]?.data() ?? null,
    },
    ai: { spentUsd: Number(ai.get('spentUsd') ?? 0), importSpentUsd: Number(imp.get('spentUsd') ?? 0) },
  }
})

export const cleanUpPhotos = onCall({ ...CALLABLE, timeoutSeconds: 540, memory: '512MiB' }, async req => {
  const caller = await requireRole(req, ['owner'])
  try { return await runCleanup(caller.email) } catch (e) { throw new HttpsError('failed-precondition', (e as Error).message) }
})
