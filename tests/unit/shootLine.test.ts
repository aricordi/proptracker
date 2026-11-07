import { describe, it, expect } from 'vitest'
import { compactHours, findShootOnDay, shootLineText, placeName, shortPlace, SHORT_PLACE_MAX } from '../../src/lib/shootLine'
import type { ScheduleDay } from '../../functions/src/schedule'

const houses = { cliff1: { name: 'Cliff 1' }, cliff2: { name: 'Cliff 2' } }
const DATE = '2026-11-07'   // a Saturday

describe('compactHours', () => {
  it('drops the first AM/PM when both ends share it', () => {
    expect(compactHours(780, 900)).toBe('1–3 PM')
    expect(compactHours(720, 840)).toBe('12–2 PM')
    expect(compactHours(870, 1020)).toBe('2:30–5 PM')
    expect(compactHours(420, 540)).toBe('7–9 AM')
  })
  it('keeps both when the halves differ or it runs past midnight', () => {
    expect(compactHours(660, 780)).toBe('11 AM–1 PM')
    expect(compactHours(1380, 1500)).toBe('11 PM–1 AM')
    // 18-hour offsite shoot, 7 AM → 1 AM the next day: both say AM but it isn't "7–1 AM"
    expect(compactHours(420, 1500)).toBe('7 AM–1 AM')
  })
})

describe('findShootOnDay', () => {
  const day: ScheduleDay = {
    date: DATE,
    cliff1: {
      '780': { shootId: 'sh1', name: 'Riley Chen', email: 'riley@x.com', kind: 'extra' },
      '1020': { shootId: 'sh2', name: 'Kyle', email: 'kyle@x.com', kind: 'extra', time: { start: 990, end: 1140 } },
      '1140': { shootId: 'sh2', name: 'Kyle', email: 'kyle@x.com', kind: 'extra', time: { start: 990, end: 1140 } },
      '1260': { shootId: '', name: 'Jana', email: 'jana@x.com', kind: 'extra', hold: { until: `${DATE}T20:00`, inviteId: 'i1', fromName: 'Kyle' } },
    },
    cliff2: {
      '540': { shootId: 'sh3', name: 'Maya', email: 'maya@x.com', kind: 'extra' },
      '660': { shootId: 'sh3', name: 'Maya', email: 'maya@x.com', kind: 'extra' },
      '900': { shootId: 'sh1', name: 'Riley Chen', email: 'riley@x.com', kind: 'extra', move: true, pending: true },
    },
    offsite: [{ shootId: 'sh4', name: 'Devon', email: 'devon@x.com', start: 600, end: 870, where: 'Old Port, Montreal' },
      { shootId: 'sh5', name: 'Sam', start: 600, end: 720, where: 'https://maps.app.goo.gl/abc' }],
    clashes: [{ house: 'cliff1', slot: '780', shootId: 'sh6', name: 'Val', start: 780, end: 960 }],
  }

  it('finds a house slot with the slot length', () => {
    expect(findShootOnDay(day, 'sh1', 120)).toEqual({ place: 'cliff1', date: DATE, start: 780, end: 900, name: 'Riley Chen', email: 'riley@x.com' })
  })
  it('several slots in a row = one block', () => {
    expect(findShootOnDay(day, 'sh3', 120)).toMatchObject({ place: 'cliff2', start: 540, end: 780 })
  })
  it('an imported shoot keeps its real hours', () => {
    expect(findShootOnDay(day, 'sh2', 120)).toMatchObject({ start: 990, end: 1140 })
  })
  it('ignores a move still waiting for approval', () => {
    expect(findShootOnDay(day, 'sh1', 120)?.place).toBe('cliff1')
    expect(findShootOnDay({ date: DATE, cliff2: day.cliff2 }, 'sh1', 120)).toBeNull()
  })
  it('offsite and clashes', () => {
    expect(findShootOnDay(day, 'sh4', 120)).toMatchObject({ place: 'offsite', where: 'Old Port, Montreal', start: 600, end: 870 })
    expect(findShootOnDay(day, 'sh6', 120)).toMatchObject({ place: 'cliff1', start: 780, end: 960, name: 'Val' })
  })
  it('nothing for no shoot, no day, an unknown id, or a held slot', () => {
    expect(findShootOnDay(day, undefined, 120)).toBeNull()
    expect(findShootOnDay(null, 'sh1', 120)).toBeNull()
    expect(findShootOnDay(day, 'nope', 120)).toBeNull()
    expect(findShootOnDay(day, '', 120)).toBeNull()
  })

  it('the one line: place · day · hours · creator', () => {
    expect(shootLineText(findShootOnDay(day, 'sh1', 120)!, houses)).toBe('Cliff 1 · Sat, Nov 7 · 1–3 PM · Riley Chen')
    expect(shootLineText(findShootOnDay(day, 'sh4', 120)!, houses)).toBe('Old Port, Montreal · Sat, Nov 7 · 10 AM–2:30 PM · Devon')
  })
  it('leaves out your own name, and a map link reads "Offsite"', () => {
    expect(shootLineText(findShootOnDay(day, 'sh1', 120)!, houses, 'riley@x.com')).toBe('Cliff 1 · Sat, Nov 7 · 1–3 PM')
    expect(shootLineText(findShootOnDay(day, 'sh1', 120)!, houses, 'arts@x.com')).toContain('Riley Chen')
    expect(placeName(findShootOnDay(day, 'sh5', 120)!, houses)).toBe('Offsite')
  })
})

describe('shortPlace (cards: the day, hours and name always fit)', () => {
  it('keeps what is before the first comma', () => {
    expect(shortPlace('123 Rue Saint-Paul Ouest, Montréal')).toBe('123 Rue Saint-Paul Ouest')
    expect(shortPlace('Old Port, Montreal')).toBe('Old Port')
    expect(shortPlace('Mount Royal')).toBe('Mount Royal')
  })
  it(`caps it at ${SHORT_PLACE_MAX} characters with …`, () => {
    const cut = shortPlace('The big warehouse behind the bakery on Saint-Laurent')
    expect(cut.length).toBeLessThanOrEqual(SHORT_PLACE_MAX)
    expect(cut.endsWith('…')).toBe(true)
    expect(shortPlace('x'.repeat(200)).length).toBe(SHORT_PLACE_MAX)
  })
  it('tidies spaces and never comes back empty', () => {
    expect(shortPlace('  Old   Port  ,  Montreal ')).toBe('Old Port')
    expect(shortPlace(', Montreal')).toBe(', Montreal')
  })
  it('cards get the short place, a request page the whole address; houses and map links unchanged', () => {
    const spot = { place: 'offsite' as const, where: '123 Rue Saint-Paul Ouest, Montréal, QC H2Y 1Z5', date: DATE, start: 660, end: 780, name: 'Riley Chen', email: 'riley@x.com' }
    expect(shootLineText(spot, houses, undefined, true)).toBe('123 Rue Saint-Paul Ouest · Sat, Nov 7 · 11 AM–1 PM · Riley Chen')
    expect(shootLineText(spot, houses)).toBe('123 Rue Saint-Paul Ouest, Montréal, QC H2Y 1Z5 · Sat, Nov 7 · 11 AM–1 PM · Riley Chen')
    expect(placeName({ ...spot, place: 'cliff1' }, houses, true)).toBe('Cliff 1')
    expect(placeName({ ...spot, where: 'https://maps.app.goo.gl/abc' }, houses, true)).toBe('Offsite')
    expect(placeName({ ...spot, where: '' }, houses, true)).toBe('Offsite')
  })
})
