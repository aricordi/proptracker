// Double-booking protection, tested against the real server functions in the emulator.
import { beforeAll, beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { addDays, todayInStudio } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'res-arts@example.com'
const ALEX = 'alex@example.com', BLAIR = 'blair@example.com', CASEY = 'casey@example.com'
const today = todayInStudio()
const day = (n: number) => addDays(today, n)

const reserve = (email: string, lines: { itemId: string; qty: number }[], start = day(10), end = day(11), title = 'Test shoot') =>
  call('createReservation', { title, startDate: start, endDate: end, lines }, email)

beforeAll(async () => {
  await clearDatabase()
})

beforeEach(async () => {
  await clearDatabase()
  for (const [email, role] of [[ARTS, 'arts'], [ALEX, 'creator'], [BLAIR, 'creator'], [CASEY, 'creator']]) {
    await put(`users/${email}`, { email, role, active: true, name: email.split('@')[0] })
  }
  await put('app_settings/booking', { leadTimeDays: 3, bufferDays: 1 })
  await put('items/cop', { name: 'Cop costume', quantity: 1, condition: 'good', tags: [] })
  await put('items/chairs', { name: 'Wooden chair', quantity: 10, condition: 'fair', tags: [] })
  await put('items/skull', { name: 'Fake skull', quantity: 1, condition: 'damaged', tags: [] })
  await put('items/lamp', { name: 'Old lamp', quantity: 1, condition: 'good', tags: [], archived: true })
  await put('items/bottle', { name: 'Breakaway bottle', quantity: 3, status: 'checked-out', tags: [] })
})

describe('one-of-a-kind props', () => {
  it('the first creator gets it, the second is told it is taken', async () => {
    expect((await reserve(ALEX, [{ itemId: 'cop', qty: 1 }])).ok).toBe(true)
    const second = await reserve(BLAIR, [{ itemId: 'cop', qty: 1 }], day(11), day(12))
    expect(second.error).toBe('FAILED_PRECONDITION')
    expect(second.details.conflicts[0]).toMatchObject({ itemId: 'cop', free: 0 })
  })
  it('the turnaround day is respected, and the day after is fine', async () => {
    await reserve(ALEX, [{ itemId: 'cop', qty: 1 }], day(10), day(11))
    expect((await reserve(BLAIR, [{ itemId: 'cop', qty: 1 }], day(12), day(12))).ok).toBe(false)
    expect((await reserve(BLAIR, [{ itemId: 'cop', qty: 1 }], day(13), day(13))).ok).toBe(true)
  })
  it('five people grabbing it at the same instant: exactly one wins', async () => {
    const racers = [ALEX, BLAIR, CASEY, ARTS, OWNER]
    const results = await Promise.all(racers.map(e => reserve(e, [{ itemId: 'cop', qty: 1 }])))
    expect(results.filter(r => r.ok)).toHaveLength(1)
    const bookings = await getDoc('item_bookings/cop')
    expect(bookings!.entries).toHaveLength(1)
  }, 30000)
})

describe('quantities (10 chairs)', () => {
  it('bookings add up to the stock and no further', async () => {
    expect((await reserve(ALEX, [{ itemId: 'chairs', qty: 6 }])).ok).toBe(true)
    expect((await reserve(BLAIR, [{ itemId: 'chairs', qty: 4 }])).ok).toBe(true)
    const third = await reserve(CASEY, [{ itemId: 'chairs', qty: 1 }])
    expect(third.ok).toBe(false)
    expect(third.details.conflicts[0].free).toBe(0)
  })
  it('asking for more than exist tells you how many are free', async () => {
    await reserve(ALEX, [{ itemId: 'chairs', qty: 7 }])
    const r = await reserve(BLAIR, [{ itemId: 'chairs', qty: 5 }])
    expect(r.details.conflicts[0]).toMatchObject({ requested: 5, free: 3 })
  })
  it('a race for the last 4 chairs never oversells', async () => {
    await reserve(ALEX, [{ itemId: 'chairs', qty: 6 }])
    const results = await Promise.all([BLAIR, CASEY, ARTS].map(e => reserve(e, [{ itemId: 'chairs', qty: 3 }])))
    expect(results.filter(r => r.ok)).toHaveLength(1)
    const total = (await getDoc('item_bookings/chairs'))!.entries.reduce((n: number, e: { qty: number }) => n + e.qty, 0)
    expect(total).toBe(9)
  }, 30000)
  it('one clash blocks the whole reservation, so nothing is half-booked', async () => {
    await reserve(ALEX, [{ itemId: 'cop', qty: 1 }])
    const r = await reserve(BLAIR, [{ itemId: 'chairs', qty: 2 }, { itemId: 'cop', qty: 1 }])
    expect(r.ok).toBe(false)
    expect((await getDoc('item_bookings/chairs'))?.entries ?? []).toHaveLength(0)
  })
})

describe('what can be booked', () => {
  it('creators must book at least 3 days ahead; arts department can book same-day', async () => {
    const tooSoon = await reserve(ALEX, [{ itemId: 'cop', qty: 1 }], day(2), day(2))
    expect(tooSoon.error).toBe('INVALID_ARGUMENT')
    expect(tooSoon.message).toContain(day(3))
    expect((await reserve(ALEX, [{ itemId: 'cop', qty: 1 }], day(3), day(3))).ok).toBe(true)
    expect((await reserve(ARTS, [{ itemId: 'chairs', qty: 1 }], day(0), day(0))).ok).toBe(true)
  })
  it('the lead time follows the admin setting', async () => {
    await put('app_settings/booking', { leadTimeDays: 0, bufferDays: 1 })
    expect((await reserve(ALEX, [{ itemId: 'cop', qty: 1 }], day(0), day(0))).ok).toBe(true)
  })
  it('creators cannot reserve damaged props', async () => {
    const r = await reserve(ALEX, [{ itemId: 'skull', qty: 1 }])
    expect(r.details.conflicts[0].reason).toBe('damaged')
  })
  it('archived props and props out on the old Checkout screen cannot be reserved', async () => {
    expect((await reserve(ALEX, [{ itemId: 'lamp', qty: 1 }])).ok).toBe(false)
    expect((await reserve(ALEX, [{ itemId: 'bottle', qty: 1 }])).ok).toBe(false)
  })
  it('signed-out and uninvited people cannot reserve', async () => {
    expect((await reserve('stranger@example.com', [{ itemId: 'cop', qty: 1 }])).error).toBe('PERMISSION_DENIED')
  })
})

describe('ending a reservation frees the props', () => {
  it('a creator can cancel their own, then someone else can book', async () => {
    const { result } = await reserve(ALEX, [{ itemId: 'cop', qty: 1 }])
    expect((await call('cancelReservation', { id: result.id }, BLAIR)).error).toBe('PERMISSION_DENIED')
    expect((await call('cancelReservation', { id: result.id }, ALEX)).ok).toBe(true)
    expect((await reserve(BLAIR, [{ itemId: 'cop', qty: 1 }])).ok).toBe(true)
    expect((await getDoc(`reservations/${result.id}`))!.status).toBe('cancelled')
  })
  it('only the arts department can decline, and must give a reason', async () => {
    const { result } = await reserve(ALEX, [{ itemId: 'cop', qty: 1 }])
    expect((await call('declineReservation', { id: result.id, reason: 'no' }, ALEX)).error).toBe('PERMISSION_DENIED')
    expect((await call('declineReservation', { id: result.id, reason: '' }, ARTS)).error).toBe('INVALID_ARGUMENT')
    expect((await call('declineReservation', { id: result.id, reason: 'Needed for reshoot' }, ARTS)).ok).toBe(true)
    const res = (await getDoc(`reservations/${result.id}`))!
    expect(res.status).toBe('declined')
    expect(res.statusReason).toBe('Needed for reshoot')
    expect(res.history.map((h: { status: string }) => h.status)).toEqual(['requested', 'declined'])
  })
  it('an ended reservation cannot be ended twice', async () => {
    const { result } = await reserve(ALEX, [{ itemId: 'cop', qty: 1 }])
    await call('cancelReservation', { id: result.id }, ALEX)
    expect((await call('cancelReservation', { id: result.id }, ALEX)).error).toBe('FAILED_PRECONDITION')
  })
})
