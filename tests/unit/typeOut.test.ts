import { describe, expect, it } from 'vitest'
import { MAX_REVEAL_MS, WORD_MS, wordPieces, revealMs, wordsShown } from '../../src/lib/typeOut'

describe('typing out chat answers', () => {
  it('cuts text into words that join back exactly', () => {
    const t = 'Hi **Maya**!\n- Thursday 5 PM  is free.'
    expect(wordPieces(t).join('')).toBe(t)
    expect(wordPieces(t)).toHaveLength(8)
    expect(wordPieces('')).toEqual([])
    expect(wordPieces('   ')).toEqual([])
  })
  it('is 25 ms a word for short replies and never over 1.2 s for long ones', () => {
    expect(revealMs(10)).toBe(10 * WORD_MS)
    expect(revealMs(200)).toBe(MAX_REVEAL_MS)
    expect(revealMs(0)).toBe(0)
  })
  it('shows the first word straight away and everything by the end', () => {
    expect(wordsShown(10, 0)).toBe(1)
    expect(wordsShown(10, 50)).toBe(3)
    expect(wordsShown(10, 10_000)).toBe(10)
    expect(wordsShown(300, MAX_REVEAL_MS)).toBe(300)
    expect(wordsShown(0, 100)).toBe(0)
  })
})
