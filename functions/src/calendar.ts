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
import { randomBytes } from 'node:crypto'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings, BLOCK_TYPES, monthOf, slotWindow, type ScheduleDay, type Block, type BlockType, type House, type Place } from './schedule.js'
import { importShootAsTeam, removeImportedShoot, filmingPeople } from './scheduling.js'
import { stamp, addMinutes } from './gearBooking.js'
import { calendarAccess, calendarAccount } from './googleAccount.js'
import { sendPush } from './push.js'
import { houseFromText, ignoreReason } from './calendarText.js'
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
export const EVENT_COLOURS: Record<'cliff1' | 'cliff2' | 'offsite' | 'block', string> = { cliff1: '5', cliff2: '7', offsite: '10', block: '8' }

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
    if (sh && (sh.importedFrom || sh.calendarEventId)) return   // an old calendar event: never touched
    if (sh && sh.status === 'booked') {
      const house = sh.place === 'offsite' ? null : s.houses[sh.place as 'cliff1' | 'cliff2']
      const needs = await shootNeeds(ref.shootId)
      const list = (title: string, xs: string[]) => xs.length ? [`${title}:`, ...xs.slice(0, 25).map(x => `• ${x}`), ...(xs.length > 25 ? [`…and ${xs.length - 25} more`] : [])] : []
      ev = { summary: `${sh.creatorName} · ${house ? house.name : 'Offsite'}`, location: house ? house.address : sh.where,
        colorId: EVENT_COLOURS[house ? sh.place as 'cliff1' | 'cliff2' : 'offsite'],
        description: [`${sh.kind === 'offsite' ? `Offsite shoot · ${sh.where}` : 'House slot'}`, ...list('Gear', needs.gear), ...list('Props', needs.props),
          'Booked in Prime Capitol (changes made here are not copied back)'].join('\n'),
        start: when(sh.from), end: when(sh.to) }
    }
  } else {
    const b = (((await db.doc(`schedule_days/${ref.date}`).get()).data() as ScheduleDay | undefined)?.blocks ?? []).find(x => x.id === ref.blockId) as (Block & { imported?: boolean }) | undefined
    if (b?.imported) return
    if (b) {
      const from = stamp(ref.date, b.start)
      ev = { summary: `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name}`,
        location: s.houses[b.house].address, colorId: EVENT_COLOURS.block, description: 'Blocked time · set in Prime Capitol', start: when(from), end: when(addMinutes(from, b.end - b.start)) }
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
  if (!shoot || shoot.importedFrom || shoot.calendarEventId) return   // old calendar event: never touched
  const before = event.data?.before.data()
  const what = (x?: Record<string, any>) => x && x.status === 'booked' ? JSON.stringify([x.place, x.from, x.to, x.where, x.creatorName]) : ''
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
  if (!sh || sh.status !== 'booked' || sh.importedFrom || sh.calendarEventId) return
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  await sendNow(shootEventId(shootId), { kind: 'shoot', shootId }, shootLabel(sh, s), 'props/gear change')
}
export const syncPropsToCalendar = onDocumentWritten('reservations/{id}', e => refreshShootFor(e.data?.before.data(), e.data?.after.data()))
export const syncGearToCalendar = onDocumentWritten('gear_bookings/{id}', e => refreshShootFor(e.data?.before.data(), e.data?.after.data()))

export const syncBlocksToCalendar = onDocumentWritten('schedule_days/{date}', async event => {
  // Blocks imported from Google Calendar (imported: true) are that calendar's own events: never touched.
  const before = ((event.data?.before.data() as ScheduleDay | undefined)?.blocks ?? []).filter(b => !(b as Block & { imported?: boolean }).imported)
  const after = ((event.data?.after.data() as ScheduleDay | undefined)?.blocks ?? []).filter(b => !(b as Block & { imported?: boolean }).imported)
  const key = (b: Block) => JSON.stringify([b.id, b.house, b.start, b.end, b.type, b.note ?? ''])
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
  await requireRole(req, ['owner'])
  const [p, sent] = await Promise.all([db.collection('calendar_outbox').orderBy('at').limit(300).get(), db.collection('calendar_sent').orderBy('at', 'desc').limit(300).get()])
  return { pending: p.docs.map(d => d.data()), sent: sent.docs.map(d => ({ eventId: d.id, label: d.get('label'), at: d.get('at') })) }
})

// A tap from the team: retry ('send') or drop ('discard') failed changes, or take app events back out ('remove').
export const applyCalendarChanges = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner'])
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
  const house = houseFromText(text) ?? 'offsite'
  const isBlock = /clean|maint|repair|plumb|event|party|airbnb|rental|guest|blocked|closed/.test(text)
  const person = people.find(p => { const first = p.name.split(/\s+/)[0]?.toLowerCase(); return first && first.length > 1 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, '')}\\b`).test(text) })
  // The 2-hour slot the event starts in (or the closest one).
  const slot = slots.reduce((best, s) => Math.abs(s - e.startMin) < Math.abs(best - e.startMin) ? s : best, slots[0])
  return { action: isBlock ? 'block' : person ? 'shoot' : 'skip', email: person?.email ?? '', house, start: house === 'offsite' ? e.startMin : slot }
}

export const previewCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  await requireRole(req, ['owner'])
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
    const endMin = (to.slice(0, 10) > date ? 1440 : 0) + Number(to.slice(11, 13)) * 60 + Number(to.slice(14, 16))
    return [{ id: e.id, title, location, date, startMin, endMin, allDay: false, eventType }]
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
    const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 120 * 86400000).toISOString(), ...(pageToken ? { pageToken } : {}) })
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } })
    // One calendar that can't be read stops the whole check: otherwise its events would look deleted.
    if (!r.ok) throw new HttpsError('failed-precondition', `Google Calendar said ${r.status} for "${cal.name}". Is it shared with the app's account? (${(await r.text()).slice(0, 160)})`)
    const j = await r.json() as { items?: GEvent[]; nextPageToken?: string }
    items.push(...(j.items ?? [])); pageToken = j.nextPageToken ?? ''
  } while (pageToken && items.length < 1500)
  // Google's own name for the calendar, so the team can tell a wrong ID from an empty calendar.
  const meta = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}`, { headers: { Authorization: `Bearer ${token}` } })
  const title = meta.ok ? String(((await meta.json()) as { summary?: string }).summary ?? '') : ''
  return { items, title }
}

// Read every calendar (never writes) and compare with what was imported before.
async function scanCalendar(cals: Source[]) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const people = (await filmingPeople()).map(p => ({ email: p.email, name: p.name }))
  // What was imported before, with a snapshot of the event then (owner, Oct 19: the team keeps adding events straight
  // in Google Calendar while testing, so the import is re-run: new events, changed ones and deleted ones show up).
  const imports = new Map((await db.collection('calendar_imports').get()).docs.map(d => [d.id, d.data()]))
  const live: (ScanItem & { cal: Source })[] = []
  const seen = new Set<string>()
  const counts: { name: string; house: string; title: string; found: number; hidden: number }[] = []
  for (const cal of cals) {
    const { items, title } = await readCalendar(cal)
    const row = { name: cal.name, house: cal.house, title, found: 0, hidden: 0 }
    counts.push(row)
    for (const e of items) {
      if (e.status === 'cancelled' || /^[sbt][0-9a-f]+$/.test(e.id)) continue   // the app's own events
      for (const it of eventDays(e)) {
        if (seen.has(it.id)) continue   // same event in two calendars: once
        seen.add(it.id); live.push({ ...it, cal }); row.found++
        if (ignoreReason(it)) row.hidden++
      }
    }
  }
  // Same time, and (when we know them) the same title and place.
  const same = (a: Record<string, any>, b: Record<string, any>) => a.date === b.date && a.startMin === b.startMin && a.endMin === b.endMin
    && (!b.title || a.title === b.title) && (!b.location || a.location === b.location)
  const guessFor = (it: ScanItem, cal: Source) => {
    const g = guessImport(it, people, s.slots)
    // Mixed calendar: someone's name → their shoot; a house but nobody named (e.g. "Stromedy - Cliff 2") → blocked time.
    // The address/name in the event wins (owner, Oct 30: the calendars aren't tidy); else the calendar's usual house.
    const said = houseFromText(`${it.title} ${it.location}`)
    if (cal.house === 'any' || said) return (it.allDay && g.action === 'shoot') || (g.action === 'skip' && g.house !== 'offsite') ? { ...g, action: 'block' } : g
    // A calendar that's for one house and the event doesn't say otherwise: at that house; nobody named → blocked time to check.
    return { ...g, house: cal.house, start: s.slots.find(x => x >= it.startMin) ?? s.slots[0], action: g.action === 'skip' || it.allDay ? 'block' : g.action }
  }
  const events: Record<string, unknown>[] = []
  for (const it of live) {
    const { cal, ...base } = it
    const tag = { calendar: cal.name, feedId: cal.id }
    const was = imports.get(it.id)
    const why = ignoreReason(base)
    // Time off and birthdays: not shoots or blocks. Listed as 'ignored' (hidden on the screen unless asked for).
    if (!was && why) { events.push({ ...base, ...tag, kind: 'ignored', why, guess: { ...guessFor(base, cal), action: 'skip' } }); continue }
    if (!was) { events.push({ ...base, ...tag, kind: 'new', guess: guessFor(base, cal) }); continue }
    // Already imported: only show it again if it was changed in Google Calendar since (skipped ones stay skipped).
    if (was.action === 'skip' || (was.date && same(base, was))) continue
    const g = guessFor(base, cal)
    events.push({ ...base, ...tag, kind: 'changed', was: { date: was.date, startMin: was.startMin, endMin: was.endMin, title: was.title },
      guess: { ...g, action: was.action, email: was.email || g.email, house: was.house || g.house, type: was.type } })
  }
  // Deleted (or moved out of view) in Google Calendar: still on the app's schedule. Only for calendars still read
  // (imports from before Oct 30 came from the app calendar); a calendar taken off the list never removes anything.
  const today = todayInStudio()
  const read = new Set(cals.map(c => c.id)), appCal = s.googleCalendarId
  for (const [id, was] of imports) {
    if (seen.has(id) || was.action === 'skip' || was.removed || !was.date || was.date < today) continue
    if (!read.has(String(was.feedId ?? appCal))) continue
    events.push({ id, title: was.title ?? '(no title)', location: was.location ?? '', date: was.date, startMin: was.startMin, endMin: was.endMin, kind: 'removed',
      calendar: cals.find(c => c.id === String(was.feedId ?? appCal))?.name ?? '', allDay: !!was.allDay,
      guess: { action: 'remove', email: was.email ?? '', house: was.house ?? 'cliff1', start: was.startMin }, wasAction: was.action })
  }
  return { events, people: people.sort((a, b) => a.name.localeCompare(b.name)), imports, counts }
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
  const caller = await requireRole(req, ['owner'])
  const list = Array.isArray(req.data?.items) ? req.data.items.slice(0, 500) : []
  return { results: await applyImports(list, caller.email) }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyImports(list: any[], by: string) {
  const caller = { email: by }
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const results: { id: string; ok: boolean; message?: string }[] = []
  for (const it of list) {
    const id = String(it?.id ?? '').slice(0, 200)
    if (!id) continue
    let clash: string[] = []
    try {
      const was = (await db.doc(`calendar_imports/${id}`).get()).data()
      // Take the app's earlier copy off the schedule when the event became something else or was deleted.
      const dropOld = async () => {
        if (was?.shootId && (it.action !== 'shoot')) await removeImportedShoot(was.shootId, caller.email)
        if (was?.blockId && was.date) await removeImportedBlock(was.date, was.blockId)
      }
      const startMin = Number(it.start) || 0
      const snapshot = { title: String(it.title ?? '').slice(0, 200), location: String(it.location ?? '').slice(0, 300), date: String(it.date), startMin,
        endMin: Number(it.end) > startMin ? Number(it.end) : startMin + s.slotMinutes,
        feedId: String(it.feedId || s.googleCalendarId).slice(0, 200), allDay: it.allDay === true }
      if (it.action === 'remove' || it.action === 'keep') {
        if (it.action === 'remove') await dropOld()
        await db.doc(`calendar_imports/${id}`).set({ ...(was ?? {}), removed: it.action === 'remove', at: new Date().toISOString(), by: caller.email })
        results.push({ id, ok: true }); continue
      }
      await dropOld()
      let saved: Record<string, unknown> = {}
      if (it.action === 'shoot') {
        const u = (await db.doc(`users/${String(it.email).toLowerCase()}`).get()).data()
        if (!u?.active) throw new Error('Pick who this shoot is for.')
        const place = (['cliff1', 'cliff2', 'offsite'].includes(it.house) ? it.house : 'cliff1') as Place
        // The real hours from the calendar (owner, Oct 19: never moved to the grid, never changed in Google).
        const start = Number(it.start), end = Number(it.end) > start ? Number(it.end) : start + s.slotMinutes
        const r = await importShootAsTeam({ place, date: String(it.date), start, end, where: place === 'offsite' ? String(it.where || it.title || 'Offsite').slice(0, 200) : '' },
          { email: String(it.email).toLowerCase(), name: u.name || it.email }, caller.email, { calendarEventId: id, importedFrom: 'google-calendar' }, was?.shootId)
        if (r.clashWith.length) clash = r.clashWith
        saved = { shootId: r.id, email: String(it.email).toLowerCase(), house: place }
      } else if (it.action === 'block') {
        const house = (it.house === 'cliff2' ? 'cliff2' : 'cliff1') as House
        const type = (Object.keys(BLOCK_TYPES).includes(it.type) ? it.type : 'other') as BlockType
        const start = Math.max(0, Number(it.start) || 0), end = Math.max(start + 1, Number(it.end) || 0)
        const ref = db.doc(`schedule_days/${it.date}`)
        const blockId = `g${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`
        const note = String(it.title ?? '').slice(0, 200)
        // Owner (Oct 30): an old-calendar block landing on a shoot already booked in the app = a CLASH. The shoot stays,
        // gets a red "Clash" tag, and the schedule team + the owner are told to sort it out with the creator.
        const hit: { name: string; email?: string }[] = []
        await db.runTransaction(async tx => {
          const day = ((await tx.get(ref)).data() ?? {}) as ScheduleDay
          const under = Object.entries(day[house] ?? {}).filter(([k, e]) => e.shootId && !e.hold && Number(k) < end && start < Number(k) + s.slotMinutes)
          hit.splice(0, hit.length, ...under.map(([, e]) => ({ name: e.name, email: e.email })))
          const clashes = [...(day.clashes ?? []).filter(c => c.blockId !== blockId),
            ...under.map(([k, e]) => ({ house, slot: k, shootId: e.shootId, name: note || BLOCK_TYPES[type], email: e.email ?? '', start, end, blockId }))]
          tx.set(ref, { date: it.date, clashes, blocks: [...(day.blocks ?? []).filter(b => b.id !== blockId), { id: blockId, house, start, end, type, note, by: caller.email, imported: true }] }, { merge: true })
        })
        if (hit.length) {
          clash = hit.map(h => h.name)
          const known = (was?.clashWith ?? []) as string[]
          if (clash.some(n => !known.includes(n))) {
            await sendPush({ to: ['gear-team', OWNER_EMAIL], title: 'Calendar clash', url: '/schedule',
              body: `"${note || BLOCK_TYPES[type]}" (${s.houses[house].name}, ${it.date}) is on top of ${clash.join(', ')}'s shoot. Sort it out with them.` }).catch(() => 0)
          }
        }
        saved = { blockId, house, type, clashWith: clash }
      }
      // Remember the event as it is now, so the next import can tell if it changed in Google Calendar.
      await db.doc(`calendar_imports/${id}`).set({ action: it.action === 'shoot' || it.action === 'block' ? it.action : 'skip', ...snapshot, ...saved, at: new Date().toISOString(), by: caller.email })
      results.push({ id, ok: true, ...(clash.length ? { message: `Imported · CLASH with ${clash.join(', ')}` } : {}) })
    } catch (e) { results.push({ id, ok: false, message: (e as Error).message }) }
  }
  return results
}

// Every 15 minutes (owner, Oct 19; Cloud Scheduler, 3rd job, within the free 3): read the shared calendar. Events that
// were imported and then CHANGED or DELETED in Google Calendar (by a person) are mirrored in the app straight away.
// NEW events need a person to say who/which house, so they only wait on the import screen (counted for the banner).
// Never writes anything to Google Calendar.
export async function runCalendarCheck() {
  const cals = await sources()
  if (!cals.length) return null
  const status = db.doc('app_settings/calendarCheck')
  try {
    const { events } = await scanCalendar(cals) as { events: any[] }   // eslint-disable-line @typescript-eslint/no-explicit-any
    const auto = events.filter(e => e.kind === 'changed' || e.kind === 'removed').map(e => e.kind === 'removed'
      ? { id: e.id, action: 'remove', date: e.date }
      : { id: e.id, action: e.guess.action, email: e.guess.email, house: e.guess.house, type: e.guess.type, date: e.date, start: e.startMin, end: e.endMin, title: e.title, location: e.location, where: e.location || e.title, feedId: e.feedId, allDay: e.allDay })
    const results = auto.length ? await applyImports(auto, 'calendar check') : []
    const out = { at: new Date().toISOString(), newEvents: events.filter(e => e.kind === 'new').length,
      changed: auto.filter(a => a.action !== 'remove').length, removed: auto.filter(a => a.action === 'remove').length,
      failed: results.filter(r => !r.ok).map(r => `${r.id}: ${r.message ?? ''}`).slice(0, 10), error: '' }
    await status.set(out)
    return out
  } catch (e) {
    await status.set({ at: new Date().toISOString(), error: String((e as Error).message).slice(0, 300) }, { merge: true })
    throw e
  }
}
export const calendarCheck = onSchedule({ schedule: 'every 15 minutes', timeZone: 'America/Toronto', timeoutSeconds: 300 }, async () => {
  try { await runCalendarCheck() } catch (e) { logger.warn('Calendar check failed', String(e)) }
})

// "Check now" on the import screen (same as the 15-minute check).
export const checkCalendarNow = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  await requireRole(req, ['owner'])
  return (await runCalendarCheck()) ?? { error: 'Paste a Google Calendar ID in Calendar & email first.' }
})
