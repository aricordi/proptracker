// "Notify me if it opens" (owner, Nov 7). A creator taps the bell on a house slot someone else has. When that slot frees up
// (a cancel, a declined invite, a hold or request that ran out), the first person on its list gets it HELD for
// INVITE_HOLD_MINUTES with a notification, exactly like a friend's back-to-back invite: they confirm with one tap in the
// app (answerInvite, unchanged), or it goes to the next person. The rules that need no database are in waitlistRules.ts.
//
// waitlist/{date_house_start_who} {date, house, start, email, name, at, status waiting|offered|done|left|expired,
// inviteId?, offeredAt?, reason?}. Readable by its person and the schedule team (security rules); only the server writes.
import { createHash } from 'node:crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { db, requireRole, CALLABLE, OWNER_EMAIL, isDemoCreator } from './auth.js'
import { isDay } from './booking.js'
import { nowStamp, addMinutes } from './gearBooking.js'
import { loadScheduleSettings } from './scheduling.js'
import { blockAt, houseSlotsOn, INVITE_HOLD_MINUTES, needsGuideline, priorityLocked, slotKey, slotWindow, type House, type ScheduleDay, type ScheduleSettings } from './schedule.js'
import { freedSlots, MAX_WAITING, nextInLine, positionOf, slotOccupant, waitId, type WaitEntry } from './waitlistRules.js'

const emailKey = (email: string) => createHash('sha1').update(email.toLowerCase()).digest('hex').slice(0, 16)
const dayRef = (date: string) => db.doc(`schedule_days/${date}`)
const isHouse = (h: unknown): h is House => h === 'cliff1' || h === 'cliff2'
const fail = (problem: string, message: string) => new HttpsError('failed-precondition', message, { problem })

async function slotEntries(date: string, house: House, start: number): Promise<WaitEntry[]> {
  const q = await db.collection('waitlist').where('date', '==', date).where('house', '==', house).where('start', '==', start).get()
  return q.docs.map(d => ({ id: d.id, ...d.data() } as WaitEntry))
}

export const joinWaitlist = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])   // Props-only creators are refused (no demoOk)
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const date = d.date, house = d.house, start = d.start
  if (!isDay(date) || !isHouse(house) || !Number.isInteger(start) || !s.slots.includes(start)) throw new HttpsError('invalid-argument', 'Pick a time on the schedule.')
  const now = nowStamp()
  if (slotWindow(date, start, s.slotMinutes).from <= now) throw fail('past', 'That time has already started.')
  const day = (await dayRef(date).get()).data() as ScheduleDay | undefined
  const who = slotOccupant(day, house, start, s, caller.email, now)
  if (who === 'free') throw fail('free', "That time is free right now: book it instead.")
  if (who === 'mine') throw fail('mine', "That one's already yours.")
  if (who === 'blocked') throw fail('blocked', "That time is blocked by the team, so it won't open up.")
  if (houseSlotsOn(day, caller.email, now) >= s.slotsPerDay) throw fail('day-limit', 'You already have a house slot that day (one 2-hour slot a day each).')
  if (priorityLocked(date, house, s, caller.email, now)) throw fail('locked', "That's a priority-day slot that hasn't opened to everyone yet.")
  // A priority-day slot at Cliff 1 needs a filming guideline (PDF), which a one-tap waitlist can't ask for.
  if (needsGuideline(date, house, caller.email, s)) throw fail('guideline', 'Thursdays and Saturdays at Cliff 1 need a filming guideline, so the waitlist doesn\'t cover them. Ask for another time.')
  const id = waitId(date, house, start, emailKey(caller.email))
  const ref = db.doc(`waitlist/${id}`)
  const mine = (await db.collection('waitlist').where('email', '==', caller.email).where('status', '==', 'waiting').get()).docs
  const already = (await ref.get()).data()
  if (!(already && ['waiting', 'offered'].includes(already.status))) {
    if (mine.filter(x => x.id !== id).length >= MAX_WAITING) throw fail('too-many', `You're already waiting for ${MAX_WAITING} times. Leave one of them first.`)
    await ref.set({ date, house, start, email: caller.email, name: caller.name, at: new Date().toISOString(), status: 'waiting' })
  }
  const all = await slotEntries(date, house, start)
  return { id, status: already?.status === 'offered' ? 'offered' : 'waiting', position: positionOf(all, caller.email) }
})

export const leaveWaitlist = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])
  const id = typeof req.data?.id === 'string' ? req.data.id.slice(0, 200) : ''
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Which one?')
  const ref = db.doc(`waitlist/${id}`)
  const w = (await ref.get()).data()
  if (!w || w.email !== caller.email) throw new HttpsError('not-found', "You're not on that list.")
  if (w.status === 'offered') throw fail('offered', "It's held for you right now: confirm it, or tap Can't on the invite.")
  if (w.status === 'waiting') await ref.update({ status: 'left', leftAt: new Date().toISOString() })
  return { ok: true }
})

// Your waiting entries with your place in line (other people's entries aren't readable from the phone).
export const myWaitlist = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])
  const mine = (await db.collection('waitlist').where('email', '==', caller.email).get()).docs
    .map(d => ({ id: d.id, ...d.data() } as WaitEntry)).filter(w => w.status === 'waiting' || w.status === 'offered')
  const out = []
  for (const w of mine) out.push({ id: w.id, date: w.date, house: w.house, start: w.start, status: w.status, position: w.status === 'waiting' ? positionOf(await slotEntries(w.date, w.house, w.start), caller.email) : 0 })
  return { entries: out }
})

// Can this person still take the slot? (They might have booked something else that day, or lost access.)
async function stillEligible(w: WaitEntry, day: ScheduleDay | undefined, s: ScheduleSettings, now: string): Promise<string> {
  if (houseSlotsOn(day, w.email, now) >= s.slotsPerDay) return 'has-slot'
  if (priorityLocked(w.date, w.house, s, w.email, now)) return 'locked'
  if (w.email !== OWNER_EMAIL) {
    const u = (await db.doc(`users/${w.email}`).get()).data()
    if (!u || u.active !== true || isDemoCreator(u.role, u.access)) return 'no-access'
  }
  return ''
}

/** A slot just freed: hold it for the first person still waiting (skipping anyone who can't take it any more). */
export async function offerNext(date: string, house: House, start: number, now = nowStamp()): Promise<string | null> {
  const s = await loadScheduleSettings()
  if (!s.slots.includes(start) || slotWindow(date, start, s.slotMinutes).from <= now) return null
  for (const cand of nextInLine(await slotEntries(date, house, start))) {
    const ref = db.doc(`waitlist/${cand.id}`), inviteRef = db.collection('schedule_invites').doc()
    const result = await db.runTransaction(async tx => {
      const w = (await tx.get(ref)).data() as WaitEntry | undefined
      const day = (await tx.get(dayRef(date))).data() as ScheduleDay | undefined
      if (!w || w.status !== 'waiting') return 'next'
      // Someone else got there first (or the team blocked it): nothing to offer.
      if (day?.[house]?.[slotKey(start)] || blockAt(day, house, start, s.slotMinutes)) return 'stop'
      const why = await stillEligible(w, day, s, now)
      if (why) { tx.update(ref, { status: 'expired', reason: why, endedAt: new Date().toISOString() }); return 'next' }
      const until = addMinutes(now, INVITE_HOLD_MINUTES), at = new Date().toISOString()
      tx.set(dayRef(date), { ...(day ?? {}), date, [house]: { ...(day?.[house] ?? {}),
        [slotKey(start)]: { shootId: '', name: w.name, email: w.email, kind: 'extra', hold: { until, inviteId: inviteRef.id, fromName: 'Waitlist' } } } })
      tx.set(inviteRef, { fromEmail: 'waitlist', fromName: 'Waitlist', toEmail: w.email, toName: w.name, place: house, date, start, end: start + s.slotMinutes,
        until, status: 'pending', createdAt: at, waitlist: true, waitlistId: cand.id })
      tx.update(ref, { status: 'offered', inviteId: inviteRef.id, offeredAt: at })
      return 'offered'
    })
    if (result === 'offered') return cand.id!
    if (result === 'stop') return null
  }
  return null
}

// Every write to a day: offer each house slot that just emptied. The offer's own write fills the slot, so it never re-fires.
export const waitlistOnDay = onDocumentWritten('schedule_days/{date}', async e => {
  const freed = freedSlots(e.data?.before.data() as ScheduleDay | undefined, e.data?.after.data() as ScheduleDay | undefined)
  for (const f of freed) {
    try { await offerNext(e.params.date, f.house, f.start) } catch (err) { logger.warn('Waitlist offer failed', e.params.date, f, String(err)) }
  }
})

// The offer was answered: confirmed = done; can't = left; the 20 minutes ran out = expired (the freed slot then goes on).
export const waitlistOnInvite = onDocumentWritten('schedule_invites/{id}', async e => {
  const b = e.data?.before.data(), a = e.data?.after.data()
  if (!a?.waitlist || !a.waitlistId || b?.status !== 'pending' || a.status === 'pending') return
  const status = a.status === 'accepted' ? 'done' : a.status === 'declined' ? 'left' : 'expired'
  await db.doc(`waitlist/${a.waitlistId}`).update({ status, endedAt: new Date().toISOString() }).catch(err => logger.warn('Waitlist entry update failed', a.waitlistId, String(err)))
})

/** Entries whose slot has started are over (swept every 10 minutes with the other reminders). */
export async function expireWaitlist(now = nowStamp()) {
  const s = await loadScheduleSettings()
  const waiting = await db.collection('waitlist').where('status', '==', 'waiting').get()
  let n = 0
  for (const d of waiting.docs) {
    if (slotWindow(String(d.get('date')), Number(d.get('start')), s.slotMinutes).from > now) continue
    await d.ref.update({ status: 'expired', reason: 'started', endedAt: new Date().toISOString() }); n++
  }
  return n
}
