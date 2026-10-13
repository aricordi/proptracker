import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'

// Batch import (Phase 6). Records are written only by the server.
export type ImportStatus = 'pending' | 'working' | 'analyzed' | 'failed' | 'approved' | 'skipped'
export type ImportCounts = Record<'pending' | 'analyzed' | 'failed' | 'approved' | 'skipped', number>

export interface ImportJob {
  id: string
  createdBy: string
  createdAt: string
  dryRun: boolean
  folders: { id: string; name: string; count: number }[]
  total: number
  counts: ImportCounts
  spentUsd: number
}

export interface ImportSuggestion {
  name: string
  categoryId: string | null
  tags: string[]
  description: string
  binLabel: string | null
  quantity: number
}

export interface ImportItem {
  id: string
  jobId: string
  order: number
  fileName: string
  folder: string
  status: ImportStatus
  photoUrl?: string
  suggestion?: ImportSuggestion
  error?: string
  itemId?: string
}

export interface ImportBudget { capUsd: number; spentUsd: number }
export const DEFAULT_CAP_USD = 10

export function subscribeToImportJobs(cb: (jobs: ImportJob[]) => void) {
  return onSnapshot(query(collection(db, 'import_jobs'), orderBy('createdAt', 'desc'), limit(30)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as ImportJob))), () => cb([]))
}

export function subscribeToImportJob(id: string, cb: (job: ImportJob | null) => void) {
  return onSnapshot(doc(db, 'import_jobs', id), snap => cb(snap.exists() ? { id: snap.id, ...snap.data() } as ImportJob : null), () => cb(null))
}

export function subscribeToImportItems(jobId: string, status: ImportStatus, max: number, cb: (items: ImportItem[]) => void) {
  return onSnapshot(query(collection(db, 'import_items'), where('jobId', '==', jobId), where('status', '==', status), orderBy('order'), limit(max)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as ImportItem))), () => cb([]))
}

export function subscribeToImportBudget(cb: (b: ImportBudget) => void) {
  return onSnapshot(doc(db, 'app_settings', 'import'),
    snap => cb({ capUsd: snap.get('capUsd') ?? DEFAULT_CAP_USD, spentUsd: snap.get('spentUsd') ?? 0 }),
    () => cb({ capUsd: DEFAULT_CAP_USD, spentUsd: 0 }))
}

// Owner only (security rules). Spending so far is kept.
export function setImportCap(capUsd: number) {
  return setDoc(doc(db, 'app_settings', 'import'), { capUsd }, { merge: true })
}

// Bin signs are written many ways: "Bin C7", "c 7", "C7" all mean bin C7.
export const binKey = (s: string) => s.toUpperCase().replace(/^BIN\s*/, '').replace(/[\s#.-]+/g, '')

export interface Approval {
  id: string; name?: string; categoryId?: string; tags?: string[]; description?: string; quantity?: number
  binId?: string | null; newBinLabel?: string
}

export const importInfo     = httpsCallable<void, { serviceAccount: string }>(functions, 'importInfo')
export const startImport    = httpsCallable<{ links: string[]; dryRun: boolean }, { jobId: string | null; queued: number; alreadyImported: number; found: number }>(functions, 'startImport')
export const processImport  = httpsCallable<{ jobId: string; retryFailed?: boolean }, { processed: number; capped: boolean; slowDown?: boolean; counts: ImportCounts; spentUsd: number; capUsd: number }>(functions, 'processImport')
export const approveImports = httpsCallable<{ items: Approval[] }, { results: { id: string; itemId?: string; error?: string }[] }>(functions, 'approveImports')
export const skipImports    = httpsCallable<{ ids: string[] }, { skipped: number }>(functions, 'skipImports')

export const mergeImports = httpsCallable<
  { ids: string[]; item?: Omit<Approval, 'id'>; addToItemId?: string; addQuantity?: number },
  { itemId: string }
>(functions, 'mergeImports')
export const undoImport = httpsCallable<{ jobId: string }, { deletedProps: number; clearedPhotos: number }>(functions, 'undoImport')
export const deleteImportedProp = httpsCallable<{ itemId: string }, { ok: boolean }>(functions, 'deleteImportedProp')

// Duplicate finder (after the import).
export interface DuplicatePair { a: string; b: string; score: number }
export interface PairVerdict { same: boolean; confidence: 'high' | 'medium' | 'low'; reason: string }
export const findDuplicates    = httpsCallable<{ min?: number }, { pairs: DuplicatePair[]; checked: number; withoutFingerprint: number }>(functions, 'findDuplicates')
export const comparePropPhotos = httpsCallable<{ a: string; b: string }, PairVerdict>(functions, 'comparePropPhotos')
export const mergeProps        = httpsCallable<{ keepId: string; removeId: string; mode: 'copies' | 'angles' }, { keptId: string; removed: 'deleted' | 'archived' }>(functions, 'mergeProps')
