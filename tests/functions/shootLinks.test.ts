// Props and gear added to a shoot on the schedule; cutoffs; cancelling or moving the shoot.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, addOpenDays, DEFAULT_BOOKING_SETTINGS } from '../../functions/src/booking'

const ANA = 'ana@example.com', BEN = 'ben@example.com'
const today = todayInStudio()
const DAY = addDays(today, 8)      // far enough for every cutoff
const OTHER = addDays(today, 9)

async function shoot(id: string, email: string, name: string, date = DAY, start = 780, status = 'booked') {
  await put(`shoots/${id}`, { creatorEmail: email, creatorName: name, place: 'cliff1', where: '', date, month: date.slice(0, 7), start, end: start + 120,
    from: `${date}T13:00`, to: `${date}T15:00`, kind: 'extra', status, bookedBy: email, createdAt: '2026-01-01T00:00:00.000Z', history: [] })
  await put(`schedule_days/${date}`, { date, cliff1: { [String(start)]: { shootId: id, name, email, kind: 'extra' } } })
}

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put('items/chairs', { name: 'Diner chair', quantity: 4, condition: 'good', collection: 'company', archived: false })
  await put('gear_bundles/fx3', { name: 'FX3 kit', kind: 'bundle', archived: false, pieces: [{ itemId: 'g1', qty: 1, name: 'FX3' }] })
})

describe('adding props and gear to a shoot', () => {
  it('props and gear go on the shoot\'s day, link to it and show in its history', async () => {
    await shoot('shoot1', ANA, 'Ana')
    const wrong = await call('createReservation', { title: 'x', startDate: OTHER, endDate: OTHER, lines: [{ itemId: 'chairs', qty: 1 }], scheduleShootId: 'shoot1' }, ANA)
    expect(wrong.message).toMatch(/its day/)
    const p = await call('createReservation', { title: 'Diner', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 2 }], scheduleShootId: 'shoot1' }, ANA)
    expect(p.ok).toBe(true)
    expect(await getDoc(`reservations/${p.result.id}`)).toMatchObject({ shootId: 'shoot1', scheduleShootId: 'shoot1' })
    const g = await call('createGearBooking', { title: 'Diner', date: DAY, start: 780, end: 900, lines: [{ offerId: 'fx3', qty: 1 }], scheduleShootId: 'shoot1' }, ANA)
    expect(g.ok).toBe(true)
    expect((await getDoc(`gear_bookings/${g.result.id}`))!.shootId).toBe('shoot1')
    expect((await getDoc('shoots/shoot1'))!.history.map((h: any) => h.action)).toEqual(['props-added', 'gear-added'])
  })

  it('only your own booked shoot', async () => {
    await shoot('shoot1', ANA, 'Ana')
    expect((await call('createReservation', { title: 'x', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 1 }], scheduleShootId: 'shoot1' }, BEN)).error).toBe('PERMISSION_DENIED')
    await shoot('shoot1', ANA, 'Ana', DAY, 780, 'cancelled')
    expect((await call('createReservation', { title: 'x', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 1 }], scheduleShootId: 'shoot1' }, ANA)).message).toMatch(/cancelled/)
  })
})

describe('cutoffs (open days before the shoot)', () => {
  it('props 2, new props 4, gear 2 by default', async () => {
    expect(DEFAULT_BOOKING_SETTINGS.leadTimeDays).toBe(2)
    expect(DEFAULT_BOOKING_SETTINGS.buildLeadDays).toBe(4)
    const two = addOpenDays(today, 2, DEFAULT_BOOKING_SETTINGS), three = addOpenDays(today, 3, DEFAULT_BOOKING_SETTINGS)
    expect((await call('createReservation', { title: 'x', startDate: two, endDate: two, lines: [{ itemId: 'chairs', qty: 1 }] }, ANA)).ok).toBe(true)
    const build = await call('createReservation', { title: 'x', startDate: three, endDate: three, lines: [], builds: [{ description: 'Giant donut', qty: 1 }] }, ANA)
    expect(build.message).toMatch(/New props .* 4 open days/)
    const one = addOpenDays(today, 1, DEFAULT_BOOKING_SETTINGS)
    expect((await call('createGearBooking', { title: 'x', date: one, start: 600, end: 720, lines: [{ offerId: 'fx3', qty: 1 }] }, ANA)).message).toMatch(/2 open days/)
  })
})

describe('cancelling or moving the shoot', () => {
  it('cancelling the shoot cancels its props and gear', async () => {
    await shoot('shoot1', ANA, 'Ana')
    const p = await call('createReservation', { title: 'Diner', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 2 }], scheduleShootId: 'shoot1' }, ANA)
    const g = await call('createGearBooking', { title: 'Diner', date: DAY, start: 780, end: 900, lines: [{ offerId: 'fx3', qty: 1 }], scheduleShootId: 'shoot1' }, ANA)
    const c = await call('cancelShoot', { id: 'shoot1' }, ANA)
    expect(c.result).toMatchObject({ cancelledProps: 1, cancelledGear: 1, stillOut: 0 })
    expect((await getDoc(`reservations/${p.result.id}`))!.status).toBe('cancelled')
    expect((await getDoc(`gear_bookings/${g.result.id}`))!.status).toBe('cancelled')
    expect((await getDoc('item_bookings/chairs'))!.entries).toEqual([])
  })

  it('a shoot with props or gear can move on the same day but not to another day', async () => {
    await shoot('shoot1', ANA, 'Ana')
    await call('createReservation', { title: 'Diner', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 1 }], scheduleShootId: 'shoot1' }, ANA)
    expect((await call('moveShoot', { id: 'shoot1', place: 'cliff1', date: OTHER, start: 780 }, ANA)).message).toMatch(/props or gear booked/)
    expect((await call('moveShoot', { id: 'shoot1', place: 'cliff2', date: DAY, start: 780 }, ANA)).ok).toBe(true)
  })
})
