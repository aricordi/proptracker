// Give it to Kyle (owner, Nov 2): someone with top priority needs a slot another creator holds. The schedule team moves
// the holder to another free time that day, or cancels them (sorry note + their next request goes first).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, soonSlot } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { slotWindow } from '../../functions/src/schedule'

const MAANIK = 'maanik@example.com', SAM = 'sam@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com', KYLE = 'kyle@example.com'
const today = todayInStudio()
let FRI = addDays(today, 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${SAM}`, { email: SAM, role: 'admin', active: true, name: 'Sam' })
  for (const [e, n] of [[ANA, 'Ana'], [BEN, 'Ben'], [KYLE, 'Kyle']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n, access: 'full' })
  await put('app_settings/schedule', { instantBookers: [{ email: KYLE, name: 'Kyle' }] })
})

const book = (who: string, data: Record<string, unknown> = {}) => call('bookShoot', { place: 'cliff1', date: FRI, start: 780, ...data }, who)
const give = (who: string, data: Record<string, unknown>) => call('giveSlot', { date: FRI, house: 'cliff1', start: 780, ...data }, who)

describe('give it to Kyle', () => {
  it('moves the holder to another free time that day and books Kyle in the slot', async () => {
    const a = (await book(ANA)).result.id
    await call('decideBooking', { id: a, approve: true }, MAANIK)
    const r = await give(MAANIK, { toEmail: KYLE, moveTo: { house: 'cliff2', start: 780 } })
    expect(r.ok).toBe(true)
    const day = (await getDoc(`schedule_days/${FRI}`))!
    expect(day.cliff1['780']).toMatchObject({ email: KYLE })
    expect(day.cliff2['780']).toMatchObject({ shootId: a, email: ANA })
    expect(await getDoc(`shoots/${a}`)).toMatchObject({ status: 'booked', place: 'cliff2', bumped: { for: KYLE } })
    expect((await getDoc(`user_status/${ANA}`))?.firstInLine).toBeUndefined()
  })

  it('cancels the holder when no time works; their next request goes first until decided', async () => {
    const a = (await book(ANA)).result.id
    const r = await give(SAM, { toEmail: KYLE })
    expect(r.ok).toBe(true)
    expect(await getDoc(`shoots/${a}`)).toMatchObject({ status: 'cancelled', bumped: { for: KYLE, forName: 'Kyle' } })
    expect((await getDoc(`user_status/${ANA}`))!.firstInLine).toMatchObject({ date: FRI, forName: 'Kyle' })
    const next = (await book(ANA, { start: 1020 })).result.id
    await call('decideBooking', { id: next, approve: true }, MAANIK)
    expect((await getDoc(`user_status/${ANA}`))?.firstInLine).toBeUndefined()
  })

  it('a moved-to time must be free, and creators can\'t give slots', async () => {
    const a = (await book(ANA)).result.id
    await book(BEN, { place: 'cliff2' })
    expect((await give(MAANIK, { toEmail: KYLE, moveTo: { house: 'cliff2', start: 780 } })).ok).toBe(false)
    expect((await give(BEN, { toEmail: KYLE })).ok).toBe(false)
    expect(await getDoc(`shoots/${a}`)).toMatchObject({ status: 'requested', place: 'cliff1' })
  })

  it('Kyle can take a booked slot himself in the app; another creator can\'t', async () => {
    const a = (await book(ANA)).result.id
    expect((await book(BEN, { take: true })).ok).toBe(false)
    const r = await book(KYLE, { take: true })
    expect(r.ok).toBe(true)
    expect(r.result.bumped).toBe('Ana')
    expect(await getDoc(`shoots/${a}`)).toMatchObject({ status: 'cancelled' })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['780']).toMatchObject({ email: KYLE })
  })

  it('a creator the team moved can still move it and cancel free inside 48 h (audit, Nov 7)', async () => {
    // Booked days ago (so neither the 10-minute undo nor "booked less than 24 h ahead" makes the cancel free).
    const { date, start } = await soonSlot()
    const old = new Date(Date.now() - 5 * 86400000).toISOString()
    const shoot = (id: string, who: string, name: string, day: string, house: string, at: number) => put(`shoots/${id}`, { creatorEmail: who, creatorName: name, place: house, where: '',
      date: day, start: at, end: at + 120, ...slotWindow(day, at, 120), month: day.slice(0, 7), status: 'booked', kind: 'extra', createdAt: old, bookedBy: who, history: [] })
    await shoot('a1', ANA, 'Ana', date, 'cliff1', start)
    await put(`schedule_days/${date}`, { date, cliff1: { [String(start)]: { shootId: 'a1', name: 'Ana', email: ANA, kind: 'extra' } } })
    await shoot('b1', BEN, 'Ben', FRI, 'cliff2', 780)
    await put(`schedule_days/${FRI}`, { date: FRI, cliff2: { '780': { shootId: 'b1', name: 'Ben', email: BEN, kind: 'extra' } } })
    // A priority booking moves Ana to Cliff 2 at the same time; the team moves Ben's shoot (stamped as a team move).
    const g = await give(MAANIK, { date, start, toEmail: KYLE, moveTo: { house: 'cliff2', start } })
    expect(g.ok, g.message).toBe(true)
    const m = await call('moveShoot', { id: 'b1', place: 'cliff2', date: FRI, start: 900 }, MAANIK)
    expect(m.ok, m.message).toBe(true)
    expect((await getDoc('shoots/b1'))!.teamMovedAt).toBeTruthy()
    // Ana can still ask to move inside 48 h (short notice would normally refuse it), and cancelling is free.
    const mv = await call('moveShoot', { id: 'a1', place: 'cliff1', date: FRI, start: 1020 }, ANA)
    expect(mv.ok, mv.message).toBe(true)
    const ca = await call('cancelShoot', { id: 'a1' }, ANA)
    expect(ca.ok, ca.message).toBe(true)
    expect(ca.result.lateCancel).toBe(false)
    expect((await getDoc('shoots/a1'))!.noShow).toBeUndefined()
    expect((await getDoc(`user_status/${ANA}`))?.strikes ?? 0).toBe(0)
  })

  it('a clashing event from Kyle\'s calendar can be given the slot', async () => {
    const a = (await book(ANA)).result.id
    await put('shoots/kcal', { creatorEmail: KYLE, creatorName: 'Kyle', place: 'cliff1', date: FRI, start: 780, end: 900, from: `${FRI}T13:00`, to: `${FRI}T15:00`,
      status: 'booked', kind: 'extra', clash: true, clashWith: ['Ana'], history: [] })
    const day = (await getDoc(`schedule_days/${FRI}`))!
    await put(`schedule_days/${FRI}`, { ...day, clashes: [{ house: 'cliff1', slot: '780', shootId: 'kcal', name: 'Kyle', email: KYLE, start: 780, end: 900 }] })
    const r = await give(MAANIK, { clashShootId: 'kcal' })
    expect(r.ok).toBe(true)
    const after = (await getDoc(`schedule_days/${FRI}`))!
    expect(after.cliff1['780']).toMatchObject({ shootId: 'kcal' })
    expect(after.clashes ?? []).toHaveLength(0)
    expect((await getDoc('shoots/kcal'))!.clash).toBeUndefined()
    expect(await getDoc(`shoots/${a}`)).toMatchObject({ status: 'cancelled' })
  })
})
