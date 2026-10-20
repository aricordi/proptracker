// Strikes and pauses. A strike is added for a no-show (missed check-in the team confirms, or a
// cancel inside the notice period) or an upheld report (ran over / left a mess). Enough strikes
// within the window (2 in 30 days) pause that person's prop + gear bookings (14 days). The team can
// lift a pause; strikes from before a lift no longer count toward the next one.
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings } from './schedule.js'

export type StrikeReason = 'late-cancel' | 'no-show' | 'report' | 'manual'
export const STRIKE_LABELS: Record<StrikeReason, string> = {
  'late-cancel': 'Cancelled inside the notice period', 'no-show': 'No-show', report: 'Report upheld (ran over or left a mess)',
  manual: 'Given by an admin',
}

// Strikes that still count: in the window, after the last lift, and not removed.
async function countStrikes(email: string, settings: ReturnType<typeof cleanScheduleSettings>, liftedAt?: string) {
  const since = [new Date(Date.now() - settings.strikeDays * 86400000).toISOString(), liftedAt ?? ''].sort().at(-1)!
  return (await db.collection('strikes').where('email', '==', email).get()).docs.filter(d => d.get('at') >= since && !d.get('removedAt')).length
}

export async function addStrike(email: string, name: string, reason: StrikeReason, shootId: string, by: string, extra: { note?: string; about?: string } = {}) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const at = new Date().toISOString()
  const doc = await db.collection('strikes').add({ email, name, reason, shootId, by, at, ...(extra.note ? { note: extra.note } : {}), ...(extra.about ? { about: extra.about } : {}) })
  const statusRef = db.doc(`user_status/${email}`)
  const status = (await statusRef.get()).data() ?? {}
  const recent = await countStrikes(email, s, status.liftedAt)
  const paused = recent >= s.strikeCount && s.pauseDays > 0
  await statusRef.set({ email, name, strikes: recent, ...(paused ? { pausedUntil: addDays(todayInStudio(), s.pauseDays), pausedAt: at, manualPause: false } : {}), updatedAt: at }, { merge: true })
  return { strikes: recent, paused, id: doc.id }
}

// Take a strike off (kept on record as removed, with who and why). If that drops the person below the limit,
// a pause that came from strikes is lifted too (a pause someone started by hand stays).
export async function removeStrikeById(id: string, by: string, note: string) {
  const ref = db.doc(`strikes/${id}`)
  const st = (await ref.get()).data()
  if (!st) throw new HttpsError('not-found', 'Strike not found.')
  if (st.removedAt) throw new HttpsError('failed-precondition', 'That strike was already removed.')
  const at = new Date().toISOString()
  await ref.update({ removedAt: at, removedBy: by, removeNote: note })
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const statusRef = db.doc(`user_status/${st.email}`)
  const status = (await statusRef.get()).data() ?? {}
  const recent = await countStrikes(st.email, s, status.liftedAt)
  const lift = recent < s.strikeCount && !!status.pausedUntil && status.manualPause !== true
  await statusRef.set({ email: st.email, strikes: recent, ...(lift ? { pausedUntil: null, liftedAt: at, liftedBy: by } : {}), updatedAt: at }, { merge: true })
  return { strikes: recent, lifted: lift }
}

// Creators whose bookings are paused can't book props or gear until the pause ends (or is lifted).
export async function assertNotPaused(email: string) {
  const st = (await db.doc(`user_status/${email}`).get()).data()
  if (st?.pausedUntil && st.pausedUntil > todayInStudio()) {
    throw new HttpsError('failed-precondition', `Your prop and gear bookings are paused until ${st.pausedUntil} (strikes, or a pause from the team). Ask the schedule team if you think this is wrong.`, { problem: 'paused' })
  }
}
