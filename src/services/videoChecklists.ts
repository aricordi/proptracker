import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  query, orderBy, getDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { VideoChecklist, VideoChecklistProp } from '../types'
import { propId } from './manifestParser'

const col = collection(db, 'video_checklists')

export function subscribeToVideoChecklists(cb: (checklists: VideoChecklist[]) => void) {
  return onSnapshot(
    query(col, orderBy('updatedAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as VideoChecklist))),
    () => cb([]),
  )
}

export function subscribeToVideoChecklist(id: string, cb: (cl: VideoChecklist | null) => void) {
  return onSnapshot(
    doc(col, id),
    snap => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as VideoChecklist) : null),
    () => cb(null),
  )
}

export async function saveVideoChecklist(checklist: VideoChecklist): Promise<void> {
  const now = new Date().toISOString()
  await setDoc(doc(col, checklist.id), {
    ...checklist,
    updatedAt: now,
  })
}

// Update a single prop's fields without rewriting the whole document.
// Uses the full props array update pattern (Firestore doesn't support
// array-element-in-place updates, so we write the whole props array).
export async function updateChecklistProp(
  checklistId: string,
  updatedProps: VideoChecklistProp[],
): Promise<void> {
  await updateDoc(doc(col, checklistId), {
    props: updatedProps,
    updatedAt: new Date().toISOString(),
  })
}

export async function getVideoChecklist(id: string): Promise<VideoChecklist | null> {
  const snap = await getDoc(doc(col, id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as VideoChecklist) : null
}

// ─── Re-sync merge ───────────────────────────────────────────────────────────
//
// Rules:
//  • Props matched by normalized name (case-insensitive, trimmed).
//  • Existing props: preserve all user decisions, checked state, matchStatus,
//    propEmbedding. Update name (case may have changed), notes, scene, qty, type.
//  • New props: add with isNew=true so the UI can highlight them.
//  • Removed props: keep in list but set removedFromScript=true.

export interface ResyncSummary {
  addedCount: number
  removedCount: number
}

export function mergeManifestIntoChecklist(
  existing: VideoChecklistProp[],
  incoming: VideoChecklistProp[],
): { merged: VideoChecklistProp[]; summary: ResyncSummary } {
  const existingById = new Map(existing.map(p => [p.id, p]))
  const incomingIds  = new Set(incoming.map(p => p.id))

  // Update existing or add new
  const merged: VideoChecklistProp[] = incoming.map(incomingProp => {
    const existing = existingById.get(incomingProp.id)
    if (existing) {
      // Preserve user decisions; update manifest fields (name, notes, scene, etc.)
      return {
        ...existing,
        name: incomingProp.name,
        type: incomingProp.type,
        qty: incomingProp.qty,
        scene: incomingProp.scene,
        notes: incomingProp.notes,
        physical_output: incomingProp.physical_output,
        isNew: false,
        removedFromScript: false,
      }
    }
    // Genuinely new prop
    return { ...incomingProp, isNew: true }
  })

  // Props that were in existing but not in incoming manifest
  let removedCount = 0
  for (const existingProp of existing) {
    if (!incomingIds.has(existingProp.id) && !existingProp.removedFromScript) {
      merged.push({ ...existingProp, removedFromScript: true })
      removedCount++
    } else if (!incomingIds.has(existingProp.id) && existingProp.removedFromScript) {
      // Already flagged; carry forward
      merged.push(existingProp)
    }
  }

  const addedCount = incoming.filter(p => !existingById.has(p.id)).length

  return { merged, summary: { addedCount, removedCount } }
}

// Clear isNew / removedFromScript flags after user has seen the re-sync banner.
export function dismissResyncFlags(props: VideoChecklistProp[]): VideoChecklistProp[] {
  return props.map(p => ({ ...p, isNew: false, removedFromScript: false }))
}

// Derive the propId from a name — re-exported for convenience
export { propId }
