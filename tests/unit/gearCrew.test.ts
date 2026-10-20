import { describe, it, expect } from 'vitest'
import { backToBack, crewProblem, crewHours, responsible } from '../../functions/src/gearCrew'
import { gearChange, gearReminders } from '../../functions/src/pushMessages'

const s = (id: string, email: string, start: number, place = 'cliff1', date = '2026-11-02') => ({ id, email, name: id.toUpperCase(), date, place, start, end: start + 120 })
const me = s('me', 'me@x', 780)

describe('back-to-back friends', () => {
  it('follows the chain both ways, skips gaps, other houses and my own other slots', () => {
    const all = [s('before', 'b@x', 660), s('after', 'a@x', 900), s('after2', 'c@x', 1020), s('gap', 'g@x', 1260), s('mine2', 'me@x', 1140), s('c2', 'd@x', 900, 'cliff2')]
    expect(backToBack(me, all).map(x => x.id)).toEqual(['before', 'after', 'after2'])
  })
  it('crew must be one unbroken block', () => {
    expect(crewProblem(me, [s('after', 'a@x', 900)])).toBeNull()
    expect(crewProblem(me, [s('gap', 'g@x', 1260)])).toMatch(/no gaps/)
    expect(crewProblem(me, [s('c2', 'd@x', 900, 'cliff2')])).toMatch(/same day/)
  })
  it('hours = whole block, trimmed at midnight', () => {
    expect(crewHours([me, s('after', 'a@x', 900)])).toEqual({ start: 780, end: 1020 })
    expect(crewHours([s('late', 'l@x', 1380)])).toEqual({ start: 1380, end: 1440 })
  })
})

describe('shared gear notifications', () => {
  const g = { title: 'Diner', creatorEmail: 'c@x', creatorName: 'Ana B', crewEmails: ['k@x'], date: '2026-11-02', start: 780, status: 'held', history: [{ by: 'c@x' }] }
  it('friends hear they share it; declines and reminders go to everyone', () => {
    expect(gearChange('g1', null, g).map(p => p.to)).toEqual([['gear-team'], ['k@x']])
    expect(gearChange('g1', g, { ...g, status: 'declined' })[0].to).toEqual(['c@x', 'k@x'])
    expect(gearChange('g1', g, { ...g, status: 'cancelled', history: [{ by: 'c@x' }] })[0]).toMatchObject({ to: ['k@x'], title: 'Shared gear cancelled' })
    expect(gearChange('g1', g, { ...g, status: 'cancelled', history: [{ by: 'team@x' }] })[0].to).toEqual(['c@x', 'k@x'])
    expect(gearReminders('g1', { ...g, status: 'out', to: '2026-11-02T17:00' }, '2026-11-02T16:40')[0].push.to).toEqual(['c@x', 'k@x'])
    expect(responsible({ creatorEmail: 'c@x' })).toEqual(['c@x'])
  })
})
