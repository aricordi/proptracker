// "Add to my calendar" links: a private feed of your shoots (the team's lists everyone's).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, waitFor, clearDatabase } from './helpers'

const docs = async (col: string) => {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/${col}?pageSize=100`, { headers: { Authorization: 'Bearer owner' } })
  const list = (await res.json()).documents ?? []
  return Promise.all(list.map((d: { name: string }) => getDoc(d.name.split('/documents/')[1]))) as Promise<Record<string, any>[]>
}
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const ANA = 'ana@example.com', BEN = 'ben@example.com', MAANIK = 'maanik@example.com', OWNER = 'alexisricordi@gmail.com'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  // These tests cover the booking rules themselves; the approval step (owner, Nov 2) is tested in requests.test.ts.
  await put('app_settings/schedule', { instantBookers: [{ email: ANA, name: 'Ana' }, { email: BEN, name: 'Ben' }] })
})

const feed = async (url: string) => (await fetch(url)).text()

describe('calendar links', () => {
  it('your link lists only your booked shoots; the same link is reused; a reset kills the old one', async () => {
    await call('bookShoot', { place: 'cliff1', date: FRI, start: 780, kind: 'monthly' }, ANA)
    await call('bookShoot', { place: 'cliff2', date: FRI, start: 1380 }, BEN)
    const link = await call('myCalendarLink', {}, ANA)
    expect(link.ok, link.message).toBe(true)
    expect(link.result.webcal).toMatch(/^webcal:/)
    const ics = await feed(link.result.url)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`DTSTART;TZID=America/Toronto:${FRI.replace(/-/g, '')}T130000`)
    expect(ics).toContain('SUMMARY:Shoot · Cliff 1')
    expect(ics).not.toContain('Cliff 2')
    expect((await call('myCalendarLink', {}, ANA)).result.url).toBe(link.result.url)
    const fresh = await call('myCalendarLink', { reset: true }, ANA)
    expect(fresh.result.url).not.toBe(link.result.url)
    expect(await feed(link.result.url)).toMatch(/no longer valid/)
  })

  it("the schedule team's link lists everyone's shoots, including after midnight", async () => {
    await call('bookShoot', { place: 'cliff1', date: FRI, start: 780 }, ANA)
    await call('bookShoot', { place: 'cliff2', date: FRI, start: 1380 }, BEN)
    const ics = await feed((await call('myCalendarLink', {}, MAANIK)).result.url)
    expect(ics).toContain('SUMMARY:Ana · Cliff 1')
    expect(ics).toContain('SUMMARY:Ben · Cliff 2')
    expect(ics).toContain(`DTEND;TZID=America/Toronto:${addDays(FRI, 1).replace(/-/g, '')}T010000`)
  })

  it('a link stops working when the person is deactivated, and follows their role today', async () => {
    await call('bookShoot', { place: 'cliff1', date: FRI, start: 780 }, ANA)
    await call('bookShoot', { place: 'cliff2', date: FRI, start: 1380 }, BEN)
    const url = (await call('myCalendarLink', {}, MAANIK)).result.url
    await put(`users/${MAANIK}`, { email: MAANIK, role: 'creator', active: true, name: 'Maanik' })
    const asCreator = await feed(url)
    expect(asCreator).not.toContain('Ana · Cliff 1')
    expect(asCreator).toContain('My shoots')
    await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: false, name: 'Maanik' })
    expect(await feed(url)).toMatch(/no longer valid/)
  })

  it('a made-up link shows nothing', async () => {
    const base = (await call('myCalendarLink', {}, ANA)).result.url.split('?')[0]
    expect(await feed(`${base}?t=${'0'.repeat(36)}`)).toMatch(/no longer valid/)
  })

  it('the connection test needs a calendar ID first, and only the team can run it', async () => {
    expect((await call('testCalendarLink', {}, MAANIK)).error).toBe('PERMISSION_DENIED')   // calendar connection = the owner's (Oct 20)
    expect((await call('testCalendarLink', {}, OWNER)).message).toMatch(/Calendar ID/)
    expect((await call('testCalendarLink', {}, ANA)).error).toBe('PERMISSION_DENIED')
  })
})

describe('importing the existing calendar', () => {
  it('previews events with guesses, then imports a shoot (keeping its Google event) and a block; imported ones disappear', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('users/jana@example.com', { email: 'jana@example.com', role: 'creator', active: true, name: 'Jana' })
    const p = await call('previewCalendarImport', {}, OWNER)
    expect(p.ok, p.message).toBe(true)
    const [shoot, block] = p.result.events
    expect(shoot.guess).toMatchObject({ action: 'shoot', email: 'jana@example.com', house: 'cliff1', start: 780 })
    expect(block.guess.action).toBe('block')
    const r = await call('applyCalendarImport', { items: [
      { id: shoot.id, action: 'shoot', email: 'jana@example.com', house: 'cliff1', date: shoot.date, start: 780 },
      { id: block.id, action: 'block', house: 'cliff1', type: 'cleaners', date: block.date, start: block.startMin, end: block.endMin, title: block.title },
    ] }, OWNER)
    expect(r.result.results.every((x: { ok: boolean }) => x.ok)).toBe(true)
    expect((await call('previewCalendarImport', {}, OWNER)).result.events).toHaveLength(0)
    expect((await call('previewCalendarImport', {}, ANA)).error).toBe('PERMISSION_DENIED')
    // The equipment team sorts imports too (owner, Nov 4); the calendar connection stays the owner's.
    expect((await call('previewCalendarImport', {}, MAANIK)).result.events).toHaveLength(0)
    expect((await call('checkCalendarNow', {}, MAANIK)).error).toBeUndefined()
  })

  it('old events keep their real hours (fill every slot they touch) and overlapping ones are imported as a clash', async () => {
    const day = FRI
    const r = await call('applyCalendarImport', { items: [
      { id: 'odd1', action: 'shoot', email: ANA, house: 'cliff2', date: day, start: 870, end: 1020 },   // 2:30–5 PM
      { id: 'odd2', action: 'shoot', email: BEN, house: 'cliff2', date: day, start: 900, end: 1020 },   // 3–5 PM, same house
    ] }, OWNER)
    expect(r.result.results.every((x: { ok: boolean }) => x.ok)).toBe(true)
    expect(r.result.results[1].message).toMatch(/CLASH with Ana/)
    const d = (await getDoc(`schedule_days/${day}`))!
    expect(d.cliff2['780'].email).toBe(ANA)            // 1–3 slot held: it overlaps 2:30–3
    expect(d.cliff2['900'].email).toBe(ANA)
    expect(d.cliff2['900'].time).toEqual({ start: 870, end: 1020 })
    expect(d.clashes).toHaveLength(1)
    expect(d.clashes[0]).toMatchObject({ house: 'cliff2', slot: '900', name: 'Ben' })
    // Nobody can book over the imported shoot.
    expect((await call('bookShoot', { place: 'cliff2', date: day, start: 780 }, BEN)).ok).toBe(false)
    // Cancelling it frees her slots, and Ben's shoot that was clashing underneath takes the 3–5 slot (audit, Nov 5).
    const ana = (await getDoc(`schedule_days/${day}`))!.cliff2['900'].shootId
    expect((await call('cancelShoot', { id: ana }, MAANIK)).ok).toBe(true)
    const after = (await getDoc(`schedule_days/${day}`))!
    expect(after.cliff2['780']).toBeUndefined()
    expect(after.cliff2['900'].email).toBe(BEN)
    expect(after.clashes).toHaveLength(0)
    expect((await getDoc(`shoots/${ana}`))!.start).toBe(870)
  })
})

describe('shared calendar copies', () => {
  it('a booking goes in right away, a cancel takes it out; old imported events are never touched', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    const b = await call('bookShoot', { place: 'cliff1', date: FRI, start: 780 }, ANA)
    expect(b.ok, b.message).toBe(true)
    const cal = async () => (await call('calendarPending', {}, OWNER)).result
    await waitFor(async () => (await cal()).sent.length === 1)
    expect((await cal()).pending).toHaveLength(0)
    expect((await call('calendarPending', {}, ANA)).error).toBe('PERMISSION_DENIED')
    // Cancel → out of the calendar.
    await call('cancelShoot', { id: b.result.id }, MAANIK)
    await waitFor(async () => (await cal()).sent.length === 0)
    // An old imported event never goes through the app's copy.
    await call('applyCalendarImport', { items: [{ id: 'old1', action: 'shoot', email: BEN, house: 'cliff2', date: FRI, start: 870, end: 1020 }] }, OWNER)
    await new Promise(r => setTimeout(r, 2500))
    const c = await cal()
    expect([...c.sent, ...c.pending].filter((x: { label: string }) => /Ben/.test(x.label))).toHaveLength(0)
  })
})

// Toronto's offset on FRI (summer time -04:00, winter -05:00 from early November).
const TZ = (() => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${FRI}T12:00:00Z`)).find(x => x.type === 'timeZoneName')!.value   // e.g. "GMT-5"
  return `-0${name.replace('GMT-', '')}:00`
})()

describe('importing again', () => {
  it('shows events changed or deleted in Google Calendar; changes move the app copy, deletes take it off', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    const ev = (start: string, end: string, title = 'Ana - Cliff 2') => ({ id: 'man1', summary: title, start: { dateTime: `${FRI}T${start}:00${TZ}` }, end: { dateTime: `${FRI}T${end}:00${TZ}` } })
    await put('test_calendar/events', { items: [ev('13:00', '15:00')] })
    const p1 = (await call('previewCalendarImport', {}, OWNER)).result.events
    expect(p1[0].kind).toBe('new')
    await call('applyCalendarImport', { items: [{ id: 'man1', action: 'shoot', email: ANA, house: 'cliff2', date: FRI, start: 780, end: 900, title: 'Ana - Cliff 2' }] }, OWNER)
    expect((await call('previewCalendarImport', {}, OWNER)).result.events).toHaveLength(0)
    // Someone moves it in Google Calendar to 3:30–5:30.
    await put('test_calendar/events', { items: [ev('15:30', '17:30')] })
    const p2 = (await call('previewCalendarImport', {}, OWNER)).result.events
    expect(p2[0]).toMatchObject({ kind: 'changed', startMin: 930, was: { startMin: 780 } })
    await call('applyCalendarImport', { items: [{ id: 'man1', action: 'shoot', email: ANA, house: 'cliff2', date: FRI, start: 930, end: 1050, title: 'Ana - Cliff 2' }] }, OWNER)
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff2['780']).toBeUndefined()
    const id = d.cliff2['900'].shootId
    expect(d.cliff2['1020'].shootId).toBe(id)
    expect((await getDoc(`shoots/${id}`))!.start).toBe(930)
    // Deleted in Google Calendar.
    await put('test_calendar/events', { items: [] })
    const p3 = (await call('previewCalendarImport', {}, OWNER)).result.events
    expect(p3[0]).toMatchObject({ kind: 'removed', id: 'man1' })
    await call('applyCalendarImport', { items: [{ id: 'man1', action: 'remove', date: FRI }] }, OWNER)
    expect((await getDoc(`shoots/${id}`))!.status).toBe('cancelled')
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff2['900']).toBeUndefined()
    expect((await call('previewCalendarImport', {}, OWNER)).result.events).toHaveLength(0)
  })
})

describe('automatic calendar check', () => {
  it('follows changes and deletions of imported events by itself, and counts new ones for a person to sort', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    const ev = (id: string, start: string, end: string) => ({ id, summary: 'Ana - Cliff 1', start: { dateTime: `${FRI}T${start}:00${TZ}` }, end: { dateTime: `${FRI}T${end}:00${TZ}` } })
    await put('test_calendar/events', { items: [ev('a1', '13:00', '15:00')] })
    await call('applyCalendarImport', { items: [{ id: 'a1', action: 'shoot', email: ANA, house: 'cliff1', date: FRI, start: 780, end: 900, title: 'Ana - Cliff 1' }] }, OWNER)
    // Moved in Google Calendar + a brand-new event added there.
    await put('test_calendar/events', { items: [ev('a1', '17:00', '19:00'), ev('new1', '09:00', '11:00')] })
    const r = await call('checkCalendarNow', {}, OWNER)
    expect(r.ok, r.message).toBe(true)
    // The new one names Ana and Cliff 1, so it's clear enough to come in by itself (owner, Nov 1).
    expect(r.result).toMatchObject({ changed: 1, removed: 0, newEvents: 0, broughtIn: 1 })
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff1['780']).toBeUndefined()
    expect(d.cliff1['1020'].email).toBe(ANA)
    expect(d.cliff1['540'].email).toBe(ANA)
    expect((await call('checkCalendarNow', {}, ANA)).error).toBe('PERMISSION_DENIED')
  })

  it('brings in CLEAR new events from an old calendar by itself; unclear ones wait', async () => {
    const OLD = 'old@group.calendar.google.com'
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: OLD, name: 'Old', house: 'any' }] })
    await put('test_calendar/events', { items: [] })
    const at = (id: string, summary: string, location: string, s: string, e: string) => ({ id, summary, location, start: { dateTime: `${FRI}T${s}:00${TZ}` }, end: { dateTime: `${FRI}T${e}:00${TZ}` } })
    await put(`test_calendar/${OLD.replace(/[^a-zA-Z0-9]/g, '_')}`, { items: [
      at('clear1', 'Ana filming', '2375 Cliff Road', '13:00', '15:00'),
      at('clear2', 'Cleaners', '2371 Cliff Road', '07:00', '09:00'),
      at('unsure', 'Meeting', '', '17:00', '19:00'),
    ] })
    const r = await call('checkCalendarNow', {}, OWNER)
    expect(r.ok, r.message).toBe(true)
    expect(r.result).toMatchObject({ broughtIn: 2, newEvents: 1 })
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff1['780'].email).toBe(ANA)
    expect(d.blocks.some((b: any) => b.house === 'cliff2' && b.type === 'cleaners')).toBe(true)
  })
})


describe('Requests → Google Calendar tab (owner, Nov 4: every import waits for the equipment team)', () => {
  it('puts what it can read on the schedule "to check", holds the creator\'s notice until confirmed; fix and skip work', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com', instantBookers: [{ email: ANA, name: 'Ana' }, { email: BEN, name: 'Ben' }] })
    const at = (id: string, summary: string, s: string, e: string) => ({ id, summary, location: summary === 'Meeting' ? '' : '2375 Cliff Road', start: { dateTime: `${FRI}T${s}:00${TZ}` }, end: { dateTime: `${FRI}T${e}:00${TZ}` } })
    await put('test_calendar/events', { items: [at('q1', 'Ana filming', '13:00', '15:00'), at('q2', 'Ana and Ben filming', '15:00', '19:00'), at('q3', 'Meeting', '19:00', '21:00')] })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    const q = await docs('calendar_queue')
    expect(q.length).toBe(3)
    expect(q.filter(x => x.placed).length).toBe(2)            // q3 names nobody: waits unplaced
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff1['780'].email).toBe(ANA)                    // already holding the time
    const sid = d.cliff1['780'].shootId
    expect((await getDoc(`shoots/${sid}`))!.toCheck).toBe(true)
    // Confirm → no longer to check, the creator is told.
    expect((await call('reviewCalendarImport', { id: 'q1', action: 'confirm' }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await getDoc(`shoots/${sid}`))!.toCheck === undefined)
    expect((await getDoc(`shoots/${sid}`))!.told).toBe(true)
    expect((await getDoc('calendar_queue/q1'))!.status).toBe('confirmed')
    // Fix the unreadable one: Ben's shoot.
    expect((await call('reviewCalendarImport', { id: 'q3', action: 'fix', fix: { action: 'shoot', emails: [BEN], house: 'cliff1', type: 'other', soft: false } }, MAANIK)).ok).toBe(true)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['1140'].email).toBe(BEN)
    // Skip the group one: taken off the schedule again.
    expect((await call('reviewCalendarImport', { id: 'q2', action: 'skip' }, MAANIK)).ok).toBe(true)
    const after = (await getDoc(`schedule_days/${FRI}`))!
    expect(after.cliff1['900']).toBeUndefined()
    expect(after.cliff1['1020']).toBeUndefined()
    expect((await docs('calendar_queue')).filter(x => x.status === 'waiting').length).toBe(0)
    // Already handled; creators can't touch it.
    expect((await call('reviewCalendarImport', { id: 'q1', action: 'confirm' }, MAANIK)).message).toMatch(/already handled/)
    expect((await call('reviewCalendarImport', { id: 'q1', action: 'confirm' }, ANA)).error).toBe('PERMISSION_DENIED')
  })
})

describe('old calendars (read only)', () => {
  it('reads each old calendar: its house, all-day events, a clash on a booked shoot alerts the team; a calendar taken off the list removes nothing', async () => {
    const C2 = 'cliff2cal@group.calendar.google.com', STR = 'stromedy@group.calendar.google.com'
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [
      { id: C2, name: 'Cliff 2', house: 'cliff2' }, { id: STR, name: 'Stromedy', house: 'any' }] })
    await put('test_calendar/events', { items: [] })
    const key = (id: string) => `test_calendar/${id.replace(/[^a-zA-Z0-9]/g, '_')}`
    await put(key(C2), { title: 'Cliff 2.0 bookings', items: [
      { id: 'c2a', summary: 'Ana shoot', start: { dateTime: `${FRI}T13:00:00${TZ}` }, end: { dateTime: `${FRI}T15:00:00${TZ}` } },
      // The address wins over the calendar's usual house (owner, Oct 30).
      { id: 'c2b', summary: 'Ben shoot', location: '2375 Cliff Road', start: { dateTime: `${FRI}T09:00:00${TZ}` }, end: { dateTime: `${FRI}T11:00:00${TZ}` } },
      { id: 'away1', summary: 'Valentyna away', start: { date: FRI }, end: { date: addDays(FRI, 1) } },
    ] })
    const SAT = addDays(FRI, 1), SUN = addDays(FRI, 2)
    await put(key(STR), { items: [
      { id: 'off1', summary: 'Stromedy off', start: { date: SAT }, end: { date: addDays(SUN, 1) } },   // two all-day days
      { id: 'st1', summary: 'Stromedy - Cliff 2', start: { dateTime: `${FRI}T17:00:00${TZ}` }, end: { dateTime: `${FRI}T19:00:00${TZ}` } },
    ] })
    const p = await call('previewCalendarImport', {}, OWNER)
    expect(p.ok, p.message).toBe(true)
    const byId = Object.fromEntries(p.result.events.map((e: any) => [e.id, e]))
    expect(byId.c2a).toMatchObject({ calendar: 'Cliff 2', kind: 'new', guess: { house: 'cliff2', action: 'shoot', email: ANA } })
    expect(byId.c2b.guess).toMatchObject({ house: 'cliff1', action: 'shoot', email: BEN })
    expect(byId.away1).toMatchObject({ kind: 'ignored', why: 'Someone away' })
    expect(p.result.calendars.find((c: any) => c.name === 'Cliff 2')).toMatchObject({ title: 'Cliff 2.0 bookings', found: 3, hidden: 1 })
    expect(byId[`off1_${SAT.replace(/-/g, '')}`]).toMatchObject({ calendar: 'Stromedy', allDay: true, startMin: 0, endMin: 1440 })
    expect(byId[`off1_${SUN.replace(/-/g, '')}`]).toBeTruthy()
    expect(byId.st1.guess).toMatchObject({ house: 'cliff2', action: 'block' })   // a house, nobody named → blocked time
    expect(byId[`off1_${SAT.replace(/-/g, '')}`].guess.action).toBe('skip')       // no house → waits for a person to pick

    // Ben already booked 5–7 PM at Cliff 2; Stromedy's time lands on top of it → clash, Ben's shoot stays, team is told.
    await call('bookShoot', { place: 'cliff2', date: FRI, start: 1020 }, BEN)
    const r = await call('applyCalendarImport', { items: [{ ...byId.st1, action: 'block', house: 'cliff2', type: 'other', start: 1020, end: 1140 }] }, OWNER)
    expect(r.result.results[0].message).toMatch(/CLASH with Ben/)
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff2['1020'].email).toBe(BEN)
    expect(d.clashes.some((c: any) => c.slot === '1020' && c.blockId)).toBe(true)
    const pushes = (await docs('push_log')).filter((x: any) => x.title === 'Calendar clash')
    expect(pushes[0].to).toEqual(expect.arrayContaining([MAANIK, OWNER]))
    const log = await call('previewCalendarImport', {}, OWNER)   // the imported one is gone from the list
    expect(log.result.events.some((e: any) => e.id === 'st1')).toBe(false)

    // Stromedy taken off the list: its imported block is NOT treated as deleted.
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: C2, name: 'Cliff 2', house: 'cliff2' }] })
    const p2 = (await call('previewCalendarImport', {}, OWNER)).result.events
    expect(p2.some((e: any) => e.id === 'st1')).toBe(false)
  })
})

describe('one booking, several creators (owner, Nov 4)', () => {
  it('guesses everyone named, lists Props-only creators, and splits the hours into back-to-back turns', async () => {
    const DEE = 'dee@example.com'
    await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('test_calendar/events', { items: [{ id: 'grp1', summary: 'Ben / Ana / Dee - Cliff 1', start: { dateTime: `${FRI}T13:00:00${TZ}` }, end: { dateTime: `${FRI}T19:00:00${TZ}` } }] })
    const pv = (await call('previewCalendarImport', {}, OWNER)).result
    expect(pv.people.map((p: any) => p.email)).toContain(DEE)
    expect(pv.events[0].guess.emails).toEqual([BEN, ANA, DEE])
    const r = await call('applyCalendarImport', { items: [{ id: 'grp1', action: 'shoot', email: BEN, emails: [BEN, ANA, DEE], house: 'cliff1', date: FRI, start: 780, end: 1140, title: 'Ben / Ana / Dee - Cliff 1' }] }, OWNER)
    expect(r.result.results[0]).toMatchObject({ ok: true })
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect([d.cliff1['780'].email, d.cliff1['900'].email, d.cliff1['1020'].email]).toEqual([BEN, ANA, DEE])
    const imp = (await getDoc('calendar_imports/grp1'))!
    expect(imp.shootIds).toHaveLength(3)
    // Taken back to one person later: the extra turns come off.
    await call('applyCalendarImport', { items: [{ id: 'grp1', action: 'shoot', email: BEN, house: 'cliff1', date: FRI, start: 780, end: 1140 }] }, OWNER)
    const d2 = (await getDoc(`schedule_days/${FRI}`))!
    expect([d2.cliff1['780'].email, d2.cliff1['900'].email, d2.cliff1['1020'].email]).toEqual([BEN, BEN, BEN])
    expect((await getDoc(`shoots/${imp.shootIds[1]}`))!.status).toBe('cancelled')
    // Ben keeps his own shoot (audit, Nov 7: every turn was cancelled and made again).
    expect(d2.cliff1['780'].shootId).toBe(imp.shootIds[0])
  })
})

describe('blocks the automatic check made before a creator could be matched (owner, Nov 5: Ariel\'s shoots missing)', () => {
  it('re-reads "<Name> - Stromedy Talent Filming" as that person\'s shoot; blocks a person chose stay blocks', async () => {
    const T1 = 'c_talent@group.calendar.google.com'
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: T1, name: 'Stromedy Talent (Cliff 1)', house: 'cliff1' }],
      instantBookers: [{ email: ANA, name: 'Ana' }, { email: BEN, name: 'Ben' }] })
    await put('test_calendar/events', { items: [] })
    const ev = (id: string, summary: string, s: string, e: string) => ({ id, summary, start: { dateTime: `${FRI}T${s}:00${TZ}` }, end: { dateTime: `${FRI}T${e}:00${TZ}` } })
    await put(`test_calendar/${T1.replace(/[^a-zA-Z0-9]/g, '_')}`, { items: [ev('ana1', 'Ana - Stromedy Talent Filming', '13:00', '15:00'), ev('ben1', 'Ben - Stromedy Talent Filming', '15:00', '17:00')] })
    // What Nov 2 left behind: both brought in as blocked time by the automatic check; Ben's was later checked by a person.
    const old = (id: string, title: string, s: number, by: string, extra = {}) => put(`calendar_imports/${id}`, {
      action: 'block', title, location: '', date: FRI, startMin: s, endMin: s + 120, feedId: T1, allDay: false, blockId: `g${id}`, house: 'cliff1', by, at: '2026-11-02T05:05:14Z', ...extra })
    await old('ana1', 'Ana - Stromedy Talent Filming', 780, 'calendar check')
    await old('ben1', 'Ben - Stromedy Talent Filming', 900, 'calendar check', { checkedBy: MAANIK })
    await put(`schedule_days/${FRI}`, { date: FRI, blocks: [
      { id: 'gana1', house: 'cliff1', start: 780, end: 900, type: 'other', note: 'Ana - Stromedy Talent Filming', by: 'calendar check', imported: true },
      { id: 'gben1', house: 'cliff1', start: 900, end: 1020, type: 'other', note: 'Ben - Stromedy Talent Filming', by: 'calendar check', imported: true }] })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff1?.['780']?.email).toBe(ANA)                         // Ana's shoot is back on the schedule
    expect(d.blocks.map((b: { id: string }) => b.id)).toEqual(['gben1'])   // her block is gone; Ben's (checked) stays
    const imp = (await getDoc('calendar_imports/ana1'))!
    expect(imp.action).toBe('shoot')
    expect((await getDoc(`shoots/${imp.shootId}`))!.toCheck).toBe(true)   // waits in the Calendar tab like any import
    expect((await getDoc('calendar_queue/ana1'))!.placed).toBe(true)
    // Once is enough: the next check changes nothing.
    await call('checkCalendarNow', {}, MAANIK)
    expect((await getDoc('calendar_imports/ana1'))!.shootId).toBe(imp.shootId)
  })
})

describe('"Offsite" in a one-house calendar (owner, Nov 5: Val / Sam / Preslea)', () => {
  it('new events go offsite at their real hours, and one the check already put at the house moves offsite', async () => {
    const T1 = 'c_talent2@group.calendar.google.com'
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: T1, name: 'Stromedy Talent (Cliff 1)', house: 'cliff1' }] })
    await put('test_calendar/events', { items: [] })
    const ev = (id: string, summary: string, s: string, e: string) => ({ id, summary, start: { dateTime: `${FRI}T${s}:00${TZ}` }, end: { dateTime: `${FRI}T${e}:00${TZ}` } })
    await put(`test_calendar/${T1.replace(/[^a-zA-Z0-9]/g, '_')}`, { items: [ev('off1', 'Ana - Offsite Filming', '10:00', '12:00'), ev('off2', 'Ben - Offsite Filming', '13:00', '15:00')] })
    const pv = (await call('previewCalendarImport', {}, OWNER)).result.events
    expect(pv.find((e: any) => e.id === 'off1').guess).toMatchObject({ action: 'shoot', house: 'offsite', start: 600 })
    // What the check did before this fix: Ben's at Cliff 1.
    const placed = await call('applyCalendarImport', { items: [{ id: 'off2', action: 'shoot', email: BEN, house: 'cliff1', date: FRI, start: 780, end: 900, title: 'Ben - Offsite Filming', feedId: T1 }] }, OWNER)
    expect(placed.ok, placed.message).toBe(true)
    const { checkedBy, checkedAt, ...imp } = (await getDoc('calendar_imports/off2'))!   // eslint-disable-line @typescript-eslint/no-unused-vars
    await put('calendar_imports/off2', { ...imp, by: 'calendar check' })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(Object.values(d.cliff1 ?? {}).some((x: any) => x.email === BEN)).toBe(false)
    expect(d.offsite.map((o: any) => [o.email, o.start])).toEqual(expect.arrayContaining([[ANA, 600], [BEN, 780]]))
    expect((await getDoc('calendar_imports/off2'))!.house).toBe('offsite')
  })
})

describe('Confirm all in the Calendar tab (owner, Nov 5)', () => {
  it('confirms every clean card it is given; clashes and unread ones stay waiting', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com' })
    const card = (id: string, extra: Record<string, unknown>) => put(`calendar_queue/${id}`, { title: id, location: '', date: FRI, startMin: 600, endMin: 720, allDay: false,
      calendar: 'App calendar', feedId: '', kind: 'new', guess: {}, status: 'waiting', at: '2026-11-05T10:00:00Z', ...extra })
    await card('ok1', { placed: true, result: { action: 'block', house: 'cliff1' } })
    await card('ok2', { placed: true, result: { action: 'block', house: 'cliff2' } })
    await card('clash1', { placed: true, result: { action: 'shoot', clashWith: ['Ana'] } })
    await card('unread1', { placed: false, result: {} })
    expect((await call('reviewCalendarImport', { action: 'confirmAll', ids: ['ok1'] }, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('reviewCalendarImport', { action: 'confirmAll', ids: ['ok1', 'ok2', 'clash1', 'unread1', 'nope'] }, MAANIK)
    expect(r.ok, r.message).toBe(true)
    expect(r.result).toMatchObject({ confirmed: 2, left: 2 })
    expect((await getDoc('calendar_queue/ok1'))!.status).toBe('confirmed')
    expect((await getDoc('calendar_queue/clash1'))!.status).toBe('waiting')
    expect((await getDoc('calendar_queue/unread1'))!.status).toBe('waiting')
  })
})

describe('calendar audit fixes (Nov 5)', () => {
  const STR = 'c_mixed@group.calendar.google.com'
  const key = (id: string) => `test_calendar/${id.replace(/[^a-zA-Z0-9]/g, '_')}`
  const ev = (id: string, summary: string, date: string, s: string, e: string) => ({ id, summary, start: { dateTime: `${date}T${s}:00${TZ}` }, end: { dateTime: `${date}T${e}:00${TZ}` } })

  it('a mixed calendar that does not say where, or a name two people share, waits for a person', async () => {
    await put('users/justin1@example.com', { email: 'justin1@example.com', role: 'creator', active: true, name: 'Justin Figs' })
    await put('users/justin2@example.com', { email: 'justin2@example.com', role: 'creator', active: true, name: 'Justin Show' })
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: STR, name: 'Stromedy', house: 'any' }] })
    await put('test_calendar/events', { items: [] })
    await put(key(STR), { items: [ev('m1', 'Ana filming', FRI, '13:00', '15:00'), ev('m2', 'Justin - Cliff 2', FRI, '15:00', '17:00'), ev('m3', 'Ben - Cliff 1', FRI, '13:00', '15:00')] })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    const d = (await getDoc(`schedule_days/${FRI}`)) ?? {}
    expect((d.offsite ?? []).length).toBe(0)                       // Ana not sent offsite by guess
    expect(d.cliff1?.['780']?.email).toBe(BEN)                      // a clear one still goes in
    expect(Object.keys(d.cliff2 ?? {})).toHaveLength(0)             // "Justin" could be two people
    expect((await getDoc('calendar_queue/m1'))!.placed).toBe(false)
    expect((await getDoc('calendar_queue/m2'))!.message).toMatch(/more than one person/)
  })

  it('an old automatic guess on a name two people share goes back to the team (it keeps holding the time)', async () => {
    await put('users/justin1@example.com', { email: 'justin1@example.com', role: 'creator', active: true, name: 'Justin Figs' })
    await put('users/justin2@example.com', { email: 'justin2@example.com', role: 'creator', active: true, name: 'Justin Show' })
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('test_calendar/events', { items: [ev('ju1', 'Justin - Cliff 1', FRI, '13:00', '15:00')] })
    // What the check did before: guessed the first Justin.
    await call('applyCalendarImport', { items: [{ id: 'ju1', action: 'shoot', email: 'justin1@example.com', house: 'cliff1', date: FRI, start: 780, end: 900, title: 'Justin - Cliff 1' }] }, OWNER)
    const { checkedBy, checkedAt, ...imp } = (await getDoc('calendar_imports/ju1'))!   // eslint-disable-line @typescript-eslint/no-unused-vars
    await put('calendar_imports/ju1', { ...imp, by: 'calendar check' })
    await call('checkCalendarNow', {}, MAANIK)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780'].email).toBe('justin1@example.com')
    expect(await getDoc('calendar_queue/ju1')).toMatchObject({ placed: false, status: 'waiting' })
    expect((await getDoc('calendar_queue/ju1'))!.message).toMatch(/more than one person/)
  })

  it('a group that cannot all be placed leaves nothing behind; Redo waits for a person', async () => {
    const r = await call('applyCalendarImport', { items: [{ id: 'g4', action: 'shoot', emails: [ANA, BEN, 'nobody@example.com'], house: 'cliff1', date: FRI, start: 780, end: 960, title: 'grp' }] }, OWNER)
    expect(r.result.results[0].ok).toBe(false)
    const d = (await getDoc(`schedule_days/${FRI}`)) ?? {}
    expect(Object.keys(d.cliff1 ?? {})).toHaveLength(0)
    // Redo: the 15-minute check doesn't place it again by itself.
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('test_calendar/events', { items: [ev('rd1', 'Ana - Cliff 1', FRI, '13:00', '15:00')] })
    await call('checkCalendarNow', {}, MAANIK)
    const shootId = (await getDoc('calendar_imports/rd1'))!.shootId
    expect((await call('redoCalendarImport', { shootId }, MAANIK)).ok).toBe(true)
    await call('checkCalendarNow', {}, MAANIK)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1?.['780']).toBeUndefined()
    expect((await getDoc('calendar_queue/rd1'))!.placed).toBe(false)
  })
})

describe('calendar audit fixes (Nov 7): props, groups, changes, keep', () => {
  const at = (id: string, summary: string, day: string, st: string, en: string) => ({ id, summary, location: '2375 Cliff Road', start: { dateTime: `${day}T${st}:00${TZ}` }, end: { dateTime: `${day}T${en}:00${TZ}` } })
  const props = (id: string, shootId: string) => put(`reservations/${id}`, { shootId, scheduleShootId: shootId, status: 'requested', itemIds: [], lines: [], history: [], creatorEmail: ANA, creatorName: 'Ana', title: 'Prank', startDate: FRI, endDate: FRI })

  it('a shoot deleted in Google: off the schedule at once, its props are only cancelled once the team confirms', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com', instantBookers: [{ email: ANA, name: 'Ana' }] })
    await put('test_calendar/events', { items: [at('p1', 'Ana filming', FRI, '13:00', '15:00')] })
    expect((await call('checkCalendarNow', {}, MAANIK)).ok).toBe(true)
    const sid = (await getDoc(`schedule_days/${FRI}`))!.cliff1['780'].shootId
    await props('r1', sid)
    await put('test_calendar/events', { items: [] })
    expect((await call('checkCalendarNow', {}, MAANIK)).ok).toBe(true)
    expect((await getDoc(`shoots/${sid}`))!.status).toBe('cancelled')
    expect((await getDoc('reservations/r1'))!.status).toBe('requested')
    expect((await call('reviewCalendarImport', { id: 'p1', action: 'confirm' }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await getDoc('reservations/r1'))!.status === 'cancelled')
  })

  it('a shoot moved to another day in Google while it has props is not moved; the card says why', async () => {
    const NEXT = addDays(FRI, 7)
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com', instantBookers: [{ email: ANA, name: 'Ana' }] })
    await put('test_calendar/events', { items: [at('p2', 'Ana filming', FRI, '13:00', '15:00')] })
    await call('applyCalendarImport', { items: [{ id: 'p2', action: 'shoot', email: ANA, house: 'cliff1', date: FRI, start: 780, end: 900, title: 'Ana filming' }] }, OWNER)
    const sid = (await getDoc('calendar_imports/p2'))!.shootId
    await props('r2', sid)
    await put('test_calendar/events', { items: [at('p2', 'Ana filming', NEXT, '13:00', '15:00')] })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    expect((await getDoc(`shoots/${sid}`))!.date).toBe(FRI)
    expect((await getDoc('reservations/r2'))!.status).toBe('requested')
    const card = (await getDoc('calendar_queue/p2'))!
    expect(card.placed).toBe(false)
    expect(card.problem).toMatch(/props or gear booked/)
  })

  it('a group booking that changes keeps each creator\'s own shoot (and props)', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await call('applyCalendarImport', { items: [{ id: 'g9', action: 'shoot', emails: [BEN, ANA], house: 'cliff1', date: FRI, start: 780, end: 1020, title: 'Ben & Ana' }] }, OWNER)
    const first = (await getDoc('calendar_imports/g9'))!.shootIds as string[]
    expect(first).toHaveLength(2)
    await props('r3', first[1])
    await call('applyCalendarImport', { items: [{ id: 'g9', action: 'shoot', emails: [BEN, ANA], house: 'cliff1', date: FRI, start: 900, end: 1140, title: 'Ben & Ana' }] }, OWNER)
    const second = (await getDoc('calendar_imports/g9'))!.shootIds as string[]
    expect(second).toEqual(first)
    expect((await getDoc(`shoots/${first[1]}`))!.status).toBe('booked')
    expect((await getDoc('reservations/r3'))!.status).toBe('requested')
  })

  it('a "Changed in Google" card cannot be skipped (it would cancel a booking)', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com', instantBookers: [{ email: ANA, name: 'Ana' }] })
    await put('test_calendar/events', { items: [at('c1', 'Ana filming', FRI, '13:00', '15:00')] })
    await call('checkCalendarNow', {}, MAANIK)
    expect((await call('reviewCalendarImport', { id: 'c1', action: 'confirm' }, MAANIK)).ok).toBe(true)
    await put('test_calendar/events', { items: [at('c1', 'Ana filming', FRI, '15:00', '17:00')] })
    await call('checkCalendarNow', {}, MAANIK)
    expect((await getDoc('calendar_queue/c1'))!.kind).toBe('changed')
    expect((await call('reviewCalendarImport', { id: 'c1', action: 'skip' }, MAANIK)).message).toMatch(/already on the schedule/)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['900'].email).toBe(ANA)
  })

  it('"Keep it in the app" for an event deleted in Google sticks', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('test_calendar/events', { items: [at('k1', 'Ana filming', FRI, '13:00', '15:00')] })
    await call('applyCalendarImport', { items: [{ id: 'k1', action: 'shoot', email: ANA, house: 'cliff1', date: FRI, start: 780, end: 900, title: 'Ana filming' }] }, OWNER)
    const sid = (await getDoc('calendar_imports/k1'))!.shootId
    await put('test_calendar/events', { items: [] })
    expect((await call('previewCalendarImport', {}, OWNER)).result.events[0]).toMatchObject({ kind: 'removed', id: 'k1' })
    await call('applyCalendarImport', { items: [{ id: 'k1', action: 'keep', date: FRI }] }, OWNER)
    await call('checkCalendarNow', {}, MAANIK)
    expect((await getDoc(`shoots/${sid}`))!.status).toBe('booked')
    expect((await call('previewCalendarImport', {}, OWNER)).result.events).toHaveLength(0)
  })
})
