// Phone notifications end to end in the emulator: a phone signs up, events trigger pings
// (logged to push_log instead of sent), and team pings reach the right team.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const MAANIK = 'maanik@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)

const docs = async (col: string) => {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/${col}?pageSize=100`, { headers: { Authorization: 'Bearer owner' } })
  const list = (await res.json()).documents ?? []
  return Promise.all(list.map((d: { name: string }) => getDoc(d.name.split('/documents/')[1]))) as Promise<Record<string, any>[]>
}
const pings = async (title: RegExp) => (await docs('push_log')).filter(p => title.test(p.title))

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
})

describe('phone notifications', () => {
  it('a phone signs up (server-only record), can test, and can sign out', async () => {
    const token = 'emulator-0123456789abcdef-test-device'
    expect((await call('registerPush', { token, platform: 'ios-app' }, ANA)).ok).toBe(true)
    expect((await docs('push_tokens')).map(d => d.email)).toEqual([ANA])
    expect((await call('registerPush', { token: 'short' }, ANA)).ok).toBe(false)
    expect((await call('testPush', {}, ANA)).result.sent).toBe(1)
    expect((await pings(/Notifications are on/))[0].to).toEqual([ANA])
    expect((await call('unregisterPush', { token }, BEN)).ok).toBe(true)   // someone else's token: ignored
    expect((await docs('push_tokens')).length).toBe(1)
    await call('unregisterPush', { token }, ANA)
    expect((await docs('push_tokens')).length).toBe(0)
  })

  it('a friend invite pings the friend; confirming pings the inviter', async () => {
    const r = await call('bookWithFriends', { place: 'cliff2', date: FRI, start: 780, friends: [BEN], mySlots: 1 }, ANA)
    expect(r.ok, r.message).toBe(true)
    expect(await waitFor(async () => (await pings(/invited you to film/)).length > 0)).toBe(true)
    expect((await pings(/invited you to film/))[0].to).toEqual([BEN])
    expect((await call('answerInvite', { id: r.result.inviteIds[0], accept: true }, BEN)).ok).toBe(true)
    expect(await waitFor(async () => (await pings(/Ben confirmed/)).length > 0)).toBe(true)
    expect((await pings(/Ben confirmed/))[0].to).toEqual([ANA])
  })

  it('the team booking someone a shoot pings that creator; team pings go to the team', async () => {
    expect((await call('bookShoot', { place: 'cliff1', date: FRI, start: 1260, forEmail: ANA }, MAANIK)).ok).toBe(true)
    expect(await waitFor(async () => (await pings(/new shoot/)).length > 0)).toBe(true)
    expect((await pings(/new shoot/))[0].to).toEqual([ANA])
    // Booking your own shoot doesn't ping you.
    expect((await call('bookShoot', { place: 'cliff2', date: addDays(FRI, 3), start: 780 }, BEN)).ok).toBe(true)
    await new Promise(r => setTimeout(r, 1500))
    expect((await pings(/new shoot/)).length).toBe(1)
  })
})
