// Owner (Oct 21): admins open any flag and act on it: send a note, give a strike for it, excuse it, mark it handled.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase, getDoc } from './helpers'

const ADMIN = 'sam@example.com', CREATOR = 'riley@example.com', ARTS = 'arts@example.com', GEAR = 'gear@example.com'
const FLAG = { flagId: 'late-props:res1', email: CREATOR, kind: 'late-props', label: 'Late props · Oct 12' }
const doc = (id: string) => getDoc(`flag_reviews/${id.replace(/:/g, '__')}`)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true, name: 'Riley' })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true, name: 'Maanik' })
})

describe('acting on a flag', () => {
  it('only the owner and admins; reasons required; unknown flags refused', async () => {
    for (const who of [ARTS, GEAR, CREATOR]) expect((await call('reviewFlag', { ...FLAG, action: 'handled' }, who)).error).toBe('PERMISSION_DENIED')
    expect((await call('reviewFlag', { ...FLAG, action: 'excuse', note: '' }, ADMIN)).error).toBe('INVALID_ARGUMENT')
    expect((await call('reviewFlag', { ...FLAG, flagId: 'no-show:res1', action: 'handled' }, ADMIN)).error).toBe('INVALID_ARGUMENT')   // kind must match
    expect((await call('reviewFlag', { ...FLAG, flagId: 'late-props:../x', action: 'handled' }, ADMIN)).error).toBe('INVALID_ARGUMENT')
    expect((await call('reviewFlag', { ...FLAG, action: 'handled' }, ADMIN)).ok).toBe(true)   // a note is optional here
  })
  it("the owner's own flags can be excused too (owner, Nov 5: 'says I'm not a creator')", async () => {
    const OWNER = 'alexisricordi@gmail.com'
    const mine = { flagId: 'props-damaged:res9', email: OWNER, kind: 'props-damaged', label: 'Props damaged · Oct 21' }
    const r = await call('reviewFlag', { ...mine, action: 'excuse', note: 'test' }, OWNER)
    expect(r.ok, r.message).toBe(true)
    expect(await doc(mine.flagId)).toMatchObject({ status: 'excused', email: OWNER })
  })
  it('excuse, count again, send a note: all kept on the flag', async () => {
    expect((await call('reviewFlag', { ...FLAG, action: 'excuse', note: 'Arts said it was their mix-up' }, ADMIN)).result.status).toBe('excused')
    expect(await doc(FLAG.flagId)).toMatchObject({ status: 'excused', email: CREATOR, kind: 'late-props' })
    await call('reviewFlag', { ...FLAG, action: 'unexcuse' }, ADMIN)
    await call('reviewFlag', { ...FLAG, action: 'warn', note: 'Please bring props back on time' }, ADMIN)
    const d = await doc(FLAG.flagId)
    expect(d!.status).toBe('warned')
    expect(d!.actions.map((a: { action: string }) => a.action)).toEqual(['excuse', 'unexcuse', 'warn'])
    expect(d!.actions[2]).toMatchObject({ by: ADMIN, note: 'Please bring props back on time' })
  })
  it('a strike for the flag counts toward the pause, once per flag (again after it is removed)', async () => {
    const one = await call('reviewFlag', { ...FLAG, action: 'strike', note: 'Two days late' }, ADMIN)
    expect(one.result.strike).toMatchObject({ strikes: 1, paused: false })
    const st = await getDoc(`strikes/${one.result.strike.id}`)
    expect(st).toMatchObject({ email: CREATOR, reason: 'manual', about: 'props', flagId: FLAG.flagId, note: 'Two days late (Late props · Oct 12)' })
    expect((await call('reviewFlag', { ...FLAG, action: 'strike', note: 'again' }, ADMIN)).error).toBe('FAILED_PRECONDITION')
    await call('removeStrike', { id: one.result.strike.id, note: 'Arts mix-up' }, ADMIN)
    expect((await call('reviewFlag', { ...FLAG, action: 'strike', note: 'Really late this time' }, ADMIN)).ok).toBe(true)
    expect((await doc(FLAG.flagId))!.status).toBe('struck')
  })
})

describe('strikes audit fixes (Nov 5)', () => {
  it('excusing a no-show takes its strike off; a longer pause set by hand is not shortened by a new strike', async () => {
    await put('app_settings/schedule', { strikeCount: 2, strikeDays: 30, pauseDays: 14 })
    await put('strikes/s1', { email: CREATOR, name: 'Riley', reason: 'no-show', shootId: 'sh1', by: GEAR, at: new Date().toISOString() })
    await put(`user_status/${CREATOR}`, { email: CREATOR, strikes: 1 })
    const r = await call('reviewFlag', { flagId: 'no-show:sh1', email: CREATOR, kind: 'no-show', label: 'No-show', shootId: 'sh1', action: 'excuse', note: 'Car broke down' }, ADMIN)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.removedStrikes).toBe(1)
    expect((await getDoc('strikes/s1'))!.removedAt).toBeTruthy()
    expect((await getDoc(`user_status/${CREATOR}`))!.strikes).toBe(0)
    // A 60-day pause by hand, then two strikes: still 60 days.
    expect((await call('pauseCreator', { email: CREATOR, days: 60, note: 'Repeated issues' }, ADMIN)).ok).toBe(true)
    const until = (await getDoc(`user_status/${CREATOR}`))!.pausedUntil
    await call('giveStrike', { email: CREATOR, about: 'props', note: 'late props' }, ADMIN)
    await call('giveStrike', { email: CREATOR, about: 'props', note: 'late again' }, ADMIN)
    const st = (await getDoc(`user_status/${CREATOR}`))!
    expect(st.pausedUntil).toBe(until)
    expect(st.manualPause).toBe(true)
  })
})
