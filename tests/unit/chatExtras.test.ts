import { describe, it, expect } from 'vitest'
import { photoAnswer, photoWords, speakable, speakOn, PHOTO_TEXT } from '../../src/lib/chatExtras'

describe('chat photo answer', () => {
  it('turns matches into one props group', () => {
    const r = photoAnswer('A red rotary phone', ['a', 'b'])
    expect(r.text).toBe("Looks like a red rotary phone. Here's what we have that's closest.")
    expect(r.result?.groups[0].picks.map(p => p.id)).toEqual(['a', 'b'])
    expect(r.result?.groups[0].picks[0].kind).toBe('prop')
    expect(r.search).toBeUndefined()
  })
  it('offers a search when nothing is close', () => {
    const r = photoAnswer('A black wool peacoat.', [])
    expect(r.result).toBeUndefined()
    expect(r.search).toBe('black wool peacoat')
    expect(r.text).toMatch(/^Looks like a black wool peacoat\./)
  })
  it('says so when the photo could not be read', () => {
    const r = photoAnswer('', ['x'])
    expect(r.result).toBeUndefined()
    expect(r.text).toMatch(/couldn't tell/)
  })
  it('photoWords drops the article', () => {
    expect(photoWords('An old lamp')).toBe('old lamp')
    expect(PHOTO_TEXT.length).toBeGreaterThan(5)
  })
})

describe('read aloud', () => {
  it('reads only the words', () => {
    expect(speakable('**Thursday** is free ✓\n- Cliff 1\n- Cliff 2 ›')).toBe('Thursday is free Cliff 1 Cliff 2')
  })
  it('is on unless turned off', () => {
    expect(speakOn(null)).toBe(true)
    expect(speakOn({ getItem: () => null })).toBe(true)
    expect(speakOn({ getItem: () => 'off' })).toBe(false)
    expect(speakOn({ getItem: () => { throw new Error('blocked') } })).toBe(true)
  })
})
