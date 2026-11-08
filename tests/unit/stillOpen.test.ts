import { describe, it, expect } from 'vitest'
import { stillOpen, nothingOpen, openText } from '../../src/lib/stillOpen'

describe('switching a creator back to Props only (owner, Nov 8: refuse while things are open)', () => {
  const T = '2026-11-08'
  it('counts upcoming shoots and requests, props not back yet, gear held or out', () => {
    const o = stillOpen(
      [{ status: 'booked', date: '2026-11-14' }, { status: 'requested', date: '2026-11-09' }, { status: 'booked', date: '2026-11-01' }, { status: 'cancelled', date: '2026-11-20' }],
      [{ status: 'collected' }, { status: 'return_pending' }, { status: 'returned' }, { status: 'requested' }],
      [{ status: 'out' }, { status: 'checked_in' }],
      T)
    expect(o).toEqual({ shoots: ['2026-11-09', '2026-11-14'], props: 2, gear: 1 })
    expect(nothingOpen(o)).toBe(false)
    expect(openText(o, d => d.slice(5))).toBe('2 shoots coming up (11-09 + 1 more) · 2 props requests not brought back yet · 1 gear booking held or out')
  })
  it('nothing open when everything is past, done or cancelled', () => {
    expect(nothingOpen(stillOpen([{ status: 'booked', date: '2026-11-07' }], [{ status: 'return_pending' }], [{ status: 'returned' }], T))).toBe(true)
  })
})
