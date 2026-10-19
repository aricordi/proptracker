// Owner rule (Oct 18): a creator books ONE 2-hour house slot a day (both houses together). Only the schedule
// team can give someone more (by booking it for them). Offsite shoots don't count.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const MAANIK = 'maanik@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
const SAT = addDays(FRI, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
})
const book = (who: string, data: Record<string, unknown>) => call('bookShoot', { place: 'cliff2', date: FRI, start: 780, ...data }, who)

describe('one house slot a day', () => {
  it('a second slot the same day is refused, at either house', async () => {
    expect((await book(ANA, {})).ok).toBe(true)
    const again = await book(ANA, { start: 900 })
    expect(again.error).toBe('FAILED_PRECONDITION')
    expect(again.message).toMatch(/one 2-hour slot a day/)
    expect((await book(ANA, { place: 'cliff1', start: 1020 })).message).toMatch(/one 2-hour slot a day/)
    expect((await book(ANA, { date: SAT })).ok).toBe(true)   // another day is fine
  })

  it('two taps at once still give only one slot', async () => {
    const [a, b] = await Promise.all([book(ANA, {}), book(ANA, { start: 900 })])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  })

  it('offsite shoots do not count', async () => {
    expect((await book(ANA, { place: 'offsite', start: 600, end: 720, where: 'The park' })).ok).toBe(true)
    expect((await book(ANA, {})).ok).toBe(true)
  })

  it('the schedule team can add more (manually allowed)', async () => {
    expect((await book(ANA, {})).ok).toBe(true)
    expect((await book(MAANIK, { start: 900, forEmail: ANA })).ok).toBe(true)
  })

  it('moving onto a day where you already film is refused; moving within the day is fine', async () => {
    const a = await book(ANA, {}), b = await book(ANA, { date: SAT })
    expect((await call('moveShoot', { id: b.result.id, place: 'cliff2', date: FRI, start: 1140 }, ANA)).message).toMatch(/one 2-hour slot a day/)
    expect((await call('moveShoot', { id: a.result.id, place: 'cliff1', date: FRI, start: 1140 }, ANA)).ok).toBe(true)
  })

  it('a swap that would give someone two slots on one day is refused', async () => {
    const mine = await book(ANA, {}), mine2 = await book(ANA, { date: SAT })
    const bens = await book(BEN, { start: 1140 })
    const req = await call('requestSwap', { myShootId: mine2.result.id, theirShootId: bens.result.id }, ANA)
    expect(req.ok).toBe(true)
    expect((await call('answerSwap', { id: req.result.id, accept: true }, BEN)).message).toMatch(/Ana already has a house slot/)
    expect(mine.ok).toBe(true)
  })

  it('booking with a friend: one slot each, and a friend who already films that day is refused', async () => {
    expect((await call('bookWithFriends', { place: 'cliff2', date: FRI, start: 780, friends: [BEN], mySlots: 2 }, ANA)).message).toMatch(/one 2-hour slot a day/)
    expect((await book(BEN, { place: 'cliff1', start: 1260 })).ok).toBe(true)
    expect((await call('bookWithFriends', { place: 'cliff2', date: FRI, start: 780, friends: [BEN], mySlots: 1 }, ANA)).message).toMatch(/Ben already has a house slot/)
    const ok = await call('bookWithFriends', { place: 'cliff2', date: SAT, start: 780, friends: [BEN], mySlots: 1 }, ANA)
    expect(ok.ok, ok.message).toBe(true)
    expect((await getDoc(`schedule_days/${SAT}`))!.cliff2['900'].hold).toBeTruthy()
    // While Ben's slot is held for him, he can't book a different one that day either.
    expect((await book(BEN, { date: SAT, start: 1260 })).message).toMatch(/one 2-hour slot a day/)
  })

  it('the limit is a setting the team can change', async () => {
    await put('app_settings/schedule', { slotsPerDay: 2 })
    expect((await book(ANA, {})).ok).toBe(true)
    expect((await book(ANA, { start: 900 })).ok).toBe(true)
    expect((await book(ANA, { start: 1020 })).ok).toBe(false)
  })
})

describe('arts department does not book', () => {
  it('arts cannot book shoots, props or gear (they handle the requests)', async () => {
    await put('users/arts@example.com', { email: 'arts@example.com', role: 'arts', active: true, name: 'Arty' })
    const day = addDays(todayInStudio(), 9)
    expect((await call('bookShoot', { place: 'cliff2', date: day, start: 780 }, 'arts@example.com')).error).toBe('PERMISSION_DENIED')
    expect((await call('createReservation', { title: 'x', startDate: day, endDate: day, lines: [] }, 'arts@example.com')).error).toBe('PERMISSION_DENIED')
    expect((await call('createGearBooking', { title: 'x', date: day, start: 600, end: 720, lines: [] }, 'arts@example.com')).error).toBe('PERMISSION_DENIED')
  })
})
