import { describe, it, expect } from 'vitest'
import { analyze } from '../../src/lib/analytics'
import { flagState, warnText, stillOut } from '../../src/lib/flagState'

const closed = { closedWeekdays: [0], closedDates: [] }
const shoot = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, creatorEmail: 'ana@x', creatorName: 'Ana', date, from: `${date}T13:00`, to: `${date}T15:00`, place: 'cliff1', status: 'booked', ...extra })
const base = { now: '2026-10-20T12:00', closed, props: [], gear: [], reports: [], invites: [] }

describe('flags you can act on', () => {
  const a = analyze({ ...base,
    shoots: [shoot('s1', '2026-10-05', { noShow: 'missed', outcome: 'noshow' }), shoot('s2', '2026-10-06'), shoot('s3', '2026-10-07', { checkin: { at: '2026-10-07T17:40:00.000Z' } })],
    strikes: [{ id: 'k1', email: 'ana@x', reason: 'no-show', shootId: 's1', at: '2026-10-05T20:00:00.000Z' }] })
  const by = (id: string) => a.incidents.find(i => i.id === id)!
  it('every flag has a stable id and knows the strike that came with it', () => {
    expect(a.incidents.map(i => i.id).sort()).toEqual(['missed-checkin:s2', 'no-show:s1', 'no-wrap:s3', 'late-start:s3'].sort())   // the no-show's strike rides on that flag
    expect(by('no-show:s1')).toMatchObject({ strikeId: 'k1', shootId: 's1', src: { type: 'shoot', id: 's1' } })
  })
  it('says where each stands', () => {
    expect(flagState(by('missed-checkin:s2'), undefined)).toBe('decide')
    expect(flagState(by('no-show:s1'), undefined)).toBe('handled')     // a strike came with it
    expect(flagState(by('no-wrap:s3'), undefined)).toBe('todo')
    expect(flagState(by('no-wrap:s3'), { status: 'warned' })).toBe('handled')
    expect(flagState(by('no-wrap:s3'), { status: 'open' })).toBe('todo')  // counted again after an excuse
    expect(warnText(by('no-wrap:s3'))).toMatch(/didn't wrap/)
    expect(stillOut(by('no-wrap:s3'))).toBe(false)
  })
  it('excused flags stop counting but are kept for the list', () => {
    const b = analyze({ ...base, shoots: [shoot('s3', '2026-10-07', { checkin: { at: '2026-10-07T17:40:00.000Z' } })], strikes: [], excused: new Set(['late-start:s3']) })
    expect(b.incidents.map(i => i.id)).toEqual(['no-wrap:s3'])
    expect(b.excused.map(i => i.id)).toEqual(['late-start:s3'])
  })
})

describe('which shoots count (audit, Nov 5)', () => {
  const a = analyze({ ...base, strikes: [{ id: 'm1', email: 'ana@x', reason: 'manual', at: '2026-10-10T20:00:00.000Z', note: 'rude' }],
    checksIn: e => e !== 'dee@x',
    shoots: [
      shoot('w', '2026-10-05', { status: 'requested' }), shoot('d', '2026-10-05', { status: 'denied' }), shoot('e', '2026-10-05', { status: 'expired' }),
      shoot('t', '2026-10-06', { toCheck: true }), shoot('off', '2026-10-07', { place: 'offsite' }),
      shoot('demo', '2026-10-08', { creatorEmail: 'dee@x', creatorName: 'Dee' }), shoot('demoNo', '2026-10-09', { creatorEmail: 'dee@x', creatorName: 'Dee', noShow: 'missed' }),
      shoot('fut', '2026-10-30', { status: 'requested' }), shoot('fut2', '2026-10-30', { approvedAt: '2026-10-19T10:00:00.000Z' }),
    ] })
  it('only approved shoots are counted; requests are listed on their own', () => {
    expect(a.facts.map(f => f.id).sort()).toEqual(['demo', 'demoNo', 'off'])
    expect(a.upcoming.map(u => u.id)).toEqual(['fut2'])
    expect(a.requests.map(r => `${r.id}:${r.status}`).sort()).toEqual(['d:denied', 'e:expired', 'fut2:approved', 'fut:waiting', 'w:waiting'])
  })
  it('offsite and people who cannot check in yet count as filmed unless the team says no-show', () => {
    expect(a.facts.find(f => f.id === 'off')!.filmed).toBe(true)
    expect(a.facts.find(f => f.id === 'demo')!.filmed).toBe(true)
    expect(a.facts.find(f => f.id === 'demoNo')!.filmed).toBe(false)
    expect(a.incidents.filter(i => i.kind === 'missed-checkin')).toHaveLength(0)
    expect(a.incidents.map(i => i.id)).toContain('no-show:demoNo')
  })
  it('a stand-alone strike is still a flag', () => {
    expect(a.incidents.map(i => i.id)).toContain('strike:m1')
  })
})
