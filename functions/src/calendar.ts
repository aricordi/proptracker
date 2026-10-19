// Calendars.
// 1) "Add to my calendar": every person gets a private link (an iCal feed) that phone calendars
//    subscribe to. It lists their own shoots (the schedule team's link lists everyone's) and
//    updates by itself. The link holds a random token, kept in calendar_tokens (server-only).
// 2) The shared Google Calendar: every booking, move, cancel and blocked time is copied there
//    (one-way; the app stays the source of truth). Off until the team pastes the calendar's ID in
//    Schedule → Settings and shares that calendar with the app's server account.
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { GoogleAuth } from 'google-auth-library'
import { randomBytes } from 'node:crypto'
import { db, requireRole, CALLABLE } from './auth.js'
import { addDays, todayInStudio } from './booking.js'
import { cleanScheduleSettings, BLOCK_TYPES, monthOf, slotWindow, type ScheduleDay, type Block, type BlockType, type House, type Place } from './schedule.js'
import { importShootAsTeam } from './scheduling.js'
import { stamp, addMinutes } from './gearBooking.js'

const TEAM = ['owner', 'equipment', 'admin']
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

// Owner (Oct 19): the app may add, change and delete ITS OWN events in the shared calendar, but never by itself:
// every booking, move, cancel or blocked time only queues a change in `calendar_outbox` (one per Google event, the
// latest state wins). The schedule team reviews the list and taps Send (or Don't send). Events that came from the
// old calendar (imported shoots and blocks) are never queued, so the app can never touch them. Only event IDs the
// app makes itself ('s…' / 'b…') are ever written. `calendar_sent/{eventId}` = what's in the calendar from the app.
type Pending = { kind: 'shoot'; shootId: string } | { kind: 'block'; date: string; blockId: string }
const outbox = (eventId: string) => db.doc(`calendar_outbox/${eventId}`)
const sentDoc = (eventId: string) => db.doc(`calendar_sent/${eventId}`)

async function queue(eventId: string, ref: Pending, label: string, removing: boolean) {
  const wasSent = (await sentDoc(eventId).get()).exists
  // Removing something that never reached the calendar: nothing to do.
  if (removing && !wasSent) { await outbox(eventId).delete(); return }
  await outbox(eventId).set({ ...ref, eventId, label, change: removing ? 'remove' : wasSent ? 'update' : 'add', at: new Date().toISOString() })
}

const shootLabel = (sh: Record<string, any>, s: ReturnType<typeof cleanScheduleSettings>) => {
  const house = sh.place === 'offsite' ? null : s.houses[sh.place as 'cliff1' | 'cliff2']
  return `${sh.creatorName} · ${house ? house.name : sh.where || 'Offsite'} · ${sh.date} ${sh.from?.slice(11, 16)}–${sh.to?.slice(11, 16)}`
}

export const syncShootToCalendar = onDocumentWritten('shoots/{id}', async event => {
  const after = event.data?.after.data()
  const shoot = after ?? event.data?.before.data()
  // Imported from Google Calendar: that event belongs to the calendar, the app never changes or deletes it.
  if (!shoot || shoot.importedFrom || shoot.calendarEventId) return
  const before = event.data?.before.data()
  const what = (x?: Record<string, any>) => x && x.status === 'booked' ? JSON.stringify([x.place, x.from, x.to, x.where, x.creatorName]) : ''
  if (what(before) === what(after)) return   // nothing the calendar shows has changed (e.g. a check-in)
  if (!(await calendarId())) return
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  await queue(shootEventId(event.params.id), { kind: 'shoot', shootId: event.params.id }, shootLabel(shoot, s), !after || after.status !== 'booked')
})

export const syncBlocksToCalendar = onDocumentWritten('schedule_days/{date}', async event => {
  // Blocks imported from Google Calendar (imported: true) are that calendar's own events: never touched.
  const before = ((event.data?.before.data() as ScheduleDay | undefined)?.blocks ?? []).filter(b => !(b as Block & { imported?: boolean }).imported)
  const after = ((event.data?.after.data() as ScheduleDay | undefined)?.blocks ?? []).filter(b => !(b as Block & { imported?: boolean }).imported)
  const key = (b: Block) => JSON.stringify([b.id, b.house, b.start, b.end, b.type, b.note ?? ''])
  const added = after.filter(b => !before.some(x => key(x) === key(b)))
  const removed = before.filter(b => !after.some(x => x.id === b.id))
  if (!added.length && !removed.length) return
  if (!(await calendarId())) return
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const date = event.params.date
  const label = (b: Block) => `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name} · ${date}`
  for (const b of removed) await queue(blockEventId(date, b.id), { kind: 'block', date, blockId: b.id }, label(b), true)
  for (const b of added) await queue(blockEventId(date, b.id), { kind: 'block', date, blockId: b.id }, label(b), false)
})

// The changes waiting for approval (oldest first) and what the app has put in the calendar.
export const calendarPending = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'], { noAdmin: true })
  const [p, sent] = await Promise.all([db.collection('calendar_outbox').orderBy('at').limit(300).get(), db.collection('calendar_sent').orderBy('at', 'desc').limit(300).get()])
  return { pending: p.docs.map(d => d.data()), sent: sent.docs.map(d => ({ eventId: d.id, label: d.get('label'), at: d.get('at') })) }
})

// Send (or drop) the chosen changes, or take app events back out of the calendar. Re-reads the CURRENT booking, so
// what's sent is always up to date. Only the app's own event IDs are ever written.
export const applyCalendarChanges = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'], { noAdmin: true })
  const action = req.data?.action
  const ids = (Array.isArray(req.data?.ids) ? req.data.ids : []).map((x: unknown) => String(x)).filter((x: string) => /^[sb][0-9a-f]+$/.test(x)).slice(0, 100) as string[]
  if (!['send', 'discard', 'remove'].includes(action) || !ids.length) throw new HttpsError('invalid-argument', 'Pick what to send.')
  const cal = await calendarId()
  if (!cal && action !== 'discard') throw new HttpsError('failed-precondition', 'Paste the Google Calendar ID in Schedule settings first.')
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const results: { eventId: string; ok: boolean; message?: string }[] = []
  for (const eventId of ids) {
    try {
      if (action === 'discard') { await outbox(eventId).delete(); results.push({ eventId, ok: true }); continue }
      if (action === 'remove') {
        if (!isEmulator()) await deleteEvent(cal, eventId)
        await sentDoc(eventId).delete(); await outbox(eventId).delete()
        results.push({ eventId, ok: true }); continue
      }
      const p = (await outbox(eventId).get()).data() as (Pending & { label: string }) | undefined
      if (!p) { results.push({ eventId, ok: false, message: 'Already handled.' }); continue }
      let ev: Record<string, unknown> | null = null
      if (p.kind === 'shoot') {
        const sh = (await db.doc(`shoots/${p.shootId}`).get()).data()
        if (sh && sh.status === 'booked' && !sh.importedFrom && !sh.calendarEventId) {
          const house = sh.place === 'offsite' ? null : s.houses[sh.place as 'cliff1' | 'cliff2']
          ev = { summary: `${sh.creatorName} · ${house ? house.name : 'Offsite'}`, location: house ? house.address : sh.where,
            description: `${sh.kind === 'offsite' ? 'Offsite shoot' : 'House slot'} · booked in Prime Capitol (changes made here are not copied back)`,
            start: when(sh.from), end: when(sh.to) }
        }
      } else {
        const b = (((await db.doc(`schedule_days/${p.date}`).get()).data() as ScheduleDay | undefined)?.blocks ?? []).find(x => x.id === p.blockId) as (Block & { imported?: boolean }) | undefined
        if (b && !b.imported) {
          const from = stamp(p.date, b.start)
          ev = { summary: `${BLOCK_TYPES[b.type]}${b.note && b.note !== BLOCK_TYPES[b.type] ? `: ${b.note}` : ''} · ${s.houses[b.house].name}`,
            location: s.houses[b.house].address, description: 'Blocked time · set in Prime Capitol', start: when(from), end: when(addMinutes(from, b.end - b.start)) }
        }
      }
      if (!isEmulator()) { if (ev) await upsertEvent(cal, eventId, ev); else await deleteEvent(cal, eventId) }
      if (ev) await sentDoc(eventId).set({ label: p.label, at: new Date().toISOString(), by: caller.email })
      else await sentDoc(eventId).delete()
      await outbox(eventId).delete()
      results.push({ eventId, ok: true })
    } catch (e) { results.push({ eventId, ok: false, message: String((e as Error).message).slice(0, 200) }) }
  }
  return { results }
})

// Schedule team: test the shared-calendar connection (a tap: writes and removes one test event).
export const testCalendarLink = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'], { noAdmin: true })   // the connection itself: not admins (owner, Oct 19)
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
  await requireRole(req, ['owner', 'equipment'], { noAdmin: true })
  const cal = await calendarId()
  if (!cal) throw new HttpsError('failed-precondition', 'Paste the Google Calendar ID in Schedule settings first.')
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const people = (await db.collection('users').where('active', '==', true).get()).docs.map(u => ({ email: u.id, name: String(u.get('name') || u.id) }))
  const done = new Set((await db.collection('calendar_imports').get()).docs.map(d => d.id))
  let items: GEvent[] = []
  if (isEmulator()) {
    const d = addDays(todayInStudio(), 3)
    items = [
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
  const events = items
    .filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime && !/^[sbt][0-9a-f]+$/.test(e.id) && !done.has(e.id))   // skip the app's own events + already imported
    .map(e => {
      const from = torontoStamp(e.start!.dateTime!), to = torontoStamp(e.end!.dateTime!)
      const date = from.slice(0, 10), startMin = Number(from.slice(11, 13)) * 60 + Number(from.slice(14, 16))
      const endMin = (to.slice(0, 10) > date ? 1440 : 0) + Number(to.slice(11, 13)) * 60 + Number(to.slice(14, 16))
      const base = { id: e.id, title: e.summary ?? '(no title)', location: e.location ?? '', date, startMin, endMin }
      return { ...base, guess: guessImport(base, people, s.slots) }
    })
  return { events, people: people.sort((a, b) => a.name.localeCompare(b.name)) }
})

// Import the reviewed events. Each one is a shoot (for a person, at a house slot or offsite hours)
// or blocked time; skipped ones are just remembered so they don't show up again.
export const applyCalendarImport = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'], { noAdmin: true })
  const list = Array.isArray(req.data?.items) ? req.data.items.slice(0, 500) : []
  const s = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
  const results: { id: string; ok: boolean; message?: string }[] = []
  for (const it of list) {
    const id = String(it?.id ?? '').slice(0, 200)
    if (!id) continue
    let clash: string[] = []
    try {
      if (it.action === 'shoot') {
        const u = (await db.doc(`users/${String(it.email).toLowerCase()}`).get()).data()
        if (!u?.active) throw new Error('Pick who this shoot is for.')
        const place = (['cliff1', 'cliff2', 'offsite'].includes(it.house) ? it.house : 'cliff1') as Place
        // The real hours from the calendar (owner, Oct 19: never moved to the grid, never changed in Google).
        const start = Number(it.start), end = Number(it.end) > start ? Number(it.end) : start + s.slotMinutes
        const r = await importShootAsTeam({ place, date: String(it.date), start, end, where: place === 'offsite' ? String(it.where || it.title || 'Offsite').slice(0, 200) : '' },
          { email: String(it.email).toLowerCase(), name: u.name || it.email }, caller.email, { calendarEventId: id, importedFrom: 'google-calendar' })
        if (typeof r !== 'string' && r.clashWith.length) clash = r.clashWith
      } else if (it.action === 'block') {
        const house = (it.house === 'cliff2' ? 'cliff2' : 'cliff1') as House
        const type = (Object.keys(BLOCK_TYPES).includes(it.type) ? it.type : 'other') as BlockType
        const start = Math.max(0, Number(it.start) || 0), end = Math.max(start + 1, Number(it.end) || 0)
        const ref = db.doc(`schedule_days/${it.date}`)
        await db.runTransaction(async tx => {
          const day = ((await tx.get(ref)).data() ?? {}) as ScheduleDay
          tx.set(ref, { date: it.date, blocks: [...(day.blocks ?? []), { id: `g${id.slice(0, 7)}`, house, start, end, type, note: String(it.title ?? '').slice(0, 200), by: caller.email, imported: true }] }, { merge: true })
        })
      }
      await db.doc(`calendar_imports/${id}`).set({ action: it.action === 'shoot' || it.action === 'block' ? it.action : 'skip', at: new Date().toISOString(), by: caller.email })
      results.push({ id, ok: true, ...(clash.length ? { message: `Imported · CLASH with ${clash.join(', ')}` } : {}) })
    } catch (e) { results.push({ id, ok: false, message: (e as Error).message }) }
  }
  return { results }
})
