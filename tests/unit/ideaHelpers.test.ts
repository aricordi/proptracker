// When the AI is busy or refuses, the idea helper still answers from smart search.
import { describe, it, expect } from 'vitest'
import { plainNeeds, rankedPicks, signalsFrom, goesWith } from '../../functions/src/ideaHelpers'

describe('plainNeeds', () => {
  it('searches the whole idea and each of its parts', () => {
    const n = plainNeeds('a cop, a diner and a radar gun')
    expect(n[0].items).toEqual(['a cop, a diner and a radar gun', 'a cop', 'a diner', 'a radar gun'])
  })
  it('keeps it to 6 searches and skips tiny bits', () => {
    expect(plainNeeds('a, b, hat, mask, wig, cape, sword, shield, gun')[0].items.length).toBeLessThanOrEqual(6)
    expect(plainNeeds('a, b, hat')[0].items).not.toContain('a')
  })
})

describe('rankedPicks', () => {
  it('takes the closest usable props per need, never twice, max 5 per group', () => {
    const needs = [{ scene: 'For the cop', items: ['badge', 'uniform'] }, { scene: 'For the diner', items: ['menu'] }]
    const near = { badge: ['b1', 'b2', 'b3'], uniform: ['b2', 'u1'], menu: ['x', 'm1'] }
    const g = rankedPicks(needs, near, new Set(['b1', 'b2', 'u1', 'm1']))
    expect(g[0].picks.map(p => p.id)).toEqual(['b1', 'b2', 'u1'])
    expect(g[1].picks.map(p => p.id)).toEqual(['m1'])
    expect(g[0].picks[0].why).toBe('Close match for "badge"')
  })
  it('drops a group with nothing usable', () => {
    expect(rankedPicks([{ scene: 'For x', items: ['y'] }], { y: ['gone'] }, new Set())).toEqual([])
  })
})

describe('learning from real requests', () => {
  const s = signalsFrom([{ itemIds: ['badge', 'uniform', 'cuffs'] }, { itemIds: ['badge', 'uniform'] }, { itemIds: ['badge', 'menu'] }, { itemIds: ['uniform', 'uniform'] }])
  it('counts how often each prop is requested (once per request)', () => {
    expect(s.uses).toEqual({ badge: 3, uniform: 3, cuffs: 1, menu: 1 })
  })
  it('suggests what is usually requested with the picks, skipping shown ones and one-offs', () => {
    expect(goesWith(['badge'], s, new Set())).toEqual([{ id: 'uniform', times: 2 }])
    expect(goesWith(['badge'], s, new Set(['uniform']))).toEqual([])
    expect(goesWith(['badge', 'cuffs'], s, new Set(), 3, 1).map(x => x.id)).toEqual(['uniform', 'menu'])
  })
})
