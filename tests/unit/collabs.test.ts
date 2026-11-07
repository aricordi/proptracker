import { describe, it, expect } from 'vitest'
import { collabPairs, partnersOf, usual, neighboursOf, collabShootsFromDays, usualPartners, partnerLabel, type CollabShoot, type CollabDay } from '../../src/lib/collabs'

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

describe('usual partner from the schedule day docs', () => {
  const slot = (email: string, name: string, shootId: string, extra = {}) => ({ shootId, email, name, kind: 'extra', ...extra })
  const day = (date: string, c1: Record<string, unknown>, c2: Record<string, unknown> = {}) => ({ date, cliff1: c1, cliff2: c2 }) as CollabDay

  it('turns slots into shoots: back to back pairs up, holds skipped, a multi-slot shoot counts once', () => {
    const shoots = collabShootsFromDays([
      day('2026-10-01', { '780': slot('ana@x.com', 'Ana', 'a1'), '900': slot('kyle@x.com', 'Kyle', 'k1', { pending: true }),
        '1020': { shootId: '', email: 'jo@x.com', name: 'Jo', hold: { until: 'x' } } }),
      day('2026-10-02', { '540': slot('ana@x.com', 'Ana', 'a2', { time: { start: 540, end: 750 } }), '660': slot('ana@x.com', 'Ana', 'a2', { time: { start: 540, end: 750 } }) }),
    ], 120)
    expect(shoots.map(s => s.id)).toEqual(['a1', 'k1', 'a2'])
    expect(shoots.find(s => s.id === 'k1')!.status).toBe('requested')
    expect(collabPairs(shoots).map(p => [p.a, p.b])).toEqual([['ana@x.com', 'kyle@x.com']])
  })

  it('usual = twice or more, only people still on the friend list, never yourself', () => {
    const days = ['2026-10-01', '2026-10-05', '2026-10-09'].map((d, i) => day(d, {
      '780': slot('ana@x.com', 'Ana', `a${i}`), '900': slot('kyle@x.com', 'Kyle', `k${i}`),
      ...(i < 2 ? { '1020': slot('gone@x.com', 'Gone', `g${i}`) } : {}),
    }))
    const shoots = collabShootsFromDays(days, 120)
    const allowed = [{ email: 'kyle@x.com', name: 'Kyle Smith' }, { email: 'ana@x.com', name: 'Ana' }]
    expect(usualPartners('ana@x.com', shoots, allowed)).toEqual([{ email: 'kyle@x.com', name: 'Kyle Smith', times: 3 }])
    expect(usualPartners('ANA@x.com', shoots, [])).toEqual([])
  })

  it('chip label = first name unless someone shares it', () => {
    const list = [{ email: 'j1@x.com', name: 'Justin Figs' }, { email: 'j2@x.com', name: 'Justin Lee' }, { email: 'k@x.com', name: 'Kyle Smith' }]
    expect(partnerLabel(list[2], list)).toBe('Kyle')
    expect(partnerLabel(list[0], list)).toBe('Justin Figs')
  })
})
