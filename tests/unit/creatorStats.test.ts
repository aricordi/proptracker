import { describe, it, expect } from 'vitest'
import { creatorStats, flagTotal, weeklyFilming } from '../../src/lib/creatorStats'

const closed = { closedWeekdays: [0], closedDates: [] }
const shoot = (id: string, email: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, creatorEmail: email, creatorName: email.split('@')[0], date, from: `${date}T13:00`, to: `${date}T15:00`, place: 'cliff1', status: 'booked' as const, ...extra })

describe('creator dashboard numbers', () => {
  const now = '2026-11-10T12:00'
  const stats = creatorStats({
    from: '2026-11-01', now, closed,
    shoots: [
      shoot('a', 'ana@x', '2026-11-02', { checkin: { at: '2026-11-02T18:05:00.000Z' } }),   // 1:05 PM Toronto = on time
      shoot('b', 'ana@x', '2026-11-03', { checkin: { at: '2026-11-03T18:40:00.000Z' } }),   // 1:40 PM = 40 min late
      shoot('c', 'ana@x', '2026-11-04', { noShow: 'missed', outcome: 'noshow' }),
      shoot('d', 'ana@x', '2026-11-20'),                                                      // upcoming
      shoot('e', 'kyle@x', '2026-11-05', { status: 'cancelled', noShow: 'late-cancel', lateCancel: true }),
      shoot('f', 'kyle@x', '2026-11-06'),                                                     // no check-in yet, no decision
      shoot('g', 'kyle@x', '2026-11-07', { status: 'cancelled' }),                            // free cancel: not counted
      shoot('old', 'kyle@x', '2026-10-01', { checkin: { at: '2026-10-01T17:00:00.000Z' } }),  // before the period
    ],
    props: [{ id: 'r1', creatorEmail: 'kyle@x', title: 'Diner', status: 'collected', endDate: '2026-11-05' }],
    gear: [{ id: 'g1', creatorEmail: 'ana@x', title: 'Cam', status: 'returned', to: '2026-11-02T15:00', date: '2026-11-02', returnedLate: true, usedBy: ['ana@x', 'jana@x'], crewEmails: ['jana@x'], late: { by: 'jana@x' } }],
    reports: [
      { id: 'p1', onEmail: 'ana@x', onName: 'Ana', date: '2026-11-03', overMinutes: 20, mess: true, status: 'upheld', onShootId: 'b' },
      { id: 'p2', onEmail: 'ana@x', onName: 'Ana', date: '2026-11-03', overMinutes: 10, mess: false, status: 'dismissed', onShootId: 'b' },
    ],
    strikes: [{ email: 'kyle@x', reason: 'late-cancel', at: '2026-11-05T15:00:00.000Z', shootId: 'e' }],
    people: [{ email: 'riley@x', name: 'Riley' }],
  })
  const by = Object.fromEntries(stats.map(s => [s.email, s]))
  it('counts filmed, booked and upcoming', () => {
    expect(by['ana@x']).toMatchObject({ filmed: 2, booked: 3, upcoming: 1 })
    expect(by['kyle@x']).toMatchObject({ filmed: 0, booked: 2 })
    expect(by['riley@x']).toMatchObject({ filmed: 0, booked: 0 })
    expect(stats[0].email).toBe('ana@x')
  })
  it('collects every flag', () => {
    expect(by['ana@x'].counts).toEqual({ 'late-start': 1, 'no-show': 1, 'ran-over': 1, mess: 1 })
    expect(by['kyle@x'].counts).toEqual({ 'late-cancel': 1, 'missed-checkin': 1, 'late-props': 1, strike: 1 })
    expect(by['jana@x'].counts).toEqual({ 'late-gear': 1 })   // the last person to have it (owner, Oct 27)
    expect(flagTotal(by['riley@x'])).toBe(0)
  })
})

describe('filming per week', () => {
  it('counts booked and filmed shoots in Monday–Sunday weeks, oldest first', () => {
    const w = weeklyFilming([
      shoot('a', 'ana@x', '2026-11-09', { checkin: { at: '2026-11-09T18:05:00.000Z' } }),   // Monday this week
      shoot('b', 'ana@x', '2026-11-08', { outcome: 'filmed' }),                              // Sunday last week
      shoot('c', 'kyle@x', '2026-11-04', { noShow: 'missed' }),                              // last week, not filmed
      shoot('d', 'kyle@x', '2026-11-05', { status: 'cancelled' }),                           // free cancel: not counted
      shoot('e', 'kyle@x', '2026-11-12'),                                                    // later this week: not happened yet
    ], '2026-11-10', '2026-11-10T12:00', 3)
    expect(w.map(x => x.start)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(w.map(x => [x.booked, x.filmed])).toEqual([[0, 0], [2, 1], [1, 1]])
  })
})
