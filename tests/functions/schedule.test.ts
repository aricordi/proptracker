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
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780']).toEqual({ shootId: r.result.id, name: 'Ana', email: ANA, kind: 'monthly' })
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
    // One house slot a day per creator, so the five slots are on five different days of the same month.
    // (Thursdays and Saturdays at Cliff 1 are priority days, so those are skipped.)
    const days: string[] = []
    for (let d = FRI; days.length < 5; d = addDays(d, 1)) {
      if (days.length && d.slice(0, 7) !== days[0].slice(0, 7)) days.length = 0
      if (![4, 6].includes(weekday(d))) days.push(d)
    }
    for (const d of days.slice(0, 4)) {
      const r = await book(ANA, { date: d, start: 1260 })
      expect(r.ok, r.message).toBe(true)
    }
    const fifth = await book(ANA, { date: days[4], start: 1380 })
    expect(fifth.error).toBe('FAILED_PRECONDITION')
    expect(fifth.message).toMatch(/monthly slots/)
    expect((await book(ANA, { date: days[4], start: 1380, kind: 'extra' })).ok).toBe(true)
  })

  it('refuses slots that are not on the grid, in the past, or blocked', async () => {
    expect((await book(ANA, { start: 600 })).error).toBe('FAILED_PRECONDITION')
    expect((await book(ANA, { date: addDays(today, -1) })).message).toMatch(/already started/)
    await call('addScheduleBlock', { date: FRI, house: 'cliff1', start: 780, end: 900, type: 'cleaners' }, MAANIK)
    expect((await book(ANA, {})).message).toMatch(/blocked/)
  })

  it('offsite shoots go on the schedule without holding a house', async () => {
    const r = await book(ANA, { place: 'offsite', start: 630, end: 900, where: 'Rosewood Park' })   // any half hours: 10:30 AM–3 PM
    expect(r.ok).toBe(true)
    expect((await getDoc(`schedule_days/${FRI}`))!.offsite).toEqual([{ shootId: r.result.id, name: 'Ana', email: ANA, start: 630, end: 900, where: 'Rosewood Park' }])
    expect((await book(BEN, { place: 'offsite', end: 900, where: '' })).message).toMatch(/where/)
    expect((await book(BEN, { place: 'offsite', start: 900, end: 840, where: 'Park' })).message).toMatch(/start and end/)
    expect((await book(BEN, {})).ok).toBe(true)   // Cliff 1 at the same time is still free
  })
})

describe('priority days (Thursdays and Saturdays at Cliff 1)', () => {
  it('only the priority group until the Sunday release; the schedule team can always book', async () => {
    const r = await book(ANA, { date: THU })
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toMatch(/priority/)
    expect((await book(JANA, { date: THU })).ok).toBe(true)
    expect((await book(MAANIK, { date: THU, start: 900, forEmail: BEN })).ok).toBe(true)
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

  it('the owner saves settings (cleaned); the team lists people; creators cannot', async () => {
    // Schedule settings are the owner's (owner, Oct 20); the gear team runs the schedule but can't change its rules.
    expect((await call('saveScheduleSettings', { monthlySlots: 5 }, MAANIK)).error).toBe('PERMISSION_DENIED')
    const r = await call('saveScheduleSettings', { monthlySlots: 5, slots: [480, 600], priority: [{ email: ANA, name: 'Ana' }] }, OWNER)
    expect(r.ok).toBe(true)
    expect((await getDoc('app_settings/schedule'))!).toMatchObject({ monthlySlots: 5, slots: [480, 600], updatedBy: OWNER })
    expect((await call('saveScheduleSettings', { monthlySlots: 1 }, ANA)).error).toBe('PERMISSION_DENIED')
    const people = await call('listSchedulePeople', {}, OWNER)
    expect(people.result.people.map((p: { email: string }) => p.email)).toContain(BEN)
    expect((await call('listSchedulePeople', {}, BEN)).error).toBe('PERMISSION_DENIED')
  })
})

// A shoot about a day away: inside the 48-hour notice period (skip near midnight edge cases by using an afternoon slot).
let SOON = addDays(today, 1)
if (weekday(SOON) === 4 || weekday(SOON) === 6) SOON = addDays(SOON, 1)   // avoid priority days

describe('moving and the 48-hour notice', () => {
  it('moves to a free slot in one step; the old slot frees up and the history says where from', async () => {
    const r = await book(ANA, {})
    const m = await call('moveShoot', { id: r.result.id, place: 'cliff2', date: FRI, start: 1380 }, ANA)
    expect(m.ok, m.message).toBe(true)
    const day = (await getDoc(`schedule_days/${FRI}`))!
    expect(day.cliff1?.['780']).toBeUndefined()
    expect(day.cliff2['1380']).toMatchObject({ shootId: r.result.id, name: 'Ana', kind: 'extra' })   // Cliff 2 is never monthly
    const shoot = (await getDoc(`shoots/${r.result.id}`))!
    expect(shoot).toMatchObject({ place: 'cliff2', start: 1380, kind: 'extra', to: `${addDays(FRI, 1)}T01:00` })   // 11 PM–1 AM
    expect(shoot.history.at(-1).action).toBe('moved')
  })

  it('a move to a taken slot changes nothing', async () => {
    const r = await book(ANA, {})
    await book(BEN, { start: 900 })
    expect((await call('moveShoot', { id: r.result.id, place: 'cliff1', date: FRI, start: 900 }, ANA)).message).toMatch(/just booked/)
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780'].shootId).toBe(r.result.id)
  })

  it('a booking made by mistake can be cancelled for free within 10 minutes, even inside 48 hours', async () => {
    const r = await book(ANA, { date: SOON, start: 1260, kind: 'extra' })
    const c = await call('cancelShoot', { id: r.result.id }, ANA)
    expect(c.ok, c.message).toBe(true)
    expect(c.result.lateCancel).toBe(false)
  })

  it('inside 48 hours: no free move; cancelling needs confirming and counts as a no-show; the team is exempt', async () => {
    const r = await book(ANA, { date: SOON, start: 1260, kind: 'extra' })
    expect(r.ok, r.message).toBe(true)
    await put(`shoots/${r.result.id}`, { ...(await getDoc(`shoots/${r.result.id}`))!, createdAt: '2026-01-01T00:00:00.000Z' })   // booked long ago
    expect((await call('moveShoot', { id: r.result.id, date: FRI, start: 1260 }, ANA)).message).toMatch(/Swap with someone/)
    expect((await call('cancelShoot', { id: r.result.id }, ANA)).message).toMatch(/no-show/)
    const c = await call('cancelShoot', { id: r.result.id, confirmNoShow: true }, ANA)
    expect(c.result.lateCancel).toBe(true)
    expect((await getDoc(`shoots/${r.result.id}`))!).toMatchObject({ status: 'cancelled', noShow: 'late-cancel' })
    const r2 = await book(BEN, { date: SOON, start: 1260, kind: 'extra' })
    expect((await call('moveShoot', { id: r2.result.id, date: FRI, start: 1260 }, MAANIK)).ok).toBe(true)
  })
})

describe('swaps', () => {
  it('ask, accept, and both shoots trade places in one step (even inside 48 hours)', async () => {
    const a = await book(ANA, { date: SOON, start: 1260, kind: 'extra' })
    const b = await book(BEN, { start: 900 })
    const req = await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, ANA)
    expect(req.ok, req.message).toBe(true)
    expect((await call('answerSwap', { id: req.result.id, accept: true }, ANA)).error).toBe('PERMISSION_DENIED')   // can't accept your own
    expect((await call('answerSwap', { id: req.result.id, accept: true }, BEN)).ok).toBe(true)
    expect((await getDoc(`shoots/${a.result.id}`))!).toMatchObject({ creatorEmail: ANA, date: FRI, start: 900 })
    expect((await getDoc(`shoots/${b.result.id}`))!).toMatchObject({ creatorEmail: BEN, date: SOON, start: 1260 })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['900']).toMatchObject({ shootId: a.result.id, name: 'Ana' })
    expect((await getDoc(`schedule_days/${SOON}`))!.cliff1['1260']).toMatchObject({ shootId: b.result.id, name: 'Ben' })
    expect((await getDoc(`swap_requests/${req.result.id}`))!.status).toBe('accepted')
  })

  it('declined swaps change nothing; one open request per shoot; stale requests expire', async () => {
    const a = await book(ANA, {}), b = await book(BEN, { start: 900 })
    const req = await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, ANA)
    expect((await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, ANA)).message).toMatch(/already asked/)
    expect((await call('answerSwap', { id: req.result.id, accept: false }, BEN)).ok).toBe(true)
    expect((await getDoc(`shoots/${a.result.id}`))!.start).toBe(780)
    const req2 = await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, ANA)
    await call('moveShoot', { id: b.result.id, date: FRI, start: 1020 }, BEN)   // Ben moves first
    expect((await call('answerSwap', { id: req2.result.id, accept: true }, BEN)).message).toMatch(/no longer works/)
    expect((await getDoc(`swap_requests/${req2.result.id}`))!.status).toBe('expired')
  })

  it('you can only offer your own shoot', async () => {
    const a = await book(ANA, {}), b = await book(BEN, { start: 900 })
    expect((await call('requestSwap', { myShootId: a.result.id, theirShootId: b.result.id }, BEN)).error).toBe('PERMISSION_DENIED')
  })
})
