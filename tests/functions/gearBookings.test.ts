// Gear bookings: instant holds by the hour, no double-booking, cancel/decline.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', GEAR = 'gb-team@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com'
// A weekday a few days out (not Sunday, which is closed by default).
let DAY = addDays(todayInStudio(), 4)
if (weekday(DAY) === 0) DAY = addDays(DAY, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put('gear_bundles/fx3', { name: 'FX3 Bundle', kind: 'bundle', category: 'Camera', archived: false,
    pieces: [{ itemId: 'cam', qty: 1, name: 'Sony FX3 body' }, { itemId: 'bat', qty: 2, name: 'NP-FZ100 battery' }] })
  await put('gear_bundles/sand', { name: 'Sandbag', kind: 'extra', category: 'Grip', archived: false, pieces: [{ itemId: 'sb', qty: 5, name: 'Sandbag' }] })
})

const book = (who: string, start: number, end: number, lines: unknown, date = DAY) =>
  call('createGearBooking', { title: 'Shoot', date, start, end, lines }, who)

describe('holding gear', () => {
  it('a creator holds a bundle and extras; the booking keeps what was in the case', async () => {
    const r = await book(ANA, 600, 1080, [{ offerId: 'fx3', qty: 1 }, { offerId: 'sand', qty: 3 }])
    expect(r.ok).toBe(true)
    const b = (await getDoc(`gear_bookings/${r.result.id}`))!
    expect(b).toMatchObject({ creatorEmail: ANA, creatorName: 'Ana', status: 'held', date: DAY, start: 600, end: 1080, from: `${DAY}T10:00`, to: `${DAY}T18:00` })
    expect(b.lines[0]).toMatchObject({ offerId: 'fx3', kind: 'bundle', qty: 1, pieces: [{ itemId: 'cam', qty: 1, name: 'Sony FX3 body' }, { itemId: 'bat', qty: 2, name: 'NP-FZ100 battery' }] })
    expect(b.lines[1]).toMatchObject({ offerId: 'sand', kind: 'extra', qty: 3 })
    expect((await getDoc('gear_holds/fx3'))!.entries).toEqual([{ bookingId: r.result.id, from: `${DAY}T10:00`, to: `${DAY}T18:00`, qty: 1 }])
  })

  it('no double-booking: overlapping hours are refused, back-to-back is fine', async () => {
    expect((await book(ANA, 600, 960, [{ offerId: 'fx3', qty: 1 }])).ok).toBe(true)
    const clash = await book(BEN, 900, 1080, [{ offerId: 'fx3', qty: 1 }])
    expect(clash.error).toBe('FAILED_PRECONDITION')
    expect(clash.message).toMatch(/taken for those hours/)
    expect((await book(BEN, 960, 1200, [{ offerId: 'fx3', qty: 1 }])).ok).toBe(true)
  })

  it('two creators racing for the same bundle: exactly one gets it', async () => {
    const [a, b] = await Promise.all([book(ANA, 600, 900, [{ offerId: 'fx3', qty: 1 }]), book(BEN, 660, 960, [{ offerId: 'fx3', qty: 1 }])])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect((await getDoc('gear_holds/fx3'))!.entries).toHaveLength(1)
  })

  it('extras: only as many as are offered, across bookings', async () => {
    expect((await book(ANA, 600, 900, [{ offerId: 'sand', qty: 4 }])).ok).toBe(true)
    const r = await book(BEN, 700 - 10, 960, [{ offerId: 'sand', qty: 2 }])
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/Only 1 "Sandbag" free/)
    expect((await book(BEN, 690, 960, [{ offerId: 'sand', qty: 1 }])).ok).toBe(true)
  })

  it('a bundle is whole: never more than one', async () => {
    expect((await book(ANA, 600, 900, [{ offerId: 'fx3', qty: 2 }])).error).toBe('INVALID_ARGUMENT')
  })

  it('creators need 1 open day of notice; the owner does not', async () => {
    const today = todayInStudio()
    expect((await book(ANA, 1380, 1410, [{ offerId: 'fx3', qty: 1 }], today)).error).toBe('FAILED_PRECONDITION')
    // Owner can book later today (the last half hour of the day is always in the future unless it's 11:30 PM+).
    const r = await book(OWNER, 1410, 1440, [{ offerId: 'fx3', qty: 1 }], today)
    expect(r.ok || r.message?.includes('already passed')).toBe(true)
  })

  it('refuses gear that is not offered, and the equipment team cannot book', async () => {
    await put('gear_bundles/old', { name: 'Old', kind: 'bundle', archived: true, pieces: [] })
    expect((await book(ANA, 600, 900, [{ offerId: 'old', qty: 1 }])).error).toBe('FAILED_PRECONDITION')
    expect((await book(GEAR, 600, 900, [{ offerId: 'fx3', qty: 1 }])).error).toBe('PERMISSION_DENIED')
  })
})

describe('cancel and decline', () => {
  it('the creator (or the team) can cancel; other creators cannot; the gear becomes free', async () => {
    const r = await book(ANA, 600, 900, [{ offerId: 'fx3', qty: 1 }])
    expect((await call('cancelGearBooking', { id: r.result.id }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('cancelGearBooking', { id: r.result.id }, ANA)).ok).toBe(true)
    expect((await getDoc(`gear_bookings/${r.result.id}`))!.status).toBe('cancelled')
    expect((await getDoc('gear_holds/fx3'))!.entries).toEqual([])
    expect((await book(BEN, 600, 900, [{ offerId: 'fx3', qty: 1 }])).ok).toBe(true)
    expect((await call('cancelGearBooking', { id: r.result.id }, ANA)).error).toBe('FAILED_PRECONDITION')
  })

  it('only the equipment team (or owner) declines, and must say why', async () => {
    const r = await book(ANA, 600, 900, [{ offerId: 'fx3', qty: 1 }])
    expect((await call('declineGearBooking', { id: r.result.id, reason: 'x' }, ANA)).error).toBe('PERMISSION_DENIED')
    expect((await call('declineGearBooking', { id: r.result.id, reason: '' }, GEAR)).error).toBe('INVALID_ARGUMENT')
    expect((await call('declineGearBooking', { id: r.result.id, reason: 'Camera in for repair' }, GEAR)).ok).toBe(true)
    expect(await getDoc(`gear_bookings/${r.result.id}`)).toMatchObject({ status: 'declined', declineReason: 'Camera in for repair' })
  })
})

describe('bundles that are booked', () => {
  beforeEach(async () => {
    await put('gear_items/cam', { name: 'Sony FX3 body', category: 'Camera', have: 1, archived: false })
    await put('gear_items/bat', { name: 'NP-FZ100 battery', category: 'Power', have: 4, archived: false })
  })
  it("what's in a booked bundle can't change, and it can't be archived; its name can", async () => {
    await book(ANA, 600, 900, [{ offerId: 'fx3', qty: 1 }])
    const change = await call('saveGearBundle', { id: 'fx3', name: 'FX3 Bundle', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 3 }] }, GEAR)
    expect(change.error).toBe('FAILED_PRECONDITION')
    expect((await call('saveGearBundle', { id: 'fx3', name: 'FX3 Cinema Bundle', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 2 }] }, GEAR)).ok).toBe(true)
    expect((await call('setGearBundleArchived', { id: 'fx3', archived: true }, GEAR)).error).toBe('FAILED_PRECONDITION')
  })
  it('renaming a piece updates the bundles that contain it', async () => {
    expect((await call('saveGearItem', { id: 'bat', name: 'NP-FZ100 battery (Sony)', category: 'Power', have: 4 }, GEAR)).ok).toBe(true)
    expect((await getDoc('gear_bundles/fx3'))!.pieces[1]).toMatchObject({ itemId: 'bat', name: 'NP-FZ100 battery (Sony)' })
  })
})

describe('one shoot: props + gear linked', () => {
  it('both halves keep the same shoot link; junk links are ignored', async () => {
    await put('items/lamp', { collection: 'company', name: 'Lamp', quantity: 1, condition: 'good', tags: [], photos: [] })
    const g = await call('createGearBooking', { title: 'Shoot', date: DAY, start: 600, end: 900, lines: [{ offerId: 'fx3', qty: 1 }], shootId: 'sabc123xyz' }, OWNER)
    const r = await call('createReservation', { title: 'Shoot', startDate: DAY, endDate: DAY, notes: '', lines: [{ itemId: 'lamp', qty: 1 }], builds: [], shootId: 'sabc123xyz' }, OWNER)
    expect(r.ok).toBe(true)
    expect((await getDoc(`gear_bookings/${g.result.id}`))!.shootId).toBe('sabc123xyz')
    expect((await getDoc(`reservations/${r.result.id}`))!.shootId).toBe('sabc123xyz')
    const bad = await call('createGearBooking', { title: 'X', date: DAY, start: 960, end: 1020, lines: [{ offerId: 'fx3', qty: 1 }], shootId: 'no spaces/allowed' }, OWNER)
    expect((await getDoc(`gear_bookings/${bad.result.id}`))!.shootId).toBeUndefined()
  })
})
