// The monthly Cliff 1 draw: wishlist window, the draw booking 4 spread-out slots each, undo.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { monthAfter, wishWindow } from '../../functions/src/monthlyDraw'

const ANA = 'ana@example.com', BEN = 'ben@example.com', DEE = 'dee@example.com', OWNER = 'alexisricordi@gmail.com'
const NEXT = monthAfter(monthAfter(todayInStudio().slice(0, 7)))   // a month that hasn't started (and isn't this one's draw)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
})

describe('monthly draw', () => {
  it('the wishlist only opens on the 15th of the month before', async () => {
    const r = await call('saveWishlist', { month: NEXT, wishes: [] }, ANA)
    // NEXT is two months away: its window hasn't opened yet.
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/opens on the 15th/)
    expect(wishWindow(NEXT).opens > todayInStudio()).toBe(true)
  })

  it('the draw books 4 spread-out Cliff 1 slots for every creator (Props only too) + the owner; undo takes them off', async () => {
    const r = await call('runMonthlyDraw', { month: NEXT }, OWNER)
    expect(r.ok, r.message).toBe(true)
    const draw = (await getDoc(`monthly_draws/${NEXT}`))!
    expect(draw.status).toBe('done')
    for (const email of [ANA, BEN, DEE, OWNER]) {
      const mine = draw.placements.filter((p: any) => p.email === email)
      expect(mine).toHaveLength(4)
      const days = mine.map((p: any) => Number(p.date.slice(8, 10))).sort((a: number, b: number) => a - b)
      expect(days.every((d: number, i: number) => i === 0 || d - days[i - 1] >= 2)).toBe(true)
      const sh = (await getDoc(`shoots/${mine[0].shootId}`))!
      expect(sh).toMatchObject({ kind: 'monthly', place: 'cliff1', status: 'booked', draw: NEXT, creatorEmail: email })
    }
    expect((await call('runMonthlyDraw', { month: NEXT }, OWNER)).message).toMatch(/already ran/)
    expect((await call('runMonthlyDraw', { month: NEXT }, ANA)).error).toBe('PERMISSION_DENIED')
    const u = await call('undoMonthlyDraw', { month: NEXT }, OWNER)
    expect(u.ok, u.message).toBe(true)
    expect(u.result.removed).toBe(16)
    expect((await getDoc(`shoots/${draw.placements[0].shootId}`))!.status).toBe('cancelled')
    expect((await getDoc(`monthly_draws/${NEXT}`))!.status).toBe('undone')
  })
})
