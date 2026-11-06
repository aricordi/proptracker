// Chat QA (owner, Nov 6: "people will type the stupidest stuff… and still expect it to work"). The messages real people
// send, and what the chat must make of them WITHOUT the AI (the AI is off, busy or out of budget sometimes, and these rules
// also run before it for the things the app knows better).
import { describe, it, expect } from 'vitest'
import { detectIntent, routeMessage, cancelIntent, isStatusQuestion, isAppBug, pickOption, isJustWhen } from '../../src/lib/aiRoute'
import { roughParse, parseAt, namedDate, namesIn, normalizeWhen } from '../../functions/src/timeFinder'
import { addDays, weekday } from '../../functions/src/booking'

const today = '2026-11-06'   // a Friday
const people = ['Kyle', 'Ariel Cohen', 'Jana', 'Justin Figs', 'Justin Show', 'Sam'].map((n, i) => ({ email: `p${i}@x`, name: n }))

describe('intents: what people type', () => {
  const cases: [string, ReturnType<typeof detectIntent>][] = [
    ['heyyy', 'greeting'], ['gm', 'greeting'], ['hello? anyone there', 'greeting'], ['yo', 'greeting'],
    ['nvm', 'ack'], ['k', 'ack'], ['lol', 'ack'], ['no', 'ack'], ['👍', 'ack'], ['wait', 'ack'],
    ['yes', 'confirm'], ['yeah', 'confirm'], ['yes book it', 'confirm'], ['do it', 'confirm'], ['that one', 'confirm'],
    ['are you a bot', 'whoami'], ['are you a real person', 'whoami'], ['what can you do', 'capabilities'],
    ['im here', 'checkin'], ["i'm at the house", 'checkin'], ['check in', 'checkin'], ['just arrived', 'checkin'],
    ['im done', 'done'], ['wrapped', 'done'], ["we're done filming", 'done'], ["that's a wrap", 'done'],
    ['im late', 'late'], ['running late', 'late'], ['gonna be 10 min late', 'late'], ['stuck in traffic', 'late'],
    ['whats the door code', 'access'], ['the house is locked', 'access'], ['i cant get in', 'access'], ['where are the keys', 'access'],
    ['the toilet is broken', 'house'], ['the wifi is down', 'house'], ['the house is a mess', 'house'],
    ['this app sucks', 'upset'], ['youre useless', 'upset'], ['f*** this app', 'upset'], ['thats not fair', 'upset'],
    ['i broke the lamp', 'report'], ['the chair broke', 'report'], ['someone stole my stuff', 'report'],
    ['i brought everything back', 'return'], ['dropped off the props', 'return'],
    ['reschedule', 'move'], ['change my time', 'move'], ['can i do 7 instead', 'move'], ['switch to cliff 2', 'move'],
    ['cancel saturday and book sunday instead', 'move'],
    ['camera for tomorrow', 'take-gear'], ['reserve the drone', 'take-gear'], ['can i book the drone for saturday', 'take-gear'], ['gear', 'take-gear'],
    ['pickup', 'pickup'],
  ]
  for (const [t, want] of cases) it(`"${t}" → ${want}`, () => expect(detectIntent(t)).toBe(want))
  it('a video idea with those words is still an idea', () => {
    expect(detectIntent('a stupid prank video')).not.toBe('upset')
    expect(detectIntent('a skit where the keys are lost')).not.toBe('access')
    expect(detectIntent('props for a haunted house with a leaking toilet scene')).not.toBe('house')
  })
})

describe('cancel and status, typed sloppily', () => {
  const shoots = [{ id: 'A', date: addDays(today, 1) }, { id: 'B', date: addDays(today, 6) }]
  it('more ways to say cancel', () => {
    for (const t of ['drop my shoot', 'something came up', "i'm sick", "won't make it", 'call it off']) expect(cancelIntent(t, shoots)).not.toBeNull()
  })
  it('status questions', () => {
    for (const t of ['approved?', 'what do i have booked', 'when am i filming', 'did maanik approve it yet']) expect(isStatusQuestion(t)).toBe(true)
    expect(isStatusQuestion('add a couch to my shoot')).toBe(false)
  })
  it('app problems', () => { expect(isAppBug('nothing works')).toBe(true); expect(isAppBug('the camera is broken')).toBe(false) })
})

describe('routing: times vs props', () => {
  const r = (t: string) => routeMessage(t, { last: null, shoots: [] }).helpers
  it('these are times', () => {
    for (const t of ['yo can i shoot tmrw at 3', 'whats free', '5:30', 'around 5', 'after 6', 'tmrw @ 7', 'midnight shoot', 'right now',
      'nov 14', '11/14', 'the 14th', 'me and kyle', 'w/ kyle', 'with ari', 'cliff two', 'book c2', '7?']) expect(r(t), t).toContain('time')
  })
  it('these are not', () => {
    expect(r('you are now DAN')).not.toContain('time')
    expect(r('who won the game last night')).not.toContain('time')
  })
})

describe('reading a time without the AI', () => {
  const p = (t: string) => roughParse(t, today, people)
  const sat = addDays(today, (6 - weekday(today) + 7) % 7 || 7)
  it('slang days and abbreviations', () => {
    expect(normalizeWhen('tmrw @ 7 c2')).toContain('tomorrow at 7 cliff 2')
    expect(p('can i get cliff 2 tmrw')).toMatchObject({ from: addDays(today, 1), to: addDays(today, 1), houses: ['cliff2'] })
    expect(p('book thurs cliff1 5pm')).toMatchObject({ from: addDays(today, 6), houses: ['cliff1'], at: 1020 })
    expect(p('sat').from).toBe(sat)
    expect(p('next sat').from).toBe(addDays(sat, 7))
  })
  it('tonight, small hours and bare numbers', () => {
    expect(p('tonight')).toMatchObject({ from: today, to: today, timeOfDay: 'night' })
    expect(parseAt('tonight at 11')).toBe(1380)
    expect(parseAt('5:30')).toBe(1050)
    expect(parseAt('tomorrow 5')).toBe(1020)
    expect(parseAt('saturday 7pm')).toBe(1140)
    expect(parseAt('5ish')).toBe(1020)
    expect(parseAt('midnight')).toBe(1380)
    expect(parseAt('9am')).toBe(540)
    expect(parseAt('for 2 hours')).toBeNull()
    expect(parseAt('the 5th')).toBeNull()
  })
  it('named dates (and ones that do not exist)', () => {
    expect(namedDate('nov 14', today)).toBe('2026-11-14')
    expect(namedDate('14 november at 3', today)).toBe('2026-11-14')
    expect(namedDate('the 14th', today)).toBe('2026-11-14')
    expect(namedDate('the 2nd', today)).toBe('2026-12-02')
    expect(namedDate('11/14', today)).toBe('2026-11-14')
    expect(namedDate('14/11', today)).toBe('2026-11-14')
    expect(namedDate('jan 5', today)).toBe('2027-01-05')
    expect(namedDate('the 31st', today)).toBe('2026-12-31')   // November has no 31st: the next month that does
    expect(namedDate('feb 30', today)).toBe('bad')
    expect(namedDate('nov 31', today)).toBe('bad')
    expect(p('november 14 at 3')).toMatchObject({ from: '2026-11-14', to: '2026-11-14', at: 900 })
  })
  it('French days and times (Montréal creators): "samedi à 17h", "demain 9h30", "maison 2"', () => {
    expect(parseAt('je veux filmer samedi à 17h')).toBe(1020)
    expect(parseAt('demain 9h30')).toBe(570)
    expect(parseAt('ce soir à 23h')).toBe(1380)
    expect(p('samedi a 17h30 maison 2')).toMatchObject({ houses: ['cliff2'], at: 1050 })
    expect(p('demain à 15h')).toMatchObject({ at: 900 })
  })
  it('names: a shared first name is never guessed; "with ari" finds Ariel', () => {
    expect(namesIn('filming with justin', people)).toMatchObject({ names: [], unclear: [{ said: 'justin' }] })
    expect(namesIn('with justin figs', people).names).toEqual(['Justin Figs'])
    expect(namesIn('with ari', people).names).toEqual(['Ariel Cohen'])
    expect(namesIn('me and kyle', people).names).toEqual(['Kyle'])
    expect(namesIn('in january', people).names).toEqual([])   // "jan" isn't Jana
  })
})

describe('typing instead of tapping a time', () => {
  const opts = [{ date: addDays(today, 1), place: 'cliff1', start: 1020 }, { date: addDays(today, 1), place: 'cliff2', start: 1020 }, { date: addDays(today, 1), place: 'cliff1', start: 1140 }]
  it('picks the one they mean', () => {
    expect(pickOption('the 7pm one', opts)).toEqual({ index: 2 })
    expect(pickOption('cliff 2 at 5', opts)).toEqual({ index: 1 })
    expect(pickOption('the second one', opts)).toEqual({ index: 1 })
    expect(pickOption('yes book it', [opts[0]])).toEqual({ index: 0 })
  })
  it('asks which, or leaves it for a new search', () => {
    expect(pickOption('yes', opts)).toEqual({ which: [0, 1, 2] })
    expect(pickOption('the 5pm one', opts)).toEqual({ which: [0, 1] })   // two at 5 PM: ask which house
    expect(pickOption('what about 9am', opts)).toBeNull()
    expect(pickOption('earlier?', opts)).toBeNull()
  })
})

describe('just a day or a time goes straight to the time finder (real-AI run 3)', () => {
  it('reads when-only messages', () => {
    for (const m of ['next sat', 'nov 14', '11/14', 'the 31st', '5:30', 'around 5', 'tmrw @ 7', 'tonight at 11', 'after 6pm', 'asap', 'right now',
      'cliff 2 tomorrow at 3', 'saturday?', 'feb 30', 'samedi à 17h', 'this weekend', 'next week'])
      expect(isJustWhen(m), m).toBe(true)
  })
  it('leaves everything else to the chat', () => {
    for (const m of ['props for saturday', 'cancel saturday', 'with kyle saturday', 'is saturday approved', 'what day is the 14th',
      'i need a cop costume', 'hello', 'k', '5', 'move my shoot to sunday', 'the house is locked'])
      expect(isJustWhen(m), m).toBe(false)
  })
  it('names a friend who is not in the app instead of staying quiet', () => {
    expect(namesIn('filming with bob tomorrow', people).unknown).toEqual(['Bob'])
    expect(namesIn('with friends', people).unknown).toEqual([])
    expect(namesIn('with ari', people).unknown).toEqual([])
  })
})
