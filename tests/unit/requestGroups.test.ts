import { describe, it, expect } from 'vitest'
import { groupByShoot } from '../../src/lib/requestGroups'

const shoots = [{ id: 'sh1', date: '2026-10-24', from: '2026-10-24T13:00' }, { id: 'sh2', date: '2026-10-22', from: '2026-10-22T09:00' }]

describe('groupByShoot', () => {
  it('puts props and gear for the same shoot together, soonest first', () => {
    const { upcoming, past } = groupByShoot(
      [{ id: 'p1', status: 'requested', startDate: '2026-10-24', shootId: 'sh1', scheduleShootId: 'sh1' }],
      [{ id: 'g1', status: 'held', date: '2026-10-24', shootId: 'sh1' }, { id: 'g2', status: 'held', date: '2026-10-22', scheduleShootId: 'sh2' }],
      shoots, '2026-10-20')
    expect(past).toEqual([])
    expect(upcoming.map(g => g.key)).toEqual(['sh2', 'sh1'])
    expect(upcoming[1].props.map(p => p.id)).toEqual(['p1'])
    expect(upcoming[1].gear.map(p => p.id)).toEqual(['g1'])
  })
  it('groups requests without a booked shoot by their shoot day', () => {
    const { upcoming } = groupByShoot(
      [{ id: 'p1', status: 'requested', startDate: '2026-10-30', shootId: 'old-combo' }],
      [{ id: 'g1', status: 'held', date: '2026-10-30' }], shoots, '2026-10-20')
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0]).toMatchObject({ key: 'day:2026-10-30', date: '2026-10-30' })
    expect(upcoming[0].shoot).toBeUndefined()
  })
  it('keeps a past shoot under Upcoming while something is still out', () => {
    const { upcoming, past } = groupByShoot(
      [{ id: 'p1', status: 'collected', startDate: '2026-10-10' }, { id: 'p2', status: 'returned', startDate: '2026-10-05' }, { id: 'p3', status: 'cancelled', startDate: '2026-10-08' }],
      [], [], '2026-10-20')
    expect(upcoming.map(g => g.key)).toEqual(['day:2026-10-10'])
    expect(past.map(g => g.key)).toEqual(['day:2026-10-08', 'day:2026-10-05'])
  })
})
