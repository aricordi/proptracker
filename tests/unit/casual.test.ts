// Creators talk casually (owner, Nov 24): every connector tool understands their words.
import { describe, it, expect } from 'vitest'
import { normPlace, normHouses, parseLooseClock, clockPair, parseLength, resolveShootRef, resolveRequestRef, resolveNamedRef, resolvePropRef, qtyFrom } from '../../functions/src/mcp/casual'

const today = '2026-11-24'   // Tuesday
describe('places', () => {
  it('house names as people say them', () => {
    for (const s of ['c2', 'C2', 'cliff 2', 'Cliff two', 'house 2', 'the second house', '2371 cliff rd', 'maison 2', 'cliff2']) expect(normPlace(s)).toBe('cliff2')
    for (const s of ['c1', 'cliff 1', 'cliff one', 'house one', '2375', 'first house', 'cliff1']) expect(normPlace(s)).toBe('cliff1')
    for (const s of ['offsite', 'off-site', 'on location', 'somewhere else']) expect(normPlace(s)).toBe('offsite')
    expect(normPlace('whatever')).toBeNull()
    expect(normHouses('either')).toBeNull()
    expect(normHouses('c2')).toEqual(['cliff2'])
    expect(normHouses(['cliff 1', 'c2'])?.sort()).toEqual(['cliff1', 'cliff2'])
  })
})
describe('times', () => {
  it('loose clocks', () => {
    expect(parseLooseClock('5pm')).toEqual({ m: 1020, explicit: true })
    expect(parseLooseClock('5ish')).toEqual({ m: 300, explicit: false })
    expect(parseLooseClock('noon')!.m).toBe(720)
    expect(parseLooseClock('half past 5pm')!.m).toBe(1050)
    expect(parseLooseClock('quarter to 3pm')!.m).toBe(885)
    expect(parseLooseClock('17h30')!.m).toBe(1050)
    expect(parseLooseClock('13:15')).toEqual({ m: 795, explicit: true })
    expect(parseLooseClock(900)!.m).toBe(540)
    expect(parseLooseClock('banana')).toBeNull()
  })
  it('start/end pairs read like a person means them', () => {
    expect(clockPair('5', '7')).toEqual({ start: 1020, end: 1140 })        // 5 to 7 = evening
    expect(clockPair('9', '11')).toEqual({ start: 540, end: 660 })          // morning
    expect(clockPair('11', '1')).toEqual({ start: 660, end: 780 })          // 11 AM–1 PM
    expect(clockPair('11pm', '1')).toEqual({ start: 1380, end: 1500 })      // past midnight
    expect(clockPair('1:15', '3:15')).toEqual({ start: 795, end: 915 })
    expect(clockPair('5pm', null)).toEqual({ start: 1020, end: null })
  })
  it('lengths', () => {
    expect(parseLength('2 hours')).toBe(120)
    expect(parseLength('an hour and a half')).toBe(90)
    expect(parseLength('90 min')).toBe(90)
    expect(parseLength('2h30')).toBe(150)
    expect(parseLength('a couple hours')).toBe(120)
    expect(parseLength(4)).toBe(240)
    expect(parseLength('soon')).toBeNull()
  })
})
const shoots = [
  { id: 's1', place: 'cliff2', date: '2026-11-28', start: 780, end: 900, status: 'booked', with: ['Kyle Reed'], titles: ['Ring Ring'] },
  { id: 's2', place: 'cliff1', date: '2026-11-27', start: 1020, end: 1140, status: 'requested', with: [], titles: [] },
  { id: 's3', place: 'offsite', date: '2026-12-02', start: 600, end: 720, status: 'booked', with: [], titles: ['Mall prank'] },
  { id: 's0', place: 'cliff1', date: '2026-11-20', start: 600, end: 720, status: 'booked', with: [], titles: [] },
]
const shoot = (s: string) => { const r = resolveShootRef(s, shoots, today); return r.status === 'one' ? r.hits[0].id : r.status }
describe('which shoot', () => {
  it('by day, place, person, title, time, order', () => {
    expect(shoot('saturday')).toBe('s1')
    expect(shoot('my sat shoot')).toBe('s1')
    expect(shoot('friday')).toBe('s2')
    expect(shoot('the c2 one')).toBe('s1')
    expect(shoot('the one with kyle')).toBe('s1')
    expect(shoot('ring ring')).toBe('s1')
    expect(shoot('the mall prank one')).toBe('s3')
    expect(shoot('the 5pm one')).toBe('s2')
    expect(shoot('my next shoot')).toBe('s2')
    expect(shoot('second one')).toBe('s1')
    expect(shoot('last one')).toBe('s0')
    expect(shoot('s3')).toBe('s3')
    expect(shoot('2026-12-02')).toBe('s3')
    expect(shoot('my shoot')).toBe('many')       // three coming up: ask
    expect(shoot('monday')).toBe('none')
  })
})
const reqs = [
  { id: 'r1', date: '2026-11-28', title: 'Ring Ring', status: 'requested', items: ['Red rotary phone x1'] },
  { id: 'r2', date: '2026-11-27', title: 'Cop sketch', status: 'packed', items: ['Police hat x2'] },
  { id: 'r3', date: '2026-11-10', title: 'Old', status: 'returned', items: [] },
]
const req = (s: string) => { const r = resolveRequestRef(s, reqs, today); return r.status === 'one' ? r.hits[0].id : r.status }
describe('which props request', () => {
  it('by name, day, item, status', () => {
    expect(req('ring ring')).toBe('r1')
    expect(req('the phone one')).toBe('r1')
    expect(req('my friday props')).toBe('r2')
    expect(req('the packed one')).toBe('r2')
    expect(req('cop hat request')).toBe('r2')
    expect(req('my props')).toBe('many')
  })
})
describe('invites, swaps, waitlist by person or day', () => {
  const inv = [{ id: 'i1', who: 'Jordan Lee', date: '2026-11-26' }, { id: 'i2', who: 'Sam R', date: '2026-11-29' }]
  it('works', () => {
    expect(resolveNamedRef("jordan's invite", inv, today).hits[0].id).toBe('i1')
    expect(resolveNamedRef('the sunday one', inv, today).hits[0].id).toBe('i2')
    expect(resolveNamedRef('', [inv[0]], today).status).toBe('one')
    expect(resolveNamedRef('', inv, today).status).toBe('many')
  })
})
describe('props by name', () => {
  const props = [{ id: 'p1', name: 'Red rotary phone' }, { id: 'p2', name: 'Black rotary phone' }, { id: 'p3', name: 'Police hat', tags: ['cop'] }, { id: 'p4', name: 'Fog machine' }]
  const prop = (s: string) => { const r = resolvePropRef(s, props); return r.status === 'one' ? r.hits[0].id : r.status }
  it('works', () => {
    expect(prop('the red phone')).toBe('p1')
    expect(prop('rotary phones')).toBe('many')
    expect(prop('2 cop hats')).toBe('p3')
    expect(prop('fog machine')).toBe('p4')
    expect(prop('p2')).toBe('p2')
    expect(prop('pirate ship')).toBe('none')
    expect(qtyFrom('2 cop hats')).toBe(2)
    expect(qtyFrom('a couple of phones')).toBe(2)
    expect(qtyFrom('phone x3')).toBe(3)
    expect(qtyFrom('the red phone')).toBeNull()
  })
})
