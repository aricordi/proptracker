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
