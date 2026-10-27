// Late return fee log (owner, Oct 27).
import { describe, it, expect } from 'vitest'
import { analyze } from '../../src/lib/analytics'
import { lateRows, latePeople, lateTotals, lateCsv, lateFor, stampLabel, valueLabel } from '../../src/lib/lateReturns'
import { offerValue, linesValue } from '../../functions/src/gearStock'

const closed = { closedWeekdays: [0], closedDates: [] }
const base = { closed, shoots: [], reports: [], strikes: [], invites: [] }

describe('late returns', () => {
  const a = analyze({ ...base, now: '2026-11-10T12:00',
    props: [{ id: 'r1', creatorEmail: 'kyle@x', creatorName: 'Kyle', title: 'Diner', status: 'returned', startDate: '2026-11-04', endDate: '2026-11-04',
      history: [{ status: 'return_pending', at: '2026-11-05T17:30:00.000Z', by: 'kyle@x' }] }],   // Thu 10 AM due → back 12:30 PM
    gear: [
      // Ana booked it, Ben (crew) returned it 2 h 10 min after the end.
      { id: 'g1', creatorEmail: 'ana@x', creatorName: 'Ana', title: 'Cam', status: 'checked_in', date: '2026-11-02', to: '2026-11-02T15:00', returnedLate: true,
        crewEmails: ['ben@x'], late: { minutes: 130, dueAt: '2026-11-02T15:00', backAt: '2026-11-02T17:10', by: 'ben@x', byName: 'Ben', value: 4660, valueMissing: 0 } },
      // Still out, signed for by Ana: 2 days late.
      { id: 'g2', creatorEmail: 'ana@x', creatorName: 'Ana', title: 'Drone', status: 'out', date: '2026-11-08', to: '2026-11-08T12:00', pickup: { by: 'ana@x' }, value: 1400, valueMissing: 0 },
      // An older late return with no record: on whoever signed, value unknown.
      { id: 'g3', creatorEmail: 'kyle@x', creatorName: 'Kyle', title: 'Old', status: 'checked_in', date: '2026-11-01', to: '2026-11-01T15:00', returnedLate: true, returnedAt: '2026-11-01T16:00' },
      // On time.
      { id: 'g4', creatorEmail: 'kyle@x', title: 'Fine', status: 'checked_in', date: '2026-11-03', to: '2026-11-03T15:00', returnedLate: false },
    ] })
  const rows = lateRows(a.incidents)

  it('logs every late return with how late, the value and the last person to have it', () => {
    const g1 = rows.find(r => r.i.src.id === 'g1')!
    expect(g1.i.email).toBe('ben@x')
    expect(g1.i.name).toBe('Ben')
    expect(g1.late).toMatchObject({ minutes: 130, value: 4660, fee: true, still: false, backAt: '2026-11-02T17:10' })
    const g2 = rows.find(r => r.i.src.id === 'g2')!
    expect(g2.late).toMatchObject({ still: true, value: 1400, fee: true, minutes: 2 * 24 * 60 })
    expect(rows.find(r => r.i.src.id === 'g3')!.late).toMatchObject({ value: null, minutes: 60 })
    const props = rows.find(r => r.kind === 'props')!
    expect(props.late).toMatchObject({ fee: false, dueAt: '2026-11-05T10:00', minutes: 150 })
    expect(rows.some(r => r.i.src.id === 'g4')).toBe(false)
  })
  it('counts per creator and in total', () => {
    expect(lateTotals(rows)).toEqual({ count: 4, gear: 3, props: 1, stillOut: 1, gearValue: 6060, people: 3 })
    const ppl = latePeople(rows)
    expect(ppl[0]).toMatchObject({ email: 'kyle@x', count: 2, gear: 1, props: 1 })
    expect(ppl.find(p => p.email === 'ben@x')).toMatchObject({ count: 1, gearValue: 4660, minutes: 130 })
  })
  it('excused late returns drop out of the log', () => {
    const b = analyze({ ...base, now: '2026-11-10T12:00', props: [], excused: new Set(['late-gear:g1:ben-x']),
      gear: [{ id: 'g1', creatorEmail: 'ana@x', title: 'Cam', status: 'checked_in', date: '2026-11-02', to: '2026-11-02T15:00', returnedLate: true,
        late: { minutes: 130, dueAt: '2026-11-02T15:00', backAt: '2026-11-02T17:10', by: 'ben@x', value: 4660, valueMissing: 0 } }] })
    expect(lateRows(b.incidents)).toHaveLength(0)
    expect(lateRows(b.excused)).toHaveLength(1)
  })
  it('a spreadsheet with one line per late return', () => {
    const csv = lateCsv(rows, () => 'Not looked at').split('\n')
    expect(csv).toHaveLength(5)
    expect(csv[0]).toContain('Minutes late')
    expect(csv.find(l => l.includes('ben@x'))).toContain('4660')
  })
  it('formats', () => {
    expect(lateFor(45)).toBe('45 min')
    expect(lateFor(130)).toBe('2 h 10 min')
    expect(lateFor(3 * 1440 + 240)).toBe('3 days 4 h')
    expect(stampLabel('2026-11-02T17:10')).toBe('Nov 2, 5:10 PM')
    expect(stampLabel('2026-11-02T09:00')).toBe('Nov 2, 9 AM')
    expect(valueLabel({ minutes: 1, dueAt: '', still: false, fee: true, value: null, valueMissing: 0 })).toBe('Value not recorded')
  })
  it('values a kit, an extra and a booking', () => {
    expect(offerValue({ kind: 'bundle', pieces: [{ qty: 1, value: 4500 }, { qty: 2, value: 80 }] })).toEqual({ value: 4660, missing: 0 })
    expect(offerValue({ kind: 'extra', pieces: [{ qty: 6, value: 120 }] })).toEqual({ value: 120, missing: 0 })
    expect(offerValue({ kind: 'bundle', pieces: [{ qty: 1, value: 4500 }, { qty: 2 }] })).toEqual({ value: 4500, missing: 1 })
    expect(linesValue([{ pieces: [{ qty: 1, value: 4500 }] }, { pieces: [{ qty: 3, value: 120 }] }])).toEqual({ value: 4860, missing: 0 })
  })
})
