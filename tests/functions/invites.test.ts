// Filming back to back with friends: your slot and theirs are booked at once (Nov 14: no confirming).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ANA = 'ana@example.com', KYLE = 'kyle@example.com', JANA = 'jana@example.com', BEN = 'ben@example.com'
const DAY = addDays(todayInStudio(), 9)

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [JANA, 'Jana'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
})

describe('book with friends (no confirming since Nov 14)', () => {
  it('books your slot and each friend\'s slot at once, in the same state as yours', async () => {
    await put(`users/${JANA}`, { email: JANA, role: 'creator', active: true, name: 'Jana', access: 'props' })   // Props only is fine now
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [KYLE, JANA] }, ANA)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.inviteIds).toEqual([])
    const day = (await getDoc(`schedule_days/${DAY}`))!
    expect(day.cliff2['780'].email).toBe(ANA)
    expect(day.cliff2['900']).toMatchObject({ email: KYLE, pending: true })
    expect(day.cliff2['900'].hold).toBeUndefined()
    expect(day.cliff2['1020'].email).toBe(JANA)
    const [kyleShoot, janaShoot] = r.result.friendShootIds
    expect(await getDoc(`shoots/${kyleShoot}`)).toMatchObject({ creatorEmail: KYLE, start: 900, status: 'requested', invitedBy: ANA, bookedBy: ANA })
    expect(await getDoc(`shoots/${janaShoot}`)).toMatchObject({ creatorEmail: JANA, start: 1020, status: 'requested' })
    // Nobody else can take those slots.
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 900 }, BEN)).ok).toBe(false)
  })

  it('a friend who is not on the app yet is booked under their name', async () => {
    await put('app_settings/schedule', { instantBookers: [{ email: ANA, name: 'Ana' }] })
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: ['guest:Bob Smith', 'guest:bob smith'] }, ANA)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.friendShootIds).toHaveLength(1)
    expect(await getDoc(`shoots/${r.result.friendShootIds[0]}`)).toMatchObject({ creatorEmail: 'guest:bob-smith', creatorName: 'Bob Smith', guest: true, status: 'booked' })
    expect((await getDoc(`schedule_days/${DAY}`))!.cliff2['900'].name).toBe('Bob Smith')
  })

  // Cliff 2: Cliff 1 is priority-only on Thursdays and Saturdays, and DAY can land on one.
  it("only people who film can get a slot (not arts, equipment or admins)", async () => {
    await put('users/sam@example.com', { email: 'sam@example.com', role: 'admin', active: true, name: 'Sam' })
    await put('users/farrell@example.com', { email: 'farrell@example.com', role: 'arts', active: true, name: 'Farrell' })
    for (const who of ['sam@example.com', 'farrell@example.com']) {
      const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [who] }, ANA)
      expect(r.message).toMatch(/doesn't film/)
    }
  })

  it('the person who booked can cancel a friend\'s slot; the friend can too; others cannot', async () => {
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [KYLE, 'guest:Bob'] }, ANA)
    const [kyleShoot, bobShoot] = r.result.friendShootIds
    expect((await call('cancelShoot', { id: kyleShoot }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('cancelShoot', { id: bobShoot }, ANA)).ok).toBe(true)
    expect((await call('cancelShoot', { id: kyleShoot }, KYLE)).ok).toBe(true)
    const day = (await getDoc(`schedule_days/${DAY}`))!
    expect(day.cliff2['900']).toBeUndefined()
    expect(day.cliff2['1020']).toBeUndefined()
    // Ana's own slot stays.
    expect(day.cliff2['780'].email).toBe(ANA)
  })
})

describe('ask for a time', () => {
  it('finds back-to-back options for you and a friend (simple reading in test mode)', async () => {
    const r = await call('askForTime', { text: 'filming with Kyle next week, evenings, cliff 2' }, ANA)
    expect(r.ok).toBe(true)
    expect(r.result.friends.map((f: any) => f.email)).toEqual([KYLE])
    expect(r.result.options.length).toBeGreaterThan(0)
    const o = r.result.options[0]
    expect(o.place).toBe('cliff2')
    expect(o.slots.map((x: any) => x.email)).toEqual([ANA, KYLE])
    expect(o.slots[0].start).toBeGreaterThanOrEqual(1020)
  })
})

describe('people you can film with', () => {
  it('lists active creators (not yourself, not other teams), names only', async () => {
    await put('users/arts@example.com', { email: 'arts@example.com', role: 'arts', active: true, name: 'Arty' })
    await put('users/gone@example.com', { email: 'gone@example.com', role: 'creator', active: false, name: 'Gone' })
    const r = await call('listFilmingFriends', {}, ANA)
    const emails = r.result.people.map((p: { email: string }) => p.email)
    expect(emails).toEqual(expect.arrayContaining([KYLE, JANA, BEN]))
    expect(emails).not.toContain(ANA)
    expect(emails).not.toContain('arts@example.com')
    expect(emails).not.toContain('gone@example.com')
    expect(Object.keys(r.result.people[0]).sort()).toEqual(['email', 'name'])
  })
})
