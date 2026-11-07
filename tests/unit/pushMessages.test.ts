// Phone notifications: who gets told what, and when the reminders go out.
import { describe, it, expect } from 'vitest'
import { inviteChange, swapChange, reservationChange, gearChange, shootChange, strikeCreated, reportCreated, shootReminders, propsReminders, gearReminders, dayLabel } from '../../functions/src/pushMessages'
import { cleanScheduleSettings } from '../../functions/src/schedule'

const s = cleanScheduleSettings({})
const closed = { closedWeekdays: [0], closedDates: [] as string[] }
const invite = { fromEmail: 'alex@x.com', fromName: 'Alex R', toEmail: 'ariel@x.com', toName: 'Ariel', place: 'cliff2', date: '2026-10-23', start: 900, end: 1020, until: '2026-10-21T13:20', status: 'pending' }

describe('instant notifications', () => {
  it('invites: the friend is asked; the inviter hears back', () => {
    const [p] = inviteChange('i1', null, invite, s)
    expect(p).toMatchObject({ to: ['ariel@x.com'], title: 'Alex invited you to film 🎬', url: '/' })
    expect(p.body).toMatch(/Cliff 2 · Fri Oct 23 · 3 PM.*Confirm by 1:20 PM/)
    expect(inviteChange('i1', invite, { ...invite, status: 'accepted' }, s)[0]).toMatchObject({ to: ['alex@x.com'], title: 'Ariel confirmed ✓' })
    expect(inviteChange('i1', invite, { ...invite, status: 'declined' }, s)[0].title).toBe("Ariel can't make it")
    expect(inviteChange('i1', invite, { ...invite }, s)).toEqual([])
  })
  it('swaps', () => {
    const sw = { fromEmail: 'a@x.com', fromName: 'Ana', toEmail: 'b@x.com', toName: 'Ben', status: 'pending', from: { place: 'cliff1', date: '2026-10-23', start: 780 }, to: { place: 'cliff2', date: '2026-10-24', start: 900 } }
    expect(swapChange('s1', null, sw, s)[0]).toMatchObject({ to: ['b@x.com'], title: 'Ana wants to swap slots' })
    expect(swapChange('s1', sw, { ...sw, status: 'accepted' }, s)[0]).toMatchObject({ to: ['a@x.com'], title: 'Swap done ✓' })
  })
  it('props: new → arts team; packed / declined → creator; returned → arts team', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'requested', history: [{ by: 'c@x.com' }] }
    expect(reservationChange('r1', null, r)[0]).toMatchObject({ to: ['arts-team'], title: 'New props request', url: '/reservations/r1' })
    expect(reservationChange('r1', r, { ...r, status: 'packed' })[0]).toMatchObject({ to: ['c@x.com'], title: 'Your props are ready 📦' })
    expect(reservationChange('r1', r, { ...r, status: 'declined', statusReason: 'Broken' })[0].body).toMatch(/Broken/)
    expect(reservationChange('r1', r, { ...r, status: 'cancelled', history: [{ by: 'c@x.com' }] })).toEqual([])   // they cancelled it themselves
    expect(reservationChange('r1', r, { ...r, status: 'cancelled', history: [{ by: 'arts@x.com' }] })[0].to).toEqual(['c@x.com'])
    expect(reservationChange('r1', r, { ...r, status: 'return_pending' })[0].to).toEqual(['arts-team'])
    expect(reservationChange('r1', r, { ...r, notes: 'x' })).toEqual([])
  })
  it('props: creator hears straight away when a prop or build is not available', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'preparing', history: [{ by: 'arts@x.com' }],
      lines: [{ itemId: 'cop', itemName: 'Cop costume' }, { itemId: 'chair', itemName: 'Chair' }], builds: [{ id: 'b1', description: 'Fake cake', state: 'todo' }] }
    const one = reservationChange('r1', r, { ...r, lines: [{ itemId: 'cop', itemName: 'Cop costume', pick: { state: 'unavailable', reason: 'Torn' } }, r.lines[1]] })
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ to: ['c@x.com'], title: '"Cop costume" isn\'t available' })
    expect(one[0].body).toMatch(/Torn/)
    const both = reservationChange('r1', { ...r, status: 'requested' }, { ...r, builds: [{ id: 'b1', description: 'Fake cake', state: 'unavailable', reason: 'No time' }],
      lines: [{ itemId: 'cop', itemName: 'Cop costume', pick: { state: 'unavailable', reason: 'Torn' } }, r.lines[1]] })
    expect(both[0].title).toBe('2 things aren\'t available')
    // Already marked before: no second ping.
    const marked = { ...r, lines: [{ itemId: 'cop', itemName: 'Cop costume', pick: { state: 'unavailable', reason: 'Torn' } }, r.lines[1]] }
    expect(reservationChange('r1', marked, { ...marked, notes: 'x' })).toEqual([])
  })
  it('props: arts hear when a creator cancels a request they started on', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', history: [{ by: 'c@x.com' }] }
    const packed = reservationChange('r1', { ...r, status: 'packed' }, { ...r, status: 'cancelled' })
    expect(packed[0]).toMatchObject({ to: ['arts-team'], title: 'Props request cancelled' })
    expect(packed[0].body).toMatch(/Put the props back/)
    expect(reservationChange('r1', { ...r, status: 'preparing' }, { ...r, status: 'cancelled' })[0].to).toEqual(['arts-team'])
    expect(reservationChange('r1', { ...r, status: 'requested' }, { ...r, status: 'cancelled' })).toEqual([])
  })
  it('gear: new → gear team; declined → creator', () => {
    const g = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', date: '2026-10-23', start: 780, status: 'held' }
    expect(gearChange('g1', null, g)[0]).toMatchObject({ to: ['gear-team'], title: 'New gear hold' })
    expect(gearChange('g1', g, { ...g, status: 'declined', declineReason: 'In repair' })[0]).toMatchObject({ to: ['c@x.com'], body: '"Diner": In repair' })
  })
  it('the schedule team booked, moved or cancelled your shoot', () => {
    const sh = { creatorEmail: 'c@x.com', place: 'cliff1', date: '2026-10-23', start: 780, history: [{ by: 'maanik@x.com', action: 'booked' }] }
    expect(shootChange('h1', null, sh, s)[0].title).toBe('You have a new shoot 🎬')
    expect(shootChange('h1', null, { ...sh, history: [{ by: 'c@x.com', action: 'booked' }] }, s)).toEqual([])   // booked it yourself
    const moved = { ...sh, start: 900, history: [...sh.history, { by: 'maanik@x.com', action: 'moved' }] }
    expect(shootChange('h1', sh, moved, s)[0]).toMatchObject({ title: 'Your shoot moved', body: 'Now Cliff 1 · Fri Oct 23 · 3 PM.' })
  })
  it('strikes and reports', () => {
    expect(strikeCreated('k', { email: 'c@x.com', reason: 'no-show' }, s)[0].body).toMatch(/missed shoot.*2 strikes in 30 days/)
    expect(reportCreated('r', { byName: 'Ana B', onName: 'Ben C', overMinutes: 20, date: '2026-10-23' })[0]).toMatchObject({ to: ['gear-team'], body: 'Ana says Ben ran over 20 min (Fri Oct 23).' })
    expect(reportCreated('r', { byName: 'Ana B', onName: 'Ben C', mess: true, note: 'Dishes in the sink', date: '2026-10-23' })[0].body).toBe('Ana says Ben left a mess (Fri Oct 23). "Dishes in the sink"')
  })
  it('dates read like "Fri Oct 23"', () => expect(dayLabel('2026-10-23')).toBe('Fri Oct 23'))
})

describe('timed reminders', () => {
  const shoot = { status: 'booked', creatorEmail: 'c@x.com', place: 'cliff2', date: '2026-10-23', start: 780, end: 900, from: '2026-10-23T13:00', to: '2026-10-23T15:00' }
  const keys = (now: string, extra = {}, needs = true) => shootReminders('h1', { ...shoot, ...extra }, now, s, needs, closed, 2).map(r => r.key)
  it('an hour before, then when check-in opens, then a missed check-in', () => {
    expect(keys('2026-10-23T11:55')).toEqual([])
    expect(keys('2026-10-23T12:05')).toEqual(['hour_h1'])
    expect(keys('2026-10-23T12:50')).toEqual(['checkin_h1'])
    expect(keys('2026-10-23T12:50', { checkin: { at: 'x' } })).toEqual([])
    expect(keys('2026-10-23T15:10')).toEqual(['missed_h1'])
    expect(keys('2026-10-24T04:00')).toEqual([])   // the 12 hours to explain are over
  })
  it('offsite shoots get the hour reminder only', () => {
    expect(keys('2026-10-23T12:05', { place: 'offsite', where: 'The park' })).toEqual(['hour_h1'])
    expect(keys('2026-10-23T12:50', { place: 'offsite' })).toEqual([])
  })
  it('last day to add props + gear: from 9 AM, only if nothing is added', () => {
    // Fri Oct 23 shoot, 2 open days' notice → last day Wed Oct 21.
    expect(keys('2026-10-21T08:50', {}, false)).toEqual([])
    expect(keys('2026-10-21T09:00', {}, false)).toEqual(['cutoff_h1'])
    expect(keys('2026-10-21T09:00', {}, true)).toEqual([])
  })
  it('a request still waiting for approval gets the props cutoff reminder only', () => {
    expect(keys('2026-10-21T09:00', { status: 'requested' }, false)).toEqual(['cutoff_h1'])
    expect(keys('2026-10-23T12:50', { status: 'requested' })).toEqual([])
    expect(keys('2026-10-23T12:05', { status: 'requested' })).toEqual([])
    expect(keys('2026-10-21T09:00', { status: 'cancelled' }, false)).toEqual([])
  })
  it('props due back by 10 AM the next open day, then late', () => {
    const r = { status: 'collected', creatorEmail: 'c@x.com', title: 'Diner', endDate: '2026-10-24' }   // Saturday; Sunday closed
    expect(propsReminders('r1', r, '2026-10-26T07:30', closed)).toEqual([])
    expect(propsReminders('r1', r, '2026-10-26T08:00', closed)[0].key).toBe('propsdue_r1')
    expect(propsReminders('r1', r, '2026-10-26T10:00', closed)[0].key).toBe('propslate_r1')
  })
  it('gear due 30 min before the end, then late', () => {
    const g = { status: 'out', creatorEmail: 'c@x.com', title: 'FX3', to: '2026-10-23T18:00' }
    expect(gearReminders('g1', g, '2026-10-23T17:20')).toEqual([])
    expect(gearReminders('g1', g, '2026-10-23T17:35')[0].push.title).toBe('Gear due back at 6 PM')
    expect(gearReminders('g1', g, '2026-10-23T18:35')[0].key).toBe('gearlate_g1')
  })
})

describe('more notifications (Nov 3)', () => {
  it('invites that ran out or were taken back tell the right person', () => {
    const ran = inviteChange('i1', invite, { ...invite, status: 'expired' }, s)
    expect(ran.map(p => p.to[0])).toEqual(['alex@x.com', 'ariel@x.com'])
    expect(inviteChange('i1', invite, { ...invite, status: 'withdrawn' }, s)[0]).toMatchObject({ to: ['ariel@x.com'], title: 'Invite withdrawn' })
    // The inviter's shoot was cancelled / not approved (audit, Nov 7): say why.
    expect(inviteChange('i1', invite, { ...invite, status: 'withdrawn', reason: 'shoot-gone' }, s)[0].body).toMatch(/shoot was cancelled/)
  })
  it('swaps that were withdrawn or called off', () => {
    const sw = { fromEmail: 'a@x.com', fromName: 'Ana', toEmail: 'b@x.com', toName: 'Ben', status: 'pending', from: { place: 'cliff1', date: '2026-10-23', start: 780 }, to: { place: 'cliff2', date: '2026-10-24', start: 900 } }
    expect(swapChange('s1', sw, { ...sw, status: 'withdrawn' }, s)[0]).toMatchObject({ to: ['b@x.com'], title: 'Swap withdrawn' })
    expect(swapChange('s1', sw, { ...sw, status: 'expired' }, s)[0].to).toEqual(['a@x.com', 'b@x.com'])
  })
  it('props marked not available / builds that can\'t be made → the creator hears it at once', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'requested', history: [],
      lines: [{ itemId: 'p1', itemName: 'Rotary phone' }, { itemId: 'p2', itemName: 'Chair' }], builds: [{ id: 'b1', description: 'Cop badge', state: 'todo' }] }
    const one = { ...r, status: 'preparing', lines: [{ ...r.lines[0], pick: { state: 'unavailable', reason: 'Broken' } }, r.lines[1]] }
    const out = reservationChange('r1', r, one)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ to: ['c@x.com'], title: '"Rotary phone" isn\'t available', url: '/reservations/r1' })
    expect(out[0].body).toMatch(/Rotary phone: Broken.*rest of "Diner" still goes/)
    // Already marked before: no repeat. A build marked can't be made: new message.
    const build = { ...one, builds: [{ ...r.builds[0], state: 'unavailable', reason: 'No time' }] }
    expect(reservationChange('r1', one, build)[0].body).toMatch(/Cop badge: No time/)
    expect(reservationChange('r1', build, { ...build, notes: 'x' })).toEqual([])
    // Packed later says how many aren't coming.
    expect(reservationChange('r1', build, { ...build, status: 'packed' })[0].body).toMatch(/2 things aren't available/)
  })
  it('props cancelled by the creator after arts started → arts are told; a dropped shoot request doesn\'t say "by the team"', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'packed', history: [] }
    expect(reservationChange('r1', r, { ...r, status: 'cancelled', history: [{ by: 'c@x.com' }] })[0]).toMatchObject({ to: ['arts-team'], title: 'Props request cancelled' })
    expect(reservationChange('r1', { ...r, status: 'requested' }, { ...r, status: 'cancelled', history: [{ by: 'c@x.com' }] })).toEqual([])
    const dropped = reservationChange('r1', r, { ...r, status: 'cancelled', history: [{ by: 'schedule' }] })
    expect(dropped.map(p => p.to)).toEqual([['arts-team']])
    expect(dropped[0].body).toMatch(/shoot was dropped/)
    expect(reservationChange('r1', { ...r, status: 'requested' }, { ...r, status: 'cancelled', history: [{ by: 'schedule' }] })).toEqual([])
  })
  it('props checked in with damage or something missing → said plainly, no "Thanks!"', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'return_pending', history: [],
      lines: [{ itemId: 'p1', itemName: 'Rotary phone', checkIn: { result: 'damaged' } }, { itemId: 'p2', itemName: 'Glass', checkIn: { result: 'missing' } }, { itemId: 'p3', itemName: 'Chair', checkIn: { result: 'ok' } }] }
    const out = reservationChange('r1', r, { ...r, status: 'returned' })[0]
    expect(out.title).toBe('Props checked in · something to look at')
    expect(out.body).toBe('"Diner": Rotary phone damaged, Glass missing. Questions? Ask the arts department.')
  })
  it('strikes given by hand say what about and why', () => {
    expect(strikeCreated('k', { email: 'c@x.com', reason: 'manual', about: 'gear', note: 'Returned the FX3 case 3 hours late' }, s)[0].body)
      .toMatch(/^For a gear problem: "Returned the FX3 case 3 hours late"\. 2 strikes/)
    expect(strikeCreated('k', { email: 'c@x.com', reason: 'manual' }, s)[0].body).toMatch(/^For something the team noted\./)
  })
  it('props checked in → the creator hears it', () => {
    const r = { creatorEmail: 'c@x.com', creatorName: 'Cam', title: 'Diner', startDate: '2026-10-23', status: 'return_pending', history: [] }
    expect(reservationChange('r1', r, { ...r, status: 'returned' })[0]).toMatchObject({ to: ['c@x.com'], title: 'Props checked in ✓' })
  })
  it('booking requests go to everyone who approves; a creator cancelling an approved shoot tells the team', () => {
    const sh = { creatorEmail: 'c@x.com', creatorName: 'Cam', place: 'cliff1', date: '2026-10-23', start: 780, end: 900, status: 'requested', history: [{ by: 'c@x.com', action: 'requested' }] }
    expect(shootChange('x1', null, sh, s)[0].to).toEqual(['approvers'])
    const booked = { ...sh, status: 'booked', history: [...sh.history, { by: 'maanik@x.com', action: 'approved' }] }
    const cancelled = { ...booked, status: 'cancelled', history: [...booked.history, { by: 'c@x.com', action: 'cancelled' }] }
    expect(shootChange('x1', booked, cancelled, s)[0]).toMatchObject({ to: ['gear-team'], title: 'Shoot cancelled' })
    // A request the creator takes back doesn't ping anyone (it just disappears from the list).
    const withdrawn = { ...sh, status: 'cancelled', history: [...sh.history, { by: 'c@x.com', action: 'cancelled' }] }
    expect(shootChange('x1', sh, withdrawn, s)).toEqual([])
  })
})
