import { describe, it, expect } from 'vitest'
import { isBirthday, makeBirthday, birthdaysOn, birthdayLabel, firstName } from '../../src/lib/birthdays'

describe('birthdays', () => {
  it('only keeps real month-day dates', () => {
    expect(isBirthday('03-14')).toBe(true)
    expect(isBirthday('02-29')).toBe(true)
    expect(isBirthday('02-30')).toBe(false)
    expect(isBirthday('13-01')).toBe(false)
    expect(isBirthday('1990-03-14')).toBe(false)
    expect(makeBirthday(3, 4)).toBe('03-04')
    expect(birthdayLabel('11-02')).toBe('November 2')
  })
  it("finds today's birthdays; Feb 29 counts on Feb 28 in other years", () => {
    const people = [{ email: 'a@x', birthday: '10-30' }, { email: 'b@x', birthday: '02-29' }, { email: 'c@x' }]
    expect(birthdaysOn('2026-10-30', people).map(p => p.email)).toEqual(['a@x'])
    expect(birthdaysOn('2026-02-28', people).map(p => p.email)).toEqual(['b@x'])
    expect(birthdaysOn('2028-02-28', people)).toEqual([])
    expect(birthdaysOn('2028-02-29', people).map(p => p.email)).toEqual(['b@x'])
  })
  it('uses the first name', () => {
    expect(firstName('Kyle Smith', 'k@x')).toBe('Kyle')
    expect(firstName('', 'jana@example.com')).toBe('jana')
  })
})
