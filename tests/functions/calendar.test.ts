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
    // Cancelling it frees both slots; the clash listing for Ben stays until his is sorted out.
    const ana = (await getDoc(`schedule_days/${day}`))!.cliff2['900'].shootId
    expect((await call('cancelShoot', { id: ana }, MAANIK)).ok).toBe(true)
    const after = (await getDoc(`schedule_days/${day}`))!
    expect(after.cliff2['780']).toBeUndefined()
    expect(after.cliff2['900']).toBeUndefined()
    expect(after.clashes).toHaveLength(1)
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
    expect(r.result).toMatchObject({ changed: 1, removed: 0, newEvents: 1 })
    const d = (await getDoc(`schedule_days/${FRI}`))!
    expect(d.cliff1['780']).toBeUndefined()
    expect(d.cliff1['1020'].email).toBe(ANA)
    expect(d.cliff1['540']).toBeUndefined()   // the new one waits for a person
    expect((await getDoc('app_settings/calendarCheck'))!.newEvents).toBe(1)
    expect((await call('checkCalendarNow', {}, ANA)).error).toBe('PERMISSION_DENIED')
  })
})


describe('old calendars (read only)', () => {
  it('reads each old calendar: its house, all-day events, a clash on a booked shoot alerts the team; a calendar taken off the list removes nothing', async () => {
    const C2 = 'cliff2cal@group.calendar.google.com', STR = 'stromedy@group.calendar.google.com'
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [
      { id: C2, name: 'Cliff 2', house: 'cliff2' }, { id: STR, name: 'Stromedy', house: 'any' }] })
    await put('test_calendar/events', { items: [] })
    const key = (id: string) => `test_calendar/${id.replace(/[^a-zA-Z0-9]/g, '_')}`
    await put(key(C2), { items: [{ id: 'c2a', summary: 'Ana shoot', start: { dateTime: `${FRI}T13:00:00${TZ}` }, end: { dateTime: `${FRI}T15:00:00${TZ}` } }] })
    const SAT = addDays(FRI, 1), SUN = addDays(FRI, 2)
    await put(key(STR), { items: [
      { id: 'off1', summary: 'Stromedy off', start: { date: SAT }, end: { date: addDays(SUN, 1) } },   // two all-day days
      { id: 'st1', summary: 'Stromedy - Cliff 2', start: { dateTime: `${FRI}T17:00:00${TZ}` }, end: { dateTime: `${FRI}T19:00:00${TZ}` } },
    ] })
    const p = await call('previewCalendarImport', {}, OWNER)
    expect(p.ok, p.message).toBe(true)
    const byId = Object.fromEntries(p.result.events.map((e: any) => [e.id, e]))
    expect(byId.c2a).toMatchObject({ calendar: 'Cliff 2', kind: 'new', guess: { house: 'cliff2', action: 'shoot', email: ANA } })
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
