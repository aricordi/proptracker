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

describe('how-do-I questions go to the app guide', () => {
  const ctx = { last: null, shoots: [] }
  it('questions about using the app', () => {
    for (const q of ['How do I book a shoot?', 'where are my requests', 'how do I return gear', 'Can I change my request?', 'what is a strike', "I can't find the check in button", 'help'])
      expect(routeMessage(q, ctx).helpers, q).toEqual(['help'])
  })
  it('not when it is really a time search or a prop idea', () => {
    expect(routeMessage('can I book Friday at 3pm', ctx).helpers).toContain('time')
    expect(routeMessage('how do I find 2 hours next week', ctx).helpers).toContain('time')
    expect(routeMessage('what props for a seance video', ctx).helpers).toEqual(['props'])
  })
})
