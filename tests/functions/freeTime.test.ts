// Free-time booking (owner, Nov 24): any start/end in 15-minute steps; up to 2 hours per person; longer needs one more person
// per extra 2 hours, all on ONE booking that lists everyone (no confirming); overlaps refused, back to back fine.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, tokenFor } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const ANA = 'ana@example.com', KYLE = 'kyle@example.com', BEN = 'ben@example.com', MAANIK = 'maanik@example.com'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
})
const book = (who: string, d: Record<string, unknown>) => call('bookShoot', { place: 'cliff1', date: FRI, ...d }, who)

describe('free-time booking', () => {
  it('any times in 15-minute steps, up to 2 hours alone', async () => {
    const r = await book(ANA, { start: 795, end: 915 })
    expect(r.ok, r.message).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ start: 795, end: 915, from: `${FRI}T13:15`, to: `${FRI}T15:15` })
    expect((await getDoc(`schedule_days/${FRI}`))!.cliff1['795']).toMatchObject({ shootId: r.result.id, time: { start: 795, end: 915 } })
    const long = await book(BEN, { start: 915, end: 1095 })
    expect(long.ok).toBe(false)
    expect(long.message).toMatch(/up to 2 hours.*add 1 more person/)
  })

  it('overlaps are refused, back to back is fine', async () => {
    expect((await book(ANA, { start: 795, end: 915 })).ok).toBe(true)
    const over = await book(BEN, { start: 900, end: 990 })
    expect(over.ok).toBe(false)
    expect(over.message).toMatch(/Ana has 1:15 PM–3:15 PM/)
    expect((await book(BEN, { start: 915, end: 1035 })).ok).toBe(true)
  })

  it('a collaborator adds 2 hours: one booking lists everyone, and they can see it', async () => {
    const r = await book(ANA, { start: 795, end: 1035, with: [KYLE, 'guest:Moe Smith'] })
    expect(r.ok, r.message).toBe(true)
    const sh = (await getDoc(`shoots/${r.result.id}`))!
    expect(sh).toMatchObject({ creatorEmail: ANA, people: [ANA, KYLE, 'guest:moe-smith'], withNames: ['Kyle', 'Moe Smith'] })
    // Kyle (a collaborator) can read the booking (security rules), and it counts as his booking that day.
    const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/shoots/${r.result.id}`, { headers: { Authorization: `Bearer ${await tokenFor(KYLE)}` } })
    expect(res.ok).toBe(true)
    expect((await call('bookShoot', { place: 'cliff2', date: FRI, start: 1200, end: 1260 }, KYLE)).message).toMatch(/house booking that day/)
    // Up to 6 hours with two collaborators; 6 h 15 min is too long.
    expect((await book(BEN, { place: 'cliff2', start: 600, end: 975, with: [KYLE] })).ok).toBe(false)
  })

  it('a move keeps the length; the team is not limited', async () => {
    const r = await book(ANA, { start: 795, end: 885 })
    await call('decideBooking', { id: r.result.id, approve: true }, MAANIK)
    expect((await call('moveShoot', { id: r.result.id, place: 'cliff1', date: FRI, start: 1200 }, MAANIK)).ok).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ start: 1200, end: 1290 })
    const t = await call('bookShoot', { place: 'cliff2', date: FRI, start: 600, end: 1080, forEmail: BEN }, MAANIK)
    expect(t.ok, t.message).toBe(true)
  })
})
