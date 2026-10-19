import { describe, it, expect } from 'vitest'
import { routeMessage, findShoot } from '../../src/lib/aiRoute'

// 2026-10-24 is a Saturday, 2026-10-27 a Tuesday.
const shoots = [{ id: 'sat', date: '2026-10-24' }, { id: 'tue', date: '2026-10-27' }]
const r = (t: string, last: 'props' | 'time' | null = null, s = shoots) => routeMessage(t, { last, shoots: s })

describe('AI chat routing', () => {
  it('sends a video idea to props', () => {
    expect(r('A séance that goes wrong').helpers).toEqual(['props'])
    expect(r('Prank: I dress up as a cop and pull my friend over at a diner').helpers).toEqual(['props'])
    expect(r('wardrobe ideas').helpers).toEqual(['props'])
  })
  it('sends a time ask to the schedule', () => {
    expect(r('4 hours with Kyle next week, evenings').helpers).toEqual(['time'])
    expect(r('Earliest free slot at Cliff 2').helpers).toEqual(['time'])
    expect(r("I'm filming with a friend this week").helpers).toEqual(['time'])
    expect(r('tomorrow at 3pm').helpers).toEqual(['time'])
  })
  it('does both when the message has an idea and a time', () => {
    expect(r('A Christmas video, filming next week').helpers).toEqual(['props', 'time'])
    expect(r('props for a séance, can I book Friday night?').helpers).toEqual(['props', 'time'])
  })
  it('points at a booked shoot instead of looking for a new time', () => {
    expect(r('props for my Saturday shoot')).toEqual({ helpers: ['props'], shootId: 'sat' })
    expect(r('a séance for my next shoot')).toEqual({ helpers: ['props'], shootId: 'sat' })
    expect(r('stuff for the shoot on Oct 27')).toEqual({ helpers: ['props'], shootId: 'tue' })
    // No Thursday shoot booked: props AND a time on Thursday.
    expect(r('props for my Thursday shoot')).toEqual({ helpers: ['props', 'time'] })
    // Asking to book never picks an existing shoot.
    expect(findShoot('book my Saturday shoot', shoots)).toBe('sat')
    expect(r('book another slot like my Saturday shoot').shootId).toBeUndefined()
  })
  it('follows the conversation for short follow-ups', () => {
    expect(r('make it spookier', 'props').helpers).toEqual(['props'])
    expect(r('anything earlier?', 'time').helpers).toEqual(['time'])
    expect(r('evenings only', 'time').helpers).toEqual(['time'])
    expect(r('Only Cliff 2', 'props').helpers).toEqual(['time'])
    expect(r('more', 'time').helpers).toEqual(['time'])
    expect(r('more', null).helpers).toEqual(['props'])
    expect(r('anything on the weekend?', 'props').helpers).toEqual(['time'])
  })
})
