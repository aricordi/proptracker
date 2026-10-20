// Calendars.
// 1) "Add to my calendar": every person gets a private link (an iCal feed) that phone calendars
//    subscribe to. It lists their own shoots (the schedule team's link lists everyone's) and
//    updates by itself. The link holds a random token, kept in calendar_tokens (server-only).
// 2) The shared Google Calendar: every booking, move, cancel and blocked time is copied there
//    (one-way; the app stays the source of truth). Off until the team pastes the calendar's ID in
//    Schedule → Settings and shares that calendar with the app's server account.
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { GoogleAuth } from 'google-auth-library'
import { randomBytes } from 'node:crypto'
import { db, requireRole, CALLABLE } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings, BLOCK_TYPES, monthOf, slotWindow, type ScheduleDay, type Block, type BlockType, type House, type Place } from './schedule.js'
import { importShootAsTeam, removeImportedShoot } from './scheduling.js'
import { stamp, addMinutes } from './gearBooking.js'

const TEAM = ['owner', 'equipment']
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'

// ─── 1. Personal calendar feed ───────────────────────────────────────────────

const FEED_URL = 'https://northamerica-northeast1-proptracker-9732e.cloudfunctions.net/shootsCalendar'

// Your private link (made once, then reused). `reset: true` makes a new one and the old link stops working.
export const myCalendarLink = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const existing = await db.collection('calendar_tokens').where('email', '==', caller.email).get()
  let token = existing.docs[0]?.id
  if (!token || req.data?.reset === true) {
    await Promise.all(existing.docs.map(d => d.ref.delete()))
    token = randomBytes(18).toString('hex')
    await db.doc(`calendar_tokens/${token}`).set({ email: caller.email, all: TEAM.includes(caller.role), createdAt: new Date().toISOString() })
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

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/calendar.events'] })
// Google event IDs may only use the letters a–v and digits, so encode ours as hex with a prefix.
const hex = (s: string) => Buffer.from(s).toString('hex')
export const shootEventId = (shootId: string) => `s${hex(shootId)}`
export const blockEventId = (date: string, blockId: string) => `b${hex(`${date}_${blockId}`)}`

async function calendarId(): Promise<string> {
  const d = (await db.doc('app_settings/schedule').get()).data()
  return typeof d?.googleCalendarId === 'string' ? d.googleCalendarId.trim() : ''
}
async function gcal(method: 'PUT' | 'POST' | 'DELETE', cal: string, path: string, body?: unknown) {
  const token = (await (await auth.getClient()).getAccessToken()).token
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
      ev = { summary: `${sh.creatorName} · ${house ? house.name : 'Offsite'}`, location: house ? house.address : sh.where,
        description: `${sh.kind === 'offsite' ? 'Offsite shoot' : 'House slot'} · booked in Prime Capitol (changes made here are not copied back)`,
        start: when(sh.from), end: when(sh.to) }
    }
  } else {
    const b = (((await db.doc(`schedule_days/${ref.date}`).get()).data() as ScheduleDay | undefined)?.blocks ?? []).find(x => x.id === ref.blockId) as (Block & { imported?: boolean }) | undefined
    if (b?.imported) return
    if (b) {
      const from = stamp(ref.date, b.start)
      ev = { summary: `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name}`,
        location: s.houses[b.house].address, description: 'Blocked time · set in Prime Capitol', start: when(from), end: when(addMinutes(from, b.end - b.start)) }
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
  if (isEmulator()) return { ok: true, account: 'test-calendar@example.iam.gserviceaccount.com' }
  const account = (await auth.getCredentials()).client_email ?? ''
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

interface GEvent { id: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; status?: string }

const torontoStamp = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

// Best guesses from the event's words; the team can change every one.
export function guessImport(e: { title: string; location: string; date: string; startMin: number; endMin: number }, people: { email: string; name: string }[], slots: number[]) {
  const text = `${e.title} ${e.location}`.toLowerCase()
  const house = /cliff\s*2|2371/.test(text) ? 'cliff2' : /cliff|2375/.test(text) ? 'cliff1' : 'offsite'
  const isBlock = /clean|maint|repair|plumb|event|party|airbnb|rental|guest|blocked|closed/.test(text)
  const person = people.find(p => { const first = p.name.split(/\s+/)[0]?.toLowerCase(); return first && first.length > 1 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, '')}\\b`).test(text) })
  // The 2-hour slot the event starts in (or the closest one).
  const slot = slots.reduce((best, s) => Math.abs(s - e.startMin) < Math.abs(best - e.startMin) ? s : best, slots[0])
  return { action: isBlock ? 'block' : person ? 'shoot' : 'skip', email: person?.email ?? '', house, start: house === 'offsite' ? e.startMin : slot }
}

export const previewCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  await requireRole(req, ['owner'])
  const cal = await calendarId()
  if (!cal) throw new HttpsError('failed-precondition', 'Paste the Google Calendar ID in Schedule settings first.')
  const { events, people } = await scanCalendar(cal)
  return { events, people }
})

// Read the shared calendar (never writes) and compare with what was imported before.
async function scanCalendar(cal: string) {
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const people = (await db.collection('users').where('active', '==', true).get()).docs.map(u => ({ email: u.id, name: String(u.get('name') || u.id) }))
  // What was imported before, with a snapshot of the event then (owner, Oct 19: the team keeps adding events straight
  // in Google Calendar while testing, so the import is re-run: new events, changed ones and deleted ones show up).
  const imports = new Map((await db.collection('calendar_imports').get()).docs.map(d => [d.id, d.data()]))
  let items: GEvent[] = []
  if (isEmulator()) {
    const d = addDays(todayInStudio(), 3)
    const fake = (await db.doc('test_calendar/events').get()).data()   // tests can stand in their own events
    if (fake) items = fake.items as GEvent[]
    else items = [
      { id: 'demo1', summary: 'Jana - Cliff 1', start: { dateTime: `${d}T13:00:00-04:00` }, end: { dateTime: `${d}T15:00:00-04:00` } },
      { id: 'demo2', summary: 'Cleaners', location: '2375 Cliff Road', start: { dateTime: `${d}T07:00:00-04:00` }, end: { dateTime: `${d}T09:00:00-04:00` } },
    ]
  } else {
    const token = (await (await auth.getClient()).getAccessToken()).token
    let pageToken = ''
    do {
      const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 120 * 86400000).toISOString(), ...(pageToken ? { pageToken } : {}) })
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) throw new HttpsError('failed-precondition', `Google Calendar said ${r.status}. Is the calendar shared with the app? (${(await r.text()).slice(0, 160)})`)
      const j = await r.json() as { items?: GEvent[]; nextPageToken?: string }
      items.push(...(j.items ?? [])); pageToken = j.nextPageToken ?? ''
    } while (pageToken && items.length < 1500)
  }
  const live = items.filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime && !/^[sbt][0-9a-f]+$/.test(e.id))   // not the app's own events
  const seen = new Set(live.map(e => e.id))
  // Same time, and (when we know them) the same title and place.
  const same = (a: Record<string, any>, b: Record<string, any>) => a.date === b.date && a.startMin === b.startMin && a.endMin === b.endMin
    && (!b.title || a.title === b.title) && (!b.location || a.location === b.location)
  const events: Record<string, unknown>[] = []
  for (const e of live) {
    const from = torontoStamp(e.start!.dateTime!), to = torontoStamp(e.end!.dateTime!)
    const date = from.slice(0, 10), startMin = Number(from.slice(11, 13)) * 60 + Number(from.slice(14, 16))
    const endMin = (to.slice(0, 10) > date ? 1440 : 0) + Number(to.slice(11, 13)) * 60 + Number(to.slice(14, 16))
    const base = { id: e.id, title: e.summary ?? '(no title)', location: e.location ?? '', date, startMin, endMin }
    const was = imports.get(e.id)
    if (!was) { events.push({ ...base, kind: 'new', guess: guessImport(base, people, s.slots) }); continue }
    // Already imported: only show it again if it was changed in Google Calendar since (skipped ones stay skipped).
    if (was.action === 'skip' || (was.date && same(base, was))) continue
    const g = guessImport(base, people, s.slots)
    events.push({ ...base, kind: 'changed', was: { date: was.date, startMin: was.startMin, endMin: was.endMin, title: was.title },
      guess: { ...g, action: was.action, email: was.email || g.email, house: was.house || g.house, type: was.type } })
  }
  // Deleted (or moved out of view) in Google Calendar: still on the app's schedule.
  const today = todayInStudio()
  for (const [id, was] of imports) {
    if (seen.has(id) || was.action === 'skip' || was.removed || !was.date || was.date < today) continue
    events.push({ id, title: was.title ?? '(no title)', location: was.location ?? '', date: was.date, startMin: was.startMin, endMin: was.endMin, kind: 'removed',
      guess: { action: 'remove', email: was.email ?? '', house: was.house ?? 'cliff1', start: was.startMin }, wasAction: was.action })
  }
  return { events, people: people.sort((a, b) => a.name.localeCompare(b.name)), imports }
}

async function removeImportedBlock(date: string, blockId: string) {
  const ref = db.doc(`schedule_days/${date}`)
  await db.runTransaction(async tx => {
    const day = (await tx.get(ref)).data() as ScheduleDay | undefined
    if (day?.blocks?.some(b => b.id === blockId)) tx.update(ref, { blocks: day.blocks.filter(b => b.id !== blockId) })
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
        endMin: Number(it.end) > startMin ? Number(it.end) : startMin + s.slotMinutes }
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
        await db.runTransaction(async tx => {
          const day = ((await tx.get(ref)).data() ?? {}) as ScheduleDay
          tx.set(ref, { date: it.date, blocks: [...(day.blocks ?? []).filter(b => b.id !== blockId), { id: blockId, house, start, end, type, note: String(it.title ?? '').slice(0, 200), by: caller.email, imported: true }] }, { merge: true })
        })
        saved = { blockId, house, type }
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
  const cal = await calendarId()
  if (!cal) return null
  const status = db.doc('app_settings/calendarCheck')
  try {
    const { events } = await scanCalendar(cal) as { events: any[] }   // eslint-disable-line @typescript-eslint/no-explicit-any
    const auto = events.filter(e => e.kind === 'changed' || e.kind === 'removed').map(e => e.kind === 'removed'
      ? { id: e.id, action: 'remove', date: e.date }
      : { id: e.id, action: e.guess.action, email: e.guess.email, house: e.guess.house, type: e.guess.type, date: e.date, start: e.startMin, end: e.endMin, title: e.title, location: e.location, where: e.location || e.title })
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
  return (await runCalendarCheck()) ?? { error: 'Paste the Google Calendar ID in Schedule settings first.' }
})
