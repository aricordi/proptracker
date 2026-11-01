import { describe, it, expect } from 'vitest'
import { runDraw, daysOfMonth, wishWindow, drawMonthFor, type DrawPerson } from '../../functions/src/monthlyDraw'
import { weekday } from '../../functions/src/booking'

const MONTH = '2026-12'
const SLOTS = [420, 540, 660, 780, 900, 1020, 1140, 1260, 1380]
const allFree = () => daysOfMonth(MONTH).flatMap(date => SLOTS.map(start => ({ date, start })))
const person = (email: string, extra: Partial<DrawPerson> = {}): DrawPerson =>
  ({ email, name: email.split('@')[0], priority: false, wishes: [], usual: { weekdays: [], starts: [] }, busyDays: [], ...extra })
const base = { month: MONTH, perPerson: 4, slotMinutes: 120, priorityWeekdays: [4, 6] }
const gapsOk = (dates: string[]) => {
  const n = [...dates].sort().map(d => Number(d.slice(8, 10)))
  return n.every((d, i) => i === 0 || d - n[i - 1] >= 2)
}

describe('monthly draw', () => {
  it('wish window and month', () => {
    expect(drawMonthFor('2026-11-20')).toBe('2026-12')
    expect(drawMonthFor('2026-12-20')).toBe('2027-01')
    expect(wishWindow('2026-12')).toEqual({ opens: '2026-11-15T00:00', closes: '2026-11-20T18:00' })
  })

  it('everyone gets 4, spread out (never the same or next day), nobody on priority days unless in the group', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => person(`${x}@x`))
    const r = runDraw({ ...base, people, free: allFree() })
    expect(r.short).toEqual([])
    for (const p of people) {
      const mine = r.placements.filter(x => x.email === p.email)
      expect(mine).toHaveLength(4)
      expect(gapsOk(mine.map(m => m.date))).toBe(true)
      expect(mine.every(m => ![4, 6].includes(weekday(m.date)))).toBe(true)
      // the app's own picks aim for one per week
      expect(new Set(mine.map(m => Math.floor((Number(m.date.slice(8)) - 1) / 7))).size).toBeGreaterThanOrEqual(3)
    }
    const keys = r.placements.map(x => `${x.date}|${x.start}`)
    expect(new Set(keys).size).toBe(keys.length)   // no slot given twice
  })

  it('a wished slot goes to whoever comes first; the other gets their next wish; wishes next to each other are skipped', () => {
    const want = { date: '2026-12-02', start: 780 }
    const a = person('a@x', { wishes: [want, { date: '2026-12-03', start: 780 }, { date: '2026-12-09', start: 780 }] })
    const b = person('b@x', { wishes: [want, { date: '2026-12-10', start: 780 }] })
    const r = runDraw({ ...base, people: [a, b], free: allFree() })
    const got = (e: string) => r.placements.filter(x => x.email === e)
    const winner = got('a@x').some(x => x.date === want.date) ? 'a@x' : 'b@x'
    expect(got(winner === 'a@x' ? 'b@x' : 'a@x').some(x => x.date === want.date)).toBe(false)
    expect(got('a@x').some(x => x.date === '2026-12-03')).toBe(false)   // the day right after another of a's slots
    expect(got('b@x').filter(x => x.how === 'wish').length).toBeGreaterThanOrEqual(1)
  })

  it('pairs partners back to back only when both asked for it', () => {
    const a = person('a@x', { wishes: [{ date: '2026-12-08', start: 780, partner: 'b@x' }] })
    const b = person('b@x', { wishes: [{ date: '2026-12-08', start: 900, partner: 'a@x' }] })
    const r = runDraw({ ...base, people: [a, b], free: allFree() })
    expect(r.placements.find(x => x.email === 'a@x' && x.date === '2026-12-08')?.start).toBe(780)
    expect(r.placements.find(x => x.email === 'b@x' && x.date === '2026-12-08')?.start).toBe(900)
    // Only one side asked: no pairing, the other is placed elsewhere.
    const c = person('c@x', { wishes: [{ date: '2026-12-08', start: 780, partner: 'd@x' }] })
    const d = person('d@x')
    const r2 = runDraw({ ...base, people: [c, d], free: allFree() })
    expect(r2.placements.some(x => x.email === 'd@x' && x.date === '2026-12-08')).toBe(false)
  })

  it('priority group may get priority days; busy days and taken slots are respected; short when the house is full', () => {
    const thu = daysOfMonth(MONTH).find(d => weekday(d) === 4)!
    const p = person('p@x', { priority: true, wishes: [{ date: thu, start: 780 }] })
    const q = person('q@x', { wishes: [{ date: thu, start: 900 }], busyDays: ['2026-12-01'] })
    const r = runDraw({ ...base, people: [p, q], free: allFree() })
    expect(r.placements.some(x => x.email === 'p@x' && x.date === thu)).toBe(true)
    expect(r.placements.some(x => x.email === 'q@x' && (x.date === thu || x.date === '2026-12-01'))).toBe(false)
    const tiny = runDraw({ ...base, people: [person('z@x')], free: [{ date: '2026-12-01', start: 780 }, { date: '2026-12-02', start: 780 }] })
    expect(tiny.short).toEqual([{ email: 'z@x', name: 'z', missing: 3 }])
  })

  it('the same wishes give the same draw', () => {
    const people = ['a', 'b', 'c'].map(x => person(`${x}@x`))
    expect(runDraw({ ...base, people, free: allFree() })).toEqual(runDraw({ ...base, people, free: allFree() }))
  })
})
