// Test launch (owner, Oct 27): creators in demo mode ("Props only") can search the props, nothing else.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', DEMO = 'demo@example.com', FULL = 'full@example.com', GEAR = 'demo-gear@example.com'
let day = addDays(todayInStudio(), 10); while (weekday(day) === 0 || weekday(day) === 4 || weekday(day) === 6) day = addDays(day, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${DEMO}`, { email: DEMO, name: 'Dee', role: 'creator', active: true, access: 'props' })
  await put(`users/${FULL}`, { email: FULL, name: 'Fran', role: 'creator', active: true, access: 'full' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
})

describe('demo mode (Props only)', () => {
  it('a creator with no access set is in demo mode too', async () => {
    await put('users/new@example.com', { email: 'new@example.com', role: 'creator', active: true, access: null })
    const r = await call('bookShoot', { place: 'cliff2', date: day, start: 780 }, 'new@example.com')
    expect(r.error).toBe('PERMISSION_DENIED')
  })
  it('refuses booking shoots, props and gear, the AI and the friend list, with a plain message', async () => {
    for (const [name, data] of [['bookShoot', { place: 'cliff2', date: day, start: 780 }], ['createReservation', { title: 'x', startDate: day, endDate: day, lines: [{ itemId: 'a', qty: 1 }] }],
      ['createGearBooking', { title: 'x', date: day, start: 600, end: 720, lines: [{ offerId: 'a', qty: 1 }] }], ['askForTime', { text: 'two hours next week' }],
      ['listFilmingFriends', {}], ['myCalendarLink', {}]] as [string, object][]) {
      const r = await call(name, data, DEMO)
      expect(r.error, name).toBe('PERMISSION_DENIED')
      expect(r.message, name).toMatch(/search and browse the props/)
    }
  })
  it('still allows searching props and notifications', async () => {
    expect((await call('searchSimilar', { query: 'a scary mask' }, DEMO)).error).toBeUndefined()
    expect((await call('registerPush', { token: 'x'.repeat(40), platform: 'web' }, DEMO)).error).toBeUndefined()
  })
  it('a Full app creator books normally', async () => {
    expect((await call('bookShoot', { place: 'cliff2', date: day, start: 780 }, FULL)).result).toHaveProperty('id')
  })
  it('demo creators are not offered as friends or bookable people, and the team cannot book for them', async () => {
    const friends = (await call('listFilmingFriends', {}, FULL)).result.people.map((p: { email: string }) => p.email)
    expect(friends).not.toContain(DEMO)
    const people = (await call('listSchedulePeople', {}, GEAR)).result.people.map((p: { email: string }) => p.email)
    expect(people).toEqual(expect.arrayContaining([FULL, OWNER]))
    expect(people).not.toContain(DEMO)
    const r = await call('bookShoot', { place: 'cliff2', date: day, start: 780, forEmail: DEMO }, GEAR)
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/Props only/)
  })
})
