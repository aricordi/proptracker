import { describe, it, expect } from 'vitest'
import { castFollow, castReminders, castWhen, videoNoteFor, inviteNote, type CastInvite } from '../../functions/src/cast'

const inv = (over: Partial<CastInvite> = {}): CastInvite => ({
  shootId: 's1', hostEmail: 'ariel@x.com', hostName: 'Ariel Cohen', toEmail: 'alex@x.com', toName: 'Alex',
  place: 'cliff1', where: '', bothHouses: false, placeName: 'Cliff 1', date: '2026-11-25', start: 780, end: 900,
  from: '2026-11-25T13:00', to: '2026-11-25T15:00', shootStatus: 'booked', status: 'accepted',
  invitedBy: 'ariel@x.com', invitedAt: 'x', updatedAt: 'x', ...over,
})

describe('cast reminders', () => {
  it('night before from 7 PM, and an hour before', () => {
    expect(castReminders('i', inv(), '2026-11-24T18:59', '2026-11-24', '2026-11-25')).toEqual([])
    const night = castReminders('i', inv(), '2026-11-24T19:00', '2026-11-24', '2026-11-25')
    expect(night.map(r => r.key)).toEqual(['castnight_i'])
    expect(night[0].push.body).toContain('1 PM')
    expect(castReminders('i', inv(), '2026-11-25T11:59', '2026-11-25', '2026-11-26')).toEqual([])
    expect(castReminders('i', inv(), '2026-11-25T12:00', '2026-11-25', '2026-11-26').map(r => r.key)).toEqual(['cast1h_i'])
  })
  it('nothing for invites not said yes to, cancelled shoots, or after the start', () => {
    expect(castReminders('i', inv({ status: 'pending' }), '2026-11-25T12:30', '2026-11-25', '2026-11-26')).toEqual([])
    expect(castReminders('i', inv({ shootStatus: 'cancelled' }), '2026-11-25T12:30', '2026-11-25', '2026-11-26')).toEqual([])
    expect(castReminders('i', inv(), '2026-11-25T13:00', '2026-11-25', '2026-11-26')).toEqual([])
  })
})

describe('cast follows the shoot', () => {
  it('moved → new time + message to people who said yes', () => {
    const r = castFollow(inv(), { status: 'booked', place: 'cliff1', date: '2026-11-26', start: 900, end: 1020, from: '2026-11-26T15:00', to: '2026-11-26T17:00' }, 'Cliff 1', 'i')
    expect(r.update).toMatchObject({ date: '2026-11-26', start: 900 })
    expect(r.push?.title).toBe("Ariel's video moved")
  })
  it('a pending invite moves quietly; a cancelled shoot marks it off', () => {
    const r = castFollow(inv({ status: 'pending' }), { status: 'booked', place: 'cliff1', date: '2026-11-26', start: 900, end: 1020 }, 'Cliff 1', 'i')
    expect(r.update).toBeTruthy(); expect(r.push).toBeNull()
    const off = castFollow(inv(), { status: 'cancelled' }, 'Cliff 1', 'i')
    expect(off.update?.status).toBe('cancelled')
    expect(off.push?.title).toBe("Ariel's video is off")
  })
  it('answered "no" or removed: nothing changes', () => {
    expect(castFollow(inv({ status: 'declined' }), { status: 'cancelled' }, 'Cliff 1', 'i')).toEqual({ update: null, push: null })
  })
  it('reads well', () => { expect(castWhen(inv())).toBe('Wed Nov 25 · 1 PM–3 PM · Cliff 1') })
})

describe('same-day smarts', () => {
  const v = inv()  // Ariel's video Nov 25 1–3 PM, accepted
  it('my later shoot reminds me of the earlier video; overlap is a clash', () => {
    expect(videoNoteFor({ date: '2026-11-25', start: 900, end: 1020 }, [v])).toEqual({ text: "In Ariel's video at 1 PM first", clash: false })
    expect(videoNoteFor({ date: '2026-11-25', start: 840, end: 960 }, [v])?.clash).toBe(true)
    expect(videoNoteFor({ date: '2026-11-25', start: 600, end: 720 }, [v])?.text).toBe("Then Ariel's video at 1 PM")
    expect(videoNoteFor({ date: '2026-11-26', start: 900, end: 1020 }, [v])).toBeNull()
    expect(videoNoteFor({ date: '2026-11-25', start: 900, end: 1020 }, [inv({ status: 'pending' })])).toBeNull()
  })
  it('invite says what else I have that day', () => {
    expect(inviteNote(v, [{ date: '2026-11-25', start: 900, end: 1020, label: 'Cliff 2' }], [])?.text).toBe('Before your own shoot at 3 PM · Cliff 2')
    expect(inviteNote(v, [{ date: '2026-11-25', start: 840, end: 960 }], [])?.clash).toBe(true)
    expect(inviteNote(v, [], [{ ...inv({ hostName: 'Kyle' }), id: 'k' }], 'self')?.text).toBe("Clashes with Kyle's video (1 PM–3 PM)")
    expect(inviteNote(v, [], [])).toBeNull()
  })
  it('approval of a requested time tells people who said yes', () => {
    const r = castFollow(inv({ shootStatus: 'requested' }), { status: 'booked', place: 'cliff1', date: '2026-11-25', start: 780, end: 900, from: '2026-11-25T13:00', to: '2026-11-25T15:00' }, 'Cliff 1', 'i')
    expect(r.push?.title).toBe("Ariel's video is confirmed ✓")
  })
})
