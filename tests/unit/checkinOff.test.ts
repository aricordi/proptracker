// Owner, Nov 24: no check-in on shoot day. Nothing is ever "expected to check in" or a missed check-in.
import { describe, it, expect } from 'vitest'
import { CHECKIN_ON, expectsCheckIn, isMissed } from '../../functions/src/schedule'

describe('check-in is off', () => {
  it('no shoot expects a check-in and none is ever missed', () => {
    expect(CHECKIN_ON).toBe(false)
    const sh = { status: 'booked', place: 'cliff1', from: '2026-11-20T13:00', to: '2026-11-20T15:00', creatorEmail: 'a@x.com' }
    expect(expectsCheckIn(sh as never, () => true)).toBe(false)
    expect(isMissed(sh as never, '2026-11-21T10:00', () => true)).toBe(false)
  })
})
