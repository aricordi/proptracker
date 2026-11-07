// Phone notifications (web push through Firebase Cloud Messaging; free). Owner, Oct 18: instant pings when something
// happens + timed reminders. Each phone that turns notifications on registers a token in push_tokens/{hash}
// (server-only). Messages come from pushMessages.ts. In the emulator nothing is sent: messages go to push_log.
import { createHash } from 'node:crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getMessaging } from 'firebase-admin/messaging'
import { logger } from 'firebase-functions'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { loadScheduleSettings } from './scheduling.js'
import { loadSettings } from './reservations.js'
import { openLinks } from './shootLinks.js'
import { addDays, todayInStudio, lastDayToBook } from './booking.js'
import { nowStamp, addMinutes, GEAR_LEAD_TIME_DAYS } from './gearBooking.js'
import {
  inviteChange, swapChange, reservationChange, gearChange, reportCreated, strikeCreated, shootChange,
  shootReminders, propsReminders, gearReminders, type Push, type Reminder,
} from './pushMessages.js'

export const APP_URL = 'https://proptracker.arbcreative.co'
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 40)
const MAX_DEVICES = 8

// 'arts-team' = the arts department, 'gear-team' = the equipment/schedule team, 'approvers' = everyone who approves
// bookings (equipment team + admins, Nov 3). The owner gets team pings only when that team has nobody in it yet
// (so the owner isn't flooded with every request).
async function resolve(to: string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const t of to) {
    if (t === 'arts-team' || t === 'gear-team' || t === 'approvers') {
      const roles = t === 'arts-team' ? ['arts'] : t === 'gear-team' ? ['equipment'] : ['equipment', 'admin']
      const team = (await db.collection('users').where('role', 'in', roles).where('active', '==', true).get()).docs.map(d => d.id)
      ;(team.length ? team : [OWNER_EMAIL]).forEach(e => out.add(e))
    } else if (t) out.add(t.toLowerCase())
  }
  return [...out]
}

// Every real send is written down (push_log, server-only; the "Read server logs" button shows the last ones), so a
// phone that never shows a notification can be told apart from a send that failed (owner, Oct 21: Ariel got nothing).
async function logSend(p: Push, emails: string[], phones: number, sent: number, errors: string[]) {
  logger.info('Push sent', { title: p.title, to: emails, phones, sent, errors })
  await db.collection('push_log').add({ title: p.title, to: emails, phones, sent, errors, at: new Date().toISOString() }).catch(() => {})
}

export async function sendPush(p: Push): Promise<number> {
  return (await sendPushDetailed(p)).sent
}
export async function sendPushDetailed(p: Push): Promise<{ sent: number; phones: number; errors: string[] }> {
  const emails = await resolve(p.to)
  if (!emails.length) return { sent: 0, phones: 0, errors: [] }
  if (isEmulator()) {
    await db.collection('push_log').add({ ...p, to: emails, at: new Date().toISOString() })
    return { sent: emails.length, phones: emails.length, errors: [] }
  }
  const tokens: { id: string; token: string }[] = []
  for (let i = 0; i < emails.length; i += 30) {
    const q = await db.collection('push_tokens').where('email', 'in', emails.slice(i, i + 30)).get()
    q.docs.forEach(d => tokens.push({ id: d.id, token: d.get('token') }))
  }
  if (!tokens.length) { await logSend(p, emails, 0, 0, ['no phone signed up']); return { sent: 0, phones: 0, errors: ['no phone signed up'] } }
  const link = `${APP_URL}${p.url}`
  const res = await getMessaging().sendEach(tokens.map(t => ({
    token: t.token,
    data: { title: p.title, body: p.body, url: p.url, tag: p.tag ?? '' },
    webpush: {
      headers: { Urgency: 'high', TTL: '21600' },
      notification: { title: p.title, body: p.body, icon: `${APP_URL}/icons/icon-192.png`, badge: `${APP_URL}/icons/icon-192.png`, ...(p.tag ? { tag: p.tag } : {}) },
      fcmOptions: { link },
    },
  })))
  // Phones that turned notifications off (or reinstalled) give "not registered": forget those tokens.
  const errors: string[] = []
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error?.code ?? ''
    if (!r.success) { errors.push(`${code} ${r.error?.message ?? ''}`.trim()); logger.warn('Push failed', code, r.error?.message) }
    if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) return db.doc(`push_tokens/${tokens[i].id}`).delete()
    return null
  }))
  await logSend(p, emails, tokens.length, res.successCount, errors)
  return { sent: res.successCount, phones: tokens.length, errors }
}
const sendAll = (list: Push[]) => Promise.all(list.map(p => sendPush(p).catch(e => logger.warn('Push failed', String(e)))))

// ─── Phones signing up ───────────────────────────────────────────────────────

export const registerPush = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment', 'admin'], { demoOk: true })
  const token = typeof req.data?.token === 'string' ? req.data.token.trim() : ''
  if (token.length < 20 || token.length > 4096) throw new HttpsError('invalid-argument', 'That phone could not be signed up for notifications.')
  const platform = typeof req.data?.platform === 'string' ? req.data.platform.slice(0, 40) : ''
  const at = new Date().toISOString()
  const ref = db.doc(`push_tokens/${tokenId(token)}`)
  const prev = (await ref.get()).data()
  await ref.set({ token, email: caller.email, platform, createdAt: prev?.createdAt ?? at, lastSeen: at })
  // Keep the newest few phones per person.
  const mine = (await db.collection('push_tokens').where('email', '==', caller.email).get()).docs
    .sort((a, b) => String(b.get('lastSeen')).localeCompare(String(a.get('lastSeen'))))
  await Promise.all(mine.slice(MAX_DEVICES).map(d => d.ref.delete()))
  return { ok: true }
})

export const unregisterPush = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment', 'admin'], { demoOk: true })
  const token = typeof req.data?.token === 'string' ? req.data.token.trim() : ''
  if (!token) return { ok: true }
  const ref = db.doc(`push_tokens/${tokenId(token)}`)
  const d = (await ref.get()).data()
  if (d && d.email === caller.email) await ref.delete()
  return { ok: true }
})

// A test can wait a few seconds first, so the person can close the app: iPhones often don't show a banner for the
// app that's open on screen.
export const testPush = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment', 'admin'], { demoOk: true })
  const wait = Math.min(Math.max(Number(req.data?.delaySeconds) || 0, 0), 15)
  if (wait) await new Promise(r => setTimeout(r, wait * 1000))
  const r = await sendPushDetailed({ to: [caller.email], url: '/account', tag: 'test', title: 'Notifications are on ✓',
    body: "You'll get a ping for invites, swaps, props and gear, and reminders before your shoots." })
  return r
})

// Owner/admin (Oct 23): send a test to SOMEONE ELSE from their page, and see which phones they have signed up and
// when each last opened the app. Helps when "nothing pops up" on their phone.
export const testPushTo = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'admin'])
  const email = typeof req.data?.email === 'string' ? req.data.email.trim().toLowerCase() : ''
  if (!email.includes('@')) throw new HttpsError('invalid-argument', 'Pick a person.')
  const phones = (await db.collection('push_tokens').where('email', '==', email).get()).docs
    .map(d => ({ platform: String(d.get('platform') ?? ''), lastSeen: String(d.get('lastSeen') ?? '') }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
  if (req.data?.send !== true) return { sent: 0, phones: phones.length, errors: [], devices: phones }
  const from = caller.name || 'the team'
  const r = await sendPushDetailed({ to: [email], url: '/account', tag: 'test', title: 'Test notification',
    body: `${from} sent this to check your notifications work. If you can read this, you're all set.` })
  return { ...r, devices: phones }
})

// ─── Things that happen (instant) ────────────────────────────────────────────

export const pushOnInvite = onDocumentWritten('schedule_invites/{id}', async e => {
  await sendAll(inviteChange(e.params.id, e.data?.before.data(), e.data?.after.data(), await loadScheduleSettings()))
})
export const pushOnSwap = onDocumentWritten('swap_requests/{id}', async e => {
  await sendAll(swapChange(e.params.id, e.data?.before.data(), e.data?.after.data(), await loadScheduleSettings()))
})
export const pushOnReservation = onDocumentWritten('reservations/{id}', async e => {
  await sendAll(reservationChange(e.params.id, e.data?.before.data(), e.data?.after.data()))
})
export const pushOnGearBooking = onDocumentWritten('gear_bookings/{id}', async e => {
  await sendAll(gearChange(e.params.id, e.data?.before.data(), e.data?.after.data()))
})
export const pushOnShoot = onDocumentWritten('shoots/{id}', async e => {
  await sendAll(shootChange(e.params.id, e.data?.before.data(), e.data?.after.data(), await loadScheduleSettings()))
})
export const pushOnReport = onDocumentCreated('schedule_reports/{id}', async e => {
  await sendAll(reportCreated(e.params.id, e.data?.data()))
})
export const pushOnStrike = onDocumentCreated('strikes/{id}', async e => {
  await sendAll(strikeCreated(e.params.id, e.data?.data(), await loadScheduleSettings()))
})

// ─── Reminders: every 10 minutes (Cloud Scheduler, owner OK Oct 18) ───────────

// Send each reminder once: push_sent/{key} is created first; if it already exists, it was sent before.
async function sendOnce(list: Reminder[]) {
  let sent = 0
  for (const r of list) {
    try { await db.doc(`push_sent/${r.key}`).create({ at: new Date().toISOString(), to: r.push.to }) } catch { continue }
    await sendPush(r.push).catch(e => logger.warn('Reminder failed', String(e)))
    sent++
  }
  return sent
}

export async function runReminders(now = nowStamp()) {
  const today = todayInStudio()
  const [s, booking, shoots, props, gear] = await Promise.all([
    loadScheduleSettings(), loadSettings(),
    db.collection('shoots').where('date', '>=', addDays(today, -1)).where('date', '<=', addDays(today, 14)).get(),
    db.collection('reservations').where('status', '==', 'collected').get(),
    db.collection('gear_bookings').where('status', '==', 'out').get(),
  ])
  const lead = Math.max(booking.leadTimeDays, GEAR_LEAD_TIME_DAYS)
  const list: Reminder[] = []
  // Who can check in with the app right now: the owner and creators on the Full app (cached for this run).
  const access = new Map<string, boolean>()
  const canCheckIn = async (email: string) => {
    if (email === OWNER_EMAIL) return true
    if (!access.has(email)) { const u = (await db.doc(`users/${email}`).get()).data(); access.set(email, u?.role === 'creator' && u.access === 'full' && u.active !== false) }
    return access.get(email)!
  }
  for (const d of shoots.docs) {
    // One odd shoot only skips itself; the rest still get their reminders (audit, Nov 7).
    try {
      const sh = d.data()
      // Requests still waiting for approval only get the props cutoff reminder (shootReminders).
      if (!(sh.status === 'booked' || sh.status === 'requested') || sh.toCheck) continue
      // When check-in opens, remember whether this person could check in then (audit, Nov 5): Props-only creators' shoots
      // (calendar imports) never ask them to, and switching them to the Full app later doesn't turn old shoots into misses.
      if (sh.status === 'booked' && sh.place !== 'offsite' && sh.checksIn === undefined && now >= addMinutes(sh.from, -s.checkinBefore)) {
        sh.checksIn = await canCheckIn(String(sh.creatorEmail ?? ''))
        await d.ref.update({ checksIn: sh.checksIn }).catch(e => logger.warn('stamp checksIn', d.id, String(e)))
      }
      if (!(await canCheckIn(String(sh.creatorEmail ?? '')))) continue   // Props only: no shoot notifications (they can't open shoots)
      // Only look up props/gear for shoots whose last day to add them is today, and only until that reminder went out.
      const cutoffToday = sh.date > today && lastDayToBook(sh.date, lead, booking) === today && Number(now.slice(11, 13)) >= 9
        && !(await db.doc(`push_sent/cutoff_${d.id}`).get()).exists
      const needs = cutoffToday ? await openLinks(d.id) : null
      list.push(...shootReminders(d.id, sh, now, s, needs ? needs.props.length + needs.gear.length + needs.sharedGear.length > 0 : true, booking, lead))
    } catch (e) { logger.warn('Reminder skipped for a shoot', d.id, String(e)) }
  }
  // Once a day: strike counts go down as strikes get older than the window (audit, Nov 5: the stored count never dropped).
  const recountKey = db.doc(`push_sent/recount_${today}`)
  if (!(await recountKey.get()).exists) {
    await recountKey.set({ at: new Date().toISOString() })
    const { recountStrikes } = await import('./strikes.js')
    for (const d of (await db.collection('user_status').where('strikes', '>', 0).get()).docs) await recountStrikes(d.id).catch(e => logger.warn('recount', d.id, String(e)))
  }
  props.docs.forEach(d => list.push(...propsReminders(d.id, d.data(), now, booking)))
  gear.docs.forEach(d => list.push(...gearReminders(d.id, d.data(), now)))
  return sendOnce(list)
}

// A request still waiting after 12 hours: one reminder to the equipment team (owner, Nov 2).
async function nudgeWaitingRequests() {
  // Not in the middle of the night (audit, Nov 7): before 9 AM or after 9 PM it waits for the morning
  // (the reminder key is only written when it's sent).
  const hour = Number(nowStamp().slice(11, 13))
  if (hour < 9 || hour >= 21) return
  const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString()
  const waiting = (await db.collection('shoots').where('status', '==', 'requested').get()).docs.filter(d => (d.get('requestedAt') ?? d.get('createdAt') ?? '') <= cutoff)
  if (!waiting.length) return
  const names = [...new Set(waiting.map(d => d.get('creatorName') as string))].slice(0, 3).join(', ')
  await sendOnce(waiting.map(d => ({ key: `reqwait_${d.id}`, push: { to: ['approvers'], url: '/approvals', tag: 'req-waiting',
    title: `${waiting.length} booking request${waiting.length === 1 ? '' : 's'} waiting`, body: `From ${names}. They've been waiting over 12 hours.` } })))
}

export const pushReminders = onSchedule({ schedule: 'every 10 minutes', timeZone: 'America/Toronto', timeoutSeconds: 120 }, async () => {
  // Requests nobody decided on by their start time are dropped (owner, Nov 2) FIRST: freeing held slots and props matters
  // most, and an error or timeout in the reminders below must never stop it (audit, Nov 7).
  try { await (await import('./scheduling.js')).expireRequests() } catch (e) { logger.warn('Expire requests failed', String(e)) }
  try { await runReminders() } catch (e) { logger.warn('Reminders failed', String(e)) }
  // Waiting requests nudge the team once after 12 hours.
  try { await nudgeWaitingRequests() } catch (e) { logger.warn('Request reminder failed', String(e)) }
  // Waitlist entries whose slot has started are over ("Notify me if it opens", Nov 7).
  try { await (await import('./waitlist.js')).expireWaitlist() } catch (e) { logger.warn('Waitlist sweep failed', String(e)) }
  // The monthly Cliff 1 draw was RETIRED (owner, Nov 2): the equipment team puts the guaranteed slots in the Google Calendar
  // and the calendar check brings them in. draw.ts stays (its callables are unused) so a deploy doesn't have to delete functions.
})
