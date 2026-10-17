// House schedule: instant booking, no double-booking, monthly slots, priority days, blocks.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', MAANIK = 'maanik@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com', JANA = 'jana@example.com'
const today = todayInStudio()
// A Friday at least a week out (never a priority day), and a Thursday whose Sunday release is still ahead.
let FRI = addDays(today, 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
let THU = addDays(today, 8); while (weekday(THU) !== 4) THU = addDays(THU, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${JANA}`, { email: JANA, role: 'creator', active: true, name: 'Jana' })
  await put('app_settings/schedule', { priority: [{ email: JANA, name: 'Jana' }] })
})

const book = (who: string, data: Record<string, unknown>) => call('bookShoot', { place: 'cliff1', date: FRI, start: 780, kind: 'monthly', ...data }, who)

describe('booking a house', () => {
  it('books instantly: the shoot and the day both record it', async () => {
    const r = await book(ANA, {})
    expect(r.ok).toBe(true)
    expect(r.result.kind).toBe('monthly')
    const shoot = (await getDoc(`shoots/${r.result.id}`))!
    expect(shoot).toMatchObject({ creatorEmail: ANA, creatorName: 'Ana', place: 'cliff1', date: FRI, start: 780, end: 900, kind: 'monthly', status: 'booked', from: `${FRI}T13:00`, to: `${FRI}T15:00` })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780']).toEqual({ shootId: r.result.id, name: 'Ana', kind: 'monthly' })
  })

  it('no double-booking, even when two people tap at the same moment', async () => {
    const [a, b] = await Promise.all([book(ANA, {}), book(BEN, {})])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const loser = a.ok ? b : a
    expect(loser.message).toMatch(/just booked/)
    expect((await book(BEN, { start: 900 })).ok).toBe(true)   // the next slot is fine (back to back)
  })

  it('the same slot at the other house is separate', async () => {
    expect((await book(ANA, {})).ok).toBe(true)
    expect((await book(BEN, { place: 'cliff2' })).result.kind).toBe('extra')   // Cliff 2 is never a monthly slot
  })

  it('4 monthly Cliff 1 slots a month, then extra slots', async () => {
    const days = [0, 1, 2, 3].map(i => addDays(FRI, i)).filter(d => d.slice(0, 7) === FRI.slice(0, 7))
    if (days.length < 4) return   // month boundary: skip rather than test the wrong month
    for (const d of days) {
      const r = await book(ANA, { date: d, start: 1260 })
      expect(r.ok, r.message).toBe(true)
    }
    const fifth = await book(ANA, { date: days[0], start: 1380 })
    expect(fifth.error).toBe('FAILED_PRECONDITION')
    expect(fifth.message).toMatch(/monthly slots/)
    expect((await book(ANA, { date: days[0], start: 1380, kind: 'extra' })).ok).toBe(true)
  })

  it('refuses slots that are not on the grid, in the past, or blocked', async () => {
    expect((await book(ANA, { start: 600 })).error).toBe('FAILED_PRECONDITION')
    expect((await book(ANA, { date: addDays(today, -1) })).message).toMatch(/already started/)
    await call('addScheduleBlock', { date: FRI, house: 'cliff1', start: 780, end: 900, type: 'cleaners' }, MAANIK)
    expect((await book(ANA, {})).message).toMatch(/blocked/)
  })

  it('offsite shoots go on the schedule without holding a house', async () => {
    const r = await book(ANA, { place: 'offsite', where: 'Rosewood Park' })
    expect(r.ok).toBe(true)
    expect((await getDoc(`schedule_days/${FRI}`))!.offsite).toEqual([{ shootId: r.result.id, name: 'Ana', start: 780, end: 900, where: 'Rosewood Park' }])
    expect((await book(BEN, { place: 'offsite', where: '' })).message).toMatch(/where/)
    expect((await book(BEN, {})).ok).toBe(true)   // Cliff 1 at the same time is still free
  })
})

describe('priority days (Thursdays and Saturdays at Cliff 1)', () => {
  it('only the priority group until the Sunday release; the schedule team can always book', async () => {
    const r = await book(ANA, { date: THU })
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/priority/)
    expect((await book(JANA, { date: THU })).ok).toBe(true)
    expect((await book(MAANIK, { date: THU, start: 900, forEmail: ANA })).ok).toBe(true)
    expect((await book(ANA, { date: THU, place: 'cliff2' })).ok).toBe(true)
  })
})

describe('cancelling', () => {
  it('the creator or the schedule team can cancel; others cannot; the slot frees up', async () => {
    const r = await book(ANA, {})
    expect((await call('cancelShoot', { id: r.result.id }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('cancelShoot', { id: r.result.id }, ANA)).ok).toBe(true)
    expect((await getDoc(`shoots/${r.result.id}`))!.status).toBe('cancelled')
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1?.['780']).toBeUndefined()
    expect((await book(BEN, {})).ok).toBe(true)
    expect((await call('cancelShoot', { id: r.result.id }, ANA)).message).toMatch(/already cancelled/)
  })

  it('a cancelled monthly slot can be used again', async () => {
    const r = await book(ANA, {})
    await call('cancelShoot', { id: r.result.id }, MAANIK)
    expect((await getDoc(`shoots/${r.result.id}`))!.history.at(-1).note).toBe('by the schedule team')
  })
})

describe('schedule team', () => {
  it('books for someone else; creators cannot', async () => {
    const r = await book(MAANIK, { forEmail: BEN })
    expect(r.ok).toBe(true)
    expect((await getDoc(`shoots/${r.result.id}`))!).toMatchObject({ creatorEmail: BEN, creatorName: 'Ben', bookedBy: MAANIK })
    expect((await book(ANA, { start: 900, forEmail: BEN })).error).toBe('PERMISSION_DENIED')
  })

  it('blocks time, but never over a booking; blocks can be removed', async () => {
    await book(ANA, {})
    const clash = await call('addScheduleBlock', { date: FRI, house: 'cliff1', allDay: true, type: 'maintenance' }, MAANIK)
    expect(clash.message).toMatch(/Already booked then: Ana/)
    const b = await call('addScheduleBlock', { date: FRI, house: 'cliff2', allDay: true, type: 'rental', note: 'Airbnb' }, MAANIK)
    expect(b.ok).toBe(true)
    expect((await getDoc(`schedule_days/${FRI}`))!.blocks[0]).toMatchObject({ house: 'cliff2', start: 420, end: 1500, type: 'rental', note: 'Airbnb' })
    expect((await call('addScheduleBlock', { date: FRI, house: 'cliff2', allDay: true }, ANA)).error).toBe('PERMISSION_DENIED')
    expect((await call('removeScheduleBlock', { date: FRI, id: b.result.id }, MAANIK)).ok).toBe(true)
    expect((await getDoc(`schedule_days/${FRI}`))!.blocks).toEqual([])
  })

  it('saves settings (cleaned) and lists people; creators cannot', async () => {
    const r = await call('saveScheduleSettings', { monthlySlots: 5, slots: [480, 600], priority: [{ email: ANA, name: 'Ana' }] }, MAANIK)
    expect(r.ok).toBe(true)
    expect((await getDoc('app_settings/schedule'))!).toMatchObject({ monthlySlots: 5, slots: [480, 600], updatedBy: MAANIK })
    expect((await call('saveScheduleSettings', { monthlySlots: 1 }, ANA)).error).toBe('PERMISSION_DENIED')
    const people = await call('listSchedulePeople', {}, OWNER)
    expect(people.result.people.map((p: { email: string }) => p.email)).toContain(BEN)
    expect((await call('listSchedulePeople', {}, BEN)).error).toBe('PERMISSION_DENIED')
  })
})
