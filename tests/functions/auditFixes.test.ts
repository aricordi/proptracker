// Fixes from the edge-case audit (Nov 5): approving too late, swaps and the priority days, gear for unapproved shoots.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'

const MAANIK = 'maanik@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com'
const today = todayInStudio()
let FRI = addDays(today, 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
const THU = addDays(FRI, 6)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  for (const [e, n] of [[ANA, 'Ana'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n, access: 'full' })
})

const shoot = (id: string, email: string, name: string, date: string, extra: Record<string, unknown> = {}) => put(`shoots/${id}`, {
  creatorEmail: email, creatorName: name, place: 'cliff1', date, start: 780, end: 900, from: `${date}T13:00`, to: `${date}T15:00`, kind: 'extra', status: 'booked', where: '', ...extra })

describe('audit fixes', () => {
  it('a request whose time already started can\'t be approved', async () => {
    const from = addMinutes(nowStamp(), -20)
    await shoot('late1', ANA, 'Ana', from.slice(0, 10), { status: 'requested', from, to: addMinutes(from, 120) })
    const r = await call('decideBooking', { id: 'late1', approve: true }, MAANIK)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/already started/)
  })

  it('a swap can\'t put someone on a locked priority-day slot', async () => {
    await shoot('a1', ANA, 'Ana', THU)   // Thursday Cliff 1 (priority day, locked until Sunday's release)
    await shoot('b1', BEN, 'Ben', FRI)
    const r = await call('requestSwap', { myShootId: 'b1', theirShootId: 'a1' }, BEN)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/priority/)
  })

  it('gear can\'t be taken for a shoot that is still a request', async () => {
    const from = addMinutes(nowStamp(), 10)
    await shoot('req1', ANA, 'Ana', from.slice(0, 10), { status: 'requested', from, to: addMinutes(from, 120), start: Number(from.slice(11, 13)) * 60 + Number(from.slice(14, 16)) })
    const r = await call('takeGear', { scheduleShootId: 'req1', photos: ['http://127.0.0.1:9199/v0/b/demo/o/shoot-photos%2Fx%2Fp.jpg?alt=media'], lines: [{ offerId: 'k', qty: 1 }] }, ANA)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/approved/)
    expect(await getDoc('shoots/req1')).toBeTruthy()
  })
})
