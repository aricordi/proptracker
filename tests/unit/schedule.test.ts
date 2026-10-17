// House schedule rules (pure logic shared by the app and the server).
import { describe, it, expect } from 'vitest'
import {
  cleanScheduleSettings, slotState, findFree, priorityLocked, releaseStamp, slotWindow, checkSlot, fmtSlot,
  DEFAULT_SCHEDULE, isShortNotice, offsiteHoursOk, type ScheduleDay,
} from '../../functions/src/schedule'

const S = DEFAULT_SCHEDULE
const THU = '2026-10-22', SAT = '2026-10-24', FRI = '2026-10-23'

describe('settings', () => {
  it('fills in the owner defaults: 9 two-hour slots from 7 AM to 1 AM', () => {
    const s = cleanScheduleSettings(undefined)
    expect(s.slots).toEqual([420, 540, 660, 780, 900, 1020, 1140, 1260, 1380])
    expect(fmtSlot(1380, 120)).toBe('11 PM–1 AM')
    expect(s.monthlySlots).toBe(4)
    expect(s.releaseMinute).toBe(1080)
  })
  it('drops nonsense and keeps good values', () => {
    const s = cleanScheduleSettings({ slots: [600, 'x', 99, 480, 600], monthlySlots: 99, priority: [{ email: 'JANA@x.com', name: 'Jana' }, { email: 'nope' }] })
    expect(s.slots).toEqual([480, 600])
    expect(s.monthlySlots).toBe(4)
    expect(s.priority).toEqual([{ email: 'jana@x.com', name: 'Jana' }])
  })
})

describe('slots', () => {
  it('the last slot runs past midnight', () => {
    expect(slotWindow(FRI, 1380, 120)).toEqual({ from: `${FRI}T23:00`, to: '2026-10-24T01:00' })
  })
  it('free, booked, blocked and past', () => {
    const day: ScheduleDay = { date: FRI, cliff1: { 660: { shootId: 's1', name: 'Jana', kind: 'monthly' } }, blocks: [{ id: 'b', house: 'cliff1', start: 420, end: 540, type: 'cleaners' }] }
    const now = `${FRI}T08:00`
    expect(slotState(day, FRI, 'cliff1', 420, S, 'a@x.com', now, false).t).toBe('block')
    expect(slotState(day, FRI, 'cliff1', 660, S, 'a@x.com', now, false).t).toBe('booked')
    expect(slotState(day, FRI, 'cliff1', 780, S, 'a@x.com', now, false).t).toBe('free')
    expect(slotState(day, FRI, 'cliff2', 420, S, 'a@x.com', now, false).t).toBe('past')   // 7 AM has started
  })
})

describe('priority days', () => {
  const s = { ...S, priority: [{ email: 'jana@x.com', name: 'Jana' }] }
  it('Thursdays and Saturdays at Cliff 1 open to everyone on the Sunday before at 6 PM', () => {
    expect(releaseStamp(THU, s)).toBe('2026-10-18T18:00')
    expect(releaseStamp(SAT, s)).toBe('2026-10-18T18:00')
    expect(priorityLocked(THU, 'cliff1', s, 'maya@x.com', '2026-10-18T17:59')).toBe(true)
    expect(priorityLocked(THU, 'cliff1', s, 'maya@x.com', '2026-10-18T18:00')).toBe(false)
  })
  it('the priority group, Cliff 2 and other days are never locked', () => {
    expect(priorityLocked(THU, 'cliff1', s, 'JANA@x.com', '2026-10-17T10:00')).toBe(false)
    expect(priorityLocked(THU, 'cliff2', s, 'maya@x.com', '2026-10-17T10:00')).toBe(false)
    expect(priorityLocked(FRI, 'cliff1', s, 'maya@x.com', '2026-10-17T10:00')).toBe(false)
  })
  it('the schedule team sees locked slots as free', () => {
    expect(slotState(undefined, THU, 'cliff1', 780, s, 'maya@x.com', '2026-10-17T10:00', false).t).toBe('locked')
    expect(slotState(undefined, THU, 'cliff1', 780, s, 'maanik@x.com', '2026-10-17T10:00', true).t).toBe('free')
  })
})

describe('find a time', () => {
  it('finds back-to-back free slots for two people filming together', () => {
    const days: Record<string, ScheduleDay> = { [FRI]: { date: FRI, cliff1: { 420: { shootId: 'a', name: 'A', kind: 'extra' }, 660: { shootId: 'b', name: 'B', kind: 'extra' } } } }
    const r = findFree(days, FRI, 1, 2, ['cliff1'], S, 'x@x.com', '2026-10-20T10:00', false, 3)
    expect(r).toEqual([{ date: FRI, house: 'cliff1', start: 780 }, { date: FRI, house: 'cliff1', start: 1020 }, { date: FRI, house: 'cliff1', start: 1260 }])
  })
})

describe('checkSlot', () => {
  it('refuses odd times, the past and far-future days', () => {
    expect(checkSlot('cliff1', FRI, 600, S, '2026-10-17', '2026-10-17T10:00')).toBe('bad-slot')
    expect(checkSlot('cliff1', '2026-10-17', 540, S, '2026-10-17', '2026-10-17T10:00')).toBe('in-past')
    expect(checkSlot('cliff1', '2027-06-01', 540, S, '2026-10-17', '2026-10-17T10:00')).toBe('too-far')
    expect(checkSlot('garage', FRI, 540, S, '2026-10-17', '2026-10-17T10:00')).toBe('bad-slot')
    expect(checkSlot('offsite', FRI, 540, S, '2026-10-17', '2026-10-17T10:00')).toBe(null)
  })
})

describe('notice and offsite hours', () => {
  it('48 hours before the start is the line', () => {
    expect(isShortNotice('2026-10-20T13:00', '2026-10-18T13:01', S)).toBe(true)
    expect(isShortNotice('2026-10-20T13:00', '2026-10-18T12:59', S)).toBe(false)
  })
  it('offsite: any half hours, ending after the start, at most 18 hours', () => {
    expect(offsiteHoursOk(630, 900)).toBe(true)
    expect(offsiteHoursOk(630, 630)).toBe(false)
    expect(offsiteHoursOk(630, 915)).toBe(false)
    expect(offsiteHoursOk(600, 600 + 19 * 60)).toBe(false)
  })
})
