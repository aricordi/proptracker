import { describe, it, expect } from 'vitest'
import { analyze, periods, periodOf, filterAll, series, creatorRows, staffRows } from '../../src/lib/analytics'

const closed = { closedWeekdays: [0], closedDates: [] }
const shoot = (id: string, email: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, creatorEmail: email, creatorName: email.split('@')[0], date, from: `${date}T13:00`, to: `${date}T15:00`, place: 'cliff1', status: 'booked', ...extra })

describe('analytics', () => {
  const a = analyze({
    now: '2026-11-10T12:00', closed,
    shoots: [
      shoot('a', 'ana@x', '2026-11-02', { checkin: { at: '2026-11-02T18:05:00.000Z' }, wrap: { at: 'x', title: 'Pizza heist' } }),
      shoot('b', 'ana@x', '2026-11-03', { checkin: { at: '2026-11-03T18:40:00.000Z' } }),       // 40 min late, no wrap
      shoot('c', 'kyle@x', '2026-11-04', { noShow: 'missed', outcome: 'noshow' }),
      shoot('d', 'kyle@x', '2026-11-05', { status: 'cancelled', lateCancel: true }),
      shoot('e', 'kyle@x', '2026-11-06'),                                                         // no check-in yet
      shoot('f', 'ana@x', '2026-11-20'),                                                          // upcoming: ignored
      shoot('g', 'ana@x', '2026-10-20', { place: 'cliff2', outcome: 'filmed' }),
    ],
    props: [{ id: 'r1', creatorEmail: 'kyle@x', title: 'Diner', status: 'returned', startDate: '2026-11-04', endDate: '2026-11-04',
      lines: [{ itemName: 'Cop hat', checkIn: { result: 'damaged' } }, { itemName: 'Chair', checkIn: { result: 'ok' } }],
      history: [{ status: 'requested', at: '2026-10-30T14:00:00.000Z', by: 'kyle@x' }, { status: 'packed', at: '2026-11-02T14:00:00.000Z', by: 'farrell@x' },
        { status: 'return_pending', at: '2026-11-04T23:00:00.000Z', by: 'kyle@x' }, { status: 'returned', at: '2026-11-05T15:00:00.000Z', by: 'farrell@x' }] }],
    gear: [{ id: 'g1', creatorEmail: 'ana@x', title: 'Cam', status: 'checked_in', date: '2026-11-02', to: '2026-11-02T15:00',
      problems: [{ kind: 'missing_at_checkin', name: 'Lens cap', usedBy: ['ana@x'] }],
      history: [{ action: 'returned', at: '2026-11-02T20:00:00.000Z' }, { action: 'checked_in', at: '2026-11-03T14:00:00.000Z', by: 'maanik@x' }] }],
    reports: [{ id: 'p1', onEmail: 'ana@x', onName: 'Ana', date: '2026-11-03', overMinutes: 20, mess: true, status: 'upheld', onShootId: 'b' }],
    strikes: [{ id: 's1', email: 'kyle@x', reason: 'no-show', at: '2026-11-04T20:00:00.000Z' }, { id: 's2', email: 'kyle@x', reason: 'manual', at: '2026-11-05T20:00:00.000Z', removedAt: 'x' }],
    invites: [{ id: 'i1', toEmail: 'kyle@x', toName: 'Kyle', fromName: 'Ana', date: '2026-11-07', until: '2026-11-07T15:20:00.000Z', status: 'pending', place: 'cliff1' }],
  })
  const kinds = (email: string) => a.incidents.filter(i => i.email === email).map(i => i.kind).sort()

  it('turns shoots, reports, returns, strikes and invites into flags', () => {
    expect(kinds('ana@x')).toEqual(['gear-missing', 'late-start', 'mess', 'no-wrap', 'ran-over'])
    expect(kinds('kyle@x')).toEqual(['invite-lapsed', 'late-cancel', 'missed-checkin', 'no-show', 'props-damaged', 'strike'])   // removed strike not counted
    expect(a.facts.map(f => f.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'g'])
  })
  it('measures the props and equipment teams', () => {
    const packed = a.jobs.find(j => j.kind === 'packed')!
    expect(packed).toMatchObject({ team: 'props', by: 'farrell@x', onTime: true, hours: 72 })
    expect(a.jobs.find(j => j.team === 'gear')).toMatchObject({ by: 'maanik@x', hours: 18 })
    expect(staffRows(a.jobs, { grain: 'month', periods: ['2026-11'] }, 'props')[0]).toMatchObject({ packed: 1, onTime: 1, checkedIn: 1 })
  })
  it('groups by week or month, creator and house', () => {
    expect(periodOf('2026-11-10', 'week')).toBe('2026-11-09')
    expect(periods('month', '2026-11-10', 3)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(periods('week', '2026-11-10', 2)).toEqual(['2026-11-02', '2026-11-09'])
    const f = { grain: 'month' as const, periods: ['2026-10', '2026-11'] }
    const all = filterAll(a, f)
    expect(series(all.facts, all.incidents, f).map(s => [s.period, s.booked, s.filmed])).toEqual([['2026-10', 1, 1], ['2026-11', 5, 2]])
    const ana = creatorRows(all.facts, all.incidents, 2).find(r => r.email === 'ana@x')!
    expect(ana).toMatchObject({ booked: 3, filmed: 3, perPeriod: 1.5, videos: ['Pizza heist'] })
    expect(filterAll(a, { ...f, house: 'cliff2' }).facts.map(x => x.id)).toEqual(['g'])
  })
})
