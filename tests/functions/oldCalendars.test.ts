// Owner, Nov 16: until everyone is on the app, approved app bookings are ALSO written into the old Google calendars
// (by house, in their own title style), edits there come back into the app, and a shoot that came from an old calendar
// is changed there when it's moved or cancelled in the app. Newest change wins.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, waitFor, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { oldCalendarFor, oldTitle, defaultTitleStyle } from '../../functions/src/schedule'

const ANA = 'ana@example.com', BEN = 'ben@example.com', MAANIK = 'maanik@example.com'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
const APP = 'app@group.calendar.google.com', T1 = 'c_talent@group.calendar.google.com', C2 = 'c_cliff2@group.calendar.google.com', MIX = 'c_stromedy@group.calendar.google.com'
const key = (c: string) => c.replace(/[^a-zA-Z0-9]/g, '_')
const TZ = (() => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${FRI}T12:00:00Z`)).find(x => x.type === 'timeZoneName')!.value
  return `-0${name.replace('GMT-', '')}:00`
})()
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00${TZ}`
const feeds = [{ id: T1, name: 'Stromedy Talent', house: 'cliff1' }, { id: C2, name: 'Cliff 2', house: 'cliff2' }, { id: MIX, name: 'Stromedy', house: 'any' }]
const appCopies = async (cal: string) => ((await getDoc(`test_calendar/${key(cal)}_app`))?.items ?? []) as any[]

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  for (const c of [T1, C2, MIX]) await put(`test_calendar/${key(c)}`, { items: [] })
  await put('test_calendar/events', { items: [] })
})
const settings = (on: boolean, extra: Record<string, unknown> = {}) => put('app_settings/schedule', { googleCalendarId: APP, calendarFeeds: feeds, writeOldCalendars: on,
  instantBookers: [{ email: ANA, name: 'Ana' }], ...extra })
const book = async (who: string, place: string, start: number) => {
  const r = await call('bookShoot', { place, date: FRI, start, ...(place === 'offsite' ? { end: start + 120, where: 'The park' } : {}) }, who)
  expect(r.ok, r.message).toBe(true)
  const sid = String(r.result.id)
  return { sid, eid: 's' + Buffer.from(sid).toString('hex') }
}

describe('which old calendar, which title (pure)', () => {
  it('house calendars for the houses, Cliff 2 for offsite (OFFSITE); their title style', () => {
    const s = { calendarFeeds: feeds as any, googleCalendarId: APP }
    expect(oldCalendarFor(s, 'cliff1')!.id).toBe(T1)
    expect(oldCalendarFor(s, 'cliff2')!.id).toBe(C2)
    expect(oldCalendarFor(s, 'offsite')!.id).toBe(C2)
    expect(oldCalendarFor({ calendarFeeds: [feeds[0]] as any, googleCalendarId: APP }, 'offsite')).toBeNull()
    expect(oldTitle(feeds[1] as any, 'Ariel', 'offsite')).toBe('Ariel - Cliff 2 Filming (OFFSITE)')
    expect(oldTitle(feeds[0] as any, 'Ariel')).toBe('Ariel - Stromedy Talent Filming')
    expect(oldTitle({ ...feeds[1], titleStyle: '{name} Filming' } as any, 'Ariel')).toBe('Ariel Filming')
    expect(defaultTitleStyle('any')).toContain('{name}')
  })
})

describe('app bookings go into the old calendars', () => {
  it('off by default: nothing is written there', async () => {
    await settings(false)
    const { eid } = await book(ANA, 'cliff1', 780)
    await waitFor(async () => !!(await getDoc(`calendar_sent/${eid}`)))
    expect(await appCopies(T1)).toEqual([])
    expect(await getDoc(`calendar_mirror/${eid}`)).toBeNull()
  })

  it('on: each place goes to its calendar in their style, and the check never imports them back', async () => {
    await settings(true)
    const a = await book(ANA, 'cliff1', 780)
    const b = await book(ANA, 'offsite', 600)
    await waitFor(async () => (await appCopies(T1)).length === 1 && (await appCopies(C2)).length === 1)
    const ev = (await appCopies(T1))[0]
    expect(ev).toMatchObject({ id: a.eid, summary: 'Ana - Stromedy Talent Filming' })
    expect(ev.start.dateTime.slice(11, 16)).toBe('13:00')
    expect((await appCopies(C2))[0]).toMatchObject({ id: b.eid, summary: 'Ana - Cliff 2 Filming (OFFSITE)' })
    expect(await appCopies(MIX)).toEqual([])
    expect(await getDoc(`calendar_mirror/${a.eid}`)).toMatchObject({ cal: T1, from: `${FRI}T13:00`, to: `${FRI}T15:00` })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    expect(await getDoc(`calendar_imports/${a.eid}`)).toBeNull()
    expect(r.result.appCalendar).toMatchObject({ moved: 0, cancelled: 0 })
  })

  it('a request is only written once it is approved', async () => {
    await settings(true, { instantBookers: [] })
    const { sid, eid } = await book(BEN, 'cliff2', 780)
    expect((await getDoc(`shoots/${sid}`))!.status).toBe('requested')
    await new Promise(r => setTimeout(r, 1500))
    expect(await appCopies(C2)).toEqual([])
    expect((await call('decideBooking', { id: sid, approve: true }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await appCopies(C2)).some(e => e.id === eid))
    expect((await appCopies(C2))[0].summary).toBe('Ben - Cliff 2 Filming')
  })

  it('cancelled in the app: taken out of the old calendar; moved to the other house: changes calendar', async () => {
    await settings(true)
    const a = await book(ANA, 'cliff1', 780)
    await waitFor(async () => (await appCopies(T1)).length === 1)
    expect((await call('moveShoot', { id: a.sid, place: 'cliff2', date: FRI, start: 1020 }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await appCopies(C2)).length === 1 && (await appCopies(T1)).length === 0)
    expect((await appCopies(C2))[0].start.dateTime.slice(11, 16)).toBe('17:00')
    expect((await call('cancelShoot', { id: a.sid }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await appCopies(C2)).length === 0)
    expect(await getDoc(`calendar_mirror/${a.eid}`)).toBeNull()
  })

  it('moved by a person in the old calendar: the shoot moves and the app calendar follows', async () => {
    await settings(true)
    const { sid, eid } = await book(ANA, 'cliff1', 780)
    await waitFor(async () => (await appCopies(T1)).length === 1 && !!(await getDoc(`calendar_sent/${eid}`)))
    const items = await appCopies(T1)
    await put(`test_calendar/${key(T1)}_app`, { items: items.map(e => ({ ...e, start: { dateTime: at(FRI, '17:00') }, end: { dateTime: at(FRI, '19:00') }, updated: new Date().toISOString() })) })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.result.appCalendar).toMatchObject({ moved: 1 })
    expect((await getDoc(`shoots/${sid}`))!).toMatchObject({ status: 'booked', start: 1020, place: 'cliff1' })
    await waitFor(async () => (await getDoc(`calendar_sent/${eid}`))!.from === `${FRI}T17:00`)
    expect((await call('checkCalendarNow', {}, MAANIK)).result.appCalendar).toMatchObject({ moved: 0, cancelled: 0 })
  })

  it('deleted by a person in the old calendar: the shoot is cancelled (no strike)', async () => {
    await settings(true)
    const { sid } = await book(ANA, 'cliff1', 780)
    await waitFor(async () => (await appCopies(T1)).length === 1)
    await put(`test_calendar/${key(T1)}_app`, { items: [] })
    expect((await call('checkCalendarNow', {}, MAANIK)).result.appCalendar).toMatchObject({ cancelled: 1 })
    const sh = (await getDoc(`shoots/${sid}`))!
    expect(sh.status).toBe('cancelled')
    expect(sh.noShow).toBeUndefined()
  })
})

describe('shoots that came from an old calendar are changed there too', () => {
  const imported = async () => {
    await put(`test_calendar/${key(T1)}`, { items: [{ id: 'orig1', summary: 'Ana - Stromedy Talent Filming', start: { dateTime: at(FRI, '13:00') }, end: { dateTime: at(FRI, '15:00') } }] })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    const imp = (await getDoc('calendar_imports/orig1'))!
    const sid = String(imp.shootIds?.[0] ?? imp.shootId)
    expect((await getDoc(`shoots/${sid}`))!.status).toBe('booked')
    return sid
  }
  const original = async (cal = T1) => (((await getDoc(`test_calendar/${key(cal)}`))?.items ?? []) as any[]).find(e => e.id === 'orig1')

  it('moved in the app: the original event moves; the next check sees nothing new', async () => {
    await settings(true)
    const sid = await imported()
    expect((await call('moveShoot', { id: sid, place: 'cliff1', date: FRI, start: 1020 }, MAANIK)).ok).toBe(true)
    await waitFor(async () => (await original())?.start.dateTime.slice(11, 16) === '17:00')
    expect((await original()).summary).toBe('Ana - Stromedy Talent Filming')
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.result).toMatchObject({ changed: 0, removed: 0 })
    expect((await getDoc(`shoots/${sid}`))!).toMatchObject({ status: 'booked', start: 1020 })
  })

  it('moved to the other house in the app: the original moves to that house\'s calendar', async () => {
    await settings(true)
    const sid = await imported()
    expect((await call('moveShoot', { id: sid, place: 'cliff2', date: FRI, start: 1020 }, MAANIK)).ok).toBe(true)
    await waitFor(async () => !!(await original(C2)) && !(await original(T1)))
    expect((await getDoc('calendar_imports/orig1'))!).toMatchObject({ feedId: C2, house: 'cliff2', startMin: 1020 })
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.result).toMatchObject({ changed: 0, removed: 0 })
    expect((await getDoc(`shoots/${sid}`))!).toMatchObject({ status: 'booked', place: 'cliff2' })
  })

  it('cancelled in the app: the original event is deleted and nothing comes back', async () => {
    await settings(true)
    const sid = await imported()
    expect((await call('cancelShoot', { id: sid }, MAANIK)).ok).toBe(true)
    await waitFor(async () => !(await original()))
    expect((await getDoc('calendar_imports/orig1'))!.removed).toBe(true)
    const r = await call('checkCalendarNow', {}, MAANIK)
    expect(r.result).toMatchObject({ removed: 0, newEvents: 0 })
    expect((await getDoc(`shoots/${sid}`))!.status).toBe('cancelled')
  })

  it('switch off: the original is left alone', async () => {
    await settings(false)
    const sid = await imported()
    expect((await call('moveShoot', { id: sid, place: 'cliff1', date: FRI, start: 1020 }, MAANIK)).ok).toBe(true)
    await new Promise(r => setTimeout(r, 1500))
    expect((await original()).start.dateTime.slice(11, 16)).toBe('13:00')
  })
})

describe('access check', () => {
  it('the team can see where the app may write; creators cannot ask', async () => {
    await settings(false)
    expect((await call('checkCalendarAccess', {}, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('checkCalendarAccess', {}, MAANIK)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.calendars.map((c: any) => c.canWrite)).toEqual([true, true, true, true])
  })
})
