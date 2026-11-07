// Prop insights for the arts department + similar props by tags (owner, Nov 7).
import { describe, it, expect } from 'vitest'
import { propInsights, wantedKey, similarByTags, studioDay, addDaysTo, agoLabel } from '../../src/lib/propInsights'
import type { Item } from '../../src/types'
import type { Reservation, ReservationLine, BuildLine } from '../../src/services/reservations'

const item = (id: string, x: Partial<Item> = {}): Item => ({
  id, name: id, photos: [], tags: [], categoryId: 'prop', quantity: 1, condition: 'good', status: 'available', archived: false,
  collection: 'company', createdAt: '2026-01-01T00:00:00Z', updatedAt: '', createdBy: '', updatedBy: '', ...x,
}) as Item
let n = 0
const res = (who: string, asked: string, shoot: string, lines: Partial<ReservationLine>[], x: Partial<Reservation> = {}): Reservation => ({
  id: `r${++n}`, title: 'Video', creatorEmail: `${who}@x.com`, creatorName: who, startDate: shoot, endDate: shoot, status: 'returned',
  lines: lines.map(l => ({ itemId: 'a', itemName: 'A', qty: 1, ...l })) as ReservationLine[], createdAt: `${asked}T15:00:00Z`, updatedAt: '', history: [], ...x,
}) as Reservation

const TODAY = '2026-11-07'
const items = [
  item('lamp', { name: 'Brass lamp', quantity: 1, replacementCost: 40 }),
  item('mask', { name: 'Lincoln mask', quantity: 2, replacementCost: 900, categoryId: 'costume' }),
  item('cup', { name: 'Coffee cup', quantity: 6, replacementCost: 5 }),
  item('old', { name: 'Old lamp copy', archived: true, mergedInto: 'lamp' }),
  item('never', { name: 'Dusty globe', createdAt: '2025-01-01T00:00:00Z' }),
  item('broken', { name: 'Cracked vase', condition: 'damaged', replacementCost: 30 }),
  item('lost', { name: 'Toy gun', quantity: 3, missingQty: 1 }),
  item('mine', { name: 'Grandma lamp', collection: 'personal' }),
]
const reservations: Reservation[] = [
  res('ana', '2026-11-06', '2026-11-10', [{ itemId: 'lamp' }, { itemId: 'cup', qty: 2 }]),
  res('ben', '2026-11-05', '2026-11-10', [{ itemId: 'lamp' }]),                                // lamp: both units of 1 → ran out on the 10th
  res('cat', '2026-11-01', '2026-11-03', [{ itemId: 'old' }, { itemId: 'mask', qty: 2 }]),     // old lamp copy → counts for lamp
  res('ana', '2026-10-20', '2026-10-22', [{ itemId: 'mask', qty: 2, checkIn: { result: 'damaged', by: 'k', at: '2026-10-23T14:00:00Z' } }]),
  res('ben', '2026-10-25', '2026-10-27', [{ itemId: 'lost', qty: 2, checkIn: { result: 'missing', missingQty: 1, by: 'k', at: '2026-10-28T14:00:00Z' } }]),
  res('dan', '2026-11-04', '2026-11-09', [{ itemId: 'lamp', pick: { state: 'unavailable', reason: 'not on the shelf', by: 'k', at: '' } }], { status: 'declined' }),
  res('eve', '2026-11-02', '2026-11-12', [{ itemId: 'cup' }], { status: 'cancelled' }),         // cancelled: never counts
  res('ana', '2026-11-03', '2026-11-08', [], { builds: [{ id: 'b1', description: 'Fog machine', qty: 1, state: 'unavailable' } as BuildLine] }),
  res('ben', '2026-11-06', '2026-11-11', [], { builds: [{ id: 'b2', description: 'A fog machines!', qty: 1, state: 'todo' } as BuildLine] }),
]

describe('prop insights', () => {
  const all = propInsights({ items, reservations, today: TODAY, period: 'all', highValue: 500 })
  it('most booked follows merged props and skips cancelled requests', () => {
    const lamp = all.mostBooked.find(s => s.id === 'lamp')!
    expect(lamp.requests).toBe(4)          // ana, ben, cat (old copy), dan (declined still shows demand)
    expect(lamp.creators).toBe(4)
    expect(all.mostBooked[0].id).toBe('lamp')
    expect(all.mostBooked.find(s => s.id === 'cup')!.requests).toBe(1)   // eve's cancelled request doesn't count
  })
  it('periods count what was asked for in them', () => {
    const week = propInsights({ items, reservations, today: TODAY, period: '7d', highValue: 500 })
    expect(week.from).toBe('2026-11-01')
    expect(week.mostBooked.find(s => s.id === 'mask')?.requests).toBe(1)   // Oct 20 is outside the week
    expect(week.totals.requests).toBe(6)   // Nov 1–7, not cancelled (incl. the 2 build-only requests and the declined one)
    expect(week.totals.declined).toBe(1)
  })
  it('finds props that ran out, couldn’t be found or were turned away', () => {
    const lamp = all.unavailable.find(u => u.id === 'lamp')!
    expect(lamp.fullDays).toBe(2)           // Nov 3 (old copy) and Nov 10 (ana + ben)
    expect(lamp.cantFind).toBe(1)
    expect(lamp.declined).toBe(1)
    expect(lamp.buyMore).toBe(true)
    expect(all.unavailable.find(u => u.id === 'mask')!.fullDays).toBe(2)   // both units on Oct 22 and Nov 3
    expect(all.unavailable.some(u => u.id === 'cup')).toBe(false)          // 2 of 6 isn't running out
  })
  it('groups the things creators asked us to make or find', () => {
    expect(wantedKey('A fog machines!')).toBe(wantedKey('Fog machine'))
    expect(all.wanted).toHaveLength(1)
    expect(all.wanted[0]).toMatchObject({ requests: 2, couldntGet: 1, label: 'A fog machines!' })
  })
  it('puts damage and loss on the creator who booked it, with the value', () => {
    expect(all.damagedBy).toEqual([expect.objectContaining({ email: 'ana@x.com', units: 1, value: 900 })])
    expect(all.missingBy).toEqual([expect.objectContaining({ email: 'ben@x.com', units: 1, valueMissing: true })])
    expect(all.totals.lossValue).toBe(900)
  })
  it('lists what needs attention now and what was never asked for', () => {
    expect(all.damagedNow.map(i => i.id)).toEqual(['broken'])
    expect(all.missingNow.map(i => i.id)).toEqual(['lost'])
    expect(all.neverBooked.map(i => i.id)).toEqual(['never', 'broken'])   // oldest first; personal props never count
    expect(all.totals.catalogue).toBe(6)
  })
  it('trending = last 2 weeks against the 2 before, at least 2 requests', () => {
    expect(all.trending.map(t => t.stat.id)).toEqual(['lamp'])
    expect(all.trending[0]).toMatchObject({ recent: 4, before: 0 })
  })
  it('grab-and-go wants often, several people, low value', () => {
    expect(all.grabAndGo.map(g => g.id)).toEqual(['lamp'])   // lamp: 3 requests (declined don't count), 3 creators, $40
    const pricey = propInsights({ items, reservations: [...reservations, res('fay', '2026-11-06', '2026-11-20', [{ itemId: 'mask' }])], today: TODAY, period: 'all', highValue: 500 })
    expect(pricey.grabAndGo.some(g => g.id === 'mask')).toBe(false)   // $900: never a grab-and-go prop
  })
  it('categories: requests per prop', () => {
    const costume = all.byCategory.find(c => c.id === 'costume')!
    expect(costume).toMatchObject({ lines: 2, props: 1, perProp: 2 })
  })
})

describe('dates', () => {
  it('uses studio time', () => {
    expect(studioDay('2026-11-07T03:00:00Z')).toBe('2026-11-06')   // 10 PM in Toronto
    expect(addDaysTo('2026-11-01', -1)).toBe('2026-10-31')
    expect(agoLabel('2026-11-07', TODAY)).toBe('today')
    expect(agoLabel('2026-10-01', TODAY)).toBe('5 weeks ago')
  })
})

describe('similar props by tags', () => {
  it('picks props sharing tags and category, best first', () => {
    const me = item('me', { name: 'Cowboy hat', tags: ['western', 'hat'], categoryId: 'costume' })
    const pool = [
      item('boots', { name: 'Cowboy boots', tags: ['western'], categoryId: 'costume' }),
      item('sheriff', { name: 'Sheriff hat', tags: ['western', 'hat'], categoryId: 'costume' }),
      item('cup', { name: 'Cup', tags: ['kitchen'] }),
    ]
    expect(similarByTags(me, pool).map(i => i.id)).toEqual(['sheriff', 'boots'])
  })
})
