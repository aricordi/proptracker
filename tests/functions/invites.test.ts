// Filming back to back with friends: book yours, hold theirs for 20 minutes, they confirm.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ANA = 'ana@example.com', KYLE = 'kyle@example.com', JANA = 'jana@example.com', BEN = 'ben@example.com'
const DAY = addDays(todayInStudio(), 9)

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [JANA, 'Jana'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
})

describe('book with friends', () => {
  it('books your slot, holds the next ones for each friend; they confirm or it opens up', async () => {
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [KYLE, JANA] }, ANA)
    expect(r.ok).toBe(true)
    const day = (await getDoc(`schedule_days/${DAY}`))!
    expect(day.cliff2['780'].email).toBe(ANA)
    expect(day.cliff2['900'].hold.fromName).toBe('Ana')
    expect(day.cliff2['1020'].email).toBe(JANA)
    // Someone else can't take a held slot.
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 900 }, BEN)).message).toMatch(/held for someone/)
    // Kyle confirms: it becomes his shoot.
    const [kyleInvite, janaInvite] = r.result.inviteIds
    const a = await call('answerInvite', { id: kyleInvite, accept: true }, KYLE)
    expect(a.ok).toBe(true)
    expect((await getDoc(`shoots/${a.result.shootId}`))!).toMatchObject({ creatorEmail: KYLE, start: 900, invitedBy: ANA })
    expect((await getDoc(`schedule_days/${DAY}`))!.cliff2['900'].shootId).toBe(a.result.shootId)
    // Jana declines: the slot is free again.
    await call('answerInvite', { id: janaInvite, accept: false }, JANA)
    expect((await getDoc(`schedule_days/${DAY}`))!.cliff2['1020']).toBeUndefined()
    expect((await call('answerInvite', { id: kyleInvite, accept: true }, BEN)).error).toBe('PERMISSION_DENIED')
  })

  it('an ended hold can be booked by anyone; the late confirm is refused', async () => {
    const r = await call('bookWithFriends', { place: 'cliff1', date: DAY, start: 780, friends: [KYLE] }, ANA)
    const id = r.result.inviteIds[0]
    await put(`schedule_invites/${id}`, { ...(await getDoc(`schedule_invites/${id}`))!, until: '2000-01-01T00:00' })
    const day = (await getDoc(`schedule_days/${DAY}`))!
    day.cliff1['900'].hold.until = '2000-01-01T00:00'
    await put(`schedule_days/${DAY}`, day)
    expect((await call('answerInvite', { id, accept: true }, KYLE)).message).toMatch(/minutes ran out/)
    expect((await call('bookShoot', { place: 'cliff1', date: DAY, start: 900 }, BEN)).ok).toBe(true)
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
