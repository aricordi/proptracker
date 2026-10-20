import { describe, it, expect } from 'vitest'
import { analyze } from '../../src/lib/analytics'
import { rangeFor, customRange, grainsFor, defaultGrain, buckets, bucketSpan, slice, value, fmt, compare, seriesOf, rowsBy, sortRows, toCsv, standings, sortStandings, comingThisMonth, outputOf, typicalSeries } from '../../src/lib/insights'

const closed = { closedWeekdays: [0], closedDates: [] }
const shoot = (id: string, email: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, creatorEmail: email, creatorName: email.split('@')[0], date, from: `${date}T13:00`, to: `${date}T15:00`, place: 'cliff1', status: 'booked', ...extra })
const filmed = { checkin: { at: '2026-01-01T18:00:00.000Z' } }

describe('insights: ranges', () => {
  it('builds the presets and the period they are compared with', () => {
    expect(rangeFor('28d', '2026-10-20')).toMatchObject({ from: '2026-09-23', to: '2026-10-20', prevFrom: '2026-08-26', prevTo: '2026-09-22' })
    const w = rangeFor('12w', '2026-10-20')                    // Tue Oct 20 → 12 whole Monday weeks
    expect(w.from).toBe('2026-08-03'); expect(w.prevTo).toBe('2026-08-02'); expect(w.prevFrom).toBe('2026-05-16')   // same number of days
    expect(rangeFor('6m', '2026-10-20')).toMatchObject({ from: '2026-05-01', prevFrom: '2025-11-09', prevTo: '2026-04-30' })
    expect(rangeFor('lm', '2026-10-20')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-31' })
    expect(rangeFor('tm', '2026-10-20')).toMatchObject({ from: '2026-10-01', prevFrom: '2026-09-01', prevTo: '2026-09-20' })
    expect(customRange('2026-10-05', '2026-10-11')).toMatchObject({ label: 'Week of Oct 5', prevFrom: '2026-09-28', zoomed: true })
    expect(customRange('2026-09-01', '2026-09-30').label).toBe('September 2026')
  })
  it('picks sensible chart columns', () => {
    expect(grainsFor(rangeFor('12w', '2026-10-20'))).toEqual(['week', 'month'])
    expect(defaultGrain(rangeFor('28d', '2026-10-20'))).toBe('day')
    expect(defaultGrain(rangeFor('12m', '2026-10-20'))).toBe('month')
    expect(buckets('2026-10-01', '2026-10-20', 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'])
    const r = rangeFor('tm', '2026-10-20')
    expect(bucketSpan('2026-09-28', 'week', r)).toEqual(['2026-10-01', '2026-10-04'])   // clipped to the range
  })
})

describe('insights: metrics and breakdowns', () => {
  const a = analyze({
    now: '2026-10-20T12:00', closed,
    shoots: [
      shoot('a', 'ana@x', '2026-10-06', filmed), shoot('b', 'ana@x', '2026-10-13', { ...filmed, wrap: { at: 'x', title: 'Heist' } }),
      shoot('c', 'kyle@x', '2026-10-14', { noShow: 'missed', outcome: 'noshow' }), shoot('d', 'kyle@x', '2026-09-10', { ...filmed, place: 'cliff2' }),
    ],
    props: [], gear: [], reports: [], strikes: [], invites: [],
  })
  const r = rangeFor('28d', '2026-10-20')
  const cur = slice(a, r.from, r.to), prev = slice(a, r.prevFrom, r.prevTo)
  it('counts and compares', () => {
    expect(value('filmed', cur)).toBe(2)
    expect(value('showRate', cur)).toBeCloseTo(2 / 3)
    expect(value('creators', cur)).toBe(1)
    expect(value('serious', cur)).toBe(1)
    expect(fmt('showRate', value('showRate', cur))).toBe('67%')
    expect(compare('filmed', 2, 1)).toEqual({ text: '↑ 100%', tone: 'good' })
    expect(compare('flags', 2, 1)).toEqual({ text: '↑ 100%', tone: 'bad' })
    expect(compare('showRate', 0.67, 0.66)?.tone).toBe('flat')
    expect(value('filmed', prev)).toBe(1)
    expect(fmt('packTime', 30)).toBe('30 h'); expect(fmt('packTime', 72)).toBe('3 days'); expect(fmt('packTime', 0.25)).toBe('15 min')
  })
  it('narrows to a creator, house or flag', () => {
    expect(value('filmed', slice(a, r.from, r.to, { email: 'kyle@x' }))).toBe(0)
    expect(value('flags', slice(a, r.from, r.to, { kinds: ['no-show'] }))).toBe(1)
    expect(value('booked', slice(a, '2026-01-01', '2026-12-31', { house: 'cliff2' }))).toBe(1)
  })
  it('breaks down by dimension and over time', () => {
    const rows = sortRows(rowsBy('creator', cur, { grain: 'week', people: [{ email: 'zed@x', name: 'Zed' }] }), 'filmed')
    expect(rows.map(x => [x.label, value('filmed', x.data)])).toEqual([['ana', 2], ['kyle', 0], ['Zed', 0]])
    expect(rowsBy('theme', cur, { grain: 'week' }).find(x => x.key === 'abandoned')!.data.incidents).toHaveLength(1)
    const w = rowsBy('period', cur, { grain: 'week', range: r })
    expect(w.map(x => value('filmed', x.data))).toEqual([0, 0, 1, 1, 0])
    expect(seriesOf('filmed', a, r, 'week', {}).map(x => x.value)).toEqual([0, 0, 1, 1, 0])
    expect(toCsv('creator', rows, ['filmed', 'showRate'], cur).split('\n')[1]).toBe('Total,2,67%')
  })
})

describe('insights: comparing creators', () => {
  const w = { ...filmed, wrap: { at: 'x', title: 'Video' } }
  const a = analyze({
    now: '2026-10-20T12:00', closed,
    shoots: [
      ...['01', '05', '08', '12', '14', '15'].map((d, i) => shoot('r' + i, 'riley@x', `2026-10-${d}`, w)),   // 6: posting more
      ...['02', '03', '06'].map((d, i) => shoot('m' + i, 'maya@x', `2026-10-${d}`, w)),                       // 3: typical
      shoot('j1', 'jana@x', '2026-10-06', w), shoot('j2', 'jana@x', '2026-10-28'),                           // 1 + 1 booked: posting less
      ...['07', '08', '10'].map((d, i) => shoot('d' + i, 'devon@x', `2026-10-${d}`, w)), shoot('dx', 'devon@x', '2026-10-09', { noShow: 'missed', outcome: 'noshow' }),
    ],
    props: [], gear: [], reports: [], strikes: [], invites: [],
  })
  const r = rangeFor('tm', '2026-10-20')
  const list = sortStandings(standings(rowsBy('creator', slice(a, r.from, r.to), { grain: 'day', people: [{ email: 'kim@x', name: 'Kim' }] }),
    { paused: [], coming: comingThisMonth(a.upcoming, r, '2026-10-20') }))
  const by = (e: string) => list.find(s => s.email === e)!
  it('compares everyone with the typical creator (the middle value), no minimum', () => {
    expect(by('riley@x').typical).toBe(3)
    expect(list.map(s => [s.name, s.rank, s.output])).toEqual([['riley', 1, 'more'], ['maya', 2, 'typical'], ['devon', 2, 'typical'], ['jana', 4, 'less'], ['Kim', 5, 'less']])
    expect(by('jana@x')).toMatchObject({ filmed: 1, coming: 1, vsTypical: -2, attention: false })
    expect(outputOf(0, 0)).toBe('typical')
  })
  it('flags behaviour separately from output', () => {
    expect(by('devon@x')).toMatchObject({ output: 'typical', attention: true, reasons: ['1 no-show'] })
    expect(sortStandings(list, 'least')[0].name).toBe('Kim')
    expect(sortStandings(list, 'flags')[0].name).toBe('devon')
  })
  it('works out the typical creator per month', () => {
    expect(typicalSeries(a, customRange('2026-09-01', '2026-10-31'), 'month', [])).toEqual([0, 3])
  })
})
