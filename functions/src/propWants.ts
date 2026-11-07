// "Wanted but booked" (owner, Nov 7): when a creator opens a prop page while adding to one of their shoots and every unit
// is already booked that day, the app quietly notes it. The arts department sees the totals on Prop insights ("Often
// unavailable" + "Buy another?"). Nothing is shown to the creator and no AI is used.
//
// One record per prop, shoot day and person (prop_wants/{itemId}_{day}_{who}), written once and never changed, so opening
// the same page again doesn't count twice. Owner, arts and admins can read them (security rules); only this function writes.
import { createHash } from 'node:crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, requireRole, CALLABLE } from './auth.js'
import { collectionOf } from './collections.js'
import { addDays, isDay, todayInStudio } from './booking.js'

const FAR_DAYS = 400   // shoots are booked weeks ahead, never years

/** The record's id: prop, day and a short fingerprint of the email (the email itself is inside, for the team). */
export function wantId(itemId: string, day: string, email: string): string {
  return `${itemId}_${day}_${createHash('sha1').update(email.toLowerCase()).digest('hex').slice(0, 16)}`
}

export const noteWanted = onCall({ ...CALLABLE, timeoutSeconds: 15 }, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])   // Props-only creators are refused (no demoOk)
  const itemId = req.data?.itemId, day = req.data?.day
  if (typeof itemId !== 'string' || !itemId || itemId.length > 200 || itemId.includes('/')) throw new HttpsError('invalid-argument', 'Which prop?')
  const today = todayInStudio()
  if (!isDay(day) || day < today || day > addDays(today, FAR_DAYS)) throw new HttpsError('invalid-argument', 'Which day?')
  const snap = await db.doc(`items/${itemId}`).get()
  const d = snap.data()
  // Only Prime Capitol props that can be booked: the owner's personal props and removed ones never count.
  if (!snap.exists || collectionOf(d) !== 'company' || d?.archived === true || d?.mergedInto) {
    throw new HttpsError('not-found', "That prop isn't in the app any more.")
  }
  // Booked out because of THEIR OWN request for that day (the page can't tell whose holds they are): they got it, no count.
  const theirs = await db.collection('reservations').where('itemIds', 'array-contains', itemId).select('creatorEmail', 'status', 'startDate', 'endDate').get()
  if (theirs.docs.some(r => r.get('creatorEmail') === caller.email && !['cancelled', 'declined'].includes(r.get('status'))
    && String(r.get('startDate') ?? '') <= day && day <= String(r.get('endDate') || r.get('startDate') || ''))) return { noted: false }
  try {
    await db.doc(`prop_wants/${wantId(itemId, day, caller.email)}`).create({
      itemId, day, email: caller.email, at: new Date().toISOString(), quantity: Math.max(0, Number(d?.quantity) || 0),
    })
    return { noted: true }
  } catch (e) {
    const code = (e as { code?: unknown }).code
    if (code === 6 || code === 'already-exists') return { noted: false }   // ALREADY_EXISTS: this person already counted for that day
    throw e
  }
})
