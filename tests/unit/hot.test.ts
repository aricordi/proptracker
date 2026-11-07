// Browse "hot" order (owner, Nov 7).
import { describe, it, expect } from 'vitest'
import { hotScores, hotOrder } from '../../functions/src/hot'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

describe('hot order', () => {
  it('recent requests count most, old ones fade, cancelled never count', () => {
    const s = hotScores([
      { itemIds: ['lamp', 'cup'], createdAt: ago(1) },
      { itemIds: ['lamp'], createdAt: ago(2) },
      { itemIds: ['mask'], createdAt: ago(60) },
      { itemIds: ['mask'], createdAt: ago(63) },
      { itemIds: ['mask'], createdAt: ago(66) },
      { itemIds: ['hat'], createdAt: ago(1), status: 'cancelled' },
      { itemIds: ['old'], createdAt: ago(200) },
    ], NOW)
    expect(s.lamp).toBeGreaterThan(s.cup)
    expect(s.cup).toBeGreaterThan(s.mask)        // one request yesterday beats three two months ago
    expect(s.hat).toBeUndefined()
    expect(s.old).toBeUndefined()
  })
  it('hot first, then new props, then a daily shuffle (same all day, different tomorrow)', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Prop ${i}`, createdAt: '2026-01-01T00:00:00Z' }))
    items.push({ id: 'fresh', name: 'Zebra', createdAt: ago(2) })
    const order = hotOrder(items, { p7: 2, p3: 0.5 }, '2026-11-07', NOW).map(i => i.id)
    expect(order.slice(0, 3)).toEqual(['p7', 'p3', 'fresh'])
    expect(hotOrder(items, {}, '2026-11-07', NOW).map(i => i.id)).toEqual(hotOrder(items, {}, '2026-11-07', NOW).map(i => i.id))
    expect(hotOrder(items, {}, '2026-11-08', NOW).map(i => i.id)).not.toEqual(hotOrder(items, {}, '2026-11-07', NOW).map(i => i.id))
  })
})
