// Props and gear hang off a shoot booked on the schedule (step 3 of scheduling).
// The shoot decides the day; the props and gear bookings keep their own statuses and queues.
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db, type Caller } from './auth.js'

// Bookings that still matter for the shoot's day (not finished, not cancelled).
export const PROPS_OPEN = ['requested', 'preparing', 'packed', 'collected', 'return_pending']
export const GEAR_OPEN = ['held', 'out']

export interface LinkedShoot { id: string; date: string; start: number; end: number; place: string; where: string; creatorEmail: string }

const idOf = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null

// The schedule shoot a props/gear booking is added to (or null when none was given).
// Only the person who booked the shoot (or the owner) can add to it, and only while it's booked.
export async function shootToAddTo(caller: Caller, raw: unknown): Promise<LinkedShoot | null> {
  if (raw === undefined || raw === null || raw === '') return null
  const id = idOf(raw)
  if (!id) throw new HttpsError('invalid-argument', 'Unknown shoot.')
  const sh = (await db.doc(`shoots/${id}`).get()).data()
  if (!sh) throw new HttpsError('not-found', 'That shoot is no longer on the schedule.')
  if (sh.status !== 'booked') throw new HttpsError('failed-precondition', 'That shoot was cancelled, so nothing can be added to it.')
  if (sh.creatorEmail !== caller.email && caller.role !== 'owner') throw new HttpsError('permission-denied', 'You can only add to your own shoots.')
  return { id, date: sh.date, start: sh.start, end: sh.end, place: sh.place, where: sh.where ?? '', creatorEmail: sh.creatorEmail }
}

// Note on the shoot's history that props or gear were added.
export async function noteOnShoot(shootId: string, by: string, action: 'props-added' | 'gear-added', note: string) {
  const at = new Date().toISOString()
  await db.doc(`shoots/${shootId}`).update({ updatedAt: at, history: FieldValue.arrayUnion({ at, by, action, note }) })
}

// Props and gear bookings for this shoot that are still going.
export async function openLinks(shootId: string) {
  const [props, gear, shared] = await Promise.all([
    db.collection('reservations').where('shootId', '==', shootId).get(),
    db.collection('gear_bookings').where('shootId', '==', shootId).get(),
    db.collection('gear_bookings').where('crewShootIds', 'array-contains', shootId).get(),
  ])
  return {
    props: props.docs.filter(d => PROPS_OPEN.includes(d.get('status'))).map(d => ({ id: d.id, status: d.get('status') as string })),
    gear: gear.docs.filter(d => GEAR_OPEN.includes(d.get('status'))).map(d => ({ id: d.id, status: d.get('status') as string })),
    // Gear a friend booked and shares with this shoot (back to back).
    sharedGear: shared.docs.filter(d => GEAR_OPEN.includes(d.get('status'))).map(d => ({ id: d.id, status: d.get('status') as string })),
  }
}

// Moving or swapping a shoot to another DAY would leave its props and gear on the old day.
export async function assertNoLinksForDayChange(shootId: string, fromDate: string, toDate: string) {
  if (fromDate === toDate) return
  const l = await openLinks(shootId)
  if (l.sharedGear.length) {
    throw new HttpsError('failed-precondition',
      'You share gear with a friend filming back to back that day. Take yourself off the shared gear first (on the shoot), then move it.',
      { problem: 'has-bookings' })
  }
  if (l.props.length || l.gear.length) {
    throw new HttpsError('failed-precondition',
      'This shoot has props or gear booked for its day. Cancel them first (on the shoot), then move it — or pick another time on the same day.',
      { problem: 'has-bookings' })
  }
}
