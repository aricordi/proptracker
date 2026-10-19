// On the day: check in (set photo), report the slot before you, wrap, explain a missed check-in;
// the schedule team decides missed check-ins and reports, and can lift pauses.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { nowStamp } from './gearBooking.js'
import { cleanScheduleSettings, checkinWindow, isMissed, explainUntil, slotKey, type ScheduleDay, type House } from './schedule.js'
import { addStrike } from './strikes.js'

const TEAM = ['owner', 'equipment', 'admin']
const ANYONE = ['owner', 'arts', 'creator', 'equipment'] as const
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const photoList = (v: unknown) => Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10) : []
const settings = async () => cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())

async function ownShoot(id: string, email: string) {
  const ref = db.doc(`shoots/${id}`)
  const sh = (await ref.get()).data()
  if (!sh) throw new HttpsError('not-found', 'Shoot not found.')
  if (sh.creatorEmail !== email) throw new HttpsError('permission-denied', 'Only the person who booked can do this.')
  return { ref, sh }
}

export const checkInShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const id = str(req.data?.id, 100)
  const { ref, sh } = await ownShoot(id, caller.email)
  const s = await settings(), now = nowStamp()
  if (sh.status !== 'booked') throw new HttpsError('failed-precondition', 'This shoot is cancelled.')
  if (sh.checkin) throw new HttpsError('failed-precondition', 'You already checked in.')
  const win = checkinWindow(sh as any, now, s)
  if (win === 'early') throw new HttpsError('failed-precondition', `Check-in opens ${s.checkinBefore} minutes before your shoot.`)
  if (win === 'over') throw new HttpsError('failed-precondition', 'Your slot is over. If you filmed, explain it on your shoot instead.')
  const photos = photoList(req.data?.photos)
  if (!photos.length) throw new HttpsError('invalid-argument', 'Take a photo of the set to check in.')
  const at = new Date().toISOString()

  // Report on the slot right before (same house, ends when this one starts).
  const r = req.data?.report ?? {}
  const over = Number.isInteger(r.overMinutes) && r.overMinutes > 0 ? Math.min(r.overMinutes, 240) : 0
  const mess = r.mess === true, messPhotos = photoList(r.photos)
  let reported: string | null = null
  if ((over || mess) && sh.place !== 'offsite') {
    if (mess && !messPhotos.length) throw new HttpsError('invalid-argument', 'Add a photo of the mess.')
    const day = ((await db.doc(`schedule_days/${sh.date}`).get()).data() ?? {}) as ScheduleDay
    const prev = day[sh.place as House]?.[slotKey(sh.start - s.slotMinutes)]
    if (prev && prev.shootId && prev.shootId !== id) {
      const what = [over ? `ran over ${over} min` : '', mess ? 'house left a mess' : ''].filter(Boolean).join(', ')
      const rep = await db.collection('schedule_reports').add({
        onShootId: prev.shootId, onEmail: prev.email ?? '', onName: prev.name, byShootId: id, byEmail: caller.email, byName: sh.creatorName,
        date: sh.date, place: sh.place, overMinutes: over, mess, photos: messPhotos, status: 'open', createdAt: at,
      })
      reported = rep.id
      await db.doc(`shoots/${prev.shootId}`).update({ history: FieldValue.arrayUnion({ at, by: caller.email, action: 'reported', note: `by ${sh.creatorName}: ${what}` }) })
      await ref.update({ history: FieldValue.arrayUnion({ at, by: caller.email, action: 'report', note: `about ${prev.name}: ${what}` }) })
    }
  }
  await ref.update({ checkin: { at, photos }, updatedAt: at, history: FieldValue.arrayUnion({ at, by: caller.email, action: 'checked-in' }) })
  return { ok: true, reported }
})

export const wrapShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const { ref, sh } = await ownShoot(str(req.data?.id, 100), caller.email)
  if (!sh.checkin) throw new HttpsError('failed-precondition', 'Check in first.')
  const title = str(req.data?.title, 140) || 'Untitled video'
  const at = new Date().toISOString()
  await ref.update({ wrap: { at, title }, updatedAt: at, history: FieldValue.arrayUnion({ at, by: caller.email, action: 'wrapped', note: `“${title}”` }) })
  return { ok: true }
})

export const explainMissedCheckIn = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const { ref, sh } = await ownShoot(str(req.data?.id, 100), caller.email)
  const s = await settings(), now = nowStamp()
  if (!isMissed(sh as any, now)) throw new HttpsError('failed-precondition', 'There is nothing to explain for this shoot.')
  if (now >= explainUntil(sh as any, s)) throw new HttpsError('failed-precondition', `The ${s.explainHours} hours to explain have passed. The schedule team will decide.`)
  const text = str(req.data?.text, 1000)
  if (!text) throw new HttpsError('invalid-argument', 'Say what happened.')
  const at = new Date().toISOString()
  await ref.update({ explanation: { at, text }, updatedAt: at, history: FieldValue.arrayUnion({ at, by: caller.email, action: 'explained', note: text.slice(0, 200) }) })
  return { ok: true }
})

// Team: a missed check-in was really filmed, or was a no-show (adds a strike).
export const decideShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, TEAM as any)
  const ref = db.doc(`shoots/${str(req.data?.id, 100)}`)
  const sh = (await ref.get()).data()
  if (!sh) throw new HttpsError('not-found', 'Shoot not found.')
  if (!isMissed(sh as any, nowStamp())) throw new HttpsError('failed-precondition', 'This shoot was checked in or already decided.')
  const outcome = req.data?.outcome === 'noshow' ? 'noshow' : 'filmed'
  const at = new Date().toISOString()
  await ref.update({ outcome, ...(outcome === 'noshow' ? { noShow: 'missed' } : {}), updatedAt: at,
    history: FieldValue.arrayUnion({ at, by: caller.email, action: outcome === 'noshow' ? 'no-show' : 'marked-filmed' }) })
  const strike = outcome === 'noshow' ? await addStrike(sh.creatorEmail, sh.creatorName, 'no-show', ref.id, caller.email) : null
  return { ok: true, strike }
})

// Team: a report about the slot before is dismissed, or upheld (adds a strike to that person).
export const reviewReport = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, TEAM as any)
  const ref = db.doc(`schedule_reports/${str(req.data?.id, 100)}`)
  const r = (await ref.get()).data()
  if (!r) throw new HttpsError('not-found', 'Report not found.')
  if (r.status !== 'open') throw new HttpsError('failed-precondition', 'This report was already reviewed.')
  const uphold = req.data?.uphold === true
  await ref.update({ status: uphold ? 'upheld' : 'dismissed', reviewedBy: caller.email, reviewedAt: new Date().toISOString() })
  const strike = uphold && r.onEmail ? await addStrike(r.onEmail, r.onName, 'report', r.onShootId, caller.email) : null
  return { ok: true, strike }
})

export const liftPause = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, TEAM as any)
  const email = str(req.data?.email, 200).toLowerCase()
  if (!email) throw new HttpsError('invalid-argument', 'Who?')
  const at = new Date().toISOString()
  await db.doc(`user_status/${email}`).set({ email, pausedUntil: null, liftedAt: at, liftedBy: caller.email, strikes: 0, updatedAt: at }, { merge: true })
  return { ok: true }
})
