import { describe, it, expect } from 'vitest'
import { summarizeCreator } from '../../src/lib/history'
import { wasReturnedLate } from '../../functions/src/booking'
import type { Reservation } from '../../src/services/reservations'
import type { Item } from '../../src/types'

const sundays = { closedWeekdays: [0], closedDates: [] as string[] }
const item = (id: string, replacementCost?: number) => ({ id, name: id, replacementCost } as Item)
const items = new Map([['cop', item('cop', 250)], ['chair', item('chair', 45)], ['mystery', item('mystery')]])

const res = (p: Partial<Reservation>): Reservation => ({
  id: 'r', title: 'Shoot', creatorEmail: 'alex@example.com', creatorName: 'Alex', startDate: '2026-10-14', endDate: '2026-10-14',
  status: 'returned', lines: [], createdAt: '', updatedAt: '', history: [], ...p,
})

describe('returned late?', () => {
  it('a Wednesday shoot brought back Thursday 9am is on time; 11am is late', () => {
    expect(wasReturnedLate('2026-10-14', '2026-10-15T13:00:00Z', sundays)).toBe(false)
    expect(wasReturnedLate('2026-10-14', '2026-10-15T15:00:00Z', sundays)).toBe(true)
  })
})

describe('creator history summary', () => {
  const list = [
    res({ id: 'a', returnInfo: { at: '2026-10-15T13:00:00Z', by: 'alex', photos: [] },
      lines: [{ itemId: 'cop', itemName: 'Cop costume', qty: 1, checkIn: { result: 'damaged', note: 'Torn sleeve', by: 'sam', at: '' } }] }),
    res({ id: 'b', startDate: '2026-10-20', endDate: '2026-10-20', returnInfo: { at: '2026-10-22T16:00:00Z', by: 'alex', photos: [] },
      lines: [
        { itemId: 'chair', itemName: 'Chair', qty: 4, checkIn: { result: 'missing', missingQty: 2, note: 'Lost on set', by: 'sam', at: '' } },
        { itemId: 'mystery', itemName: 'Mystery box', qty: 1, checkIn: { result: 'missing', note: '?', by: 'sam', at: '' } },
      ] }),
    res({ id: 'c', status: 'cancelled' }),
    res({ id: 'd', status: 'collected', startDate: '2026-10-28', endDate: '2026-10-28' }),
  ]
  const s = summarizeCreator(list, items, sundays, new Date('2026-10-30T12:00:00Z'))
  it('counts bookings', () => {
    expect(s).toMatchObject({ total: 4, completed: 2, cancelled: 1 })
  })
  it('spots late returns and props out late now', () => {
    expect(s.lateReturns.map(r => r.id)).toEqual(['b'])
    expect(s.lateNow.map(r => r.id)).toEqual(['d'])
  })
  it('adds up replacement costs of damaged and missing props', () => {
    expect(s.incidents.map(i => [i.line.itemId, i.units, i.cost])).toEqual([['cop', 1, 250], ['chair', 2, 90], ['mystery', 1, 0]])
    expect(s.incidentCost).toBe(340)
    expect(s.unknownCosts).toBe(1)
  })
})
