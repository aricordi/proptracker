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
    expect(a.incidents.map(i => i.id).sort()).toEqual(['missed-checkin:s2', 'no-show:s1', 'no-wrap:s3', 'late-start:s3', 'strike:k1'].sort())
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
