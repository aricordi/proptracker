// Booking requests (owner, Nov 2): a creator's booking holds the slot as a REQUEST until the equipment team, an admin
// or the owner approves or denies it. Moves of an approved shoot are requests too. Kyle (instantBookers) skips approval.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const MAANIK = 'maanik@example.com', SAM = 'sam@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com', KYLE = 'kyle@example.com', ARTS = 'arts@example.com'
const today = todayInStudio()
let FRI = addDays(today, 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
const MON = addDays(FRI, 3)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${SAM}`, { email: SAM, role: 'admin', active: true, name: 'Sam' })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  for (const [e, n] of [[ANA, 'Ana'], [BEN, 'Ben'], [KYLE, 'Kyle']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n, access: 'full' })
  await put('app_settings/schedule', { instantBookers: [{ email: KYLE, name: 'Kyle' }] })
  await put('items/chairs', { name: 'Diner chair', quantity: 4, condition: 'good', collection: 'company', archived: false })
})

const book = (who: string, data: Record<string, unknown> = {}) => call('bookShoot', { place: 'cliff1', date: FRI, start: 780, ...data }, who)
const decide = (who: string, id: string, approve: boolean, reason?: string) => call('decideBooking', { id, approve, reason }, who)

describe('booking requests', () => {
  it('a creator\'s booking is a request that holds the slot; nobody else can take it', async () => {
    const r = await book(ANA)
    expect(r.ok).toBe(true)
    expect(r.result.status).toBe('requested')
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ status: 'requested', creatorEmail: ANA })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780']).toMatchObject({ shootId: r.result.id, pending: true })
    const other = await book(BEN)
    expect(other.ok).toBe(false)
  })

  it('the equipment team approves: it becomes a booking and the mark goes away', async () => {
    const r = await book(ANA)
    expect((await decide(MAANIK, r.result.id, true)).ok).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ status: 'booked', approvedBy: MAANIK })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780'].pending).toBeUndefined()
    expect((await decide(MAANIK, r.result.id, false, 'nope')).ok).toBe(false)   // already decided
  })

  it('an admin can deny with a reason; the slot frees up', async () => {
    const r = await book(ANA)
    expect((await decide(SAM, r.result.id, false)).ok).toBe(false)   // a reason is required
    expect((await decide(SAM, r.result.id, false, 'Cleaners that day')).ok).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ status: 'denied', deniedReason: 'Cleaners that day' })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1?.['780']).toBeUndefined()
    expect((await book(BEN)).ok).toBe(true)
  })

  it('creators and the arts team can\'t approve', async () => {
    const r = await book(ANA)
    expect((await decide(BEN, r.result.id, true)).ok).toBe(false)
    expect((await decide(ARTS, r.result.id, true)).ok).toBe(false)
  })

  it('Kyle (books without approval) and the schedule team booking for someone are approved at once', async () => {
    expect((await book(KYLE)).result.status).toBe('booked')
    expect((await call('bookShoot', { place: 'cliff2', date: FRI, start: 780, forEmail: ANA }, MAANIK)).result.status).toBe('booked')
  })

  it('withdrawing a request is free, even close to the start', async () => {
    const r = await book(ANA)
    const c = await call('cancelShoot', { id: r.result.id }, ANA)
    expect(c.ok).toBe(true)
    expect(c.result.lateCancel).toBe(false)
    expect((await getDoc(`shoots/${r.result.id}`))!.status).toBe('cancelled')
  })

  it('moving an approved shoot is a request: the old slot stays until it is approved', async () => {
    const r = await book(ANA)
    await decide(MAANIK, r.result.id, true)
    const m = await call('moveShoot', { id: r.result.id, place: 'cliff1', date: MON, start: 900 }, ANA)
    expect(m.ok).toBe(true)
    expect(m.result.status).toBe('requested')
    expect((await getDoc(`shoots/${r.result.id}`))).toMatchObject({ status: 'booked', date: FRI, moveRequest: { date: MON, start: 900 } })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780'].shootId).toBe(r.result.id)
    expect((await getDoc(`schedule_days/${MON}`))!.cliff1['900']).toMatchObject({ move: true, pending: true })
    expect((await decide(MAANIK, r.result.id, true)).ok).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ date: MON, start: 900 })
    expect((await getDoc(`shoots/${r.result.id}`))!.moveRequest).toBeUndefined()
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1?.['780']).toBeUndefined()
    expect((await getDoc(`schedule_days/${MON}`))!.cliff1['900']).toEqual({ shootId: r.result.id, name: 'Ana', email: ANA, kind: 'extra' })
  })

  it('a denied move keeps the original slot', async () => {
    const r = await book(ANA)
    await decide(MAANIK, r.result.id, true)
    await call('moveShoot', { id: r.result.id, place: 'cliff2', date: FRI, start: 900 }, ANA)
    expect((await decide(MAANIK, r.result.id, false, 'Cliff 2 is rented')).ok).toBe(true)
    const day = (await getDoc(`schedule_days/${FRI}`))!
    expect(day.cliff1['780'].shootId).toBe(r.result.id)
    expect(day.cliff2?.['900']).toBeUndefined()
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ status: 'booked', place: 'cliff1', start: 780 })
  })

  it('props added to a request are let go when it is denied', async () => {
    const r = await book(ANA)
    const p = await call('createReservation', { title: 'Diner', startDate: FRI, endDate: FRI, lines: [{ itemId: 'chairs', qty: 2 }], scheduleShootId: r.result.id }, ANA)
    expect(p.ok).toBe(true)
    expect((await decide(MAANIK, r.result.id, false, 'House is busy')).ok).toBe(true)
    expect((await getDoc(`reservations/${p.result.id}`))!.status).toBe('cancelled')
  })

  it('a move to another day can\'t be approved while props are booked for the old day', async () => {
    const r = await book(ANA)
    await decide(MAANIK, r.result.id, true)
    await call('moveShoot', { id: r.result.id, place: 'cliff1', date: MON, start: 900 }, ANA)
    // props added after the move was asked for, for the current day
    expect((await call('createReservation', { title: 'Diner', startDate: FRI, endDate: FRI, lines: [{ itemId: 'chairs', qty: 1 }], scheduleShootId: r.result.id }, ANA)).ok).toBe(true)
    const a = await decide(MAANIK, r.result.id, true)
    expect(a.ok).toBe(false)
    expect((await getDoc(`shoots/${r.result.id}`))).toMatchObject({ date: FRI, status: 'booked' })
    expect((await decide(MAANIK, r.result.id, false, 'Keep your Friday')).ok).toBe(true)
  })

  it('a shoot waiting for a move can\'t be swapped', async () => {
    const a = await book(ANA), b = await call('bookShoot', { place: 'cliff2', date: FRI, start: 780 }, BEN)
    await decide(MAANIK, a.result.id, true); await decide(MAANIK, b.result.id, true)
    await call('moveShoot', { id: a.result.id, place: 'cliff1', date: MON, start: 900 }, ANA)
    const sw = await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, ANA)
    expect(sw.ok).toBe(false)
    expect(sw.message).toMatch(/move/)
  })

  it('a waiting request counts toward the one-slot-a-day limit', async () => {
    await book(ANA)
    const second = await call('bookShoot', { place: 'cliff2', date: FRI, start: 1140 }, ANA)
    expect(second.ok).toBe(false)
  })
})
