// The connector "reads between the lines" (owner, Nov 24): names as people say them, and casual days.
import { describe, it, expect } from 'vitest'
import { resolvePerson, resolveWhen, editDistance } from '../../functions/src/mcp/understand'
import { weekday } from '../../functions/src/booking'

const P = [
  { email: 'me@x.co', name: 'Alex Ricordi' },
  { email: 'j1@x.co', name: 'Justin Figs' }, { email: 'r@x.co', name: 'Roland Price' }, { email: 'e@x.co', name: 'Eduard Petrov' },
  { email: 'a@x.co', name: 'Ariel Cohen' }, { email: 'k@x.co', name: 'Kyle Stone' }, { email: 'k2@x.co', name: 'Kyla Moss' },
  { email: 'v@x.co', name: 'Valentyna K' }, { email: 'c1@x.co', name: 'Chris Lane' }, { email: 'c2@x.co', name: 'Christian Bale' },
]
const who = (said: string) => { const m = resolvePerson(P, said, 'me@x.co'); return { s: m.status, n: m.hits.map(h => h.name.split(' ')[0]) } }

describe('names as people say them', () => {
  it('first names, full names, last names, @handles and accents', () => {
    expect(who('justin')).toEqual({ s: 'one', n: ['Justin'] })
    expect(who('Justin Figs')).toEqual({ s: 'one', n: ['Justin'] })
    expect(who('@kyle')).toEqual({ s: 'one', n: ['Kyle'] })
    expect(who('Petrov')).toEqual({ s: 'one', n: ['Eduard'] })
    expect(who('Ariél')).toEqual({ s: 'one', n: ['Ariel'] })
  })
  it('nicknames both ways, always confirmed ("Sam" could be a friend not on the app)', () => {
    expect(who('Rolly')).toEqual({ s: 'maybe', n: ['Roland'] })
    expect(who('eddy')).toEqual({ s: 'maybe', n: ['Eduard'] })
    expect(who('Val')).toEqual({ s: 'maybe', n: ['Valentyna'] })
  })
  it('the start of a name: a likely match to confirm, several = which one', () => {
    expect(who('jus')).toEqual({ s: 'maybe', n: ['Justin'] })
    expect(who('ari')).toEqual({ s: 'maybe', n: ['Ariel'] })
    expect(who('ky').s).toBe('none')   // too short to guess
    expect(who('kyl')).toEqual({ s: 'many', n: ['Kyle', 'Kyla'] })
  })
  it('typos are only ever a "did you mean"', () => {
    expect(who('Justn')).toEqual({ s: 'maybe', n: ['Justin'] })
    expect(who('Rolnad')).toEqual({ s: 'maybe', n: ['Roland'] })
    expect(who('Rolan')).toEqual({ s: 'maybe', n: ['Roland'] })   // the start of one name
    expect(who('Arial')).toEqual({ s: 'maybe', n: ['Ariel'] })
  })
  it('shared names are asked, never guessed; Chris is exact', () => {
    expect(who('chris')).toEqual({ s: 'one', n: ['Chris'] })
    expect(who('Christi')).toEqual({ s: 'maybe', n: ['Christian'] })
    expect(who('chri')).toEqual({ s: 'many', n: ['Chris', 'Christian'] })
  })
  it('never by email, never yourself, nobody for strangers', () => {
    expect(who('j1@x.co').s).toBe('none')
    expect(who('Alex').s).toBe('none')
    expect(who('Zebulon').s).toBe('none')
    expect(who('').s).toBe('none')
  })
  it('edit distance counts swapped letters as one', () => {
    expect(editDistance('ariel', 'arile')).toBe(1)
    expect(editDistance('kyle', 'kyle')).toBe(0)
  })
})

describe('casual days', () => {
  const today = '2026-11-24'   // a Tuesday
  it('tomorrow / today / tonight, slang and French', () => {
    expect(resolveWhen('tomorrow', today)!.days).toEqual(['2026-11-25'])
    expect(resolveWhen('tmrw night', today)!.days).toEqual(['2026-11-25'])
    expect(resolveWhen('tonight', today)!.days).toEqual([today])
    expect(resolveWhen('demain', today)!.days).toEqual(['2026-11-25'])
    expect(resolveWhen('day after tomorrow', today)!.days).toEqual(['2026-11-26'])
  })
  it('weekdays, next weekday, weekends and weeks', () => {
    expect(resolveWhen('sat', today)!.days).toEqual(['2026-11-28'])
    expect(weekday(resolveWhen('friday', today)!.days[0])).toBe(5)
    expect(resolveWhen('next friday', today)!.days).toEqual(['2026-12-04'])
    expect(resolveWhen('this weekend', today)!.days).toEqual(['2026-11-28', '2026-11-29'])
    expect(resolveWhen('next weekend', today)!.days).toEqual(['2026-12-05', '2026-12-06'])
    const nw = resolveWhen('next week', today)!.days
    expect(nw[0]).toBe('2026-11-30'); expect(nw).toHaveLength(7)
  })
  it('dates and nothing', () => {
    expect(resolveWhen('nov 28', today)!.days).toEqual(['2026-11-28'])
    expect(resolveWhen('the 30th', today)!.days).toEqual(['2026-11-30'])
    expect(resolveWhen('whenever', today)).toBeNull()
    expect(resolveWhen('', today)).toBeNull()
  })
})

describe('casual days said on a Sunday', () => {
  const sun = '2026-11-29'
  it('this week = today + the week ahead; next weekend = the coming one', () => {
    expect(resolveWhen('this week', sun)!.days).toHaveLength(8)
    expect(resolveWhen('next weekend', sun)!.days).toEqual(['2026-12-05', '2026-12-06'])
    expect(resolveWhen('this weekend', sun)!.days).toEqual([sun])
    expect(resolveWhen('next week', sun)!.days[0]).toBe('2026-11-30')
  })
})
