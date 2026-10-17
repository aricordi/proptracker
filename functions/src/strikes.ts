// Strikes and pauses. A strike is added for a no-show (missed check-in the team confirms, or a
// cancel inside the notice period) or an upheld report (ran over / left a mess). Enough strikes
// within the window (2 in 30 days) pause that person's prop + gear bookings (14 days). The team can
// lift a pause; strikes from before a lift no longer count toward the next one.
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings } from './schedule.js'

export type StrikeReason = 'late-cancel' | 'no-show' | 'report'
export const STRIKE_LABELS: Record<StrikeReason, string> = {
  'late-cancel': 'Cancelled inside the notice period', 'no-show': 'No-show', report: 'Report upheld (ran over or left a mess)',
}

export async function addStrike(email: string, name: string, reason: StrikeReason, shootId: string, by: string) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const at = new Date().toISOString()
  await db.collection('strikes').add({ email, name, reason, shootId, by, at })
  const statusRef = db.doc(`user_status/${email}`)
  const status = (await statusRef.get()).data() ?? {}
  const since = [new Date(Date.now() - s.strikeDays * 86400000).toISOString(), status.liftedAt ?? ''].sort().at(-1)!
  const recent = (await db.collection('strikes').where('email', '==', email).get()).docs.filter(d => d.get('at') >= since).length
  const paused = recent >= s.strikeCount && s.pauseDays > 0
  await statusRef.set({ email, name, strikes: recent, ...(paused ? { pausedUntil: addDays(todayInStudio(), s.pauseDays), pausedAt: at } : {}), updatedAt: at }, { merge: true })
  return { strikes: recent, paused }
}

// Creators whose bookings are paused can't book props or gear until the pause ends (or is lifted).
export async function assertNotPaused(email: string) {
  const st = (await db.doc(`user_status/${email}`).get()).data()
  if (st?.pausedUntil && st.pausedUntil > todayInStudio()) {
    throw new HttpsError('failed-precondition', `Your prop and gear bookings are paused until ${st.pausedUntil} because of strikes (no-shows or reports). Ask the schedule team if you think this is wrong.`, { problem: 'paused' })
  }
}
