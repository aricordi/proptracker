import { describe, it, expect } from 'vitest'
import { roughParse, roughAdjust, findOptions, matchPeople } from '../../functions/src/timeFinder'
import { cleanScheduleSettings } from '../../functions/src/schedule'

const s = cleanScheduleSettings({})
const people = [{ email: 'kyle@x.com', name: 'Kyle Ray' }, { email: 'jana@x.com', name: 'Jana' }]
const me = { email: 'me@x.com', name: 'Maya' }
const TODAY = '2026-10-21'   // a Wednesday

describe('reading a request without AI', () => {
  it('friends, this week, evenings', () => {
    const a = roughParse("I'm filming with Kyle and Jana this week, evenings", TODAY, people)
    expect(a).toMatchObject({ from: TODAY, to: '2026-10-25', people: ['Kyle Ray', 'Jana'], mySlots: 1, timeOfDay: 'evening', houses: ['cliff1', 'cliff2'] })
  })
  it('solo hours, next week, a house', () => {
    const a = roughParse('4 hours next week at cliff 2', TODAY, people)
    expect(a).toMatchObject({ from: '2026-10-26', to: '2026-11-01', people: [], mySlots: 2, houses: ['cliff2'] })
  })
  it('follow-ups change only what was mentioned', () => {
    const a = roughParse('with Jana this week', TODAY, people)
    expect(roughAdjust(a, 'only cliff 2', TODAY, people)).toMatchObject({ people: ['Jana'], houses: ['cliff2'], from: TODAY })
    expect(roughAdjust(a, 'just me', TODAY, people).people).toEqual([])
  })
  it('matches unique first names only', () => {
    expect(matchPeople(['kyle'], people, me.email).map(p => p.email)).toEqual(['kyle@x.com'])
    expect(matchPeople(['bob'], people, me.email)).toEqual([])
  })
})

describe('finding real open slots', () => {
  const ask = { from: '2026-10-22', to: '2026-10-22', people: ['Kyle Ray'], mySlots: 1, houses: ['cliff2' as const], timeOfDay: 'any' as const }
  const friends = [people[0]]
  it('you then your friend, same house, both free', () => {
    const days = { '2026-10-22': { date: '2026-10-22', cliff2: { '420': { shootId: 'x', name: 'A', kind: 'extra' as const } } } }
    const o = findOptions(ask, me, friends, days, {}, s, '2026-10-21T09:00', false)
    expect(o[0]).toMatchObject({ date: '2026-10-22', place: 'cliff2', start: 540 })
    expect(o[0].slots.map(x => [x.name, x.start])).toEqual([['Maya', 540], ['Kyle Ray', 660]])
  })
  it('skips times a friend is already filming, and active holds', () => {
    const days = { '2026-10-22': { date: '2026-10-22', cliff2: { '660': { shootId: '', name: 'Z', kind: 'extra' as const, hold: { until: '2026-10-21T09:10', inviteId: 'i', fromName: 'Q' } } } } }
    const busy = { 'kyle@x.com': [{ from: '2026-10-22T09:00', to: '2026-10-22T11:00' }] }
    const o = findOptions(ask, me, friends, days, busy, s, '2026-10-21T09:00', false)
    expect(o.every(x => x.slots[1].start !== 540 && x.slots[1].start !== 660)).toBe(true)
    // After the hold ends, that slot counts as free again.
    const later = findOptions(ask, me, friends, days, {}, s, '2026-10-21T09:30', false)
    expect(later.some(x => x.slots.some(y => y.start === 660))).toBe(true)
  })
})
