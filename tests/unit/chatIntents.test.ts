// The chat's own intents (owner, Nov 3): every phrasing below must land on the right thing.
import { describe, it, expect } from 'vitest'
import { detectIntent, cancelIntent, isStatusQuestion, isHelpQuestion, routeMessage } from '../../src/lib/aiRoute'

const cases: [string, ReturnType<typeof detectIntent>][] = [
  ['hi', 'greeting'], ['Hey!', 'greeting'], ['good morning', 'greeting'],
  ['thanks', 'thanks'], ['thank you!', 'thanks'], ['ok', 'thanks'],
  ['returning the camera', 'return'], ['bringing the props back', 'return'], ["I'm done with the gear", 'return'],
  ['dropping off the kit', 'return'], ['return everything', 'return'], ['giving it back now', 'return'],
  ['the tripod is broken', 'report'], ['a battery is missing from the case', 'report'], ["the camera won't turn on", 'report'],
  ['I lost the mic', 'report'], ['one of the props is damaged', 'report'], ['the lens is scratched', 'report'],
  ['are my props ready?', 'pickup'], ['picking up my props', 'pickup'], ['where are my props', 'pickup'],
  ['taking the FX3', 'take-gear'], ['grabbing a camera', 'take-gear'], ['I need a camera now', 'take-gear'],
  ['checking out FX3 case 1', 'take-gear'], ['can I get the drone', 'take-gear'],
  ['move my thursday shoot', 'move'], ['can I reschedule my shoot?', 'move'], ['change the time of my booking', 'move'],
  ['swap with Kyle', 'swap'], ['can I trade slots with someone', 'swap'],
  ['shooting at the park on Friday', 'offsite'], ["I'm filming offsite tomorrow 2 to 5", 'offsite'],
  ['do I have any strikes?', 'strikes'], ['am I paused', 'strikes'],
  ['my requests', 'requests'], ["where's my gear request", 'requests'],
]

describe('the chat understands what people mean', () => {
  for (const [t, want] of cases) it(`"${t}" → ${want}`, () => expect(detectIntent(t)).toBe(want))

  it('leaves video ideas, booking asks and how-to questions to the helpers', () => {
    for (const t of ['props for a séance video', 'a cop prank in a diner', 'Thursday Cliff 1 at 5pm', 'book me 2 hours tomorrow',
      'how do I return gear?', 'something for a broken-heart skit', 'candles']) expect(detectIntent(t)).toBeNull()
    expect(isHelpQuestion('how do I return gear?')).toBe(true)
    expect(routeMessage('Thursday Cliff 1 at 5pm', { last: null, shoots: [] }).helpers).toEqual(['time'])
  })

  it('still does cancel and status by itself', () => {
    const shoots = [{ id: 'a', date: '2026-11-05' }, { id: 'b', date: '2026-11-07' }]
    expect(cancelIntent('cancel my next shoot', shoots)).toEqual({ shootId: 'a' })
    expect(cancelIntent("I can't make it", shoots)).toEqual({})
    expect(isStatusQuestion('is my shoot approved?')).toBe(true)
  })
})
