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

  it('the last friend leaving shrinks the gear hours, so their slot frees up', async () => {
    const r = await call('createGearBooking', gear({ crewShootIds: ['k'] }), ANA)
    expect((await call('editGearBooking', { id: r.result.id, leave: true }, KYLE)).ok).toBe(true)
    expect(await getDoc(`gear_bookings/${r.result.id}`)).toMatchObject({ start: 780, end: 900, crewEmails: [] })
    expect((await getDoc('gear_holds/fx3'))!.entries[0]).toMatchObject({ from: `${DAY}T13:00`, to: `${DAY}T15:00` })
  })
})

describe('handing gear over on the spot', () => {
  const until = () => { const n = nowStamp(); const m = Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16)); return Math.ceil((m + 60) / 30) * 30 }
  async function outNow(id: string) {
    const from = addMinutes(nowStamp(), -30), to = addMinutes(nowStamp(), 30)
    await put(`gear_bookings/${id}`, { title: 'Shoot', creatorEmail: ANA, creatorName: 'Ana', crew: [{ email: KYLE, name: 'Kyle', shootId: 'k' }],
      crewEmails: [KYLE], crewShootIds: ['k'], date: from.slice(0, 10), start: 0, end: 60, from, to, pickupDay: from.slice(0, 10), closedDay: false,
      lines: [{ offerId: 'fx3', kind: 'bundle', name: 'FX3 kit', qty: 1, photo: null, pieces: [{ itemId: 'g1', qty: 1, name: 'FX3' }] }],
      offerIds: ['fx3'], status: 'out', pickup: { at: from, by: ANA, missing: [] }, history: [], createdAt: from })
    await put('gear_holds/fx3', { entries: [{ bookingId: id, from, to, qty: 1 }] })
  }
  it('ends the group\'s booking and starts one for the new person; missing at their pickup goes on the group', async () => {
    if (until() > 1440) return   // too close to midnight to test
    await outNow('g')
    const r = await call('handOverGear', { id: 'g', toEmail: BEN, end: until(), usedBy: [ANA] }, ANA)
    expect(r.ok).toBe(true)
    expect(await getDoc('gear_bookings/g')).toMatchObject({ status: 'checked_in', usedBy: [ANA], handedTo: { email: BEN, bookingId: r.result.id } })
    expect(await getDoc(`gear_bookings/${r.result.id}`)).toMatchObject({ creatorEmail: BEN, status: 'held', handedFrom: { bookingId: 'g', email: ANA } })
    expect((await getDoc('gear_holds/fx3'))!.entries.map((e: any) => e.bookingId)).toEqual([r.result.id])
    expect((await call('pickUpGear', { id: r.result.id, missing: ['fx3|g1|1'], signed: true }, BEN)).ok).toBe(true)
    expect((await getDoc('gear_bookings/g'))!.problems?.[0]).toMatchObject({ kind: 'missing_after', usedBy: [ANA] })
  })
  it('refused for people not on the gear, or when someone else has it booked before then', async () => {
    if (until() > 1440) return
    await outNow('g')
    expect((await call('handOverGear', { id: 'g', toEmail: JANA, end: until() }, BEN)).error).toBe('PERMISSION_DENIED')
    const e = await getDoc('gear_holds/fx3')
    await put('gear_holds/fx3', { entries: [...e!.entries, { bookingId: 'later', from: addMinutes(nowStamp(), 40), to: addMinutes(nowStamp(), 200), qty: 1 }] })
    expect((await call('handOverGear', { id: 'g', toEmail: BEN, end: until() }, KYLE)).message).toMatch(/booked before/)
  })
})
