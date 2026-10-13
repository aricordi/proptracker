// The activity log: one record per thing that happened, written ONLY by the
// server so it can't be skipped or edited from the app.
//  • Prop changes (who changed what, from → to), from a trigger on items.
//  • Booking steps (requested, packed, collected, returned …), from a trigger on
//    reservations: every new entry in a booking's history becomes a record.
// activity/{id}: { at, by, kind: 'prop' | 'booking', action, itemIds[], itemName?,
//   changes?[{ field, from, to }], reservationId?, title?, creatorEmail?, reason? }
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getAuth } from 'firebase-admin/auth'
import { logger } from 'firebase-functions'
import type { DocumentData } from 'firebase-admin/firestore'
import { db } from './auth.js'
import { collectionOf } from './collections.js'

// The prop fields worth recording, with plain names.
export const TRACKED_FIELDS: Record<string, string> = {
  name: 'Name',
  quantity: 'Quantity',
  condition: 'Condition',
  replacementCost: 'Replacement cost',
  categoryId: 'Category',
  locationId: 'Storage area',
  binId: 'Bin',
  missingQty: 'Missing',
  archived: 'Archived',
  status: 'Quick checkout',
  description: 'Description',
  notes: 'Notes for creators',
  tags: 'Tags',
  photos: 'Photos',
  whereToRebuy: 'Where to rebuy',
  collection: 'Belongs to',
}

type Value = string | number | boolean | null
export interface Change { field: string; from: Value; to: Value }

function shown(field: string, v: unknown): Value {
  if (v === undefined || v === null || v === '') return null
  if (field === 'photos') return Array.isArray(v) ? v.length : null   // count, not URLs
  if (Array.isArray(v)) return v.join(', ').slice(0, 300)
  if (typeof v === 'string') return v.slice(0, 300)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return JSON.stringify(v).slice(0, 300)
}

export function diffItem(before: DocumentData | undefined, after: DocumentData | undefined): Change[] {
  const out: Change[] = []
  for (const field of Object.keys(TRACKED_FIELDS)) {
    const from = shown(field, before?.[field]), to = shown(field, after?.[field])
    if (from !== to) out.push({ field, from, to })
  }
  return out
}

// updatedBy is an email for server changes and a sign-in ID for app changes.
const nameCache = new Map<string, string>()
async function whoIs(id: unknown): Promise<string> {
  if (typeof id !== 'string' || !id) return 'unknown'
  if (id.includes('@')) return id
  if (!nameCache.has(id)) {
    try { nameCache.set(id, (await getAuth().getUser(id)).email ?? id) } catch { nameCache.set(id, id) }
  }
  return nameCache.get(id)!
}

export const logItemChange = onDocumentWritten('items/{id}', async event => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after) return   // props are never deleted (rules block it)
  const changes = before ? diffItem(before, after) : []
  if (before && !changes.length) return   // e.g. only the search fingerprint changed
  try {
    // Changes to the owner's personal props go to a log only the owner can read.
    const log = collectionOf(after) === 'company' ? 'activity' : 'activity_personal'
    await db.doc(`${log}/${event.id}`).set({
      at: after.updatedAt ?? new Date().toISOString(),
      by: await whoIs(before ? after.updatedBy : (after.createdBy ?? after.updatedBy)),
      kind: 'prop',
      action: !before ? 'added' : changes.some(c => c.field === 'archived') ? (after.archived ? 'archived' : 'unarchived') : 'edited',
      itemIds: [event.params.id],
      itemName: String(after.name ?? '').slice(0, 200),
      ...(before ? { changes } : {}),
    })
  } catch (err) {
    logger.error('Activity log (prop) failed', { id: event.params.id, err: String(err) })
  }
})

export const logReservationChange = onDocumentWritten('reservations/{id}', async event => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after) return
  const id = event.params.id
  const base = {
    kind: 'booking',
    reservationId: id,
    title: String(after.title ?? '').slice(0, 200),
    creatorEmail: after.creatorEmail ?? null,
    itemIds: (after.itemIds as string[] | undefined) ?? [],
  }
  const writes: [string, DocumentData][] = []

  // New steps in the booking's history. The record ID is fixed per step, so a
  // retried trigger never logs the same step twice.
  const seen = (before?.history as unknown[] | undefined)?.length ?? 0
  const history = (after.history as DocumentData[] | undefined) ?? []
  history.slice(seen).forEach((h, i) => writes.push([`${id}_h${seen + i}`, {
    ...base, at: h.at, by: h.by, action: h.status, ...(h.reason ? { reason: String(h.reason).slice(0, 500) } : {}),
  }]))

  // Props marked "not available" while picking (with the reason).
  const wasUnavailable = new Set(((before?.lines as DocumentData[] | undefined) ?? []).filter(l => l.pick?.state === 'unavailable').map(l => l.itemId))
  for (const l of (after.lines as DocumentData[] | undefined) ?? []) {
    if (l.pick?.state !== 'unavailable' || wasUnavailable.has(l.itemId)) continue
    writes.push([`${id}_u_${l.itemId}_${String(l.pick.at).replace(/\D/g, '')}`, {
      ...base, at: l.pick.at, by: l.pick.by, action: 'unavailable', itemIds: [l.itemId], itemName: l.itemName,
      ...(l.pick.reason ? { reason: String(l.pick.reason).slice(0, 500) } : {}),
    }])
  }

  if (!writes.length) return
  try {
    const batch = db.batch()
    for (const [docId, data] of writes) batch.set(db.doc(`activity/${docId}`), data)
    await batch.commit()
  } catch (err) {
    logger.error('Activity log (booking) failed', { id, err: String(err) })
  }
})
