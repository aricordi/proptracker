// Reports in the chat (owner, Nov 3): props missing at pickup, damage + charging case at returns; kits that stay at the
// houses; offsite gear back by the end of the day.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, bookGear } from './helpers'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const ANA = 'rp-ana@example.com', ARTS = 'rp-arts@example.com'
const PHOTO = 'http://127.0.0.1:9199/v0/b/demo/o/reservation-photos%2Fx%2Freturn%2Fp.jpg?alt=media'
const lines = [{ offerId: 'fx3', kind: 'bundle', name: 'FX3 Bundle', qty: 1, photo: null,
  pieces: [{ itemId: 'cam', qty: 1, name: 'Sony FX3 body' }, { itemId: 'bat', qty: 2, name: 'NP-FZ100 battery' }] }]
let DAY = addDays(todayInStudio(), 4); if (weekday(DAY) === 0) DAY = addDays(DAY, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put('gear_bundles/fx3', { name: 'FX3 Bundle', kind: 'bundle', category: 'Camera', archived: false, pieces: lines[0].pieces, housesOnly: true })
  await put('gear_bundles/a7', { name: 'A7S kit', kind: 'bundle', category: 'Camera', archived: false, pieces: [{ itemId: 'a7', qty: 1, name: 'A7S III' }] })
})

describe('gear returns', () => {
  it('records damage and the charging case, and puts the damage on the booking\'s problems', async () => {
    const from = addMinutes(nowStamp(), -60), to = addMinutes(nowStamp(), 60)
    await put('gear_bookings/g1', { title: 'Shoot', creatorEmail: ANA, creatorName: 'Ana', date: from.slice(0, 10), start: 0, end: 60, from, to, lines, offerIds: ['fx3'], status: 'out', history: [] })
    const r = await call('returnGear', { id: 'g1', photos: [PHOTO], charging: true, damage: [{ itemId: 'cam', name: 'Sony FX3 body', note: 'screen cracked' }] }, ANA)
    expect(r.ok).toBe(true)
    const b = (await getDoc('gear_bookings/g1'))!
    expect(b.return).toMatchObject({ charging: true, damage: [{ name: 'Sony FX3 body', note: 'screen cracked' }] })
    expect(b.problems[0]).toMatchObject({ kind: 'damaged_at_return', name: 'Sony FX3 body', note: 'screen cracked' })
  })
})

describe('kits that stay at the houses', () => {
  it('an offsite shoot can\'t reserve a houses-only kit, and its gear is due back at the end of the day', async () => {
    await put('shoots/off', { creatorEmail: ANA, creatorName: 'Ana', status: 'booked', place: 'offsite', where: 'Park', date: DAY, start: 600, end: 720, from: `${DAY}T10:00`, to: `${DAY}T12:00`, kind: 'offsite', history: [] })
    const no = await bookGear({ title: 'x', date: DAY, start: 600, end: 720, lines: [{ offerId: 'fx3', qty: 1 }], scheduleShootId: 'off' }, ANA)
    expect(no.message).toMatch(/stays at the houses/)
    const ok = await bookGear({ title: 'x', date: DAY, start: 600, end: 720, lines: [{ offerId: 'a7', qty: 1 }], scheduleShootId: 'off' }, ANA)
    expect(ok.ok).toBe(true)
    expect((await getDoc(`gear_bookings/${ok.result.id}`))!.end).toBe(1440)
  })
})

describe('props pickup and return', () => {
  it('tapping missing props at pickup records them; damage at the return is recorded', async () => {
    await put('items/chair', { name: 'Diner chair', quantity: 4, condition: 'good', collection: 'company', archived: false })
    await put('reservations/r1', { title: 'Diner', creatorEmail: ANA, creatorName: 'Ana', startDate: DAY, endDate: DAY, status: 'packed',
      lines: [{ itemId: 'chair', itemName: 'Diner chair', qty: 2, pick: { state: 'picked' } }], itemIds: ['chair'], history: [] })
    const p = await call('confirmPickup', { id: 'r1', allReceived: false, missing: [{ itemId: 'chair', qty: 1 }] }, ANA)
    expect(p.ok).toBe(true)
    const r = (await getDoc('reservations/r1'))!
    expect(r.pickup).toMatchObject({ allReceived: false, missing: [{ itemId: 'chair', qty: 1, name: 'Diner chair' }] })
    expect(r.pickup.issue).toMatch(/Missing: Diner chair/)
    const back = await call('startReturn', { id: 'r1', photos: [PHOTO], damaged: [{ itemId: 'chair', note: 'leg wobbly' }] }, ANA)
    expect(back.ok).toBe(true)
    expect((await getDoc('reservations/r1'))!.returnInfo.damaged).toEqual([{ itemId: 'chair', note: 'leg wobbly', name: 'Diner chair' }])
  })
  it('a prop marked "not available" at picking can\'t be reported damaged at the return', async () => {
    await put('reservations/r2', { title: 'Diner', creatorEmail: ANA, creatorName: 'Ana', startDate: DAY, endDate: DAY, status: 'collected',
      lines: [{ itemId: 'chair', itemName: 'Diner chair', qty: 1, pick: { state: 'picked' } }, { itemId: 'cop', itemName: 'Cop costume', qty: 1, pick: { state: 'unavailable', reason: 'Torn' } }],
      itemIds: ['chair', 'cop'], history: [] })
    expect((await call('startReturn', { id: 'r2', photos: [PHOTO], damaged: [{ itemId: 'cop', note: 'ripped' }, { itemId: 'chair', note: 'scratch' }] }, ANA)).ok).toBe(true)
    expect((await getDoc('reservations/r2'))!.returnInfo.damaged.map((d: { itemId: string }) => d.itemId)).toEqual(['chair'])
  })
})
