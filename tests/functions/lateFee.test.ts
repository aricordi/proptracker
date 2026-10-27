// Late return fee (owner, Oct 27): gear keeps its value, and a late return records how late, the value and who had it last.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const GEAR = 'lf-team@example.com', ANA = 'lf-ana@example.com', BEN = 'lf-ben@example.com'
const PHOTO = 'https://example.com/return.jpg'
const pieces = [{ itemId: 'cam', qty: 1, name: 'Sony FX3 body', value: 4500 }, { itemId: 'bat', qty: 2, name: 'NP-FZ100 battery', value: 80 }]
const lines = [{ offerId: 'fx3', kind: 'bundle', name: 'FX3 Bundle', qty: 1, photo: null, pieces }]

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
  await put(`users/${ANA}`, { email: ANA, name: 'Ana', role: 'creator', active: true })
  await put(`users/${BEN}`, { email: BEN, name: 'Ben', role: 'creator', active: true })
})

describe('gear values', () => {
  it('a piece value is copied onto its bundle, and a booking keeps the value from booking time', async () => {
    const cam = await call('saveGearItem', { name: 'Sony FX3 body', category: 'Camera', have: 1, value: 4500 }, GEAR)
    const bat = await call('saveGearItem', { name: 'NP-FZ100 battery', category: 'Power', have: 4 }, GEAR)
    const kit = await call('saveGearBundle', { name: 'FX3 kit', category: 'Camera', pieces: [{ itemId: cam.result.id, qty: 1 }, { itemId: bat.result.id, qty: 2 }] }, GEAR)
    let b = (await getDoc(`gear_bundles/${kit.result.id}`))!
    expect(b.pieces.map((p: { value: number | null }) => p.value)).toEqual([4500, null])
    // Setting the battery's value updates the bundle too.
    await call('saveGearItem', { id: bat.result.id, name: 'NP-FZ100 battery', category: 'Power', have: 4, value: 80 }, GEAR)
    b = (await getDoc(`gear_bundles/${kit.result.id}`))!
    expect(b.pieces.map((p: { value: number | null }) => p.value)).toEqual([4500, 80])

    let day = addDays(todayInStudio(), 5); if (weekday(day) === 0) day = addDays(day, 1)
    const r = await call('createGearBooking', { title: 'Shoot', date: day, start: 600, end: 720, lines: [{ offerId: kit.result.id, qty: 1 }] }, ANA)
    const g = (await getDoc(`gear_bookings/${r.result.id}`))!
    expect(g).toMatchObject({ value: 4660, valueMissing: 0 })
    expect(g.lines[0].pieces.map((p: { value: number }) => p.value)).toEqual([4500, 80])
  })
})

describe('late record', () => {
  async function outBooking(id: string, endedMinutesAgo: number, extra: Record<string, unknown> = {}) {
    const to = addMinutes(nowStamp(), -endedMinutesAgo), from = addMinutes(to, -120)
    await put(`gear_bookings/${id}`, { title: 'Shoot', creatorEmail: ANA, creatorName: 'Ana', date: from.slice(0, 10), start: 0, end: 60, from, to,
      pickupDay: from.slice(0, 10), closedDay: false, lines, offerIds: ['fx3'], status: 'out', value: 4660, valueMissing: 0, history: [], createdAt: from, ...extra })
    return to
  }
  it('on time: no late record', async () => {
    await outBooking('ok', 10)
    expect((await call('returnGear', { id: 'ok', photos: [PHOTO] }, ANA)).ok).toBe(true)
    const b = (await getDoc('gear_bookings/ok'))!
    expect(b.returnedLate).toBe(false)
    expect(b.late).toBeUndefined()
  })
  it('late: how late, the value and who returned it (the last person to have it)', async () => {
    const to = await outBooking('late', 125)
    expect((await call('returnGear', { id: 'late', photos: [PHOTO] }, ANA)).ok).toBe(true)
    const b = (await getDoc('gear_bookings/late'))!
    expect(b.returnedLate).toBe(true)
    expect(b.late).toMatchObject({ dueAt: to, by: ANA, byName: 'Ana', value: 4660, valueMissing: 0, feePercent: 10 })
    expect(b.late.minutes).toBeGreaterThanOrEqual(124)
    expect(b.late.minutes).toBeLessThanOrEqual(127)
  })
  it('shared gear: the friend who returns it is the last person to have it; the team returning it puts it on whoever signed', async () => {
    const crew = { crew: [{ email: BEN, name: 'Ben', shootId: 'x' }], crewEmails: [BEN], crewShootIds: ['x'] }
    await outBooking('shared', 90, { ...crew, pickup: { at: 'x', by: ANA, missing: [] } })
    expect((await call('returnGear', { id: 'shared', photos: [PHOTO], usedBy: [ANA, BEN] }, BEN)).ok).toBe(true)
    expect((await getDoc('gear_bookings/shared'))!.late).toMatchObject({ by: BEN, byName: 'Ben' })

    await outBooking('team', 90, { ...crew, pickup: { at: 'x', by: BEN, missing: [] } })
    expect((await call('returnGear', { id: 'team', photos: [PHOTO] }, GEAR)).ok).toBe(true)
    expect((await getDoc('gear_bookings/team'))!.late).toMatchObject({ by: BEN, byName: 'Ben' })
  })
  it('an older booking without a saved value still gets the value from its pieces', async () => {
    await outBooking('old', 60, { value: null, valueMissing: null })
    expect((await call('returnGear', { id: 'old', photos: [PHOTO] }, ANA)).ok).toBe(true)
    expect((await getDoc('gear_bookings/old'))!.late).toMatchObject({ value: 4660, valueMissing: 0 })
  })
})
