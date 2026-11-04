import { describe, it, expect } from 'vitest'
import { houseFromText, ignoreReason } from '../../functions/src/calendarText'

describe('old calendar events', () => {
  it('reads the house from the address or the name', () => {
    expect(houseFromText('Shoot · 2375 Cliff Road')).toBe('cliff1')
    expect(houseFromText('2371 Cliff Rd, Toronto')).toBe('cliff2')
    expect(houseFromText('Jana - Cliff 2')).toBe('cliff2')
    expect(houseFromText('Cliff 1 cleaners')).toBe('cliff1')
    expect(houseFromText('Cliff Road shoot')).toBe(null)
    expect(houseFromText('Kyle offsite')).toBe(null)
  })
  it('hides people away and birthdays, unless they name a house', () => {
    expect(ignoreReason({ title: 'Valentyna away', location: '' })).toBe('Someone away')
    expect(ignoreReason({ title: 'Out of office', location: '' })).toBe('Someone away')
    expect(ignoreReason({ title: "Kyle's birthday", location: '' })).toBe('Birthday')
    expect(ignoreReason({ title: 'Anything', location: '', eventType: 'birthday' })).toBe('Birthday')
    expect(ignoreReason({ title: 'Team away day', location: '2375 Cliff Road' })).toBe('')
    expect(ignoreReason({ title: 'Ana shoot', location: '' })).toBe('')
  })
})

import { isClearEvent, blockTypeOf } from '../../functions/src/calendarText'
describe('clear enough to bring in by itself', () => {
  it('needs a known house and either a creator or a block that says what it is', () => {
    expect(isClearEvent({ title: 'Ana shoot', location: '' }, { action: 'shoot', email: 'ana@x', house: 'cliff1' }, true)).toBe(true)
    expect(isClearEvent({ title: 'Ana shoot', location: '' }, { action: 'shoot', email: 'ana@x', house: 'cliff1' }, false)).toBe(false)
    expect(isClearEvent({ title: 'Somebody shoot', location: '' }, { action: 'shoot', email: '', house: 'cliff1' }, true)).toBe(false)
    expect(isClearEvent({ title: 'Cleaners', location: '2375 Cliff' }, { action: 'block', house: 'cliff1' }, true)).toBe(true)
    expect(isClearEvent({ title: 'Stromedy - Cliff 2', location: '' }, { action: 'block', house: 'cliff2' }, true)).toBe(true)
    expect(isClearEvent({ title: 'Meeting', location: '2375 Cliff' }, { action: 'block', house: 'cliff1' }, true)).toBe(false)
    expect(blockTypeOf('Airbnb guests')).toBe('rental')
  })
})

describe('shared bookings', () => {
  it('finds everyone named, in order, and splits the hours', async () => {
    const { namedPeople, splitHours } = await import('../../functions/src/calendarText')
    const people = [{ email: 'a', name: 'Ana Lee' }, { email: 'k', name: 'Kyle' }, { email: 'j', name: 'Jana' }]
    expect(namedPeople('Kyle + Ana shoot (Jana too)', people).map(p => p.email)).toEqual(['k', 'a', 'j'])
    expect(namedPeople('Anabelle shoot', people)).toEqual([])
    expect(splitHours(780, 1140, 3)).toEqual([{ start: 780, end: 900 }, { start: 900, end: 1020 }, { start: 1020, end: 1140 }])
    expect(splitHours(780, 900, 1)).toEqual([{ start: 780, end: 900 }])
    expect(splitHours(780, 810, 3)).toEqual([{ start: 780, end: 810 }])
  })
})

describe('nicknames', () => {
  it('Eddy in the calendar finds Eduard in the app', async () => {
    const { namedPeople } = await import('../../functions/src/calendarText')
    const people = [{ email: 'b', name: 'Bryan' }, { email: 'e', name: 'Eduard Petrov' }]
    expect(namedPeople('Bryan + Eddy - Cliff 1', people).map(p => p.email)).toEqual(['b', 'e'])
  })
})

describe('shared booking on the slot grid', () => {
  it('one slot each, clipped to the real hours', async () => {
    const { splitOnGrid } = await import('../../functions/src/calendarText')
    const slots = [420, 540, 660, 780, 900, 1020, 1140, 1260, 1380]
    expect(splitOnGrid(720, 1140, 4, slots, 120)).toEqual([{ start: 720, end: 780 }, { start: 780, end: 900 }, { start: 900, end: 1020 }, { start: 1020, end: 1140 }])
    expect(splitOnGrid(780, 1140, 2, slots, 120)).toEqual([{ start: 780, end: 1020 }, { start: 1020, end: 1140 }])
    expect(splitOnGrid(780, 900, 3, slots, 120)).toEqual([{ start: 780, end: 810 }, { start: 810, end: 840 }, { start: 840, end: 900 }])
  })
})
