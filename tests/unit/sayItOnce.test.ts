import { describe, it, expect } from 'vitest'
import { pairOf, topPicks, planSkip, videoName, PLAN_MAX_PICKS } from '../../src/lib/sayItOnce'

describe('say it once: pairOf', () => {
  it('reads a time + props message either way round', () => {
    expect(pairOf({ action: 'times', query: 'Thursday 5pm Cliff 1 with Kyle', also: { action: 'props', query: 'cop costume and handcuffs' } }))
      .toEqual({ time: 'Thursday 5pm Cliff 1 with Kyle', props: 'cop costume and handcuffs' })
    expect(pairOf({ action: 'props', query: 'a séance', also: { action: 'times', query: 'Friday at 3' } })).toEqual({ time: 'Friday at 3', props: 'a séance' })
  })
  it('ignores anything else', () => {
    expect(pairOf({ action: 'times', query: 'Friday at 3' })).toBeNull()
    expect(pairOf({ action: 'times', query: 'Friday at 3', also: { action: 'return', query: '' } })).toBeNull()
    expect(pairOf({ action: 'times', query: '', also: { action: 'props', query: 'a séance' } })).toBeNull()
    expect(pairOf({ action: 'reply', query: 'x', also: { action: 'props', query: 'y' } })).toBeNull()
  })
})

describe('say it once: topPicks', () => {
  const groups = [
    { picks: [{ id: 'a', kind: 'prop' }, { id: 'g', kind: 'gear' }, { id: 'b', kind: 'prop' }] },
    { picks: [{ id: 'a', kind: 'prop' }, { id: 'c', kind: 'prop' }, { id: 'd', kind: 'prop' }] },
  ]
  it('keeps the AI order, props only, each once, free that day', () => {
    const free: Record<string, number | null> = { a: 1, b: 0, c: 2, d: null }
    expect(topPicks(groups, id => free[id] ?? null)).toEqual(['a', 'c'])
  })
  it('stops at the limit', () => {
    const many = [{ picks: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, kind: 'prop' })) }]
    expect(topPicks(many, () => 1)).toHaveLength(PLAN_MAX_PICKS)
  })
})

describe('say it once: planSkip', () => {
  const ok = { hasTime: true, needsGuideline: false, tooLateForProps: false, picks: 2 }
  it('shows the card when everything fits', () => expect(planSkip(ok)).toBeNull())
  it('falls back to the separate answers', () => {
    expect(planSkip({ ...ok, hasTime: false })).toBe('no-time')
    expect(planSkip({ ...ok, timeNote: true })).toBe('time-note')
    expect(planSkip({ ...ok, timeNote: false })).toBeNull()
    expect(planSkip({ ...ok, needsGuideline: true })).toBe('guideline')
    expect(planSkip({ ...ok, tooLateForProps: true })).toBe('too-late')
    expect(planSkip({ ...ok, picks: 0 })).toBe('no-props')
  })
})

describe('say it once: videoName', () => {
  it('tidies the idea', () => {
    expect(videoName('  i need a cop costume and handcuffs. ')).toBe('A cop costume and handcuffs')
    expect(videoName('')).toBe('My video')
    const long = videoName('a very long idea about a prank where I dress up as a cop and pull my friend over at the diner downtown at night')
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith(' ')).toBe(false)
  })
})
