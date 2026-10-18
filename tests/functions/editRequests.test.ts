// Changing a props request or held gear before the team starts on it.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ANA = 'ana@example.com', BEN = 'ben@example.com'
const DAY = addDays(todayInStudio(), 8)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put('items/chairs', { name: 'Diner chair', quantity: 4, condition: 'good', collection: 'company', archived: false })
  await put('items/cake', { name: 'Fake cake', quantity: 1, condition: 'good', collection: 'company', archived: false })
  await put('gear_bundles/fx3', { name: 'FX3 kit', kind: 'bundle', archived: false, pieces: [{ itemId: 'g1', qty: 1, name: 'FX3' }] })
  await put('gear_bundles/cst', { name: 'C-stand', kind: 'extra', archived: false, pieces: [{ itemId: 'g2', qty: 3, name: 'C-stand' }] })
})

describe('change a props request', () => {
  it('change quantities, add and remove props, add something to make; holds follow', async () => {
    const r = await call('createReservation', { title: 'Diner', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 2 }] }, ANA)
    const id = r.result.id
    expect((await call('editReservation', { id, lines: [{ itemId: 'chairs', qty: 3 }, { itemId: 'cake', qty: 1 }], builds: [{ description: 'Police badge', qty: 1 }] }, ANA)).ok).toBe(true)
    const res = (await getDoc(`reservations/${id}`))!
    expect(res.lines.map((l: any) => `${l.itemId}:${l.qty}`)).toEqual(['chairs:3', 'cake:1'])
    expect(res.builds.map((b: any) => b.description)).toEqual(['Police badge'])
    expect(res.history.at(-1).event).toBe('edited')
    expect((await getDoc('item_bookings/chairs'))!.entries[0].qty).toBe(3)
    // Remove the cake: its hold goes away.
    await call('editReservation', { id, lines: [{ itemId: 'chairs', qty: 1 }], builds: [{ description: 'Police badge', qty: 2 }] }, ANA)
    expect((await getDoc('item_bookings/cake'))!.entries).toEqual([])
    expect((await getDoc(`reservations/${id}`))!.builds[0]).toMatchObject({ id: 'b1', qty: 2 })
  })

  it('only your own, only while Requested, and never more than is free', async () => {
    const id = (await call('createReservation', { title: 'Diner', startDate: DAY, endDate: DAY, lines: [{ itemId: 'chairs', qty: 2 }] }, ANA)).result.id
    await call('createReservation', { title: 'Other', startDate: DAY, endDate: DAY, lines: [{ itemId: 'cake', qty: 1 }] }, BEN)
    expect((await call('editReservation', { id, lines: [{ itemId: 'chairs', qty: 1 }] }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('editReservation', { id, lines: [{ itemId: 'chairs', qty: 2 }, { itemId: 'cake', qty: 1 }] }, ANA)).message).toMatch(/aren't free/)
    expect((await call('editReservation', { id, lines: [] }, ANA)).message).toMatch(/Cancel it instead/)
    await put(`reservations/${id}`, { ...(await getDoc(`reservations/${id}`))!, status: 'preparing' })
    expect((await call('editReservation', { id, lines: [{ itemId: 'chairs', qty: 1 }] }, ANA)).message).toMatch(/started on this request/)
  })
})

describe('change held gear', () => {
  it('add an extra, change hours, remove a bundle; refuses what is taken', async () => {
    const g = await call('createGearBooking', { title: 'Diner', date: DAY, start: 780, end: 900, lines: [{ offerId: 'fx3', qty: 1 }] }, ANA)
    const id = g.result.id
    expect((await call('editGearBooking', { id, lines: [{ offerId: 'fx3', qty: 1 }, { offerId: 'cst', qty: 2 }], start: 720, end: 900 }, ANA)).ok).toBe(true)
    const b = (await getDoc(`gear_bookings/${id}`))!
    expect(b.offerIds).toEqual(['fx3', 'cst'])
    expect(b.start).toBe(720); expect(b.from.endsWith("T12:00")).toBe(true)   // pickup at the new start (a closed day's shoot: the open day before)
    expect((await getDoc('gear_holds/cst'))!.entries[0].qty).toBe(2)
    await call('createGearBooking', { title: 'Ben', date: DAY, start: 780, end: 840, lines: [{ offerId: 'cst', qty: 1 }] }, BEN)   // overlaps Ana's hours, whatever the weekday
    expect((await call('editGearBooking', { id, lines: [{ offerId: 'cst', qty: 3 }] }, ANA)).message).toMatch(/Only 2 "C-stand"/)
    expect((await call('editGearBooking', { id, lines: [{ offerId: 'cst', qty: 1 }] }, ANA)).ok).toBe(true)
    expect((await getDoc('gear_holds/fx3'))!.entries).toEqual([])
  })
})
