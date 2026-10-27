// On the day: check in (set photo), report the slot before you, wrap, explain a missed check-in;
// the schedule team decides missed check-ins and reports, and can lift pauses.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { nowStamp } from './gearBooking.js'
import { cleanScheduleSettings, checkinWindow, isMissed, explainUntil, slotKey, type ScheduleDay, type House } from './schedule.js'
import { addStrike, removeStrikeById } from './strikes.js'
import { addDays, todayInStudio } from './booking.js'

const TEAM = ['owner', 'equipment']
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
  // A short message in their own words (owner, Oct 19: "ran over" / "mess" alone aren't descriptive enough).
  const note = typeof r.note === 'string' ? r.note.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  let reported: string | null = null
  if ((over || mess) && sh.place !== 'offsite') {
    if (mess && !messPhotos.length) throw new HttpsError('invalid-argument', 'Add a photo of the mess.')
    const day = ((await db.doc(`schedule_days/${sh.date}`).get()).data() ?? {}) as ScheduleDay
    const prev = day[sh.place as House]?.[slotKey(sh.start - s.slotMinutes)]
    if (prev && prev.shootId && prev.shootId !== id) {
      const what = [over ? `ran over ${over} min` : '', mess ? 'house left a mess' : ''].filter(Boolean).join(', ') + (note ? `: "${note.length > 80 ? note.slice(0, 79) + '…' : note}"` : '')
      const rep = await db.collection('schedule_reports').add({
        onShootId: prev.shootId, onEmail: prev.email ?? '', onName: prev.name, byShootId: id, byEmail: caller.email, byName: sh.creatorName,
        date: sh.date, place: sh.place, overMinutes: over, mess, note, photos: messPhotos, status: 'open', createdAt: at,
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

// People who manage the creators (owner, Oct 20): the schedule team decides check-ins and reports; admins too.
const DISCIPLINE = ['owner', 'equipment', 'admin']
// Strikes and pauses given by hand: the owner and admins only.
const MANAGERS = ['owner', 'admin']

// Team: a missed check-in was really filmed, or was a no-show (adds a strike).
export const decideShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, DISCIPLINE as any)
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
  const caller = await requireRole(req, DISCIPLINE as any)
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
  const caller = await requireRole(req, DISCIPLINE as any)
  const email = str(req.data?.email, 200).toLowerCase()
  if (!email) throw new HttpsError('invalid-argument', 'Who?')
  const at = new Date().toISOString()
  await db.doc(`user_status/${email}`).set({ email, pausedUntil: null, manualPause: false, liftedAt: at, liftedBy: caller.email, strikes: 0, updatedAt: at }, { merge: true })
  return { ok: true }
})

// ─── Managing creators by hand (owner + admins, owner Oct 20) ────────────────
const STRIKE_ABOUT = ['props', 'gear', 'schedule', 'behaviour', 'other']
async function creatorNamed(email: string) {
  const u = (await db.doc(`users/${email}`).get()).data()
  if (!u || u.role !== 'creator') throw new HttpsError('not-found', "That person isn't a creator in the app.")
  return String(u.name || email)
}

// Give a strike for anything (late props or gear, damage, behaviour…). A reason is required; it counts toward the pause.
export const giveStrike = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, MANAGERS as any)
  const email = str(req.data?.email, 200).toLowerCase(), note = str(req.data?.note, 300)
  const about = STRIKE_ABOUT.includes(req.data?.about) ? req.data.about as string : 'other'
  if (note.length < 3) throw new HttpsError('invalid-argument', 'Write a short reason, so the creator knows why.')
  const name = await creatorNamed(email)
  const r = await addStrike(email, name, 'manual', str(req.data?.shootId, 100), caller.email, { note, about })
  return { ok: true, ...r }
})

export const removeStrike = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, MANAGERS as any)
  const note = str(req.data?.note, 300)
  if (note.length < 3) throw new HttpsError('invalid-argument', 'Say why it comes off (for the record).')
  const r = await removeStrikeById(str(req.data?.id, 100), caller.email, note)
  return { ok: true, ...r }
})

// Pause someone's prop + gear bookings straight away for N days (1–90), with a reason.
export const pauseCreator = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, MANAGERS as any)
  const email = str(req.data?.email, 200).toLowerCase(), note = str(req.data?.note, 300)
  const days = Number(req.data?.days)
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpsError('invalid-argument', 'Pick 1 to 90 days.')
  if (note.length < 3) throw new HttpsError('invalid-argument', 'Write a short reason.')
  const name = await creatorNamed(email)
  const at = new Date().toISOString()
  const until = addDays(todayInStudio(), days)
  await db.doc(`user_status/${email}`).set({ email, name, pausedUntil: until, pausedAt: at, manualPause: true, pausedBy: caller.email, pauseNote: note, updatedAt: at }, { merge: true })
  return { ok: true, pausedUntil: until }
})

// ─── Handling one flag (owner + admins, owner Oct 21: "press the flag cards… remediation options for each one") ──
// Flags are worked out by the app from shoots, reports, requests and strikes; each has a stable id like
// 'late-props:<requestId>'. What an admin did about it is kept in `flag_reviews/{id}` (server-only writes):
//  excuse   = doesn't count any more (kept on record with the reason; can be undone with 'unexcuse')
//  warn     = a message to the creator (phone notification), kept on the flag
//  strike   = a strike for this flag (counts toward the automatic pause; one per flag)
//  handled  = looked at, nothing more to do (optional note)
const FLAG_ACTIONS = ['excuse', 'unexcuse', 'warn', 'strike', 'handled']
const ABOUT_FOR: Record<string, string> = { 'late-props': 'props', 'props-damaged': 'props', 'late-gear': 'gear', 'gear-missing': 'gear',
  'no-show': 'schedule', 'late-cancel': 'schedule', 'late-start': 'schedule', 'ran-over': 'schedule', 'missed-checkin': 'schedule',
  'no-wrap': 'schedule', 'invite-lapsed': 'schedule', mess: 'behaviour' }
export const reviewFlag = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, MANAGERS as any)
  const id = str(req.data?.flagId, 200), action = String(req.data?.action ?? ''), note = str(req.data?.note, 300)
  const email = str(req.data?.email, 200).toLowerCase(), kind = str(req.data?.kind, 40), label = str(req.data?.label, 200)
  if (!/^[a-z-]+:[\w-]+(:[\w-]+)*$/.test(id) || id.split(':')[0] !== kind) throw new HttpsError('invalid-argument', 'Unknown flag.')
  if (!FLAG_ACTIONS.includes(action)) throw new HttpsError('invalid-argument', 'Unknown action.')
  if (action !== 'handled' && action !== 'unexcuse' && note.length < 3) throw new HttpsError('invalid-argument', 'Write a short reason.')
  const name = await creatorNamed(email)
  const ref = db.doc(`flag_reviews/${id.replace(/:/g, '__')}`)
  const cur = (await ref.get()).data()
  const at = new Date().toISOString()
  let strike: { strikes: number; paused: boolean; id: string } | null = null
  if (action === 'strike') {
    if (cur?.strikeId) {
      const old = (await db.doc(`strikes/${cur.strikeId}`).get()).data()
      if (old && !old.removedAt) throw new HttpsError('failed-precondition', 'This flag already has a strike.')
    }
    strike = await addStrike(email, name, 'manual', id.startsWith('strike:') ? '' : str(req.data?.shootId, 100), caller.email,
      { note: label ? `${note} (${label})` : note, about: ABOUT_FOR[kind] ?? 'other' })
    await db.doc(`strikes/${strike.id}`).update({ flagId: id })
  }
  if (action === 'warn') {
    const { sendPush } = await import('./push.js')
    await sendPush({ to: [email], title: 'A note from the Prime Capitol team', body: note, url: '/account', tag: `warn-${id}` }).catch(() => 0)
  }
  const status = action === 'excuse' ? 'excused' : action === 'unexcuse' ? 'open' : action === 'strike' ? 'struck' : action === 'warn' ? 'warned' : 'handled'
  await ref.set({ flagId: id, email, name, kind, label, status, updatedAt: at, updatedBy: caller.email,
    ...(strike ? { strikeId: strike.id } : {}),
    actions: FieldValue.arrayUnion({ at, by: caller.email, action, ...(note ? { note } : {}), ...(strike ? { strikeId: strike.id } : {}) }) }, { merge: true })
  return { ok: true, status, strike }
})
