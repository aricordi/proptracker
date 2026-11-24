// Real-time calendar sync (owner, Nov 24: "we'll go with real time sync, as long as you automate the reauthentication").
// Google tells us the moment any of the linked calendars changes (a "watch channel" per calendar, pointing at calendarPush);
// we then run the same calendar check the 30-minute timer runs, so the app follows Google within seconds.
//   • calendarPush (public web address): Google posts here. We only check the channel id + secret token against our own
//     list, write a "ping" and answer at once (Google wants a fast answer).
//   • calendarPinged (trigger on that ping): runs the check. Pings that arrive while a check runs are remembered and one
//     more check follows, so a burst of edits is caught without running ten checks.
//   • ensureWatches: opens a channel for every calendar that has none, renews channels a day before they end, and closes
//     channels for calendars no longer linked. Runs with every timer check (every 30 minutes), so renewal is automatic.
//     If Google refuses (the company account was disconnected, a calendar unshared), the owner gets ONE notification a day
//     and the 30-minute timer keeps everything in step meanwhile.
// Nothing here writes to Google Calendar events; channels only say "something changed".
import { onRequest } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { randomBytes, randomUUID } from 'node:crypto'
import { db, OWNER_EMAIL } from './auth.js'
import { cleanScheduleSettings } from './schedule.js'
import { calendarAccess } from './googleAccount.js'

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
const REGION = 'northamerica-northeast1'
const TTL_SECONDS = 7 * 24 * 3600       // Google keeps an events channel up to about a week
const RENEW_BEFORE_MS = 24 * 3600_000   // renew a day before it ends (the timer runs every 30 minutes, so never late)
const RUN_LEASE_MS = 6 * 60_000

export const pushAddress = () => `https://${REGION}-${process.env.GCLOUD_PROJECT || 'proptracker-9732e'}.cloudfunctions.net/calendarPush`

interface Watch { calendarId: string; name: string; channelId: string; resourceId: string; token: string; expiration: number; createdAt: string }

async function linkedCalendars(): Promise<{ id: string; name: string }[]> {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const out = s.googleCalendarId ? [{ id: s.googleCalendarId, name: 'App calendar' }] : []
  for (const f of s.calendarFeeds) if (!out.some(o => o.id === f.id)) out.push({ id: f.id, name: f.name || 'Old calendar' })
  return out
}

async function openChannel(cal: { id: string; name: string }): Promise<Watch> {
  const { token: auth } = await calendarAccess()
  const channelId = randomUUID(), secret = randomBytes(24).toString('hex')
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events/watch`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: channelId, type: 'web_hook', address: pushAddress(), token: secret, params: { ttl: String(TTL_SECONDS) } }),
  })
  if (!r.ok) throw new Error(`${cal.name}: Google said ${r.status} ${(await r.text()).slice(0, 200)}`)
  const j = await r.json() as { resourceId: string; expiration?: string }
  return { calendarId: cal.id, name: cal.name, channelId, resourceId: j.resourceId, token: secret,
    expiration: Number(j.expiration) || Date.now() + TTL_SECONDS * 1000, createdAt: new Date().toISOString() }
}
async function closeChannel(w: Pick<Watch, 'channelId' | 'resourceId'>) {
  try {
    const { token } = await calendarAccess()
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: w.channelId, resourceId: w.resourceId }) })
  } catch { /* an old channel simply runs out by itself */ }
}

/** Open, renew and close channels so every linked calendar has exactly one live channel. Safe to run any time. */
export async function ensureWatches(now = Date.now()): Promise<{ on: number; opened: number; closed: number; errors: string[] }> {
  const status = db.doc('app_settings/calendarLive')
  if (isEmulator()) return { on: 0, opened: 0, closed: 0, errors: [] }
  const cals = await linkedCalendars()
  const snap = await db.collection('calendar_watches').get()
  const watches = snap.docs.map(d => d.data() as Watch)
  const errors: string[] = []
  let opened = 0, closed = 0
  for (const cal of cals) {
    const mine = watches.filter(w => w.calendarId === cal.id).sort((a, b) => b.expiration - a.expiration)
    const best = mine[0]
    if (!best || best.expiration - now < RENEW_BEFORE_MS) {
      try {
        const w = await openChannel(cal)
        await db.doc(`calendar_watches/${w.channelId}`).set(w)
        opened++
        // The new one is live: close the old ones for this calendar.
        for (const old of mine) { await closeChannel(old); await db.doc(`calendar_watches/${old.channelId}`).delete(); closed++ }
      } catch (e) { errors.push(String((e as Error).message).slice(0, 240)) }
    } else {
      for (const old of mine.slice(1)) { await closeChannel(old); await db.doc(`calendar_watches/${old.channelId}`).delete(); closed++ }
    }
  }
  // Calendars no longer linked, and channels already over.
  for (const w of watches) {
    if (!cals.some(c => c.id === w.calendarId) || w.expiration < now) { await closeChannel(w); await db.doc(`calendar_watches/${w.channelId}`).delete().catch(() => 0); closed++ }
  }
  const live = (await db.collection('calendar_watches').get()).docs.map(d => d.data() as Watch).filter(w => w.expiration > now)
  await status.set({ at: new Date(now).toISOString(), on: live.length, calendars: cals.length,
    renewsAt: live.length ? new Date(Math.min(...live.map(w => w.expiration)) - RENEW_BEFORE_MS).toISOString() : null,
    errors }, { merge: true })
  if (errors.length) {
    logger.warn('Live calendar sync: could not open a channel', errors)
    const day = new Date(now).toISOString().slice(0, 10)
    try {
      await db.doc(`push_sent/calendarlive_${day}`).create({ at: new Date(now).toISOString() })
      const { sendPush } = await import('./push.js')
      await sendPush({ to: [OWNER_EMAIL], title: 'Live calendar sync paused', body: 'Google refused to send live calendar updates. The app still checks every 30 minutes. Open Calendar & email to reconnect.', url: '/connections', tag: 'calendar-live' })
    } catch { /* already told today */ }
  }
  return { on: live.length, opened, closed, errors }
}

// Google posts here when a watched calendar changes. Headers only (no body): channel id, our secret, what happened.
export const calendarPush = onRequest({ invoker: 'public', region: REGION, memory: '256MiB' }, async (req, res) => {
  const channelId = String(req.get('X-Goog-Channel-ID') ?? '').slice(0, 80)
  const token = String(req.get('X-Goog-Channel-Token') ?? '')
  const state = String(req.get('X-Goog-Resource-State') ?? '')
  if (req.method !== 'POST' || !/^[0-9a-f-]{36}$/.test(channelId)) { res.status(404).end(); return }
  const w = (await db.doc(`calendar_watches/${channelId}`).get()).data() as Watch | undefined
  if (!w || w.token !== token) { res.status(404).end(); return }   // not ours (or an old channel): Google stops on 404
  if (state !== 'sync') {
    // A ping per calendar; the trigger below runs the check.
    await db.doc(`calendar_ping/${channelId}`).set({ at: new Date().toISOString(), calendar: w.name, state })
  }
  res.status(200).end()
})

// One check at a time; pings during a check ask for exactly one more.
export const calendarPinged = onDocumentWritten({ document: 'calendar_ping/{id}', region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async ev => {
  if (!ev.data?.after.exists) return
  const ref = db.doc('app_settings/calendarLive')
  const claim = await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() ?? {}
    const nowIso = new Date().toISOString()
    if (d.runningUntil && String(d.runningUntil) > nowIso) { tx.set(ref, { dirty: true, lastPing: nowIso }, { merge: true }); return false }
    tx.set(ref, { runningUntil: new Date(Date.now() + RUN_LEASE_MS).toISOString(), dirty: false, lastPing: nowIso }, { merge: true })
    return true
  })
  if (!claim) return
  const { runCalendarCheck } = await import('./calendar.js')
  for (let round = 0; round < 3; round++) {
    try { await runCalendarCheck() }
    catch (e) {
      // The timer's check is running: wait for it and look once more (our change may have landed just after it read).
      logger.info('Live calendar sync: check busy, retrying', String(e))
      await new Promise(r => setTimeout(r, 20_000))
      try { await runCalendarCheck() } catch (e2) { logger.warn('Live calendar sync: check failed', String(e2)) }
    }
    const again = await db.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() ?? {}
      if (d.dirty) { tx.set(ref, { dirty: false, runningUntil: new Date(Date.now() + RUN_LEASE_MS).toISOString() }, { merge: true }); return true }
      tx.set(ref, { runningUntil: null, lastSynced: new Date().toISOString() }, { merge: true })
      return false
    })
    if (!again) return
  }
  await ref.set({ runningUntil: null, lastSynced: new Date().toISOString() }, { merge: true })
})
