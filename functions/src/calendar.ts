// Calendars.
// 1) "Add to my calendar": every person gets a private link (an iCal feed) that phone calendars
//    subscribe to. It lists their own shoots (the schedule team's link lists everyone's) and
//    updates by itself. The link holds a random token, kept in calendar_tokens (server-only).
// 2) The shared Google Calendar: every booking, move, cancel and blocked time is copied there
//    (one-way; the app stays the source of truth). Off until the team pastes the calendar's ID in
//    Schedule → Settings and shares that calendar with the Prime Capitol Google account (googleAccount.ts;
//    before that's connected: the app's server account).
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { FieldValue, FieldPath } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings, BLOCK_TYPES, monthOf, slotWindow, type ScheduleDay, type Block, type BlockType, type House, type Place } from './schedule.js'
import { importShootAsTeam, removeImportedShoot, releaseCancelledImport, filmingPeople } from './scheduling.js'
import { openLinks } from './shootLinks.js'
import { stamp, addMinutes } from './gearBooking.js'
import { calendarAccess, calendarAccount } from './googleAccount.js'
import { sendPush } from './push.js'
import { houseFromText, placeFromText, saysOffsite, ignoreReason, blockTypeOf, isClearEvent, namedPeople, namedPeopleInfo, splitHours, splitOnGrid, looksLikeHeadsUp, queueReady, nightBefore, namesBothHouses } from './calendarText.js'
export { houseFromText, ignoreReason }

const TEAM = ['owner', 'equipment']
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'

// ─── 1. Personal calendar feed ───────────────────────────────────────────────

const FEED_URL = 'https://northamerica-northeast1-proptracker-9732e.cloudfunctions.net/shootsCalendar'

// Your private link (made once, then reused). `reset: true` makes a new one and the old link stops working.
export const myCalendarLink = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment', 'admin'])
  const existing = await db.collection('calendar_tokens').where('email', '==', caller.email).get()
  let token = existing.docs[0]?.id
  if (!token || req.data?.reset === true) {
    await Promise.all(existing.docs.map(d => d.ref.delete()))
    token = randomBytes(18).toString('hex')
    await db.doc(`calendar_tokens/${token}`).set({ email: caller.email, all: TEAM.includes(caller.role) || caller.role === 'admin', createdAt: new Date().toISOString() })
  }
  const base = process.env.FUNCTIONS_EMULATOR === 'true' ? `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/northamerica-northeast1/shootsCalendar` : FEED_URL
  return { url: `${base}?t=${token}`, webcal: `${base.replace(/^https?:/, 'webcal:')}?t=${token}` }
})

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsTime = (st: string) => st.replace(/[-:]/g, '') + '00'   // '2026-10-20T13:00' → '20261020T130000'
// Long lines must be folded at 75 characters (calendar apps are strict about it).
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,74}/g)!.join('\r\n ')

export function buildIcs(name: string, events: { uid: string; from: string; to: string; title: string; where: string; note?: string; stampedAt: string }[]) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prime Capitol//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:America/Toronto', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@prime-app`, `DTSTAMP:${e.stampedAt}`,
      `DTSTART;TZID=America/Toronto:${icsTime(e.from)}`, `DTEND;TZID=America/Toronto:${icsTime(e.to)}`,
      `SUMMARY:${icsText(e.title)}`, `LOCATION:${icsText(e.where)}`, ...(e.note ? [`DESCRIPTION:${icsText(e.note)}`] : []), 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export const shootsCalendar = onRequest({ invoker: 'public' }, async (req, res) => {
  const token = String(req.query.t ?? '')
  const t = /^[a-f0-9]{36}$/.test(token) ? (await db.doc(`calendar_tokens/${token}`).get()).data() : undefined
  if (!t) { res.status(404).send('This calendar link is no longer valid. Get a new one in Prime Capitol → Schedule.'); return }
  // The person must still be active, and "everyone's shoots" follows their role TODAY (not the role when the link
  // was made): someone deactivated or moved off the schedule team stops getting the feed.
  const email = String(t.email ?? '')
  const u = email === OWNER_EMAIL ? { role: 'owner', active: true } : (await db.doc(`users/${email}`).get()).data()
  if (!email || !u || u.active !== true) { res.status(404).send('This calendar link is no longer valid. Get a new one in Prime Capitol → Schedule.'); return }
  t.all = ['owner', 'equipment', 'admin'].includes(String(u.role))
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const from = addDays(todayInStudio(), -30), to = addDays(todayInStudio(), 120)
  const base = db.collection('shoots').where('date', '>=', from).where('date', '<=', to)
  const snap = await (t.all ? base : db.collection('shoots').where('creatorEmail', '==', t.email).where('date', '>=', from)).get()
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const events = snap.docs.map(d => ({ id: d.id, ...d.data() } as any))
    .filter(x => x.status === 'booked' && x.date <= to)
    .map(x => {
      const house = x.place === 'offsite' ? null : s.houses[x.place as 'cliff1' | 'cliff2']
      const where = house ? `${house.name} · ${house.address}` : x.where
      return { uid: x.id, from: x.from, to: x.to, title: t.all ? `${x.creatorName} · ${house ? house.name : 'Offsite'}` : `Shoot · ${house ? house.name : x.where}`, where, stampedAt: now }
    })
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'private, max-age=900')
  res.send(buildIcs(t.all ? 'Prime Capitol · All shoots' : 'Prime Capitol · My shoots', events))
})

// ─── 2. Shared Google Calendar (one-way copy) ────────────────────────────────

// Who talks to Google: the connected Prime Capitol account (Admin → Google account), else the server's robot address.
// Google event IDs may only use the letters a–v and digits, so encode ours as hex with a prefix.
const hex = (s: string) => Buffer.from(s).toString('hex')
export const shootEventId = (shootId: string) => `s${hex(shootId)}`
export const blockEventId = (date: string, blockId: string) => `b${hex(`${date}_${blockId}`)}`

async function calendarId(): Promise<string> {
  const d = (await db.doc('app_settings/schedule').get()).data()
  return typeof d?.googleCalendarId === 'string' ? d.googleCalendarId.trim() : ''
}
// Every calendar the import reads: the app's own calendar (things people still add there by hand) + the old ones
// (owner, Oct 30). Read only: the app only ever WRITES its own events to the app calendar.
interface Source { id: string; name: string; house: House | 'any' }
async function sources(): Promise<Source[]> {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const out: Source[] = s.googleCalendarId ? [{ id: s.googleCalendarId, name: 'App calendar', house: 'any' }] : []
  for (const f of s.calendarFeeds) if (!out.some(o => o.id === f.id)) out.push({ id: f.id, name: f.name || 'Old calendar', house: f.house })
  return out
}
async function gcal(method: 'PUT' | 'POST' | 'DELETE', cal: string, path: string, body?: unknown) {
  const { token } = await calendarAccess()
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events${path}`
  return fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
}

// Create or update one event (update first; if it doesn't exist yet, insert it with our ID).
async function upsertEvent(cal: string, id: string, ev: Record<string, unknown>) {
  let r = await gcal('PUT', cal, `/${id}`, ev)
  if (r.status === 404) r = await gcal('POST', cal, '', { id, ...ev })
  if (!r.ok) throw new Error(`Google Calendar said ${r.status}: ${(await r.text()).slice(0, 300)}`)
}
async function deleteEvent(cal: string, id: string) {
  const r = await gcal('DELETE', cal, `/${id}`)
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google Calendar said ${r.status}: ${(await r.text()).slice(0, 300)}`)
}

const when = (st: string) => ({ dateTime: `${st}:00`, timeZone: 'America/Toronto' })
// One colour per place so the single app calendar reads like the old separate ones (Google's event colour numbers).
// Heads-ups (owner, Nov 4: something happening at a house, filming still allowed) get their own colour so they don't read as a block.
export const EVENT_COLOURS: Record<'cliff1' | 'cliff2' | 'offsite' | 'block' | 'headsUp', string> = { cliff1: '5', cliff2: '7', offsite: '10', block: '8', headsUp: '6' }

// Owner, Nov 8: events brought in from the OLD calendars (Cliff 2, Stromedy Talent…) are copied into the app calendar too,
// colour-coded like everything else, so the app calendar becomes the full schedule. The copy is the app's OWN event
// ('s…'/'b…' ids); the old calendar's event is still never touched. Events that came from the app calendar itself are never
// copied (that would put them in twice), and nothing is copied until a person has confirmed it (toCheck).
// Returns the calendar an imported shoot/block came from ('' = not imported).
const sourceCache = new Map<string, string>()
export async function importedFrom(rec: Record<string, any>, kind: 'shoot' | 'block'): Promise<string> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (kind === 'shoot' ? !(rec.importedFrom || rec.calendarEventId) : !rec.imported) return ''
  if (rec.calendarFeed) return String(rec.calendarFeed)
  const key = kind === 'shoot' ? `e:${rec.calendarEventId}` : `b:${rec.id}`
  if (sourceCache.has(key)) return sourceCache.get(key)!
  let feed = ''
  if (kind === 'shoot' && rec.calendarEventId) feed = String((await db.doc(`calendar_imports/${rec.calendarEventId}`).get()).get('feedId') ?? '')
  else if (kind === 'block' && rec.id) {
    const q = await db.collection('calendar_imports').where('blockId', '==', rec.id).limit(1).get()
    feed = String(q.docs[0]?.get('feedId') ?? '')
  }
  feed = feed || 'app'   // imports from before Oct 30 came from the app calendar (then the only one)
  sourceCache.set(key, feed)
  return feed
}
// True = this record may have its own event in the app calendar: made in the app, or confirmed from an OLD calendar.
export async function copyable(rec: Record<string, any>, kind: 'shoot' | 'block', appCal: string): Promise<boolean> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (rec.toCheck) return false
  const from = await importedFrom(rec, kind)
  return !from || (from !== 'app' && from !== appCal)
}

// What's on a shoot (props + gear), for the event's description, so anyone looking knows the kit is out.
async function shootNeeds(shootId: string) {
  const live = (st: unknown) => !['cancelled', 'declined'].includes(String(st))
  const [props, gear] = await Promise.all([
    db.collection('reservations').where('scheduleShootId', '==', shootId).get(),
    db.collection('gear_bookings').where('scheduleShootId', '==', shootId).get(),
  ])
  const lines = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.filter(d => live(d.get('status')))
    .flatMap(d => ((d.get('lines') ?? []) as { itemName?: string; name?: string; qty?: number }[]).map(l => `${l.itemName ?? l.name ?? 'Item'}${(l.qty ?? 1) > 1 ? ` ×${l.qty}` : ''}`))
  return { props: lines(props.docs), gear: lines(gear.docs) }
}

// Owner (Oct 19): bookings are instant and so is the calendar: whenever a PERSON books, moves, cancels or blocks time
// in the app, its own event in the shared calendar is added/changed/removed right away. The app never moves anything
// by itself, and events that came from the old calendar (imported shoots and blocks) are never touched. Only event IDs
// the app makes itself ('s…' / 'b…') are ever written. `calendar_sent/{eventId}` = what's in the calendar from the
// app (the team can take any of them back out); if Google refuses a change it waits in `calendar_outbox` to retry.
type Pending = { kind: 'shoot'; shootId: string } | { kind: 'block'; date: string; blockId: string }
const outbox = (eventId: string) => db.doc(`calendar_outbox/${eventId}`)
const sentDoc = (eventId: string) => db.doc(`calendar_sent/${eventId}`)

const shootLabel = (sh: Record<string, any>, s: ReturnType<typeof cleanScheduleSettings>) => {
  const house = sh.place === 'offsite' ? null : s.houses[sh.place as 'cliff1' | 'cliff2']
  return `${sh.creatorName} · ${house ? house.name : sh.where || 'Offsite'} · ${sh.date} ${sh.from?.slice(11, 16)}–${sh.to?.slice(11, 16)}`
}

// Put the CURRENT state of one app booking/block into the calendar (or take it out if it's gone).
async function pushEvent(cal: string, eventId: string, ref: Pending, label: string, by: string) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  let ev: Record<string, unknown> | null = null
  if (ref.kind === 'shoot') {
    const sh = (await db.doc(`shoots/${ref.shootId}`).get()).data()
    const from = sh ? await importedFrom(sh, 'shoot') : ''
    if (from === 'app' || (from && from === cal)) return   // came from the app calendar itself: that event IS the copy
    if (sh && sh.status === 'booked' && !sh.toCheck) {
      const house = sh.place === 'offsite' ? null : s.houses[sh.place as 'cliff1' | 'cliff2']
      const needs = await shootNeeds(ref.shootId)
      const list = (title: string, xs: string[]) => xs.length ? [`${title}:`, ...xs.slice(0, 25).map(x => `• ${x}`), ...(xs.length > 25 ? [`…and ${xs.length - 25} more`] : [])] : []
      ev = { summary: `${sh.creatorName} · ${house ? house.name : 'Offsite'}`, location: house ? house.address : sh.where,
        colorId: EVENT_COLOURS[house ? sh.place as 'cliff1' | 'cliff2' : 'offsite'],
        description: [`${sh.kind === 'offsite' ? `Offsite shoot · ${sh.where}` : 'House slot'}`, ...list('Gear', needs.gear), ...list('Props', needs.props),
          from ? 'Copied from an older Google Calendar (changes made here are not copied back)' : 'Booked in Prime Capitol (changes made here are not copied back)'].join('\n'),
        start: when(sh.from), end: when(sh.to) }
    }
  } else {
    const b = (((await db.doc(`schedule_days/${ref.date}`).get()).data() as ScheduleDay | undefined)?.blocks ?? []).find(x => x.id === ref.blockId) as (Block & { imported?: boolean; soft?: boolean; toCheck?: boolean }) | undefined
    const src = b ? await importedFrom(b, 'block') : ''
    if (src === 'app' || (src && src === cal)) return
    if (b && !b.toCheck && s.houses[b.house]) {
      const from = stamp(ref.date, b.start)
      ev = { summary: `${b.soft ? 'Heads-up: ' : ''}${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name}`,
        location: s.houses[b.house].address, colorId: b.soft ? EVENT_COLOURS.headsUp : EVENT_COLOURS.block,
        description: [b.soft ? 'Heads-up · filming can still go ahead' : 'Blocked time', src ? 'Copied from an older Google Calendar' : 'Set in Prime Capitol'].join(' · '),
        start: when(from), end: when(addMinutes(from, b.end - b.start)) }
    }
  }
  if (!ev && !(await sentDoc(eventId).get()).exists) { await outbox(eventId).delete(); return }   // never reached the calendar
  if (!isEmulator()) { if (ev) await upsertEvent(cal, eventId, ev); else await deleteEvent(cal, eventId) }
  if (ev) await sentDoc(eventId).set({ label, at: new Date().toISOString(), by })
  else await sentDoc(eventId).delete()
  await outbox(eventId).delete()
}
// Right away; if Google refuses (calendar not shared yet, API off…), keep it to retry from the Calendar screen.
async function sendNow(eventId: string, ref: Pending, label: string, by: string) {
  const cal = await calendarId()
  if (!cal) return
  try { await pushEvent(cal, eventId, ref, label, by) }
  catch (e) {
    logger.warn('Calendar copy failed', eventId, String(e))
    await outbox(eventId).set({ ...ref, eventId, label, error: String((e as Error).message).slice(0, 200), at: new Date().toISOString() })
  }
}

export const syncShootToCalendar = onDocumentWritten('shoots/{id}', async event => {
  const after = event.data?.after.data()
  const shoot = after ?? event.data?.before.data()
  if (!shoot) return
  const cal = await calendarId()
  if (!cal) return
  const from = await importedFrom(shoot, 'shoot')
  if (from === 'app' || (from && from === cal)) return   // came from the app calendar itself: never copied
  const before = event.data?.before.data()
  // Waiting to be checked (toCheck) counts as not shown, so confirming it copies it in.
  const what = (x?: Record<string, any>) => x && x.status === 'booked' && !x.toCheck ? JSON.stringify([x.place, x.from, x.to, x.where, x.creatorName]) : ''
  if (what(before) === what(after)) return   // nothing the calendar shows has changed (e.g. a check-in)
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  await sendNow(shootEventId(event.params.id), { kind: 'shoot', shootId: event.params.id }, shootLabel(shoot, s), String(shoot.updatedBy ?? shoot.bookedBy ?? ''))
})

// Props or gear added to / changed on / taken off a shoot: refresh that shoot's event (its description lists them).
async function refreshShootFor(before?: Record<string, any>, after?: Record<string, any>) {
  const shootId = String(after?.scheduleShootId ?? before?.scheduleShootId ?? '')
  if (!shootId) return
  const what = (x?: Record<string, any>) => x && !['cancelled', 'declined'].includes(x.status) ? JSON.stringify((x.lines ?? []).map((l: any) => [l.itemName ?? l.name, l.qty])) : ''
  if (what(before) === what(after)) return
  const sh = (await db.doc(`shoots/${shootId}`).get()).data()
  if (!sh || sh.status !== 'booked') return
  const cal = await calendarId()
  if (!cal || !(await copyable(sh, 'shoot', cal))) return
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  await sendNow(shootEventId(shootId), { kind: 'shoot', shootId }, shootLabel(sh, s), 'props/gear change')
}
export const syncPropsToCalendar = onDocumentWritten('reservations/{id}', e => refreshShootFor(e.data?.before.data(), e.data?.after.data()))
export const syncGearToCalendar = onDocumentWritten('gear_bookings/{id}', e => refreshShootFor(e.data?.before.data(), e.data?.after.data()))

export const syncBlocksToCalendar = onDocumentWritten('schedule_days/{date}', async event => {
  // Blocks from the app calendar itself are that calendar's own events: never copied. Blocks confirmed from an OLD calendar
  // are copied (owner, Nov 8); ones still waiting to be checked count as not there yet.
  const cal = await calendarId()
  if (!cal) return
  const keep = async (list: Block[]) => { const out: Block[] = []; for (const b of list) if (await copyable(b as Block & Record<string, unknown>, 'block', cal)) out.push(b); return out }
  const before = await keep((event.data?.before.data() as ScheduleDay | undefined)?.blocks ?? [])
  const after = await keep((event.data?.after.data() as ScheduleDay | undefined)?.blocks ?? [])
  const key = (b: Block) => JSON.stringify([b.id, b.house, b.start, b.end, b.type, b.note ?? '', !!(b as Block & { soft?: boolean }).soft])
  const changed = [...after.filter(b => !before.some(x => key(x) === key(b))), ...before.filter(b => !after.some(x => x.id === b.id))]
  if (!changed.length) return
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const date = event.params.date
  for (const b of changed) {
    await sendNow(blockEventId(date, b.id), { kind: 'block', date, blockId: b.id },
      `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name} · ${date}`, String((b as Block & { by?: string }).by ?? ''))
  }
})

// What the app has put in the calendar, and any change Google refused (to retry).
export const calendarPending = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const [p, sent] = await Promise.all([db.collection('calendar_outbox').orderBy('at').limit(300).get(), db.collection('calendar_sent').orderBy('at', 'desc').limit(300).get()])
  return { pending: p.docs.map(d => d.data()), sent: sent.docs.map(d => ({ eventId: d.id, label: d.get('label'), at: d.get('at') })) }
})

// A tap from the team: retry ('send') or drop ('discard') failed changes, or take app events back out ('remove').
export const applyCalendarChanges = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const action = req.data?.action
  const ids = (Array.isArray(req.data?.ids) ? req.data.ids : []).map((x: unknown) => String(x)).filter((x: string) => /^[sb][0-9a-f]+$/.test(x)).slice(0, 100) as string[]
  if (!['send', 'discard', 'remove'].includes(action) || !ids.length) throw new HttpsError('invalid-argument', 'Pick what to send.')
  const cal = await calendarId()
  if (!cal && action !== 'discard') throw new HttpsError('failed-precondition', 'Paste the Google Calendar ID in Schedule settings first.')
  const results: { eventId: string; ok: boolean; message?: string }[] = []
  for (const eventId of ids) {
    try {
      if (action === 'discard') await outbox(eventId).delete()
      else if (action === 'remove') {
        if (!isEmulator()) await deleteEvent(cal, eventId)
        await sentDoc(eventId).delete(); await outbox(eventId).delete()
        // Taken out by hand: the 15-minute catch-up must not put it back (it only comes back if the booking itself changes).
        await db.doc(`calendar_removed/${eventId}`).set({ at: new Date().toISOString(), by: caller.email })
      } else {
        const p = (await outbox(eventId).get()).data() as (Pending & { label: string }) | undefined
        if (!p) { results.push({ eventId, ok: false, message: 'Already handled.' }); continue }
        await pushEvent(cal, eventId, p, p.label, caller.email)
      }
      results.push({ eventId, ok: true })
    } catch (e) { results.push({ eventId, ok: false, message: String((e as Error).message).slice(0, 200) }) }
  }
  return { results }
})

// Schedule team: test the shared-calendar connection (a tap: writes and removes one test event).
export const testCalendarLink = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner'])   // the connection itself: the owner only (owner, Oct 20)
  const cal = await calendarId()
  if (!cal) throw new HttpsError('failed-precondition', 'Paste the Google Calendar ID in Schedule settings first.')
  const { account } = await calendarAccount()
  if (isEmulator()) return { ok: true, account }
  try {
    const id = `t${hex(String(Date.now()))}`
    const start = new Date(), end = new Date(start.getTime() + 30 * 60_000)
    await upsertEvent(cal, id, { summary: 'Prime Capitol connection test', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } })
    await deleteEvent(cal, id)
    return { ok: true, account, mode: 'write' }
  } catch (e) {
    throw new HttpsError('failed-precondition', `The app can't write to that calendar yet. Share it with ${account} ("Make changes to events"). (${String(e).slice(0, 160)})`, { account })
  }
})

// ─── 3. One-time import of what's already in the shared calendar ─────────────
// The team reviews each future event (a shoot for someone, blocked time, or skip). Imported shoots
// keep pointing at their original Google event (calendarEventId), so the app updates that event
// instead of creating a second copy.

export interface GEvent { id: string; summary?: string; location?: string; eventType?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; status?: string }

const torontoStamp = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

// Best guesses from the event's words; the team can change every one.
export function guessImport(e: { title: string; location: string; date: string; startMin: number; endMin: number }, people: { email: string; name: string }[], slots: number[]) {
  const text = `${e.title} ${e.location}`.toLowerCase()
  const said = placeFromText(text)
  // Nothing says where: a first guess of offsite for the screen, but never placed by itself (audit, Nov 5: "Kyle filming" in a
  // mixed calendar went offsite automatically and left the house slot free to double-book).
  const house = said ?? 'offsite'
  const { people: named, ambiguous } = namedPeopleInfo(text, people)
  const person = named[0]
  // Whole words only ("prevent", "parental", "Party prank" aren't blocks). When a creator is named, only words that are
  // clearly not filming make it blocked time.
  const isBlock = person
    ? /\b(clean\w*|maint\w*|repair\w*|plumb\w*|airbnb|rental|blocked|closed)\b/.test(text)
    : /\b(clean\w*|maint\w*|repair\w*|plumb\w*|events?|party|airbnb|rental|guests?|blocked|closed)\b/.test(text)
  // The 2-hour slot the event starts in (or the closest one).
  const slot = slots.reduce((best, s) => Math.abs(s - e.startMin) < Math.abs(best - e.startMin) ? s : best, slots[0])
  return { action: isBlock ? 'block' : person ? 'shoot' : 'skip', email: person?.email ?? '', emails: named.map(p => p.email), house, start: house === 'offsite' ? e.startMin : slot,
    ...(said ? {} : { houseUnsure: true }), ...(ambiguous.length ? { ambiguous } : {}) }
}

export const previewCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const cals = await sources()
  if (!cals.length) throw new HttpsError('failed-precondition', 'Paste a Google Calendar ID in Calendar & email first.')
  const { events, people, counts } = await scanCalendar(cals)
  return { events, people, calendars: counts }
})

// One Google event as the import sees it: a timed event, or one entry per day of an all-day event.
export interface ScanItem { id: string; title: string; location: string; date: string; startMin: number; endMin: number; allDay: boolean; eventType?: string }
export function eventDays(e: GEvent): ScanItem[] {
  const title = e.summary ?? '(no title)', location = e.location ?? '', eventType = e.eventType
  if (e.start?.dateTime && e.end?.dateTime) {
    const from = torontoStamp(e.start.dateTime), to = torontoStamp(e.end.dateTime)
    const date = from.slice(0, 10), startMin = Number(from.slice(11, 13)) * 60 + Number(from.slice(14, 16))
    const toDate = to.slice(0, 10), toMin = Number(to.slice(11, 13)) * 60 + Number(to.slice(14, 16))
    // Starts in the small hours and is over early: the studio's late night of the day before (audit: a 12:30–2 AM shoot landed on
    // the next day's 7 AM slot). A 5–7 AM shoot stays on its own day (audit, Nov 7: it was put on the night before's 11 PM slot).
    if (toDate === date && nightBefore(startMin, toMin)) return [{ id: e.id, title, location, date: addDays(date, -1), startMin: startMin + 1440, endMin: toMin + 1440, allDay: false, eventType }]
    // Ends the next morning by 6 AM: one entry past midnight (the 11 PM–1 AM slot).
    if (toDate <= addDays(date, 1) && (toDate === date || toMin <= 360)) {
      const endMin = (toDate > date ? 1440 : 0) + toMin
      return [{ id: e.id, title, location, date, startMin, endMin, allDay: false, eventType }]
    }
    // Longer than that (e.g. a rental Fri 3 PM → Sun 11 AM): one entry per day, at most 14 (audit: only Friday was blocked).
    const out: ScanItem[] = []
    for (let d = date; d <= toDate && out.length < 14; d = addDays(d, 1)) {
      const s0 = d === date ? startMin : 0, e0 = d === toDate ? toMin : 1440
      if (e0 > s0) out.push({ id: `${e.id}_${d.replace(/-/g, '')}`, title, location, date: d, startMin: s0, endMin: e0, allDay: false, eventType })
    }
    return out
  }
  // All-day (e.g. a day booked off): the whole day, one entry per day (end date is the day AFTER), at most 14.
  if (e.start?.date && e.end?.date) {
    const out: ScanItem[] = []
    const multi = addDays(e.start.date, 1) < e.end.date
    for (let d = e.start.date; d < e.end.date && out.length < 14; d = addDays(d, 1)) out.push({ id: multi ? `${e.id}_${d.replace(/-/g, '')}` : e.id, title, location, date: d, startMin: 0, endMin: 1440, allDay: true, eventType })
    return out
  }
  return []
}

async function readCalendar(cal: Source): Promise<{ items: GEvent[]; title: string }> {
  if (isEmulator()) {
    const d = addDays(todayInStudio(), 3)
    const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${d}T12:00:00Z`))
      .find(x => x.type === 'timeZoneName')!.value.replace('GMT-', '-0') + ':00'   // -04:00 in summer, -05:00 in winter
    // Tests stand in their own events: test_calendar/events (the app calendar) or test_calendar/<calendar ID>.
    const fake = (await db.doc(`test_calendar/${cal.name === 'App calendar' ? 'events' : cal.id.replace(/[^a-zA-Z0-9]/g, '_')}`).get()).data()
    if (fake) return { items: fake.items as GEvent[], title: String(fake.title ?? cal.name) }
    return { title: cal.name, items: cal.name === 'App calendar' ? [
      { id: 'demo1', summary: 'Jana - Cliff 1', start: { dateTime: `${d}T13:00:00${off}` }, end: { dateTime: `${d}T15:00:00${off}` } },
      { id: 'demo2', summary: 'Cleaners', location: '2375 Cliff Road', start: { dateTime: `${d}T07:00:00${off}` }, end: { dateTime: `${d}T09:00:00${off}` } },
    ] : [] }
  }
  const { token } = await calendarAccess()
  const items: GEvent[] = []
  let pageToken = ''
  do {
    const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: new Date(Date.now() - 30 * 3600000).toISOString(), timeMax: new Date(Date.now() + 120 * 86400000).toISOString(), ...(pageToken ? { pageToken } : {}) })
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } })
    // One calendar that can't be read is skipped by scanCalendar (and none of its events look deleted).
    if (!r.ok) throw new HttpsError('failed-precondition', `Google Calendar said ${r.status} for "${cal.name}". Is it shared with the app's account? (${(await r.text()).slice(0, 160)})`)
    const j = await r.json() as { items?: GEvent[]; nextPageToken?: string }
    items.push(...(j.items ?? [])); pageToken = j.nextPageToken ?? ''
  } while (pageToken && items.length < 1500)
  // Google's own name for the calendar, so the team can tell a wrong ID from an empty calendar.
  const meta = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}`, { headers: { Authorization: `Bearer ${token}` } })
  const title = meta.ok ? String(((await meta.json()) as { summary?: string }).summary ?? '') : ''
  return { items, title }
}

// An imported block nobody ever chose or confirmed (made by the automatic check). Pure, tested.
export const regradable = (was: Record<string, unknown> | undefined) =>
  !!was && was.action === 'block' && was.by === 'calendar check' && !was.checkedBy && !was.removed

// A house shoot the automatic check placed by itself (nobody checked it) whose words now say offsite. Pure, tested.
export const wrongPlace = (was: Record<string, unknown> | undefined, e: { title: string; location: string }) =>
  !!was && was.action === 'shoot' && was.by === 'calendar check' && !was.checkedBy && !was.removed
  && (was.house === 'cliff1' || was.house === 'cliff2') && saysOffsite(`${e.title} ${e.location}`) && !houseFromText(`${e.title} ${e.location}`)

// Read every calendar (never writes) and compare with what was imported before.
async function scanCalendar(cals: Source[]) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const people = (await filmingPeople({ includeDemo: true })).map(p => ({ email: p.email, name: p.name }))
  // What was imported before, with a snapshot of the event then (owner, Oct 19: the team keeps adding events straight
  // in Google Calendar while testing, so the import is re-run: new events, changed ones and deleted ones show up).
  const imports = new Map((await db.collection('calendar_imports').get()).docs.map(d => [d.id, d.data()]))
  const live: (ScanItem & { cal: Source })[] = []
  const seen = new Set<string>()
  const today = todayInStudio()
  const whyIgnored = (it: ScanItem) => { const n = namedPeopleInfo(`${it.title} ${it.location}`, people); return ignoreReason(it, n.people.length > 0 || n.ambiguous.length > 0) }
  const counts: { name: string; house: string; title: string; found: number; hidden: number; error?: string }[] = []
  // Calendars that could be read this time. One that can't be read (a wrong ID, unshared, retired) is skipped and reported,
  // and nothing of it looks deleted; the others are still followed (audit, Nov 7: one bad calendar stopped every check).
  const readOk = new Set<string>()
  for (const cal of cals) {
    let got: { items: GEvent[]; title: string }
    try { got = await readCalendar(cal) } catch (e) {
      counts.push({ name: cal.name, house: cal.house, title: '', found: 0, hidden: 0, error: String((e as Error).message).slice(0, 240) })
      continue
    }
    readOk.add(cal.id)
    const { items, title } = got
    const row = { name: cal.name, house: cal.house, title, found: 0, hidden: 0 }
    counts.push(row)
    for (const e of items) {
      if (e.status === 'cancelled' || /^[sbt][0-9a-f]+$/.test(e.id)) continue   // the app's own events
      for (const it of eventDays(e)) {
        if (seen.has(it.id)) continue   // same event in two calendars: once
        seen.add(it.id)
        // Read from 30 hours back so today's finished events aren't mistaken for deleted ones; older days are left alone.
        if (it.date < today) continue
        live.push({ ...it, cal }); row.found++
        if (whyIgnored(it)) row.hidden++
      }
    }
  }
  // Same time, and (when we know them) the same title and place, compared as saved (titles cut at 200, places at 300:
  // otherwise a long title looked "changed" every 15 minutes).
  const same = (a: Record<string, any>, b: Record<string, any>) => a.date === b.date && a.startMin === b.startMin
    && (a.endMin === b.endMin || (a.endMin <= a.startMin && b.endMin === a.startMin + s.slotMinutes))
    && (!b.title || String(a.title ?? '').slice(0, 200) === b.title) && (!b.location || String(a.location ?? '').slice(0, 300) === b.location)
  const guessFor = (it: ScanItem, cal: Source) => {
    const g1 = guessFor0(it, cal)
    // Blocked time is always at a house: an offsite "party"/"event" is not a block (owner, Nov 8: different places never overlap).
    const g0 = g1.action === 'block' && g1.house !== 'cliff1' && g1.house !== 'cliff2' ? { ...g1, action: 'skip' } : g1
    const known = !!placeFromText(`${it.title} ${it.location}`) || cal.house !== 'any'
    const soft = g0.action === 'block' && looksLikeHeadsUp(`${it.title} ${it.location}`)
    // Owner, Nov 4: a group booking came in by itself as one person. Only a plain one-person, one-slot shoot (or a clear block)
    // is brought in automatically; longer shoots or several names wait for a person on the import screen.
    const simpleShoot = g0.action !== 'shoot' || ((g0.emails?.length ?? 0) <= 1 && it.endMin - it.startMin <= s.slotMinutes)
    // Both houses named ("Cleaners - Cliff 1 & 2"): never placed at one by itself; a person picks (or adds one per house).
    const both = namesBothHouses(`${it.title} ${it.location}`)
    return { ...g0, ...(both ? { houseUnsure: true, bothHouses: true } : {}), type: blockTypeOf(`${it.title} ${it.location}`), soft, sure: !both && !soft && simpleShoot && isClearEvent(it, g0, known) }
  }
  const guessFor0 = (it: ScanItem, cal: Source) => {
    const g = guessImport(it, people, s.slots)
    // Mixed calendar: someone's name → their shoot; a house but nobody named (e.g. "Stromedy - Cliff 2") → blocked time.
    // The address/name in the event wins (owner, Oct 30: the calendars aren't tidy); else the calendar's usual house.
    // "Offsite" in the words also wins over the calendar's usual house (owner, Nov 5).
    const said = placeFromText(`${it.title} ${it.location}`)
    if (cal.house === 'any' || said) return (it.allDay && g.action === 'shoot') || (g.action === 'skip' && g.house !== 'offsite') ? { ...g, action: 'block' } : g
    // A calendar that's for one house and the event doesn't say otherwise: at that house; nobody named → blocked time to check.
    const { houseUnsure, ...known } = g   // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...known, house: cal.house, start: s.slots.find(x => x >= it.startMin) ?? s.slots[0], action: g.action === 'skip' || it.allDay ? 'block' : g.action }
  }
  const events: Record<string, unknown>[] = []
  const unkeep: string[] = []
  for (const it of live) {
    const { cal, ...base } = it
    const tag = { calendar: cal.name, feedId: cal.id }
    const was = imports.get(it.id)
    if (was?.kept) unkeep.push(it.id)   // "Keep it in the app" was chosen, and it's back in Google: forget that choice
    const why = whyIgnored(base)
    // Never imported; or "Redo this import" (the team wants to choose again: never placed by itself); or deleted in Google
    // and put back there (audit: an Undo in Google never came back).
    const fresh = !was || was.redo === true || (was.removed === true && was.action !== 'skip')
    // Time off and birthdays: not shoots or blocks. Listed as 'ignored' (hidden on the screen unless asked for).
    if (fresh && why) { events.push({ ...base, ...tag, kind: 'ignored', why, guess: { ...guessFor(base, cal), action: 'skip' } }); continue }
    if (fresh) { events.push({ ...base, ...tag, kind: 'new', ...(was?.redo ? { redo: true } : {}), guess: guessFor(base, cal) }); continue }
    // Owner, Nov 5 (Ariel's shoots missing): on Nov 2 the automatic check brought "<Name> - Stromedy Talent Filming" in as
    // BLOCKED TIME because creators on Props only couldn't be matched yet. A block the check made by itself (no person ever
    // chose or confirmed it) whose title now names someone is brought in again as that person's shoot (the block goes).
    if (regradable(was) && !why) {
      const g = guessFor(base, cal)
      if (g.action === 'shoot' && (g.emails?.length || g.email)) { events.push({ ...base, ...tag, kind: 'new', regrade: true, guess: g }); continue }
    }
    // Audit, Nov 5 (live: three "Justin" shoots were guessed while two creators are called Justin): a shoot the check placed by
    // itself, nobody checked, whose name now fits more than one person goes back to the team to say who (it keeps holding the time).
    if (was.action === 'shoot' && was.by === 'calendar check' && !was.checkedBy && !was.removed && !why) {
      const g = guessFor(base, cal)
      if (g.ambiguous?.length) { events.push({ ...base, ...tag, kind: 'new', recheck: true, guess: g }); continue }
    }
    // Owner, Nov 5: "Val / Sam / Preslea - Offsite Filming" (in the Cliff 1 calendar) was put AT Cliff 1 by the automatic
    // check before "offsite" was read. A shoot the check placed at a house by itself (nobody checked it yet) whose words
    // say offsite (and name no house) moves to offsite at its real hours.
    if (wrongPlace(was, base) && !why) {
      const g = guessFor(base, cal)
      events.push({ ...base, ...tag, kind: 'changed', rehouse: true, was: { date: was.date, startMin: was.startMin, endMin: was.endMin, title: was.title },
        guess: { ...g, action: 'shoot', house: 'offsite', start: base.startMin, email: was.email || g.email,
          emails: Array.isArray(was.emails) && was.emails.length ? was.emails : was.email ? [was.email] : g.emails } })
      continue
    }
    // Already imported: only show it again if it was changed in Google Calendar since (skipped ones stay skipped).
    if (was.action === 'skip' || (was.date && same(base, was))) continue
    const g = guessFor(base, cal)
    // Who it's for: what was decided before, unless nobody checked it and the names in the event changed (audit: "Bryan
    // filming" renamed "Eddy filming" stayed Bryan's).
    const before: string[] = Array.isArray(was.emails) && was.emails.length ? was.emails : was.email ? [was.email] : []
    const differs = g.emails.length > 0 && !g.ambiguous && g.emails.join() !== before.join()
    const renamed = !was.checkedBy && differs
    const emails = renamed || !before.length ? g.emails : before
    // A person checked who it's for, and Google now names someone else: followed as before, but held back from "Confirm all"
    // so someone looks (audit, Nov 7: a checked "Bryan filming" renamed "Eddy filming" quietly stayed Bryan's).
    const nameOf = (m: string) => people.find(p => p.email === m)?.name.split(' ')[0] ?? m.split('@')[0]
    const peopleChanged = was.action === 'shoot' && was.checkedBy && differs
      ? `Google now says ${g.emails.map(nameOf).join(' + ')}, the app has ${before.map(nameOf).join(' + ') || 'nobody'}. Tap Fix if it's for someone else.` : ''
    // The house the event's words name now vs. what they named before: only a change in the words moves it (a person's earlier
    // Fix of the house isn't undone by a time change). Audit, Nov 7: "Kyle - Cliff 1" edited to "Kyle - Cliff 2" stayed at Cliff 1.
    const saidNow = placeFromText(`${base.title} ${base.location}`), saidBefore = placeFromText(`${was.title ?? ''} ${was.location ?? ''}`)
    const house = saidNow && saidNow !== saidBefore && (was.action === 'shoot' || saidNow !== 'offsite') ? saidNow : was.house || g.house
    events.push({ ...base, ...tag, kind: 'changed', was: { date: was.date, startMin: was.startMin, endMin: was.endMin, title: was.title }, ...(peopleChanged ? { peopleChanged } : {}),
      guess: { ...g, houseUnsure: undefined, ambiguous: undefined, action: was.action, email: emails[0] ?? '', emails, house, type: was.type, soft: was.soft === true } })
  }
  // Deleted (or moved out of view) in Google Calendar: still on the app's schedule. Only for calendars still read
  // (imports from before Oct 30 came from the app calendar); a calendar taken off the list never removes anything.
  // Never something already over (audit: today's finished shoots were being cancelled after they ended).
  const nowMin = (n => Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16)))(torontoStamp(new Date().toISOString()))
  const read = readOk, appCal = s.googleCalendarId
  for (const [id, was] of imports) {
    // kept: a person chose "Keep it in the app" (audit, Nov 7: the next check took it off anyway).
    if (seen.has(id) || was.action === 'skip' || was.removed || was.kept || was.redo || !was.date || was.date < today) continue
    if (was.date === today && Number(was.endMin) <= nowMin) continue
    if (!read.has(String(was.feedId ?? appCal))) continue
    events.push({ id, title: was.title ?? '(no title)', location: was.location ?? '', date: was.date, startMin: was.startMin, endMin: was.endMin, kind: 'removed',
      calendar: cals.find(c => c.id === String(was.feedId ?? appCal))?.name ?? '', allDay: !!was.allDay,
      guess: { action: 'remove', email: was.email ?? '', house: was.house ?? 'cliff1', start: was.startMin }, wasAction: was.action })
  }
  return { events, people: people.sort((a, b) => a.name.localeCompare(b.name)), imports, counts, unkeep }
}

async function removeImportedBlock(date: string, blockId: string) {
  const ref = db.doc(`schedule_days/${date}`)
  await db.runTransaction(async tx => {
    const day = (await tx.get(ref)).data() as ScheduleDay | undefined
    if (day?.blocks?.some(b => b.id === blockId)) tx.update(ref, { blocks: day.blocks.filter(b => b.id !== blockId), clashes: (day.clashes ?? []).filter(c => c.blockId !== blockId) })
  })
}

// Import the reviewed events. Each one is a shoot (for a person, at a house slot or offsite hours)
// or blocked time; skipped ones are just remembered so they don't show up again.
export const applyCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const list = Array.isArray(req.data?.items) ? req.data.items.slice(0, 500) : []
  // A person chose on the import screen = checked: anything waiting in the Calendar tab for these events is done.
  const results = await withCalendarLock(caller.email, async () => {
    const out = await applyImports(list, caller.email, { toCheck: true })
    for (const r of out) if (r.ok) await settleQueue(r.id, caller.email, 'confirmed', r.saved).catch(e => logger.warn('settle', String(e)))
    return out
  })
  return { results: results.map(({ saved, ...r }) => r) }   // eslint-disable-line @typescript-eslint/no-unused-vars
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// opts.toCheck (the automatic check): everything it puts on the schedule is marked "to check" and waits in the equipment
// team's Calendar tab; creators aren't told until it's confirmed there (owner, Nov 4).
async function applyImports(list: any[], by: string, opts: { toCheck?: boolean } = {}) {
  const caller = { email: by }
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const check = opts.toCheck ? { toCheck: true } : {}
  const results: { id: string; ok: boolean; message?: string; saved?: Record<string, unknown> }[] = []
  for (const it of list) {
    const id = String(it?.id ?? '').slice(0, 200)
    if (!id) continue
    let clash: string[] = []
    try {
      const was = (await db.doc(`calendar_imports/${id}`).get()).data()
      // Several creators in one booking (owner, Nov 4) → one shoot each, back to back, in the order picked.
      const who: string[] = [...new Set((Array.isArray(it.emails) && it.emails.length ? it.emails : [it.email])
        .map((e: unknown) => String(e ?? '').toLowerCase()).filter(Boolean))].slice(0, 4) as string[]
      const multi = who.length > 1
      const oldShootIds: string[] = Array.isArray(was?.shootIds) && was.shootIds.length ? was.shootIds.map(String) : was?.shootId ? [String(was.shootId)] : []
      const group = multi || oldShootIds.length > 1
      // A group booking changed (a time nudged, a name added, a Fix): each person keeps THEIR shoot (audit, Nov 7: every turn
      // was cancelled and made again, which cancelled everyone's props). Old turns are matched to people by email.
      const oldShoots = new Map<string, Record<string, any>>()   // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const sid of oldShootIds) { const d = (await db.doc(`shoots/${sid}`).get()).data(); if (d) oldShoots.set(sid, d) }
      const keepFor = new Map<string, string>()   // person -> their old shoot id
      if (it.action === 'shoot') {
        if (group) { for (const [sid, d] of oldShoots) { const m = String(d.creatorEmail ?? ''); if (who.includes(m) && !keepFor.has(m)) keepFor.set(m, sid) } }
        else if (oldShootIds.length === 1 && who.length) keepFor.set(who[0], oldShootIds[0])
      }
      const kept = new Set(keepFor.values())
      // Take the app's earlier copy off the schedule when the event became something else or was deleted (in a group, only the
      // people no longer in it lose theirs).
      const dropOld = async () => {
        for (const sid of oldShootIds) if (!kept.has(sid)) await removeImportedShoot(sid, caller.email, !!opts.toCheck)
        if (was?.blockId && was.date) await removeImportedBlock(was.date, was.blockId)
      }
      const startMin = Number(it.start) || 0
      const snapshot = { title: String(it.title ?? '').slice(0, 200), location: String(it.location ?? '').slice(0, 300), date: String(it.date), startMin,
        endMin: Number(it.end) >= startMin ? Number(it.end) : startMin + s.slotMinutes,
        feedId: String(it.feedId || s.googleCalendarId).slice(0, 200), allDay: it.allDay === true }
      if (it.action === 'remove' || it.action === 'keep') {
        if (it.action === 'remove') await dropOld()
        // "Keep it in the app" is remembered (kept): the next 15-minute check must not take it off anyway (audit, Nov 7).
        await db.doc(`calendar_imports/${id}`).set({ ...(was ?? {}), removed: it.action === 'remove', kept: it.action === 'keep', at: new Date().toISOString(), by: caller.email })
        results.push({ id, ok: true, saved: { action: it.action, shootIds: oldShootIds, blockId: was?.blockId ?? '', house: was?.house ?? '', emails: was?.emails ?? (was?.email ? [was.email] : []) } }); continue
      }
      // A shoot moving to another DAY while it has props or gear for its old day: not moved by the app (audit, Nov 7: the props
      // stayed on the old day and were packed for the wrong date). A person sorts the props out first.
      if (it.action === 'shoot') {
        for (const [m, sid] of keepFor) {
          const d = oldShoots.get(sid)
          if (!d || d.status !== 'booked' || d.date === String(it.date)) continue
          const l = await openLinks(sid)
          if (l.props.length || l.gear.length || l.sharedGear.length) {
            throw new Error(`${String(d.creatorName || m.split('@')[0])}'s shoot has props or gear booked for ${String(d.date)}, so the app didn't move it. Ask the props team to cancel or move them, then tap Fix.`)
          }
        }
      }
      await dropOld()
      let saved: Record<string, unknown> = {}
      if (it.action === 'shoot') {
        if (!who.length) throw new Error('Pick who this shoot is for.')
        const users: { email: string; name: string }[] = []
        for (const e of who) {
          const u = (await db.doc(`users/${e}`).get()).data()
          if (!u?.active && e !== OWNER_EMAIL) throw new Error(`${e} has no active account.`)
          users.push({ email: e, name: String(u?.name || (e === OWNER_EMAIL ? 'Alex' : e)) })
        }
        // Never guessed onto a house (audit, Nov 8: an unknown place fell back to Cliff 1 and could clash with a shoot there).
        if (!['cliff1', 'cliff2', 'offsite'].includes(it.house)) throw new Error('Pick where this shoot is: Cliff 1, Cliff 2 or offsite.')
        const place = it.house as Place
        // The real hours from the calendar (owner, Oct 19: never moved to the grid, never changed in Google).
        const start = Number(it.start), end = Number(it.end) > start ? Number(it.end) : start + s.slotMinutes
        const parts = place === 'offsite' ? splitHours(start, end, users.length) : splitOnGrid(start, end, users.length, s.slots, s.slotMinutes)
        // A shoot the creator cancelled (or that gave way to a priority booking) stays cancelled when the event changes in
        // Google (audit: a change there brought it back as booked). In a group, only that person's turn stays cancelled.
        const staysCancelled = (sid: string | undefined) => {
          const d = sid ? oldShoots.get(sid) : undefined
          return !!d && d.status === 'cancelled' && !(d.history ?? []).some((h: { note?: string }) => h.note === 'removed from Google Calendar')
        }
        if (!multi && staysCancelled(keepFor.get(users[0].email))) {
          const sid = keepFor.get(users[0].email)!
          await db.doc(`calendar_imports/${id}`).set({ ...(was ?? {}), ...snapshot, kept: false, at: new Date().toISOString(), by: caller.email })
          results.push({ id, ok: true, message: 'Stays cancelled: it was cancelled in the app', saved: { action: 'cancelled', shootId: sid, shootIds: [sid], house: place, emails: who } }); continue
        }
        const ids: string[] = []
        // If one turn of a group can't be placed, the turns already made come off again (audit: half-made groups were left
        // behind and made again every 15 minutes).
        const undo = async () => { for (const sid of ids) if (!oldShootIds.includes(sid)) await removeImportedShoot(sid, caller.email).catch(() => 0) }
        try {
        for (let i = 0; i < users.length; i++) {
          const part = parts[i] ?? parts[parts.length - 1]
          const existing = keepFor.get(users[i].email)
          if (multi && staysCancelled(existing)) { ids.push(existing!); continue }
          const r = await importShootAsTeam({ place, date: String(it.date), start: part.start, end: part.end, where: place === 'offsite' ? String(it.where || it.title || 'Offsite').slice(0, 200) : '' },
            users[i], caller.email, { calendarEventId: id, importedFrom: 'google-calendar', calendarFeed: snapshot.feedId, ...check, ...(multi ? { sharedBooking: { with: users.filter((_, j) => j !== i).map(u => u.name), turn: i + 1, of: users.length } } : existing ? { sharedBooking: FieldValue.delete() } : {}) },
            existing)
          ids.push(r.id)
          clash.push(...r.clashWith.filter(n => !users.some(u => u.name === n)))
        }
        } catch (e) { await undo(); throw e }
        clash = [...new Set(clash)]
        if (clash.length && clash.some(n => !((was?.clashWith ?? []) as string[]).includes(n))) {
          await sendPush({ to: ['gear-team', OWNER_EMAIL], title: 'Calendar clash', url: '/approvals',
            body: `"${String(it.title ?? '').slice(0, 80)}" (${s.houses[place === 'offsite' ? 'cliff1' : place].name}, ${it.date}) overlaps ${clash.join(', ')}. Open Requests to give the slot to ${users.map(u => u.name).join(' + ')} or sort it out.` }).catch(() => 0)
        }
        saved = { shootId: ids[0], shootIds: ids, email: users[0].email, emails: users.map(u => u.email), house: place, clashWith: clash }
      } else if (it.action === 'block') {
        // Blocked time only exists at a house. Owner, Nov 8: different places never overlap, so an offsite or unknown-place event
        // must never block (or "clash" with) Cliff 1 by falling back to it.
        if (it.house !== 'cliff1' && it.house !== 'cliff2') throw new Error(it.house === 'offsite' ? 'An offsite event can\'t block a house. Skip it, or make it a shoot.' : 'Pick which house this blocks.')
        const house = it.house as House
        const type = (Object.keys(BLOCK_TYPES).includes(it.type) ? it.type : 'other') as BlockType
        const start = Math.max(0, Number(it.start) || 0), end = Math.max(start + 1, Number(it.end) || 0)
        const ref = db.doc(`schedule_days/${it.date}`)
        const blockId = `g${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`
        const note = String(it.title ?? '').slice(0, 200)
        const soft = it.soft === true   // heads-up only (owner, Nov 4): shows on the calendar, never blocks or clashes
        // Owner (Oct 30): an old-calendar block landing on a shoot already booked in the app = a CLASH. The shoot stays,
        // gets a red "Clash" tag, and the schedule team + the owner are told to sort it out with the creator.
        const hit: { name: string; email?: string }[] = []
        await db.runTransaction(async tx => {
          const day = ((await tx.get(ref)).data() ?? {}) as ScheduleDay
          const under = soft ? [] : Object.entries(day[house] ?? {}).filter(([k, e]) => e.shootId && !e.hold && Number(k) < end && start < Number(k) + s.slotMinutes)
          hit.splice(0, hit.length, ...under.map(([, e]) => ({ name: e.name, email: e.email })))
          const clashes = [...(day.clashes ?? []).filter(c => c.blockId !== blockId),
            ...under.map(([k, e]) => ({ house, slot: k, shootId: e.shootId, name: note || BLOCK_TYPES[type], email: e.email ?? '', start, end, blockId }))]
          tx.set(ref, { date: it.date, clashes, blocks: [...(day.blocks ?? []).filter(b => b.id !== blockId), { id: blockId, house, start, end, type, note, by: caller.email, imported: true, calendarFeed: snapshot.feedId, ...(soft ? { soft: true } : {}), ...check }] }, { merge: true })
        })
        if (hit.length) {
          clash = hit.map(h => h.name)
          const known = (was?.clashWith ?? []) as string[]
          if (clash.some(n => !known.includes(n))) {
            await sendPush({ to: ['gear-team', OWNER_EMAIL], title: 'Calendar clash', url: '/schedule',
              body: `"${note || BLOCK_TYPES[type]}" (${s.houses[house].name}, ${it.date}) is on top of ${clash.join(', ')}'s shoot. Sort it out with them.` }).catch(() => 0)
          }
        }
        saved = { blockId, house, type, soft, clashWith: clash }
      }
      // Remember the event as it is now, so the next import can tell if it changed in Google Calendar.
      // (Who checked it before is kept: the automatic check never re-reads a checked one as something else.)
      await db.doc(`calendar_imports/${id}`).set({ action: it.action === 'shoot' || it.action === 'block' ? it.action : 'skip', ...snapshot, ...saved, at: new Date().toISOString(), by: caller.email,
        ...(was?.checkedBy ? { checkedBy: was.checkedBy, checkedAt: was.checkedAt ?? '' } : {}) })
      results.push({ id, ok: true, saved: { action: it.action, ...saved }, ...(clash.length ? { message: `Imported · CLASH with ${clash.join(', ')}` } : {}) })
    } catch (e) { results.push({ id, ok: false, message: (e as Error).message }) }
  }
  return results
}

// Every 15 minutes (owner, Oct 19; Cloud Scheduler): read every calendar (never writes to Google).
// Owner, Nov 4: EVERY import waits in the equipment team's Calendar tab (Requests), like booking requests:
// - events the app can read (a shoot for someone it recognises, or a block / heads-up) go on the schedule straight away,
//   so nobody books over them, marked "to check"; creators are only told once the team confirms them;
// - events changed or deleted in Google are followed the same way (to check);
// - events it can't read (nobody named, no house) wait there unplaced for the team to say what they are.
// Never by itself when the house is only a guess (a mixed calendar that doesn't say where) or a name fits two people.
const placeable = (g: { action?: string; house?: string; email?: string; emails?: string[]; houseUnsure?: boolean; ambiguous?: string[] }) =>
  !g.houseUnsure && !g.ambiguous?.length && ((g.action === 'block' && (g.house === 'cliff1' || g.house === 'cliff2')) || (g.action === 'shoot' && !!(g.emails?.length || g.email)))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asItem = (e: any, g: any = e.guess) => e.kind === 'removed'
  ? { id: e.id, action: 'remove', date: e.date }
  : { id: e.id, action: g.action, email: g.email ?? g.emails?.[0] ?? '', emails: g.emails ?? (g.email ? [g.email] : []), house: g.house, type: g.type, soft: g.soft === true,
      date: e.date, start: e.startMin, end: e.endMin, title: e.title, location: e.location, where: e.location || e.title, feedId: e.feedId, allDay: e.allDay }

// One calendar check or import at a time (audit, Nov 7: two at once imported the same event twice, leaving a stray copy).
// A lease, not a flag, so a crashed run frees it after 6 minutes by itself.
const LOCK_MINUTES = 6
export async function withCalendarLock<T>(by: string, fn: () => Promise<T>): Promise<T> {
  const ref = db.doc('app_settings/calendarLock')
  const token = randomBytes(8).toString('hex')
  await db.runTransaction(async tx => {
    const l = (await tx.get(ref)).data()
    if (l?.until && String(l.until) > new Date().toISOString()) throw new HttpsError('failed-precondition', 'The calendar is being checked right now. Try again in a minute.', { problem: 'calendar-busy' })
    tx.set(ref, { token, by, until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() })
  })
  try { return await fn() } finally {
    await db.runTransaction(async tx => { if ((await tx.get(ref)).data()?.token === token) tx.delete(ref) }).catch(() => 0)
  }
}

// Owner, Nov 8: confirmed events from the OLD calendars get their own copy in the app calendar. New confirmations copy by
// themselves (the triggers); this catches up the ones confirmed before, a few at a time on each 15-minute check.
const COPY_PER_RUN = 40
export async function copyConfirmedImports(): Promise<number> {
  const cal = await calendarId()
  if (!cal) return 0
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const today = todayInStudio()
  let n = 0
  const shoots = await db.collection('shoots').where('date', '>=', today).get()
  for (const d of shoots.docs) {
    if (n >= COPY_PER_RUN) break
    const sh = d.data()
    if (sh.status !== 'booked' || !(sh.importedFrom || sh.calendarEventId)) continue
    if (!(await copyable(sh, 'shoot', cal))) continue
    const id = shootEventId(d.id)
    if ((await sentDoc(id).get()).exists || (await outbox(id).get()).exists || (await db.doc(`calendar_removed/${id}`).get()).exists) continue
    await sendNow(id, { kind: 'shoot', shootId: d.id }, shootLabel(sh, s), 'calendar check'); n++
  }
  const days = await db.collection('schedule_days').where(FieldPath.documentId(), '>=', today).get()
  for (const d of days.docs) {
    for (const b of ((d.data() as ScheduleDay).blocks ?? []) as (Block & Record<string, unknown>)[]) {
      if (n >= COPY_PER_RUN) break
      if (!b.imported || !(await copyable(b, 'block', cal))) continue
      const id = blockEventId(d.id, b.id)
      if ((await sentDoc(id).get()).exists || (await outbox(id).get()).exists || (await db.doc(`calendar_removed/${id}`).get()).exists) continue
      await sendNow(id, { kind: 'block', date: d.id, blockId: b.id }, `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house]?.name ?? ''} · ${d.id}`, 'calendar check'); n++
    }
  }
  return n
}

export async function runCalendarCheck() {
  const cals = await sources()
  if (!cals.length) return null
  return withCalendarLock('calendar check', () => runCalendarCheckLocked(cals))
}
async function runCalendarCheckLocked(cals: Source[]) {
  const status = db.doc('app_settings/calendarCheck')
  try {
    const { events, people, unkeep, counts } = await scanCalendar(cals) as { events: any[]; people: { email: string; name: string }[]; unkeep: string[]; counts: { name: string; error?: string }[] }   // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const id of unkeep) await db.doc(`calendar_imports/${id}`).update({ kept: FieldValue.delete() }).catch(() => 0)
    const auto = events.filter(e => e.kind === 'changed' || e.kind === 'removed' || (e.kind === 'new' && !e.redo && !e.recheck && placeable(e.guess)))
    const unclear = events.filter(e => e.kind === 'new' && (e.redo || e.recheck || !placeable(e.guess)))
    const results = auto.length ? await applyImports(auto.map(e => asItem(e)), 'calendar check', { toCheck: true }) : []
    // The queue (calendar_queue/{eventId}): one card per event, until the team confirms, fixes or skips it.
    const waiting = new Map((await db.collection('calendar_queue').where('status', '==', 'waiting').get()).docs.map(d => [d.id, d.data()]))
    const at = new Date().toISOString()
    const fresh: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const put = async (e: any, extra: Record<string, unknown>) => {
      const prev = waiting.get(e.id)
      if (!prev) fresh.push(e.id)
      // (JSON round trip: Firestore refuses undefined values, e.g. a changed event's old type.)
      await db.doc(`calendar_queue/${e.id}`).set(JSON.parse(JSON.stringify({
        title: e.title ?? '', location: e.location ?? '', date: e.date, startMin: e.startMin ?? 0, endMin: e.endMin ?? 0, allDay: !!e.allDay,
        calendar: e.calendar ?? '', feedId: e.feedId ?? '', kind: prev?.kind === 'new' && e.kind !== 'removed' ? 'new' : e.kind, guess: e.guess ?? {}, ...(e.was ? { was: e.was } : {}),
        ...(e.wasAction ? { wasAction: e.wasAction } : {}), status: 'waiting', at: prev?.at ?? at, updatedAt: at, ...extra,
      })))
    }
    for (let i = 0; i < auto.length; i++) {
      const r = results[i]
      await put(auto[i], { placed: !!r?.ok, result: r?.saved ?? {}, message: r?.message ?? (r?.ok ? '' : 'Could not place it'), ...(r?.ok ? (auto[i].peopleChanged ? { problem: auto[i].peopleChanged } : {}) : { problem: r?.message ?? '' }) })
    }
    // Why the app didn't place it, in words for the team.
    const whyNot = (g: { ambiguous?: string[]; houseUnsure?: boolean; bothHouses?: boolean; action?: string }, redo?: boolean) => redo ? 'You asked to redo this one. Choose what it is.'
      : g.bothHouses ? 'It names both houses. Tap Fix and choose one; for the other house, add blocked time on the schedule.'
      : g.ambiguous?.length ? `"${g.ambiguous[0][0].toUpperCase()}${g.ambiguous[0].slice(1)}" could be more than one person. Tap Fix and pick who.`
      : g.houseUnsure && g.action !== 'skip' ? 'The event doesn\'t say which house (or offsite). Tap Fix and choose.' : ''
    for (const e of unclear) await put(e, { placed: false, result: {}, message: whyNot(e.guess ?? {}, e.redo) })
    // Placed cards for days already over settle by themselves, without telling anyone (audit: they piled up, and confirming
    // one later told the creator "You have a new shoot" for a day that had passed).
    const today = todayInStudio()
    for (const [id, q] of waiting) if (q.placed && String(q.date) < today) await settleQueue(id, 'calendar check', 'confirmed', undefined, 'past').catch(e => logger.warn('settle past', String(e)))
    // Unplaced cards whose event is gone from Google (or was handled on the import screen) leave the queue.
    const stillNew = new Set(unclear.map(e => e.id))
    for (const [id, q] of waiting) if (!q.placed && !stillNew.has(id) && !auto.some(e => e.id === id)) await db.doc(`calendar_queue/${id}`).delete()
    if (fresh.length) await sendPush({ to: ['gear-team'], title: 'Google Calendar: to check', url: '/approvals?tab=calendar', tag: 'calendar-queue',
      body: `${fresh.length} event${fresh.length === 1 ? '' : 's'} from Google Calendar to check. Open Requests → Calendar.` }).catch(() => 0)
    const out = { at, newEvents: unclear.length, waiting: waiting.size + fresh.length,
      broughtIn: auto.filter((e, i) => e.kind === 'new' && results[i]?.ok).length,
      changed: auto.filter(e => e.kind === 'changed').length, removed: auto.filter(e => e.kind === 'removed').length,
      failed: results.filter(r => !r.ok).map(r => `${r.id}: ${r.message ?? ''}`).slice(0, 10),
      error: counts.filter(c => c.error).map(c => `Couldn't read "${c.name}": ${c.error}`).join(' · ').slice(0, 300), people }
    const copied = await copyConfirmedImports().catch(e => { logger.warn('copy imports', String(e)); return 0 })
    await status.set({ ...out, copied })
    return { ...out, copied }
  } catch (e) {
    await status.set({ at: new Date().toISOString(), error: String((e as Error).message).slice(0, 300) }, { merge: true })
    throw e
  }
}

// Finish a card in the Calendar tab: the shoots and block it made stop being "to check", and the creators are told
// (pushMessages: 'import-confirmed'). Also used when a person imports on the import screen.
async function settleQueue(id: string, by: string, status: 'confirmed' | 'skipped', saved?: Record<string, unknown>, note?: 'past') {
  const qref = db.doc(`calendar_queue/${id}`)
  const q = (await qref.get()).data()
  const imp = (await db.doc(`calendar_imports/${id}`).get()).data()
  // A person looked at it: the automatic check never re-reads it as something else (see regradable).
  if (imp && !note) await db.doc(`calendar_imports/${id}`).set({ checkedBy: by, checkedAt: new Date().toISOString() }, { merge: true })
  const list = (x: unknown) => Array.isArray(x) ? x.map(String) : []
  const ids = new Set([...list(saved?.shootIds), ...list(imp?.shootIds), ...(imp?.shootId ? [String(imp.shootId)] : []), ...list(q?.result?.shootIds)])
  const at = new Date().toISOString()
  const kind = note ?? String(q?.kind ?? 'new')
  for (const sid of ids) {
    const ref = db.doc(`shoots/${sid}`)
    let gone = false
    await db.runTransaction(async tx => {
      const sh = (await tx.get(ref)).data()
      gone = false
      if (!sh?.toCheck) return
      gone = sh.status === 'cancelled'
      tx.update(ref, { toCheck: FieldValue.delete(), told: true, updatedAt: at, history: FieldValue.arrayUnion({ at, by, action: 'import-confirmed', note: kind }) })
    })
    // Taken off by the automatic check and now confirmed by a person: its props and gear are let go only now (audit, Nov 7:
    // they were cancelled before anyone looked, and stayed cancelled when the event came back in Google).
    if (gone) await releaseCancelledImport(sid)
  }
  const date = String(imp?.date ?? q?.date ?? ''), blockId = String(saved?.blockId ?? imp?.blockId ?? q?.result?.blockId ?? '')
  if (date && blockId) {
    const ref = db.doc(`schedule_days/${date}`)
    await db.runTransaction(async tx => {
      const day = (await tx.get(ref)).data() as ScheduleDay | undefined
      if (day?.blocks?.some(b => b.id === blockId && (b as { toCheck?: boolean }).toCheck))
        tx.update(ref, { blocks: day.blocks.map(b => b.id === blockId ? (({ toCheck, ...rest }) => rest)(b as Block & { toCheck?: boolean }) : b) })   // eslint-disable-line @typescript-eslint/no-unused-vars
    })
  }
  if (q) await qref.update({ status, doneBy: by, doneAt: at })
}

// The equipment team's answer to one card: confirm (looks right), fix (what it really is), or skip (not for the app).
export const reviewCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const id = String(req.data?.id ?? '').slice(0, 200)
  const action = String(req.data?.action ?? '')
  // "Confirm all" (owner, Nov 5: let Maanik confirm them all at once if he wants): every card on his screen the app placed
  // without a problem or a clash. Clashes and ones the app couldn't read stay for him to look at.
  if (action === 'confirmAll') {
    const ids = (Array.isArray(req.data?.ids) ? req.data.ids : []).map((x: unknown) => String(x ?? '').slice(0, 200)).filter(Boolean).slice(0, 300) as string[]
    let confirmed = 0, left = 0
    for (const qid of [...new Set(ids)]) {
      const c = (await db.doc(`calendar_queue/${qid}`).get()).data()
      if (!c || c.status !== 'waiting') continue
      if (!queueReady(c)) { left++; continue }
      try { await settleQueue(qid, caller.email, 'confirmed'); confirmed++ } catch (e) { left++; logger.warn('confirm all', qid, String(e)) }
    }
    return { ok: true, confirmed, left }
  }
  const q = id ? (await db.doc(`calendar_queue/${id}`).get()).data() : undefined
  if (!q || q.status !== 'waiting') throw new HttpsError('failed-precondition', 'Someone already handled this one.')
  if (action === 'confirm') {
    if (!q.placed) throw new HttpsError('failed-precondition', 'The app could not tell what this is. Tap Fix and choose.')
    await settleQueue(id, caller.email, 'confirmed')
    return { ok: true }
  }
  const base = { id, title: q.title, location: q.location, date: q.date, start: q.startMin, end: q.endMin, where: q.location || q.title, feedId: q.feedId, allDay: q.allDay }
  if (action === 'skip') {
    if (q.kind === 'removed') throw new HttpsError('failed-precondition', 'It was deleted in Google Calendar. Confirm, or add it back in Google Calendar.')
    // Skipping a change would cancel a booking that is already on the schedule (audit, Nov 7). Looks right or Fix instead.
    if (q.kind === 'changed') throw new HttpsError('failed-precondition', 'This one is already on the schedule. Tap Looks right, or Fix to change it.')
    const [r] = await withCalendarLock(caller.email, () => applyImports([{ ...base, action: 'skip' }], caller.email, { toCheck: true }))
    if (!r?.ok) throw new HttpsError('failed-precondition', r?.message ?? 'Could not skip it.')
    await settleQueue(id, caller.email, 'skipped')
    return { ok: true }
  }
  if (action === 'fix') {
    const f = req.data?.fix ?? {}
    if (!['shoot', 'block'].includes(f.action)) throw new HttpsError('invalid-argument', 'Choose a shoot, blocked time or a heads-up.')
    const emails = (Array.isArray(f.emails) ? f.emails : []).map((e: unknown) => String(e).toLowerCase()).slice(0, 4)
    const [r] = await withCalendarLock(caller.email, () => applyImports([{ ...base, action: f.action, emails, email: emails[0] ?? '', house: f.house, type: f.type, soft: f.soft === true }], caller.email, { toCheck: true }))
    if (!r?.ok) throw new HttpsError('failed-precondition', r?.message ?? 'Could not import it.')
    await settleQueue(id, caller.email, 'confirmed', r.saved)
    return { ok: true, message: r.message ?? '' }
  }
  throw new HttpsError('invalid-argument', 'Unknown action.')
})

export const calendarCheck = onSchedule({ schedule: 'every 15 minutes', timeZone: 'America/Toronto', timeoutSeconds: 300 }, async () => {
  try { await runCalendarCheck() } catch (e) { logger.warn('Calendar check failed or skipped (another one running)', String(e)) }
})

// "Check now" on the import screen (same as the 15-minute check).
// Redo one import (owner, Nov 4: a group event came in as one person). Takes every shoot the app made from that Google
// event off the schedule and forgets the event, so the import screen shows it again as new. Google Calendar is untouched.
export const redoCalendarImport = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const shootId = String(req.data?.shootId ?? '').slice(0, 100)
  const sh = shootId ? (await db.doc(`shoots/${shootId}`).get()).data() : undefined
  const eventId = String(sh?.calendarEventId ?? req.data?.eventId ?? '').slice(0, 200)
  if (!eventId) throw new HttpsError('failed-precondition', 'This shoot did not come from Google Calendar.')
  const imp = (await db.doc(`calendar_imports/${eventId}`).get()).data()
  const ids = new Set<string>([...(Array.isArray(imp?.shootIds) ? imp!.shootIds.map(String) : []), ...(imp?.shootId ? [String(imp.shootId)] : []), ...(shootId ? [shootId] : [])])
  for (const id of ids) await removeImportedShoot(id, caller.email)
  if (imp?.blockId && imp.date) await removeImportedBlock(String(imp.date), String(imp.blockId))
  // A marker, not a delete: the 15-minute check would otherwise place it again with the same guess before anyone looks.
  await db.doc(`calendar_imports/${eventId}`).set({ redo: true, at: new Date().toISOString(), by: caller.email })
  await db.doc(`calendar_queue/${eventId}`).delete()
  return { removed: ids.size, eventId }
})

export const checkCalendarNow = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  await requireRole(req, ['owner', 'equipment'])
  return (await runCalendarCheck()) ?? { error: 'Paste a Google Calendar ID in Calendar & email first.' }
})
