// Free-time booking (owner, Nov 24): any start/end in 15-minute steps, up to 2 hours per person, overlaps refused.
import { describe, it, expect } from 'vitest'
import { DEFAULT_SCHEDULE as S, freeGaps, conflictAt, checkTimes, normalizeDay, houseBookings, maxMinutesFor, houseSlotsOn, type ScheduleDay } from '../../functions/src/schedule'

const FRI = '2026-12-04'
const NOW = '2026-12-01T10:00'
const e = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ shootId: id, name: id, email: `${id}@x.com`, kind: 'extra' as const, time: { start, end }, ...extra })

describe('free time', () => {
  it('finds the free stretches around bookings and hard blocks (not heads-ups)', () => {
    const day: ScheduleDay = { date: FRI, cliff1: { '795': e('a', 795, 915), '1005': e('b', 1005, 1065) },
      blocks: [{ id: 'k', house: 'cliff1', start: 1200, end: 1260, type: 'cleaners' }, { id: 'h', house: 'cliff1', start: 600, end: 700, type: 'other', soft: true }] }
    expect(freeGaps(day, FRI, 'cliff1', S, NOW)).toEqual([
      { start: 420, end: 795 }, { start: 915, end: 1005 }, { start: 1065, end: 1200 }, { start: 1260, end: 1500 }])
  })
  it('today starts from now, the past has nothing', () => {
    expect(freeGaps(undefined, FRI, 'cliff2', S, `${FRI}T13:07`)[0]).toEqual({ start: 795, end: 1500 })
    expect(freeGaps(undefined, '2026-11-01', 'cliff2', S, NOW)).toEqual([])
  })
  it('refuses overlaps but allows back to back', () => {
    const day: ScheduleDay = { date: FRI, cliff1: { '795': e('a', 795, 915) } }
    expect(conflictAt(day, 'cliff1', 900, 960, S, NOW)?.t).toBe('booking')
    expect(conflictAt(day, 'cliff1', 915, 1035, S, NOW)).toBeNull()
    expect(conflictAt(day, 'cliff1', 675, 795, S, NOW)).toBeNull()
    expect(conflictAt(day, 'cliff1', 800, 900, S, NOW, { except: ['a'] })).toBeNull()   // the shoot being moved
  })
  it('a legacy grid entry (no time) still fills its 2 hours', () => {
    const day: ScheduleDay = { date: FRI, cliff2: { '780': { shootId: 'old', name: 'Old', kind: 'extra' } } }
    expect(conflictAt(day, 'cliff2', 840, 870, S, NOW)?.t).toBe('booking')
    expect(conflictAt(day, 'cliff2', 900, 960, S, NOW)).toBeNull()
  })
  it('checks the times: 15-minute steps, 30 minutes at least, inside house hours', () => {
    expect(checkTimes('cliff1', FRI, 795, 915, S, '2026-12-01', NOW)).toBeNull()
    expect(checkTimes('cliff1', FRI, 790, 915, S, '2026-12-01', NOW)).toBe('bad-hours')
    expect(checkTimes('cliff1', FRI, 795, 810, S, '2026-12-01', NOW)).toBe('bad-hours')
    expect(checkTimes('cliff1', FRI, 360, 480, S, '2026-12-01', NOW)).toBe('bad-hours')    // before 7 AM
    expect(checkTimes('cliff1', FRI, 1440, 1515, S, '2026-12-01', NOW)).toBe('bad-hours')  // past 1 AM
    expect(checkTimes('cliff1', '2026-11-30', 795, 915, S, '2026-12-01', NOW)).toBe('in-past')
  })
  it('2 hours per person on a booking', () => {
    expect(maxMinutesFor(1, S)).toBe(120)
    expect(maxMinutesFor(3, S)).toBe(360)
  })
  it('collaborators count toward the one-booking-a-day rule', () => {
    const day: ScheduleDay = { date: FRI, cliff1: { '795': e('a', 795, 1035, { people: ['a@x.com', 'kyle@x.com'] }) } }
    expect(houseSlotsOn(day, 'kyle@x.com', NOW)).toBe(1)
  })
  it('tidies a day written under the old grid: one entry per shoot at its real start', () => {
    const day: ScheduleDay = { date: FRI, cliff1: {
      '1020': { shootId: 'z', name: 'Zech', kind: 'extra', time: { start: 1065, end: 1185 } },
      '1140': { shootId: 'z', name: 'Zech', kind: 'extra', time: { start: 1065, end: 1185 } },
      '900': { shootId: 'p', name: 'Pedro', kind: 'extra', time: { start: 930, end: 1050 } } },
      clashes: [{ house: 'cliff1', slot: '1140', shootId: 'd', name: 'Dawson', start: 1185, end: 1305, shared: true }] }
    normalizeDay(day, S)
    expect(Object.keys(day.cliff1!).sort()).toEqual(['1065', '1185', '930'])
    expect(houseBookings(day, 'cliff1', S).map(b => [b.shootId, b.start, b.end])).toEqual([['p', 930, 1050], ['z', 1065, 1185], ['d', 1185, 1305]])
    expect(day.clashes).toEqual([])
  })
})
