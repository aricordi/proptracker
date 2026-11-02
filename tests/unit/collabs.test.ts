import { describe, it, expect } from 'vitest'
import { collabPairs, partnersOf, usual, neighboursOf, type CollabShoot } from '../../src/lib/collabs'

let n = 0
const sh = (who: string, date: string, from: string, to: string, extra: Partial<CollabShoot> = {}): CollabShoot =>
  ({ id: `s${++n}`, creatorEmail: `${who}@x.com`, creatorName: who[0].toUpperCase() + who.slice(1), place: 'cliff1', date,
    from: `${date}T${from}`, to: `${date}T${to}`, status: 'booked', ...extra })

describe('who films with whom', () => {
  it('back to back at the same house counts; a gap or the other house does not', () => {
    const pairs = collabPairs([
      sh('ana', '2026-11-01', '13:00', '15:00'), sh('ben', '2026-11-01', '15:00', '17:00'),
      sh('cy', '2026-11-01', '19:00', '21:00'),                                         // gap after Ben
      sh('dee', '2026-11-01', '17:00', '19:00', { place: 'cliff2' }),                   // other house
    ])
    expect(pairs.map(p => [p.a, p.b])).toEqual([['ana@x.com', 'ben@x.com']])
  })

  it('a chain of three makes three pairs; repeats on other days add up, once per day', () => {
    const shoots = [
      sh('ana', '2026-11-01', '13:00', '15:00'), sh('ben', '2026-11-01', '15:00', '17:00'), sh('cy', '2026-11-01', '17:00', '19:00'),
      sh('ana', '2026-11-08', '09:00', '11:00'), sh('ben', '2026-11-08', '11:00', '13:00'),
    ]
    const ps = partnersOf('ana@x.com', shoots)
    expect(ps).toEqual([
      { email: 'ben@x.com', name: 'Ben', times: 2, last: '2026-11-08', invited: 0 },
      { email: 'cy@x.com', name: 'Cy', times: 1, last: '2026-11-01', invited: 0 },
    ])
    expect(usual(ps).map(p => p.name)).toEqual(['Ben'])
  })

  it('cancelled shoots do not count; requests and invites do', () => {
    const shoots = [
      sh('ana', '2026-11-01', '13:00', '15:00'), sh('ben', '2026-11-01', '15:00', '17:00', { status: 'cancelled' }),
      sh('ana', '2026-11-02', '13:00', '15:00', { status: 'requested' }), sh('cy', '2026-11-02', '15:00', '17:00', { status: 'requested' }),
      sh('dee', '2026-11-03', '09:00', '11:00', { place: 'cliff2', invitedBy: 'Ana@x.com' }),
    ]
    const ps = partnersOf('ana@x.com', shoots)
    expect(ps.map(p => p.name).sort()).toEqual(['Cy', 'Dee'])
    expect(ps.find(p => p.name === 'Dee')!.invited).toBe(1)
  })

  it('neighbours = whoever is right before or after at the same house', () => {
    const a = sh('ana', '2026-11-01', '13:00', '15:00'), b = sh('ben', '2026-11-01', '15:00', '17:00'), c = sh('cy', '2026-11-01', '11:00', '13:00', { place: 'cliff2' })
    expect(neighboursOf(a, [a, b, c]).map(x => x.creatorName)).toEqual(['Ben'])
  })
})
