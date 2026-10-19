// Owner (Oct 19): an admin can do what creators, the arts department and the equipment team can, but nothing
// owner-only (money, AI budget, bulk tools, personal props) and not the schedule settings / calendar connection.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ADMIN = 'sam@example.com'
const DAY = addDays(todayInStudio(), 9)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
})

describe('admin role', () => {
  it('books like a creator and works the gear and schedule like the team', async () => {
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 780 }, ADMIN)).ok).toBe(true)
    expect((await call('saveGearItem', { name: 'Battery', category: 'Power', have: 2 }, ADMIN)).ok).toBe(true)
    expect((await call('addScheduleBlock', { date: DAY, house: 'cliff1', start: 420, end: 540, type: 'cleaners' }, ADMIN)).ok).toBe(true)
    expect((await call('listSchedulePeople', {}, ADMIN)).ok).toBe(true)
  })
  it('cannot use owner-only tools or change the schedule settings / calendar connection', async () => {
    for (const fn of ['costReport', 'cleanUpPhotos', 'rebuildSearchIndex']) expect((await call(fn, {}, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('saveScheduleSettings', { slotsPerDay: 3 }, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('testCalendarLink', {}, ADMIN)).error).toBe('PERMISSION_DENIED')
    expect((await call('previewCalendarImport', {}, ADMIN)).error).toBe('PERMISSION_DENIED')
  })
})
