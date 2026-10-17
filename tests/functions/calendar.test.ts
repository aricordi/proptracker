// "Add to my calendar" links: a private feed of your shoots (the team's lists everyone's).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const ANA = 'ana@example.com', BEN = 'ben@example.com', MAANIK = 'maanik@example.com'
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
    expect((await call('testCalendarLink', {}, MAANIK)).message).toMatch(/Calendar ID/)
    expect((await call('testCalendarLink', {}, ANA)).error).toBe('PERMISSION_DENIED')
  })
})

describe('importing the existing calendar', () => {
  it('previews events with guesses, then imports a shoot (keeping its Google event) and a block; imported ones disappear', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
    await put('users/jana@example.com', { email: 'jana@example.com', role: 'creator', active: true, name: 'Jana' })
    const p = await call('previewCalendarImport', {}, MAANIK)
    expect(p.ok, p.message).toBe(true)
    const [shoot, block] = p.result.events
    expect(shoot.guess).toMatchObject({ action: 'shoot', email: 'jana@example.com', house: 'cliff1', start: 780 })
    expect(block.guess.action).toBe('block')
    const r = await call('applyCalendarImport', { items: [
      { id: shoot.id, action: 'shoot', email: 'jana@example.com', house: 'cliff1', date: shoot.date, start: 780 },
      { id: block.id, action: 'block', house: 'cliff1', type: 'cleaners', date: block.date, start: block.startMin, end: block.endMin, title: block.title },
    ] }, MAANIK)
    expect(r.result.results.every((x: { ok: boolean }) => x.ok)).toBe(true)
    expect((await call('previewCalendarImport', {}, MAANIK)).result.events).toHaveLength(0)
    expect((await call('previewCalendarImport', {}, ANA)).error).toBe('PERMISSION_DENIED')
  })
})
