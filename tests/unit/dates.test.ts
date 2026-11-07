import { describe, it, expect } from 'vitest'
import { studioDayOf } from '../../src/lib/dates'

describe('studioDayOf', () => {
  it('uses the Toronto day, not the UTC day, for evening times', () => {
    expect(studioDayOf('2026-01-15T03:30:00.000Z')).toBe('2026-01-14')   // 10:30 PM Jan 14 in Toronto
    expect(studioDayOf('2026-11-08T01:30:00.000Z')).toBe('2026-11-07')   // 8:30 PM Nov 7
    expect(studioDayOf('2026-07-10T15:00:00.000Z')).toBe('2026-07-10')
  })
  it('falls back to the text itself when it is not a time', () => {
    expect(studioDayOf('nonsense')).toBe('nonsense')
  })
})
