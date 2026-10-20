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
import { nowStamp, GEAR_LEAD_TIME_DAYS } from './gearBooking.js'
import {
  inviteChange, swapChange, reservationChange, gearChange, reportCreated, strikeCreated, shootChange,
  shootReminders, propsReminders, gearReminders, type Push, type Reminder,
} from './pushMessages.js'

export const APP_URL = 'https://proptracker.arbcreative.co'
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 40)
const MAX_DEVICES = 8

// 'arts-team' = the arts department, 'gear-team' = the equipment/schedule team. The owner gets team pings only
// when that team has nobody in it yet (so the owner isn't flooded with every request).
async function resolve(to: string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const t of to) {
    if (t === 'arts-team' || t === 'gear-team') {
      const role = t === 'arts-team' ? 'arts' : 'equipment'
      const team = (await db.collection('users').where('role', '==', role).where('active', '==', true).get()).docs.map(d => d.id)
      ;(team.length ? team : [OWNER_EMAIL]).forEach(e => out.add(e))
    } else if (t) out.add(t.toLowerCase())
  }
  return [...out]
}

export async function sendPush(p: Push): Promise<number> {
  const emails = await resolve(p.to)
  if (!emails.length) return 0
  if (isEmulator()) {
    await db.collection('push_log').add({ ...p, to: emails, at: new Date().toISOString() })
    return emails.length
  }
  const tokens: { id: string; token: string }[] = []
  for (let i = 0; i < emails.length; i += 30) {
    const q = await db.collection('push_tokens').where('email', 'in', emails.slice(i, i + 30)).get()
    q.docs.forEach(d => tokens.push({ id: d.id, token: d.get('token') }))
  }
  if (!tokens.length) return 0
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
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error?.code ?? ''
    if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) return db.doc(`push_tokens/${tokens[i].id}`).delete()
    if (!r.success) logger.warn('Push failed', code, r.error?.message)
    return null
  }))
  return res.successCount
}
const sendAll = (list: Push[]) => Promise.all(list.map(p => sendPush(p).catch(e => logger.warn('Push failed', String(e)))))

// ─── Phones signing up ───────────────────────────────────────────────────────

export const registerPush = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
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
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const token = typeof req.data?.token === 'string' ? req.data.token.trim() : ''
  if (!token) return { ok: true }
  const ref = db.doc(`push_tokens/${tokenId(token)}`)
  const d = (await ref.get()).data()
  if (d && d.email === caller.email) await ref.delete()
  return { ok: true }
})

export const testPush = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const sent = await sendPush({ to: [caller.email], url: '/account', tag: 'test', title: 'Notifications are on ✓',
    body: "You'll get a ping for invites, swaps, props and gear, and reminders before your shoots." })
  return { sent }
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
  for (const d of shoots.docs) {
    const sh = d.data()
    if (sh.status !== 'booked') continue
    // Only look up props/gear for shoots whose last day to add them is today, and only until that reminder went out.
    const cutoffToday = sh.date > today && lastDayToBook(sh.date, lead, booking) === today && Number(now.slice(11, 13)) >= 9
      && !(await db.doc(`push_sent/cutoff_${d.id}`).get()).exists
    const needs = cutoffToday ? await openLinks(d.id) : null
    list.push(...shootReminders(d.id, sh, now, s, needs ? needs.props.length + needs.gear.length + needs.sharedGear.length > 0 : true, booking, lead))
  }
  props.docs.forEach(d => list.push(...propsReminders(d.id, d.data(), now, booking)))
  gear.docs.forEach(d => list.push(...gearReminders(d.id, d.data(), now)))
  return sendOnce(list)
}

export const pushReminders = onSchedule({ schedule: 'every 10 minutes', timeZone: 'America/Toronto', timeoutSeconds: 120 }, async () => {
  await runReminders()
})
