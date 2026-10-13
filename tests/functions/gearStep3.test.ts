// Gear step 3: pickup check (in the window), return photo, team check-in, late.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const GEAR = 's3-team@example.com', ANA = 's3-ana@example.com', BEN = 's3-ben@example.com'
const PHOTO = 'https://example.com/return.jpg'
const lines = [{ offerId: 'fx3', kind: 'bundle', name: 'FX3 Bundle', qty: 1, photo: null,
  pieces: [{ itemId: 'cam', qty: 1, name: 'Sony FX3 body' }, { itemId: 'bat', qty: 2, name: 'NP-FZ100 battery' }] }]

// A booking whose times are relative to now (minutes): starts in `startIn`, lasts `len`.
async function booking(id: string, who: string, startIn: number, len: number, status = 'held', extra: Record<string, unknown> = {}) {
  const from = addMinutes(nowStamp(), startIn), to = addMinutes(from, len)
  await put(`gear_bookings/${id}`, { title: 'Shoot', creatorEmail: who, creatorName: who, date: from.slice(0, 10), start: 0, end: 60,
    from, to, pickupDay: from.slice(0, 10), closedDay: false, lines, offerIds: ['fx3'], status, history: [], createdAt: from, ...extra })
  return { from, to }
}

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true })
  await put('gear_bundles/fx3', { name: 'FX3 Bundle', kind: 'bundle', category: 'Camera', archived: false, pieces: lines[0].pieces })
})

describe('pickup check', () => {
  it('opens 30 minutes before the start, not earlier', async () => {
    await booking('early', ANA, 120, 60)
    const r = await call('pickUpGear', { id: 'early', missing: [], signed: true }, ANA)
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/Pickup opens at/)
  })

  it('the creator ticks, reports a missing battery, signs; it goes on the previous holder\'s record', async () => {
    // Ben had it before and returned it (the team never checked it in).
    await put('gear_bookings/before', { title: 'Earlier', creatorEmail: BEN, status: 'returned', offerIds: ['fx3'], lines,
      from: addMinutes(nowStamp(), -600), to: addMinutes(nowStamp(), -300), history: [] })
    await booking('now', ANA, 20, 120)
    expect((await call('pickUpGear', { id: 'now', missing: [], signed: true }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('pickUpGear', { id: 'now', missing: [] }, ANA)).error).toBe('INVALID_ARGUMENT')   // must sign
    const r = await call('pickUpGear', { id: 'now', missing: ['fx3|bat|2'], signed: true }, ANA)
    expect(r.ok).toBe(true)
    const b = (await getDoc('gear_bookings/now'))!
    expect(b.status).toBe('out')
    expect(b.pickup.missing).toEqual([{ offerId: 'fx3', itemId: 'bat', name: 'NP-FZ100 battery', qty: 1 }])
    expect(b.alerts).toHaveLength(1)
    expect((await getDoc('gear_bookings/before'))!.problems[0]).toMatchObject({ kind: 'missing_after', itemId: 'bat', qty: 1, reportedOn: 'now' })
    expect((await getDoc('gear_bundles/fx3'))!.missing[0]).toMatchObject({ itemId: 'bat', name: 'NP-FZ100 battery', qty: 1, bookingId: 'now' })
    expect((await call('pickUpGear', { id: 'now', missing: [], signed: true }, ANA)).error).toBe('FAILED_PRECONDITION')   // only once
  })

  it('"Found it" takes the warning off the bundle (team only)', async () => {
    await put('gear_bundles/fx3', { name: 'FX3 Bundle', kind: 'bundle', archived: false, pieces: lines[0].pieces,
      missing: [{ itemId: 'bat', name: 'NP-FZ100 battery', qty: 1, at: 'x', bookingId: 'b' }] })
    expect((await call('markGearFound', { offerId: 'fx3', index: 0 }, ANA)).error).toBe('PERMISSION_DENIED')
    expect((await call('markGearFound', { offerId: 'fx3', index: 0 }, GEAR)).ok).toBe(true)
    expect((await getDoc('gear_bundles/fx3'))!.missing).toEqual([])
  })
})

describe('return and check-in', () => {
  it('return needs a photo, frees the gear, and the team checks it in', async () => {
    await booking('out1', ANA, -60, 180, 'out')
    await put('gear_holds/fx3', { entries: [{ bookingId: 'out1', from: 'a', to: 'z', qty: 1 }, { bookingId: 'other', from: 'a', to: 'z', qty: 1 }] })
    expect((await call('returnGear', { id: 'out1', photos: [] }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('returnGear', { id: 'out1', photos: [PHOTO] }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('returnGear', { id: 'out1', photos: [PHOTO] }, ANA)).ok).toBe(true)
    const b = (await getDoc('gear_bookings/out1'))!
    expect(b).toMatchObject({ status: 'returned', returnedLate: false, return: { photos: [PHOTO] } })
    expect((await getDoc('gear_holds/fx3'))!.entries.map((e: { bookingId: string }) => e.bookingId)).toEqual(['other'])

    expect((await call('checkInGear', { id: 'out1', missing: [] }, ANA)).error).toBe('PERMISSION_DENIED')
    expect((await call('checkInGear', { id: 'out1', missing: ['fx3|cam|1'], note: 'Body missing!' }, GEAR)).ok).toBe(true)
    const c = (await getDoc('gear_bookings/out1'))!
    expect(c.status).toBe('checked_in')
    expect(c.problems[0]).toMatchObject({ kind: 'missing_at_checkin', itemId: 'cam', qty: 1 })
    expect((await getDoc('gear_bundles/fx3'))!.missing[0]).toMatchObject({ itemId: 'cam', bookingId: 'out1' })
  })

  it('late: returned after the due time is marked late, and late creators cannot book more gear', async () => {
    await booking('late1', ANA, -300, 120, 'out')   // ended 3 hours ago
    let day = addDays(todayInStudio(), 4); if (weekday(day) === 0) day = addDays(day, 1)
    const r = await call('createGearBooking', { title: 'Next', date: day, start: 600, end: 660, lines: [{ offerId: 'fx3', qty: 1 }] }, ANA)
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/late coming back/)
    expect((await call('returnGear', { id: 'late1', photos: [PHOTO] }, ANA)).ok).toBe(true)
    expect((await getDoc('gear_bookings/late1'))!.returnedLate).toBe(true)
    expect((await call('createGearBooking', { title: 'Next', date: day, start: 600, end: 660, lines: [{ offerId: 'fx3', qty: 1 }] }, ANA)).ok).toBe(true)
  })
})
