// On the day: check in with a set photo, report the slot before, wrap; missed check-ins, strikes, pauses.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { nowStamp, addMinutes } from '../../functions/src/gearBooking'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const ANA = 'ana@example.com', BEN = 'ben@example.com', MAANIK = 'maanik@example.com'
const PHOTO = 'https://example.com/set.jpg'
const mins = (st: string) => Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16))

// A shoot written straight into the database at a chosen time around now.
async function shootAt(id: string, email: string, name: string, fromOffset: number, extra: Record<string, unknown> = {}) {
  const from = addMinutes(nowStamp(), fromOffset), to = addMinutes(from, 120), date = from.slice(0, 10)
  await put(`shoots/${id}`, { creatorEmail: email, creatorName: name, place: 'cliff1', where: '', date, month: date.slice(0, 7), start: mins(from), end: mins(from) + 120,
    from, to, kind: 'extra', status: 'booked', bookedBy: email, createdAt: '2026-01-01T00:00:00.000Z', history: [], ...extra })
  return { from, to, date, start: mins(from) }
}

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
})

describe('check in and wrap', () => {
  it('opens 15 minutes before; needs a set photo; only the person who booked', async () => {
    await shootAt('early', ANA, 'Ana', 30)
    expect((await call('checkInShoot', { id: 'early', photos: [PHOTO] }, ANA)).message).toMatch(/opens 15 minutes/)
    await shootAt('now', ANA, 'Ana', 10)
    expect((await call('checkInShoot', { id: 'now', photos: [] }, ANA)).message).toMatch(/photo/)
    expect((await call('checkInShoot', { id: 'now', photos: [PHOTO] }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('checkInShoot', { id: 'now', photos: [PHOTO] }, ANA)).ok).toBe(true)
    expect((await getDoc('shoots/now'))!.checkin.photos).toEqual([PHOTO])
    expect((await call('wrapShoot', { id: 'now', title: 'Prank call pt 3' }, ANA)).ok).toBe(true)
    expect((await getDoc('shoots/now'))!.wrap.title).toBe('Prank call pt 3')
  })

  it('reports the slot before (ran over + mess with photos); the team upholds it and that person gets a strike', async () => {
    const t = await shootAt('mine', ANA, 'Ana', -5)
    await put(`schedule_days/${t.date}`, { date: t.date, cliff1: { [String(t.start - 120)]: { shootId: 'prev', name: 'Ben', email: BEN, kind: 'extra' }, [String(t.start)]: { shootId: 'mine', name: 'Ana', email: ANA, kind: 'extra' } } })
    await put('shoots/prev', { creatorEmail: BEN, creatorName: 'Ben', status: 'booked', history: [] })
    expect((await call('checkInShoot', { id: 'mine', photos: [PHOTO], report: { mess: true } }, ANA)).message).toMatch(/photo of the mess/)
    const r = await call('checkInShoot', { id: 'mine', photos: [PHOTO], report: { overMinutes: 20, mess: true, photos: [PHOTO] } }, ANA)
    expect(r.result.reported).toBeTruthy()
    expect((await getDoc(`schedule_reports/${r.result.reported}`))!).toMatchObject({ onEmail: BEN, byEmail: ANA, overMinutes: 20, mess: true, status: 'open' })
    expect((await getDoc('shoots/prev'))!.history.at(-1).action).toBe('reported')
    expect((await call('reviewReport', { id: r.result.reported, uphold: true }, ANA)).error).toBe('PERMISSION_DENIED')
    const rev = await call('reviewReport', { id: r.result.reported, uphold: true }, MAANIK)
    expect(rev.result.strike).toMatchObject({ strikes: 1, paused: false })
  })
})

describe('missed check-ins, strikes and pauses', () => {
  it('a missed check-in can be explained; the team marks it filmed (no strike) or a no-show (strike)', async () => {
    await shootAt('missed1', ANA, 'Ana', -150)
    expect((await call('explainMissedCheckIn', { id: 'missed1', text: 'Phone died, we filmed' }, ANA)).ok).toBe(true)
    const d = await call('decideShoot', { id: 'missed1', outcome: 'filmed' }, MAANIK)
    expect(d.result.strike).toBeNull()
    expect((await call('decideShoot', { id: 'missed1', outcome: 'noshow' }, MAANIK)).message).toMatch(/already decided/)
  })

  it('2 strikes in 30 days pause prop + gear bookings; the team can lift it', async () => {
    await shootAt('m1', ANA, 'Ana', -300)
    await shootAt('m2', ANA, 'Ana', -150)
    await call('decideShoot', { id: 'm1', outcome: 'noshow' }, MAANIK)
    const second = await call('decideShoot', { id: 'm2', outcome: 'noshow' }, MAANIK)
    expect(second.result.strike).toMatchObject({ strikes: 2, paused: true })
    expect((await call('createReservation', {}, ANA)).message).toMatch(/paused until/)
    expect((await call('createGearBooking', {}, ANA)).message).toMatch(/paused until/)
    expect((await call('liftPause', { email: ANA }, MAANIK)).ok).toBe(true)
    expect((await call('createReservation', {}, ANA)).message).not.toMatch(/paused/)
  })

  it('cancelling inside 48 hours adds a strike', async () => {
    let d = addDays(todayInStudio(), 1); if (weekday(d) === 4 || weekday(d) === 6) d = addDays(d, 1)
    const b = await call('bookShoot', { place: 'cliff1', date: d, start: 1260, kind: 'extra' }, ANA)
    await put(`shoots/${b.result.id}`, { ...(await getDoc(`shoots/${b.result.id}`))!, createdAt: '2026-01-01T00:00:00.000Z' })
    await call('cancelShoot', { id: b.result.id, confirmNoShow: true }, ANA)
    expect((await getDoc(`user_status/${ANA}`))!.strikes).toBe(1)
  })
})
