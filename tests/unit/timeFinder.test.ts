import { describe, it, expect } from 'vitest'
import { roughParse, roughAdjust, findOptions, matchPeople, slotsFor, cleanAsk } from '../../functions/src/timeFinder'
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

// Owner, Oct 18: "soonest 4 hour spot at Cliff 2, filming with Ariel" offered 4 h for him + 2 h for Ariel.
// Rule: a length said with friends is the WHOLE block; each friend always gets one slot of their own.
describe('how many slots are yours', () => {
  const people3 = [...people, { email: 'ariel@x.com', name: 'Ariel' }]
  it('a length with a friend is the whole block', () => {
    expect(roughParse('i want the soonest 4 hour spot for cliff 2 i want to film with ariel', TODAY, people3)).toMatchObject({ people: ['Ariel'], mySlots: 1, houses: ['cliff2'] })
    expect(roughParse('6 hours with Kyle and Jana', TODAY, people3).mySlots).toBe(1)
    expect(roughParse('8 hours with Kyle and Jana', TODAY, people3).mySlots).toBe(2)
  })
  it('too short for everyone still gives each person their own slot', () => {
    expect(roughParse('2 hours with Kyle tomorrow', TODAY, people3).mySlots).toBe(1)
  })
  it('your own length only when you say so', () => {
    expect(roughParse('I need 4 hours myself, then Kyle', TODAY, people3).mySlots).toBe(2)
    expect(roughParse('4 hours each with Kyle', TODAY, people3).mySlots).toBe(2)
  })
  it('alone, the length is all yours (and capped at 3 slots)', () => {
    expect(roughParse('4 hours on friday', TODAY, people3).mySlots).toBe(2)
    expect(roughParse('6 hours on friday', TODAY, people3).mySlots).toBe(3)
    expect(slotsFor({ hours: 12, mySlots: 1 }, 0, 120)).toBe(3)
  })
  it('the AI only reports hours; the app counts the slots', () => {
    const fb = roughParse('with ariel', TODAY, people3)
    expect(cleanAsk({ people: ['Ariel'], totalHours: 4, myHours: null, mySlots: 3 }, TODAY, fb).mySlots).toBe(1)
    expect(cleanAsk({ people: ['Ariel'], totalHours: null, myHours: 4 }, TODAY, fb).mySlots).toBe(2)
    expect(cleanAsk({ people: [], totalHours: 4 }, TODAY, fb).mySlots).toBe(2)
  })
  it('follow-ups recount: "just me" after a 4-hour group ask gives you the 4 hours', () => {
    const a = roughParse('4 hours with Ariel', TODAY, people3)
    expect(a.mySlots).toBe(1)
    expect(roughAdjust(a, 'just me', TODAY, people3).mySlots).toBe(2)
    expect(roughAdjust(a, 'only cliff 2', TODAY, people3).mySlots).toBe(1)
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
  it('one house slot a day: skips days you or your friend already film (not for the team)', () => {
    const two = { ...ask, to: '2026-10-23' }
    const mine = { '2026-10-22': { date: '2026-10-22', cliff1: { '1260': { shootId: 'm', name: 'Maya', email: me.email, kind: 'extra' as const } } } }
    expect(findOptions(two, me, friends, mine, {}, s, '2026-10-21T09:00', false).every(o => o.date === '2026-10-23')).toBe(true)
    const kyles = { '2026-10-22': { date: '2026-10-22', cliff1: { '1260': { shootId: 'k', name: 'Kyle Ray', email: 'kyle@x.com', kind: 'extra' as const } } } }
    expect(findOptions(two, me, friends, kyles, {}, s, '2026-10-21T09:00', false).every(o => o.date === '2026-10-23')).toBe(true)
    expect(findOptions(two, me, friends, mine, {}, s, '2026-10-21T09:00', true).some(o => o.date === '2026-10-22')).toBe(true)
  })
})
