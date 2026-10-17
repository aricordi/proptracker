import { describe, it, expect } from 'vitest'
import { holdWindow, overlaps, freeQty, nextFreeStart, checkGearTimes, fmtTime, fmtHours, pruneHolds, stamp } from '../../functions/src/gearBooking'

const closed = { closedWeekdays: [0], closedDates: ['2026-12-25'] }   // Sundays + Christmas
// 2026-10-16 is a Friday, 10-18 a Sunday, 10-19 a Monday.

describe('gear hold windows', () => {
  it('open day: just the booked hours', () => {
    expect(holdWindow('2026-10-16', 600, 1080, closed)).toMatchObject({ from: '2026-10-16T10:00', to: '2026-10-16T18:00', pickup: '2026-10-16', closedDay: false })
  })
  it('closed day: picked up the day before at the same time, back next open day by 10 AM', () => {
    expect(holdWindow('2026-10-18', 840, 1200, closed)).toMatchObject({ from: '2026-10-17T14:00', to: '2026-10-19T10:00', pickup: '2026-10-17', closedDay: true })
  })
  it('midnight end stays on the same day and still sorts correctly', () => {
    const w = holdWindow('2026-10-16', 1200, 1440, closed)
    expect(w.to).toBe('2026-10-16T24:00')
    expect(overlaps(w, { from: '2026-10-17T00:00', to: '2026-10-17T02:00' })).toBe(false)
  })
})

describe('what is free', () => {
  const holds = [
    { bookingId: 'a', from: '2026-10-16T12:00', to: '2026-10-16T16:00', qty: 1 },
    { bookingId: 'b', from: '2026-10-16T09:00', to: '2026-10-16T11:00', qty: 3 },
  ]
  it('a bundle is taken by any overlapping hold; back-to-back is fine (no gap)', () => {
    expect(freeQty(1, holds, '2026-10-16T13:00', '2026-10-16T17:00')).toBe(0)
    expect(freeQty(1, holds, '2026-10-16T16:00', '2026-10-16T20:00')).toBe(1)
    expect(freeQty(1, holds, '2026-10-16T11:00', '2026-10-16T12:00')).toBe(1)
    expect(freeQty(1, holds, '2026-10-16T13:00', '2026-10-16T17:00', 'a')).toBe(1)   // ignoring its own booking
  })
  it('extras count how many are left', () => {
    expect(freeQty(8, holds, '2026-10-16T10:00', '2026-10-16T13:00')).toBe(4)   // 3 + 1 overlap
    expect(freeQty(2, holds, '2026-10-16T10:00', '2026-10-16T13:00')).toBe(0)
  })
  it('finds when it is next free for the same length', () => {
    expect(nextFreeStart(1, 1, holds, '2026-10-16', 780, 1020, closed)).toBe(960)    // 1–5 PM → 4–8 PM
    expect(nextFreeStart(1, 1, holds, '2026-10-16', 600, 1440, closed)).toBeNull()   // nothing that long later
  })
  it('tidies holds that ended over a week ago', () => {
    const old = { bookingId: 'x', from: '2026-09-01T10:00', to: '2026-09-01T12:00', qty: 1 }
    expect(pruneHolds([old, holds[0]], '2026-10-16')).toEqual([holds[0]])
  })
})

describe('checking the day and hours', () => {
  const today = '2026-10-15' // Thursday
  it('creators book at least 2 open days ahead; staff can book today', () => {
    expect(checkGearTimes('2026-10-16', 900, 960, today, 600, closed, false)).toBe('too-soon')
    expect(checkGearTimes('2026-10-17', 600, 660, today, 600, closed, false)).toBeNull()
    expect(checkGearTimes('2026-10-15', 900, 960, today, 600, closed, true)).toBeNull()
  })
  it('refuses past times, bad hours and junk', () => {
    expect(checkGearTimes('2026-10-15', 540, 600, today, 600, closed, true)).toBe('in-past')
    expect(checkGearTimes('2026-10-16', 610, 700, today, 0, closed, true)).toBe('bad-hours')
    expect(checkGearTimes('2026-10-16', 700, 640, today, 0, closed, true)).toBe('bad-hours')
    expect(checkGearTimes('2026-10-16', 300, 640, today, 0, closed, true)).toBe('bad-hours')
    expect(checkGearTimes('nope', 600, 660, today, 0, closed, true)).toBe('bad-format')
  })
  it('a Sunday shoot counts its Saturday pickup for notice', () => {
    expect(checkGearTimes('2026-10-18', 600, 720, '2026-10-17', 0, closed, false)).toBe('too-soon')
    expect(checkGearTimes('2026-10-18', 600, 720, '2026-10-16', 0, closed, false)).toBe('too-soon')
    expect(checkGearTimes('2026-10-18', 600, 720, '2026-10-15', 0, closed, false)).toBeNull()
  })
})

describe('times in words', () => {
  it('reads like a person would say it', () => {
    expect(fmtTime(600)).toBe('10 AM'); expect(fmtTime(990)).toBe('4:30 PM'); expect(fmtTime(1440)).toBe('12 AM')
    expect(fmtHours(780, 1020)).toBe('1 PM–5 PM'); expect(stamp('2026-10-16', 75)).toBe('2026-10-16T01:15')
  })
})
