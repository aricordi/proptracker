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
