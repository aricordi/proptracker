import { describe, it, expect } from 'vitest'
import { creatorStats, flagTotal, strikeTotal, weeklyFilming } from '../../src/lib/creatorStats'

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
    // The strike came with the late cancel on shoot e: one flag, not two (audit, Nov 5).
    expect(by['kyle@x'].counts).toEqual({ 'late-cancel': 1, 'missed-checkin': 1, 'late-props': 1 })
    expect(by['jana@x'].counts).toEqual({ 'late-gear': 1 })   // the last person to have it (owner, Oct 27)
    expect(flagTotal(by['riley@x'])).toBe(0)
  })
})

describe('strikes and excuses match Analytics', () => {
  const now = '2026-11-10T12:00'
  const base = {
    from: '2026-11-01', now, closed, props: [], reports: [{ id: 'p1', onEmail: 'ana@x', onName: 'Ana', date: '2026-11-03', overMinutes: 20, mess: false, status: 'upheld', onShootId: 'b' }],
    shoots: [
      shoot('b', 'ana@x', '2026-11-03', { checkin: { at: '2026-11-03T18:05:00.000Z' } }),
      shoot('c', 'ana@x', '2026-11-04', { noShow: 'missed', outcome: 'noshow' }),
      shoot('e', 'ana@x', '2026-11-05', { status: 'cancelled', noShow: 'late-cancel', lateCancel: true }),
    ],
    gear: [{ id: 'g1', creatorEmail: 'ana@x', title: 'Cam', status: 'returned', to: '2026-11-02T15:00', date: '2026-11-02', returnedLate: true }],
    strikes: [
      { id: 's1', email: 'ana@x', reason: 'no-show', at: '2026-11-04T20:00:00.000Z', shootId: 'c' },
      { id: 's2', email: 'ana@x', reason: 'late-cancel', at: '2026-11-05T15:00:00.000Z', shootId: 'e' },
      { id: 's3', email: 'ana@x', reason: 'report', at: '2026-11-03T20:00:00.000Z', shootId: 'b' },
      { id: 's4', email: 'ana@x', reason: 'manual', at: '2026-11-06T15:00:00.000Z', flagId: 'late-gear:g1:ana-x' },
      { id: 's5', email: 'ana@x', reason: 'manual', at: '2026-11-07T15:00:00.000Z', note: 'rude' },
      { id: 's6', email: 'ana@x', reason: 'manual', at: '2026-11-08T15:00:00.000Z', note: 'old', removedAt: '2026-11-09T00:00:00.000Z' },
    ],
  }
  it('every live strike can be found (and removed) on its flag, and all of them are counted', () => {
    const [ana] = creatorStats(base)
    const id = (k: string) => ana.flags.find(f => f.kind === k)?.strikeId
    expect([id('no-show'), id('late-cancel'), id('ran-over'), id('late-gear'), id('strike')]).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(ana.counts.strike).toBe(1)
    expect(strikeTotal(ana)).toBe(5)
  })
  it('flags excused in Analytics drop out here too', () => {
    const [ana] = creatorStats({ ...base, excused: new Set(['no-show:c', 'late-gear:g1:ana-x']) })
    expect(ana.counts['no-show']).toBeUndefined()
    expect(ana.counts['late-gear']).toBeUndefined()
    expect(ana.counts['late-cancel']).toBe(1)
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
