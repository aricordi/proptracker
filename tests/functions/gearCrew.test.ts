// Shared gear for friends filming back to back (owner, Oct 20: "one booking for the group but everyone
// needs to be responsible"): one gear booking covers the block; any of them picks it up / returns it.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'

const ANA = 'crew-ana@example.com', KYLE = 'crew-kyle@example.com', JANA = 'crew-jana@example.com', BEN = 'crew-ben@example.com'
const DAY = addDays(todayInStudio(), 8)
const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function shoot(id: string, email: string, name: string, start: number, place = 'cliff1', date = DAY) {
  await put(`shoots/${id}`, { creatorEmail: email, creatorName: name, place, where: '', date, month: date.slice(0, 7), start, end: start + 120,
    from: `${date}T${hh(start)}`, to: `${date}T${hh(start + 120)}`, kind: 'extra', status: 'booked', bookedBy: email, createdAt: '2026-01-01T00:00:00.000Z', history: [] })
}
const gear = (extra: Record<string, unknown> = {}) => ({ title: 'Haunted house', date: DAY, start: 780, end: 1020, lines: [{ offerId: 'fx3', qty: 1 }], scheduleShootId: 'a', ...extra })

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [JANA, 'Jana'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
  await put('gear_bundles/fx3', { name: 'FX3 kit', kind: 'bundle', archived: false, pieces: [{ itemId: 'g1', qty: 1, name: 'FX3' }] })
  await shoot('a', ANA, 'Ana', 780)       // 1–3 PM
  await shoot('k', KYLE, 'Kyle', 900)     // 3–5 PM
  await shoot('j', JANA, 'Jana', 1140)    // 7–9 PM (gap after Kyle)
  await shoot('b', BEN, 'Ben', 900, 'cliff2')
})

describe('booking shared gear', () => {
  it('one booking for the whole block; the friend can read it and it shows on their shoot', async () => {
    const r = await call('createGearBooking', gear({ crewShootIds: ['k'] }), ANA)
    expect(r.ok).toBe(true)
    const b = await getDoc(`gear_bookings/${r.result.id}`)
    expect(b).toMatchObject({ creatorEmail: ANA, crewEmails: [KYLE], crewShootIds: ['k'], start: 780, end: 1020 })
    expect((await getDoc('gear_holds/fx3'))!.entries[0]).toMatchObject({ from: `${DAY}T13:00`, to: `${DAY}T17:00` })
    expect((await getDoc('shoots/k'))!.history.at(-1)).toMatchObject({ action: 'gear-added' })
  })

  it('the hours must be the whole block', async () => {
    const r = await call('createGearBooking', gear({ end: 900, crewShootIds: ['k'] }), ANA)
    expect(r.message).toMatch(/whole block \(1 PM–5 PM\)|whole block/)
  })

  it('only friends filming back to back, same day and same house', async () => {
    expect((await call('createGearBooking', gear({ start: 780, end: 1260, crewShootIds: ['j'] }), ANA)).message).toMatch(/back to back/)
    expect((await call('createGearBooking', gear({ crewShootIds: ['b'] }), ANA)).message).toMatch(/back to back/)
  })
})

describe('everyone is responsible', () => {
  async function out(id: string, status = 'held', startIn = 10, extra: Record<string, unknown> = {}) {
    const from = addMinutes(nowStamp(), startIn), to = addMinutes(from, 240)
    await put(`gear_bookings/${id}`, { title: 'Shoot', creatorEmail: ANA, creatorName: 'Ana', crew: [{ email: KYLE, name: 'Kyle', shootId: 'k' }],
      crewEmails: [KYLE], crewShootIds: ['k'], date: from.slice(0, 10), start: 0, end: 60, from, to, pickupDay: from.slice(0, 10), closedDay: false,
      lines: [{ offerId: 'fx3', kind: 'bundle', name: 'FX3 kit', qty: 1, photo: null, pieces: [{ itemId: 'g1', qty: 1, name: 'FX3' }] }],
      offerIds: ['fx3'], status, history: [], createdAt: from, ...extra })
  }
  it('a friend on the crew can pick it up and return it; others can\'t', async () => {
    await out('g')
    expect((await call('pickUpGear', { id: 'g', missing: [], signed: true }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('pickUpGear', { id: 'g', missing: [], signed: true }, KYLE)).ok).toBe(true)
    expect((await call('returnGear', { id: 'g', photos: ['https://example.com/p.jpg'], usedBy: [] }, KYLE)).message).toMatch(/who used/)
    expect((await call('returnGear', { id: 'g', photos: ['https://example.com/p.jpg'], usedBy: [KYLE, BEN] }, KYLE)).ok).toBe(true)
    // Only the people who used it are on it (Ben isn't on the crew, so he's ignored).
    expect(await getDoc('gear_bookings/g')).toMatchObject({ status: 'returned', usedBy: [KYLE], usedByNames: ['Kyle'] })
  })

  it('late shared gear blocks only whoever signed for it at pickup', async () => {
    await out('late', 'out', -400, { pickup: { at: 'x', by: KYLE, missing: [] } })
    const k = await call('createGearBooking', { title: 'x', date: DAY, start: 900, end: 1020, lines: [{ offerId: 'fx3', qty: 1 }], scheduleShootId: 'k' }, KYLE)
    expect(k.message).toMatch(/late/)
    expect((await call('createGearBooking', gear(), ANA)).ok).toBe(true)
  })

  it('missing at check-in goes on the people who used it', async () => {
    await out('back', 'returned', -400, { usedBy: [ANA] })
    await put('users/team@example.com', { email: 'team@example.com', role: 'equipment', active: true })
    expect((await call('checkInGear', { id: 'back', missing: ['fx3|g1|1'] }, 'team@example.com')).ok).toBe(true)
    expect((await getDoc('gear_bookings/back'))!.problems?.[0]?.usedBy).toEqual([ANA])
  })

  it('a friend can take themselves off held gear (not once it is out); only the booker changes it', async () => {
    await out('g')
    expect((await call('editGearBooking', { id: 'g', lines: [{ offerId: 'fx3', qty: 1 }] }, KYLE)).error).toBe('PERMISSION_DENIED')
    expect((await call('editGearBooking', { id: 'g', leave: true }, KYLE)).ok).toBe(true)
    expect((await getDoc('gear_bookings/g'))!.crewEmails).toEqual([])
    await out('g2', 'out')
    expect((await call('editGearBooking', { id: 'g2', leave: true }, KYLE)).message).toMatch(/picked up/)
  })

  it('the booker can add a friend later; hours grow to the block', async () => {
    const r = await call('createGearBooking', gear({ end: 900 }), ANA)
    expect((await call('editGearBooking', { id: r.result.id, lines: [{ offerId: 'fx3', qty: 1 }], crewShootIds: ['k'] }, ANA)).ok).toBe(true)
    expect(await getDoc(`gear_bookings/${r.result.id}`)).toMatchObject({ crewEmails: [KYLE], start: 780, end: 1020 })
  })

  it('cancelling the friend\'s shoot takes them off; moving it to another day is refused while on the gear', async () => {
    const r = await call('createGearBooking', gear({ crewShootIds: ['k'] }), ANA)
    expect((await call('moveShoot', { id: 'k', place: 'cliff1', date: addDays(DAY, 1), start: 900 }, KYLE)).message).toMatch(/shared gear/)
    expect((await call('cancelShoot', { id: 'k' }, KYLE)).ok).toBe(true)
    const b = await getDoc(`gear_bookings/${r.result.id}`)
    expect(b).toMatchObject({ status: 'held', crewEmails: [] })
  })
})
