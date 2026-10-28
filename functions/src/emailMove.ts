// CHANGE SOMEONE'S EMAIL (owner, Oct 27: "Aaron got a new email; I had to turn the old one off and make a new user").
// People are filed under their email (users/{email}) and the email is copied onto their shoots, requests, gear,
// strikes, invites, reports… `changeUserEmail` (owner only) moves ALL of it to the new address in one go. If the new
// address already has an account (Aaron's case) the two are MERGED into one person. The old address is switched off
// and its record DELETED (owner, Oct 28: "merge people and delete the old one"), so it can't sign in and is gone from
// People. The new record keeps movedFrom[] and `email_moves` logs every move.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { recountStrikes } from './strikes.js'

// Collections that never hold a person's email (props, photos, settings internals) or that are handled separately.
export const SKIP = new Set([
  'items', 'item_vectors', 'item_private', 'item_bookings', 'import_items', 'import_jobs', 'tags', 'categories', 'bins',
  'locations', 'gear_items', 'gear_holds', 'push_tokens', 'push_sent', 'push_log', 'calendar_tokens', 'private_google',
  'private_google_states', 'cleanup_runs', 'outbox', 'ai_usage', 'test_calendar', 'health', 'users', 'profiles',
  'user_status', 'email_moves',
])
// The analytics flag ids put the email in a "slug" (late-gear:<booking>:<slug>), see src/lib/analytics.ts.
export const emailSlug = (e: string) => e.replace(/[^\w-]/g, '-')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Swap every value that IS the old email (and every map key, and the email inside flag ids) for the new one.
export function swapEmail(v: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  if (typeof v === 'string') {
    if (v.toLowerCase() === from) return { value: to, changed: true }
    const s = `:${emailSlug(from)}`
    if (v.includes(s) && /^(late-gear|gear-missing)/.test(v)) return { value: v.split(s).join(`:${emailSlug(to)}`), changed: true }
    return { value: v, changed: false }
  }
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map(x => { const r = swapEmail(x, from, to); changed ||= r.changed; return r.value })
    // A list of emails (crewEmails, usedBy…) that had both addresses keeps just one.
    return { value: changed && out.every(x => typeof x === 'string') ? [...new Set(out)] : changed ? out : v, changed }
  }
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const r = swapEmail(x, from, to)
      const key = k.toLowerCase() === from ? to : k
      changed ||= r.changed || key !== k
      out[key] = r.value
    }
    return { value: changed ? out : v, changed }
  }
  return { value: v, changed: false }   // numbers, timestamps, etc.
}

// Top-level fields that change (so an update only touches those).
export function changedFields(data: Record<string, unknown>, from: string, to: string) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    const r = swapEmail(v, from, to)
    const key = k.toLowerCase() === from ? to : k
    if (r.changed || key !== k) out[key] = r.value
  }
  return out
}

// What the new person record looks like: the new account wins where it exists (the owner just set it up),
// Full app if either was on it, always active.
export function mergeUser(oldU: Record<string, any>, newU: Record<string, any> | undefined, to: string, by: string, at: string) {
  const access = oldU.access === 'full' || newU?.access === 'full' ? 'full' : (newU?.access ?? oldU.access)
  return {
    ...oldU, ...(newU ?? {}), email: to, role: newU?.role ?? oldU.role, name: newU?.name || oldU.name || '',
    ...(access ? { access } : {}), active: true, movedFrom: [...new Set([...(newU?.movedFrom ?? []), ...(oldU.movedFrom ?? []), oldU.email])],
    updatedAt: at, updatedBy: by,
  }
}

const LABELS: Record<string, [string, string]> = {
  shoots: ['shoot', 'shoots'], schedule_days: ['schedule day', 'schedule days'], reservations: ['prop request', 'prop requests'],
  gear_bookings: ['gear booking', 'gear bookings'], strikes: ['strike', 'strikes'], schedule_invites: ['invite', 'invites'],
  swap_requests: ['swap request', 'swap requests'], schedule_reports: ['report', 'reports'], flag_reviews: ['flag review', 'flag reviews'],
  activity: ['activity log entry', 'activity log entries'], app_settings: ['setting (e.g. the priority group)', 'settings (e.g. the priority group)'],
  suggestions: ['suggested edit', 'suggested edits'], calendar_imports: ['calendar import', 'calendar imports'], gear_bundles: ['gear warning', 'gear warnings'],
}

export const changeUserEmail = onCall({ ...CALLABLE, timeoutSeconds: 540, memory: '512MiB' }, async req => {
  const caller = await requireRole(req, ['owner'])
  const from = String(req.data?.from ?? '').trim().toLowerCase()
  const to = String(req.data?.to ?? '').trim().toLowerCase()
  const apply = req.data?.apply === true
  if (!EMAIL.test(to)) throw new HttpsError('invalid-argument', "That new email doesn't look right.")
  if (from === to) throw new HttpsError('invalid-argument', "That's the same email.")
  if (from === OWNER_EMAIL || to === OWNER_EMAIL) throw new HttpsError('invalid-argument', "The owner's email can't be moved.")
  const [oldSnap, newSnap] = await db.getAll(db.doc(`users/${from}`), db.doc(`users/${to}`))
  if (!oldSnap.exists) throw new HttpsError('not-found', 'That person is not on the list.')
  if (oldSnap.get('movedTo')) throw new HttpsError('failed-precondition', `This email was already moved to ${oldSnap.get('movedTo')}.`)
  const merging = newSnap.exists

  // Find every record that mentions the old email.
  const cols = (await db.listCollections()).filter(c => !SKIP.has(c.id))
  const hits: { ref: FirebaseFirestore.DocumentReference; fields: Record<string, unknown>; renameTo?: string }[] = []
  for (const c of cols) {
    for (const d of (await c.get()).docs) {
      const fields = changedFields(d.data(), from, to)
      const renamed = c.id === 'flag_reviews' && d.id.includes(`__${emailSlug(from)}`) ? d.id.split(`__${emailSlug(from)}`).join(`__${emailSlug(to)}`) : undefined
      if (Object.keys(fields).length || renamed) hits.push({ ref: d.ref, fields, renameTo: renamed })
    }
  }
  const counts: Record<string, number> = {}
  for (const h of hits) { const c = h.ref.parent.id; counts[c] = (counts[c] ?? 0) + 1 }
  const summary = Object.entries(counts).map(([c, n]) => ({ what: LABELS[c]?.[n === 1 ? 0 : 1] ?? c.replace(/_/g, ' '), count: n }))
  const [oldProfile, oldStatus, phones] = await Promise.all([
    db.doc(`profiles/${from}`).get(), db.doc(`user_status/${from}`).get(), db.collection('push_tokens').where('email', '==', from).get(),
  ])
  const preview = { from, to, merging, newName: newSnap.get('name') ?? null, oldName: oldSnap.get('name') ?? null, summary,
    profile: oldProfile.exists, phones: phones.size }
  if (!apply) return { ...preview, applied: false }

  const at = new Date().toISOString()
  const w = db.bulkWriter()
  // 1. The person: new record (merged), old one switched off and pointing at the new one.
  w.set(db.doc(`users/${to}`), mergeUser({ ...oldSnap.data(), email: from }, newSnap.data(), to, caller.email, at))
  w.delete(oldSnap.ref)
  // 2. Profile photo + channel: the new one's own fields win.
  if (oldProfile.exists) {
    const np = (await db.doc(`profiles/${to}`).get()).data() ?? {}
    const keep = Object.fromEntries(Object.entries(np).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    w.set(db.doc(`profiles/${to}`), { ...oldProfile.data(), ...keep })
    w.delete(oldProfile.ref)
  }
  // 3. Strikes/pause status: keep the longest pause; the strike count is recounted below.
  if (oldStatus.exists) {
    const ns = (await db.doc(`user_status/${to}`).get()).data() ?? {}
    const os = oldStatus.data()!
    const pausedUntil = [os.pausedUntil, ns.pausedUntil].filter(Boolean).sort().at(-1) ?? null
    const fromOld = pausedUntil && pausedUntil === os.pausedUntil
    w.set(db.doc(`user_status/${to}`), { ...os, ...ns, email: to, name: ns.name ?? os.name ?? '', pausedUntil,
      ...(fromOld ? { pausedAt: os.pausedAt ?? null, manualPause: os.manualPause ?? false } : {}), updatedAt: at })
    w.delete(oldStatus.ref)
  }
  // 4. Old phones and calendar links stop (they were signed in as the old email).
  for (const d of phones.docs) w.delete(d.ref)
  for (const d of (await db.collection('calendar_tokens').where('email', '==', from).get()).docs) w.delete(d.ref)
  // 5. Every record that mentions the old email.
  for (const h of hits) {
    if (h.renameTo) {
      const data = (await h.ref.get()).data() ?? {}
      w.set(h.ref.parent.doc(h.renameTo), { ...data, ...h.fields })
      w.delete(h.ref)
    } else w.update(h.ref, h.fields)
  }
  await w.close()
  await recountStrikes(to)
  await db.collection('email_moves').add({ from, to, merging, by: caller.email, at, summary })
  logger.info('Email moved', { from, to, merging, records: hits.length })
  return { ...preview, applied: true }
})
