import { lastDayToBook } from '../../functions/src/booking'
import { describe, it, expect } from 'vitest'
import {
  addDays, bookedOn, freeForRange, holdUntil, checkDates, todayInStudio,
  addOpenDays, pickupDay, returnDueDay, earliestStart, cleanClosedDays, isOpen, isLate, lineRisk,
  DEFAULT_BOOKING_SETTINGS as DEFAULTS, type BookingEntry,
} from '../../functions/src/booking'

const TODAY = '2026-10-12'
// Most tests: open every day, so the plain day maths is easy to follow.
const S = { ...DEFAULTS, closedWeekdays: [], closedDates: [] }
const entry = (start: string, end: string, qty = 1, id = 'r'): BookingEntry => ({ reservationId: id, start, end, qty })

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it("uses the studio's local date (Toronto), not UTC", () => {
    // 11:30pm in Toronto on Oct 12 is already Oct 13 in UTC
    expect(todayInStudio(new Date('2026-10-13T03:30:00Z'))).toBe('2026-10-12')
  })
})

describe('one-of-a-kind prop (the cop costume)', () => {
  const stock = { quantity: 1 }
  const booked = [entry('2026-10-20', '2026-10-22')]
  it('is not free during an existing booking', () => {
    expect(freeForRange(stock, booked, '2026-10-21', '2026-10-21', TODAY, 1)).toBe(0)
  })
  it('is not free on the turnaround day after it', () => {
    expect(freeForRange(stock, booked, '2026-10-23', '2026-10-23', TODAY, 1)).toBe(0)
  })
  it('is free the day after the turnaround', () => {
    expect(freeForRange(stock, booked, '2026-10-24', '2026-10-25', TODAY, 1)).toBe(1)
  })
  it("a new booking can't end so late its own turnaround overlaps the next shoot", () => {
    expect(freeForRange(stock, booked, '2026-10-17', '2026-10-19', TODAY, 1)).toBe(0)
    expect(freeForRange(stock, booked, '2026-10-17', '2026-10-18', TODAY, 1)).toBe(1)
  })
  it('with no buffer, back-to-back shoots are allowed', () => {
    expect(freeForRange(stock, booked, '2026-10-23', '2026-10-23', TODAY, 0)).toBe(1)
  })
  it('a multi-day range is blocked if any single day clashes', () => {
    expect(freeForRange(stock, booked, '2026-10-15', '2026-10-30', TODAY, 1)).toBe(0)
  })
})

describe('props with quantities (10 chairs)', () => {
  const stock = { quantity: 10 }
  it('counts units already booked on overlapping days', () => {
    const booked = [entry('2026-10-20', '2026-10-21', 6, 'a'), entry('2026-10-21', '2026-10-25', 3, 'b')]
    expect(bookedOn('2026-10-21', booked, TODAY, 1)).toBe(9)
    expect(freeForRange(stock, booked, '2026-10-21', '2026-10-21', TODAY, 1)).toBe(1)
    expect(freeForRange(stock, booked, '2026-10-20', '2026-10-20', TODAY, 0)).toBe(4)
  })
  it('the free count is the worst day in the range', () => {
    const booked = [entry('2026-10-22', '2026-10-22', 8)]
    expect(freeForRange(stock, booked, '2026-10-20', '2026-10-24', TODAY, 0)).toBe(2)
  })
})

describe('props not yet marked returned', () => {
  it('stay tied up after the shoot ends until someone marks them returned', () => {
    const overdue = entry('2026-10-05', '2026-10-08')
    expect(holdUntil(overdue, TODAY, 1)).toBe('9999-12-31')
    expect(freeForRange({ quantity: 1 }, [overdue], '2026-11-20', '2026-11-21', TODAY, 1)).toBe(0)
  })
  it('units reported missing are not bookable until found', () => {
    expect(freeForRange({ quantity: 10, missingQty: 3 }, [], '2026-11-01', '2026-11-01', TODAY, 1)).toBe(7)
    expect(freeForRange({ quantity: 1, missingQty: 1 }, [], '2026-11-01', '2026-11-01', TODAY, 1)).toBe(0)
  })
  it('props from the old Checkout screen are unavailable until returned there', () => {
    expect(freeForRange({ quantity: 5, legacyCheckedOut: true }, [], '2026-11-01', '2026-11-01', TODAY, 1)).toBe(0)
  })
})

describe('reservation dates', () => {
  const multi = { ...S, maxDays: 7 }
  it('accepts a valid range at least 3 days out', () => {
    expect(checkDates('2026-10-15', '2026-10-16', TODAY, multi, false)).toBeNull()
  })
  it('rejects requests inside the lead time for creators', () => {
    expect(checkDates('2026-10-13', '2026-10-13', TODAY, S, false)).toBe('too-soon')
    expect(checkDates('2026-10-14', '2026-10-14', TODAY, S, false)).toBeNull()   // 2 days' notice (owner, Oct 16)
  })
  it('lets the arts department skip the lead time', () => {
    expect(checkDates('2026-10-12', '2026-10-12', TODAY, S, true)).toBeNull()
  })
  it('rejects past dates, reversed ranges, bad formats and very long ranges', () => {
    expect(checkDates('2026-10-01', '2026-10-02', TODAY, S, true)).toBe('in-past')
    expect(checkDates('2026-10-20', '2026-10-18', TODAY, S, false)).toBe('end-before-start')
    expect(checkDates('Oct 20', '2026-10-21', TODAY, S, false)).toBe('bad-format')
    expect(checkDates('2026-10-20', '2026-12-31', TODAY, multi, false)).toBe('too-long')
  })
  it('creators are limited to single-day bookings by default; arts department can book longer', () => {
    expect(checkDates('2026-10-20', '2026-10-20', TODAY, S, false)).toBeNull()
    expect(checkDates('2026-10-20', '2026-10-21', TODAY, S, false)).toBe('too-long')
    expect(checkDates('2026-10-20', '2026-10-25', TODAY, S, true)).toBeNull()
  })
})

// Oct 2026: the 17th is a Saturday, the 18th a Sunday.
describe('days the prop room is closed', () => {
  const sundays = { closedWeekdays: [0], closedDates: [] as string[] }
  it('Sundays are closed by default', () => {
    expect(isOpen('2026-10-18', DEFAULTS)).toBe(false)
    expect(isOpen('2026-10-17', DEFAULTS)).toBe(true)
  })
  it('counting open days skips Sundays and holidays', () => {
    expect(addOpenDays('2026-10-17', 1, sundays)).toBe('2026-10-19')
    expect(addOpenDays('2026-10-16', 2, sundays)).toBe('2026-10-19')
    expect(addOpenDays('2026-10-16', 2, { closedWeekdays: [0], closedDates: ['2026-10-17'] })).toBe('2026-10-20')
    expect(addOpenDays('2026-10-16', 0, sundays)).toBe('2026-10-16')
  })
  it('a Sunday shoot is picked up Saturday; a weekday shoot the same day', () => {
    expect(pickupDay('2026-10-18', sundays)).toBe('2026-10-17')
    expect(pickupDay('2026-10-14', sundays)).toBe('2026-10-14')
  })
  it('props from a Saturday or Sunday shoot are due back Monday', () => {
    expect(returnDueDay('2026-10-17', sundays)).toBe('2026-10-19')
    expect(returnDueDay('2026-10-18', sundays)).toBe('2026-10-19')
    expect(returnDueDay('2026-10-14', sundays)).toBe('2026-10-15')
  })
  it('notice counts open days: booked Thursday with 3 days notice, earliest shoot is Monday', () => {
    const s = { ...DEFAULTS, ...sundays, leadTimeDays: 3 }
    expect(earliestStart('2026-10-15', s, false)).toBe('2026-10-19')
    expect(checkDates('2026-10-18', '2026-10-18', '2026-10-15', s, false)).toBe('too-soon')
    expect(checkDates('2026-10-19', '2026-10-19', '2026-10-15', s, false)).toBeNull()
    expect(earliestStart('2026-10-15', s, true)).toBe('2026-10-15')
  })
  it('a costume back from a Saturday shoot with 2 turnaround days is free again Wednesday', () => {
    const e = [entry('2026-10-17', '2026-10-17')]
    expect(holdUntil(e[0], '2026-10-12', 2, sundays)).toBe('2026-10-20')
    expect(freeForRange({ quantity: 1 }, e, '2026-10-20', '2026-10-20', '2026-10-12', 2, sundays)).toBe(0)
    expect(freeForRange({ quantity: 1 }, e, '2026-10-21', '2026-10-21', '2026-10-12', 2, sundays)).toBe(1)
  })
  it('a new booking also needs its turnaround counted in open days', () => {
    // Friday booking, 1 turnaround day: Saturday. A Saturday hold elsewhere clashes.
    const e = [entry('2026-10-17', '2026-10-17')]
    expect(freeForRange({ quantity: 1 }, e, '2026-10-16', '2026-10-16', '2026-10-12', 1, sundays)).toBe(0)
  })
  it('bad settings from the database are cleaned up, and every day can never be closed', () => {
    expect(cleanClosedDays({ closedWeekdays: [0, 0, 9, 'x'], closedDates: ['2026-12-25', 'nope'] }))
      .toEqual({ closedWeekdays: [0], closedDates: ['2026-12-25'] })
    expect(cleanClosedDays({ closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }).closedWeekdays).toEqual([])
    expect(cleanClosedDays({}).closedWeekdays).toEqual([0])
    expect(addOpenDays('2026-10-16', 2, { closedWeekdays: [0, 1, 2, 3, 4, 5, 6], closedDates: [] })).toBe('2026-10-18')
  })
})

describe('late returns', () => {
  const sundays = { closedWeekdays: [0], closedDates: [] as string[] }
  // Toronto is UTC-4 in October: 10am there is 14:00 UTC.
  it('a Wednesday shoot is late from 10am Thursday, not before', () => {
    expect(isLate('collected', '2026-10-14', sundays, new Date('2026-10-15T13:59:00Z'))).toBe(false)
    expect(isLate('collected', '2026-10-14', sundays, new Date('2026-10-15T14:00:00Z'))).toBe(true)
    expect(isLate('collected', '2026-10-14', sundays, new Date('2026-10-16T02:00:00Z'))).toBe(true)
  })
  it('a Saturday shoot is not late until 10am Monday', () => {
    expect(isLate('collected', '2026-10-17', sundays, new Date('2026-10-18T20:00:00Z'))).toBe(false)
    expect(isLate('collected', '2026-10-17', sundays, new Date('2026-10-19T13:00:00Z'))).toBe(false)
    expect(isLate('collected', '2026-10-17', sundays, new Date('2026-10-19T14:30:00Z'))).toBe(true)
  })
  it('only props that are out with the creator can be late', () => {
    const later = new Date('2026-11-30T12:00:00Z')
    for (const status of ['requested', 'preparing', 'packed', 'return_pending', 'returned', 'cancelled'])
      expect(isLate(status, '2026-10-14', sundays, later)).toBe(false)
  })
})

describe('upcoming bookings at risk', () => {
  const none = { closedWeekdays: [] as number[], closedDates: [] as string[] }
  // Alex's shoot was Oct 14 and the costume is still out; Blair has it booked Oct 20.
  const alex = { reservationId: 'alex', start: '2026-10-14', end: '2026-10-14', qty: 1, out: true }
  const blair = { reservationId: 'blair', start: '2026-10-20', end: '2026-10-20', qty: 1 }
  const base = {
    reservationId: 'blair', qty: 1, start: '2026-10-20', end: '2026-10-20', stock: { quantity: 1 },
    damaged: false, entries: [alex, blair], today: '2026-10-16', bufferDays: 1, closed: none,
    now: new Date('2026-10-16T15:00:00Z'),
  }
  it('flags a booking when the prop before it is late', () => {
    expect(lineRisk(base)).toBe('late')
  })
  it('not before the late deadline', () => {
    expect(lineRisk({ ...base, today: '2026-10-15', now: new Date('2026-10-15T13:00:00Z') })).toBeNull()
  })
  it('not once it has been brought back (no longer out)', () => {
    expect(lineRisk({ ...base, entries: [{ ...alex, out: undefined }, blair] })).toBeNull()
  })
  it('not when there are enough spare units anyway', () => {
    expect(lineRisk({ ...base, stock: { quantity: 2 } })).toBeNull()
  })
  it('flags damaged props and missing units', () => {
    expect(lineRisk({ ...base, entries: [blair], damaged: true })).toBe('damaged')
    expect(lineRisk({ ...base, entries: [blair], stock: { quantity: 1, missingQty: 1 } })).toBe('missing')
  })
})

describe('last day to add things to a shoot', () => {
  it('counts open days back from the shoot (Sundays closed)', () => {
    const closed = { closedWeekdays: [0], closedDates: [] }
    // Shoot Tuesday Oct 20, 2 open days: still OK on Sunday Oct 18 (Mon, Tue count).
    expect(lastDayToBook('2026-10-20', 2, closed)).toBe('2026-10-18')
    expect(lastDayToBook('2026-10-20', 4, closed)).toBe('2026-10-15')
    expect(lastDayToBook('2026-10-20', 0, closed)).toBe('2026-10-20')
  })
})
