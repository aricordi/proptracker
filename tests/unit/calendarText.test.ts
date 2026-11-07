import { describe, it, expect } from 'vitest'
import { houseFromText, ignoreReason, placeFromText, saysOffsite, namedPeopleInfo, splitHours, namesBothHouses, nightBefore, queueReady } from '../../functions/src/calendarText'

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

describe('offsite in the words (owner, Nov 5)', () => {
  it('reads offsite, but an address or house name still wins', () => {
    expect(placeFromText('Val / Sam / Preslea - Offsite Filming')).toBe('offsite')
    expect(placeFromText('Kyle off-site shoot')).toBe('offsite')
    expect(placeFromText('Kyle off site')).toBe('offsite')
    expect(placeFromText('Ana on location downtown')).toBe('offsite')
    expect(placeFromText('Offsite prep · 2375 Cliff Rd')).toBe('cliff1')
    expect(placeFromText('Ana - Stromedy Talent Filming')).toBe(null)
    expect(saysOffsite('Offsites planning')).toBe(false)
    expect(saysOffsite('Kickoff site walk')).toBe(false)
  })
})

describe('audit fixes (Nov 5)', () => {
  const people = [{ email: 'j1@x', name: 'Justin Figs' }, { email: 'j2@x', name: 'Justin Show' }, { email: 'a@x', name: 'Alex' },
    { email: 'ad@x', name: 'Alexandra' }, { email: 'e@x', name: 'Élodie' }, { email: 'k@x', name: 'Kyle' }]
  it('two people with the same first name are not guessed', () => {
    expect(namedPeopleInfo('Justin - Stromedy Talent Filming', people)).toEqual({ people: [], ambiguous: ['justin'] })
    expect(namedPeopleInfo('Kyle & Justin', people).people.map(p => p.email)).toEqual(['k@x'])
  })
  it('a person\'s own name beats someone else\'s nickname; accents don\'t matter', () => {
    expect(namedPeopleInfo('Alexandra filming', people).people.map(p => p.email)).toEqual(['ad@x'])
    expect(namedPeopleInfo('Alex filming', people).people.map(p => p.email)).toEqual(['a@x'])
    expect(namedPeopleInfo('Elodie - Cliff 1', people).people.map(p => p.email)).toEqual(['e@x'])
  })
  it('every turn of a group has time', () => {
    const t = splitHours(780, 960, 4)
    expect(t.every(x => x.end > x.start)).toBe(true)
    expect(t.at(-1)!.end).toBe(960)
  })
  it('filming events with "holiday" or "sick" in the title are not hidden', () => {
    expect(ignoreReason({ title: 'Ariel - Holiday Special - Stromedy Talent Filming', location: '' })).toBe('')
    expect(ignoreReason({ title: 'Jana - Sick prank', location: '' }, true)).toBe('')
    expect(ignoreReason({ title: 'Valentyna away', location: '' })).toBe('Someone away')
    expect(ignoreReason({ title: 'Sick day', location: '' })).toBe('Someone away')
  })
})

describe('calendar audit fixes (Nov 7)', () => {
  it('an event naming both houses is not one house (a person picks)', () => {
    for (const t of ['Cleaners - Cliff 1 & 2', 'Cleaners Cliff 1 + Cliff 2', 'Cliff 1/2 cleaners', 'Maintenance 2375 and 2371 Cliff']) {
      expect(namesBothHouses(t)).toBe(true)
      expect(houseFromText(t)).toBe(null)
    }
    expect(namesBothHouses('Kyle - Cliff 1')).toBe(false)
    expect(houseFromText('Kyle - Cliff 1')).toBe('cliff1')
    expect(ignoreReason({ title: 'Cleaners away Cliff 1 & 2', location: '' })).toBe('')
  })
  it('only the small hours belong to the night before; a 5–7 AM shoot stays on its own day', () => {
    expect(nightBefore(30, 120)).toBe(true)      // 12:30–2 AM
    expect(nightBefore(0, 60)).toBe(true)        // midnight–1 AM
    expect(nightBefore(300, 420)).toBe(false)    // 5–7 AM
    expect(nightBefore(330, 450)).toBe(false)    // 5:30–7:30 AM
    expect(nightBefore(120, 420)).toBe(false)    // 2–7 AM runs into the morning
  })
  it('Confirm all leaves out a shoot that stays cancelled', () => {
    expect(queueReady({ placed: true, result: { action: 'shoot' } })).toBe(true)
    expect(queueReady({ placed: true, result: { action: 'cancelled' } })).toBe(false)
    expect(queueReady({ placed: true, problem: 'Google now says Eddy', result: { action: 'shoot' } })).toBe(false)
  })
})
