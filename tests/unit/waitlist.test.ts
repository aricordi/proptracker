// "Notify me if it opens" (waitlist): the pure rules and the notification wording.
import { describe, it, expect } from 'vitest'
import { freedSlots, slotOccupant, positionOf, nextInLine, waitlistSpotFor, waitRefusal, waitId } from '../../functions/src/waitlistRules'
import { inviteChange } from '../../functions/src/pushMessages'
import { cleanScheduleSettings, type ScheduleDay } from '../../functions/src/schedule'

const s = cleanScheduleSettings({})
const NOW = '2026-11-07T12:00'
const shoot = (email: string, name = 'X') => ({ shootId: 'sh-' + email, name, email, kind: 'extra' as const })

describe('which slots just freed', () => {
  it('a slot that had something and is now empty counts; a slot being taken never does', () => {
    const before: ScheduleDay = { date: 'd', cliff1: { '780': shoot('a@x.com'), '900': shoot('b@x.com') }, cliff2: { '1020': { shootId: '', name: 'K', email: 'k@x.com', kind: 'extra', hold: { until: '2026-11-07T12:20', inviteId: 'i', fromName: 'Ana' } } } }
    const after: ScheduleDay = { date: 'd', cliff1: { '900': shoot('b@x.com'), '1140': shoot('c@x.com') }, cliff2: {} }
    expect(freedSlots(before, after)).toEqual([{ house: 'cliff1', start: 780 }, { house: 'cliff2', start: 1020 }])
    // The offer's own write (a hold appears) frees nothing, so the trigger can't loop.
    expect(freedSlots(after, { ...after, cliff1: { ...after.cliff1, '780': { shootId: '', name: 'W', email: 'w@x.com', kind: 'extra', hold: { until: 'x', inviteId: 'j', fromName: 'Waitlist' } } } })).toEqual([])
    // A hold that becomes the person's shoot in the same slot frees nothing either.
    expect(freedSlots(before, { ...before, cliff2: { '1020': shoot('k@x.com') } })).toEqual([])
    expect(freedSlots(undefined, after)).toEqual([])
  })
})

describe('who is on a slot', () => {
  const day: ScheduleDay = { date: '2026-11-12', cliff1: { '780': shoot('a@x.com'), '900': { shootId: '', name: 'K', email: 'k@x.com', kind: 'extra', hold: { until: '2000-01-01T00:00', inviteId: 'i', fromName: 'Ana' } } },
    blocks: [{ id: 'b', house: 'cliff2', start: 780, end: 900, type: 'cleaners', note: '' }] }
  it('free, blocked, yours or taken', () => {
    expect(slotOccupant(day, 'cliff1', 780, s, 'me@x.com', NOW)).toBe('taken')
    expect(slotOccupant(day, 'cliff1', 780, s, 'A@x.com', NOW)).toBe('mine')
    expect(slotOccupant(day, 'cliff1', 900, s, 'me@x.com', NOW)).toBe('free')   // a hold that ran out counts as free
    expect(slotOccupant(day, 'cliff2', 780, s, 'me@x.com', NOW)).toBe('blocked')
    expect(slotOccupant(undefined, 'cliff2', 1020, s, 'me@x.com', NOW)).toBe('free')
  })
})

describe('the line', () => {
  const list = [
    { email: 'b@x.com', at: '2026-11-07T10:00:00Z', status: 'waiting' as const },
    { email: 'a@x.com', at: '2026-11-07T09:00:00Z', status: 'waiting' as const },
    { email: 'c@x.com', at: '2026-11-07T08:00:00Z', status: 'left' as const },
    { email: 'd@x.com', at: '2026-11-07T07:00:00Z', status: 'offered' as const },
  ]
  it('oldest waiting first; others are not in line', () => {
    expect(nextInLine(list).map(x => x.email)).toEqual(['a@x.com', 'b@x.com'])
    expect(positionOf(list, 'a@x.com')).toBe(1)
    expect(positionOf(list, 'b@x.com')).toBe(2)
    expect(positionOf(list, 'c@x.com')).toBe(0)
  })
  it('one record per person and slot', () => {
    expect(waitId('2026-11-12', 'cliff1', 1020, 'abc')).toBe('2026-11-12_cliff1_1020_abc')
  })
})

describe('the chat offers the waitlist', () => {
  const day: ScheduleDay = { date: '2026-11-11', cliff1: { '1020': shoot('a@x.com') } }
  it('only when the exact asked time that day is someone else\'s and not free anywhere', () => {
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1', 'cliff2'], 1020, s, 'me@x.com', NOW, [{ date: '2026-11-11', start: 1140 }]))
      .toEqual({ date: '2026-11-11', house: 'cliff1', start: 1020 })
    // 5 PM is free at Cliff 2 that day: book that instead.
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1', 'cliff2'], 1020, s, 'me@x.com', NOW, [{ date: '2026-11-11', start: 1020 }])).toBeNull()
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff2'], 1020, s, 'me@x.com', NOW, [])).toBeNull()   // Cliff 2 is just empty
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1'], 1020, s, 'a@x.com', NOW, [])).toBeNull()    // it's yours
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1'], 1050, s, 'me@x.com', NOW, [])).toBeNull()   // not a slot start
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1'], undefined, s, 'me@x.com', NOW, [])).toBeNull()
  })
  it('never offers a spot the server would refuse (reviewer, Nov 7)', () => {
    // The time has already started.
    expect(waitlistSpotFor(day, '2026-11-11', ['cliff1'], 1020, s, 'me@x.com', '2026-11-11T17:30', [])).toBeNull()
    // They already film at a house that day (one slot a day).
    const busy: ScheduleDay = { ...day, cliff2: { '780': shoot('me@x.com') } }
    expect(waitlistSpotFor(busy, '2026-11-11', ['cliff1'], 1020, s, 'me@x.com', NOW, [])).toBeNull()
    // Thursday at Cliff 1: still under the priority lock (and needs a guideline) for someone outside the priority group.
    const thu: ScheduleDay = { date: '2026-11-12', cliff1: { '1020': shoot('a@x.com') } }
    expect(waitlistSpotFor(thu, '2026-11-12', ['cliff1'], 1020, s, 'me@x.com', NOW, [])).toBeNull()
    expect(waitRefusal(thu, '2026-11-12', 'cliff1', 1020, s, 'me@x.com', NOW)).toBe('locked')
    expect(waitRefusal(thu, '2026-11-12', 'cliff1', 1020, s, 'me@x.com', '2026-11-09T12:00')).toBe('guideline')   // after the Sunday release
    expect(waitRefusal(day, '2026-11-11', 'cliff1', 1020, s, 'me@x.com', NOW)).toBeNull()
  })
})

describe('the notification', () => {
  const inv = { fromEmail: 'waitlist', fromName: 'Waitlist', toEmail: 'ariel@x.com', toName: 'Ariel', place: 'cliff1', date: '2026-11-12', start: 1020, end: 1140, until: '2026-11-07T12:20', status: 'pending', waitlist: true, waitlistId: 'w1' }
  it('says the time opened and is held for 20 minutes (not "X invited you")', () => {
    const [p] = inviteChange('i9', null, inv, s)
    expect(p).toMatchObject({ to: ['ariel@x.com'], url: '/', title: 'A slot you wanted opened up' })
    expect(p.body).toBe("Thursday Nov 12 · 5 PM at Cliff 1 just opened. It's held for you for 20 minutes: confirm in the app.")
  })
  it('nothing goes to the made-up "waitlist" sender; running out tells the person', () => {
    expect(inviteChange('i9', inv, { ...inv, status: 'accepted' }, s)).toEqual([])
    expect(inviteChange('i9', inv, { ...inv, status: 'declined' }, s)).toEqual([])
    const out = inviteChange('i9', inv, { ...inv, status: 'expired' }, s)
    expect(out).toHaveLength(1)
    expect(out[0].to).toEqual(['ariel@x.com'])
    expect(out[0].body).toMatch(/went to the next person/)
  })
})
