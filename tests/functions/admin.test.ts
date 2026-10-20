// Owner (Oct 20): an admin is a VIEWER who manages the creators. They book their own shoots like a creator, see
// everything the arts department and the equipment team see, and handle strikes and pauses. They can't change props,
// gear, the queues, the schedule (blocks) or any setting other than the booking rules.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase, getDoc } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ADMIN = 'sam@example.com', CREATOR = 'riley@example.com', ARTS = 'arts@example.com', GEAR = 'gear@example.com'
const DAY = addDays(todayInStudio(), 9)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true, name: 'Riley' })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true, name: 'Maanik' })
})

describe('admin role', () => {
  it('books their own shoot like a creator, but cannot change gear or the schedule', async () => {
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 780 }, ADMIN)).ok).toBe(true)
    expect((await call('saveGearItem', { name: 'Light', category: 'Lighting', have: 2 }, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('addScheduleBlock', { date: DAY, house: 'cliff1', start: 420, end: 540, type: 'cleaners' }, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('bookShoot', { place: 'cliff1', date: addDays(DAY, 1), start: 420, forEmail: CREATOR }, ADMIN)).error).toBe('PERMISSION_DENIED')
  })
  it('cannot use owner-only tools or change the schedule settings / calendar connection', async () => {
    for (const fn of ['costReport', 'cleanUpPhotos', 'rebuildSearchIndex', 'importInfo']) expect((await call(fn, {}, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('saveScheduleSettings', { slotsPerDay: 3 }, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('testCalendarLink', {}, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('previewCalendarImport', {}, ADMIN)).error).toBe('PERMISSION_DENIED')
  })
  it('gives and removes strikes and pauses creators, always with a reason; others cannot', async () => {
    expect((await call('giveStrike', { email: CREATOR, about: 'gear', note: '' }, ADMIN)).error).toBe('INVALID_ARGUMENT')
    for (const who of [ARTS, GEAR, CREATOR]) expect((await call('giveStrike', { email: CREATOR, about: 'gear', note: 'Late' }, who)).error).toBe('PERMISSION_DENIED')
    const one = await call('giveStrike', { email: CREATOR, about: 'gear', note: 'Brought the kit back a day late' }, ADMIN)
    expect(one.result).toMatchObject({ strikes: 1, paused: false })
    const two = await call('giveStrike', { email: CREATOR, about: 'props', note: 'Lost the cop hat' }, ADMIN)
    expect(two.result).toMatchObject({ strikes: 2, paused: true })   // default: 2 strikes in 30 days
    expect((await getDoc(`strikes/${two.result.id}`))).toMatchObject({ reason: 'manual', about: 'props', note: 'Lost the cop hat', by: ADMIN })

    // Taking one off drops below the limit, so the automatic pause lifts. The strike stays on record as removed.
    const off = await call('removeStrike', { id: two.result.id, note: 'Found the hat' }, ADMIN)
    expect(off.result).toMatchObject({ strikes: 1, lifted: true })
    expect((await getDoc(`strikes/${two.result.id}`))).toMatchObject({ removedBy: ADMIN, removeNote: 'Found the hat' })
    expect((await call('removeStrike', { id: two.result.id, note: 'again' }, ADMIN)).error).toBe('FAILED_PRECONDITION')
    expect((await getDoc(`user_status/${CREATOR}`))?.pausedUntil ?? null).toBeNull()

    // A pause started by hand stays even when strikes drop.
    expect((await call('pauseCreator', { email: CREATOR, days: 0, note: 'x y z' }, ADMIN)).error).toBe('INVALID_ARGUMENT')
    const p = await call('pauseCreator', { email: CREATOR, days: 7, note: 'Two no-shows in a row' }, ADMIN)
    expect(p.result.pausedUntil).toBe(addDays(todayInStudio(), 7))
    await call('removeStrike', { id: one.result.id, note: 'Fair enough' }, ADMIN)
    expect((await getDoc(`user_status/${CREATOR}`))).toMatchObject({ pausedUntil: addDays(todayInStudio(), 7), manualPause: true })
    expect((await call('liftPause', { email: CREATOR }, ADMIN)).ok).toBe(true)
    expect((await getDoc(`user_status/${CREATOR}`))?.pausedUntil ?? null).toBeNull()
  })
})
