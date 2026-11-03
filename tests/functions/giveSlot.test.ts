// Give it to Kyle (owner, Nov 2): someone with top priority needs a slot another creator holds. The schedule team moves
// the holder to another free time that day, or cancels them (sorry note + their next request goes first).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

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
