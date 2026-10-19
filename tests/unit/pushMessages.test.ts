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
    expect(p).toMatchObject({ to: ['ariel@x.com'], title: 'Alex invited you to film 🎬', url: '/schedule' })
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
