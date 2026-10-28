// Change someone's email (owner, Oct 27): everything filed under the old email moves to the new one.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase, getDoc, exists } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', OLD = 'aaron.old@example.com', NEW = 'aaron@example.com', FRIEND = 'fran@example.com'
let day = addDays(todayInStudio(), 10); while (weekday(day) === 0 || weekday(day) === 4 || weekday(day) === 6) day = addDays(day, 1)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${OLD}`, { email: OLD, name: 'Aaron', role: 'creator', active: false, access: 'full' })
  await put(`users/${NEW}`, { email: NEW, name: 'Aaron B', role: 'creator', active: true, access: 'props' })
  await put(`users/${FRIEND}`, { email: FRIEND, name: 'Fran', role: 'creator', active: true })
  await put(`profiles/${OLD}`, { channel: '@aaron', googlePhoto: 'https://x/old.jpg' })
  await put(`strikes/s1`, { email: OLD, name: 'Aaron', reason: 'manual', shootId: '', by: OWNER, at: new Date().toISOString() })
  await put(`user_status/${OLD}`, { email: OLD, strikes: 1, pausedUntil: addDays(todayInStudio(), 5), manualPause: true })
  await put('gear_bookings/g1', { title: 'Shoot', creatorEmail: FRIEND, crewEmails: [OLD], crew: [{ email: OLD, name: 'Aaron', shootId: 'x' }], usedBy: [OLD, FRIEND], status: 'checked_in' })
  await put('flag_reviews/late-gear__g1__aaron-old-example-com', { flagId: 'late-gear:g1:aaron-old-example-com', email: OLD, status: 'excused' })
  await put('app_settings/schedule', { priority: [{ email: OLD, name: 'Aaron' }] })
  await put('push_tokens/t1', { token: 'abc', email: OLD })
  await put('items/i1', { name: 'Lamp', updatedBy: OLD, collection: 'company' })
})

describe('changeUserEmail', () => {
  it('only the owner can do it', async () => {
    expect((await call('changeUserEmail', { from: OLD, to: NEW }, FRIEND)).error).toBe('PERMISSION_DENIED')
  })
  it('previews without changing anything, then moves and merges everything', async () => {
    await put(`users/${OLD}`, { email: OLD, name: 'Aaron', role: 'creator', active: true, access: 'full' })
    const shoot = (await call('bookShoot', { place: 'cliff2', date: day, start: 780 }, OLD)).result
    expect(shoot).toHaveProperty('id')
    const p = (await call('changeUserEmail', { from: OLD, to: NEW }, OWNER)).result
    expect(p.applied).toBe(false)
    expect(p.merging).toBe(true)
    expect(p.summary.find((s: { what: string }) => s.what === 'shoot').count).toBe(1)
    expect((await getDoc(`shoots/${shoot.id}`))!.creatorEmail).toBe(OLD)

    const r = (await call('changeUserEmail', { from: OLD, to: NEW, apply: true }, OWNER)).result
    expect(r.applied).toBe(true)
    const nu = (await getDoc(`users/${NEW}`))!
    expect(nu).toMatchObject({ active: true, access: 'full', name: 'Aaron B', role: 'creator', movedFrom: [OLD] })
    expect(await exists(`users/${OLD}`)).toBe(false)
    expect((await getDoc(`shoots/${shoot.id}`))!.creatorEmail).toBe(NEW)
    const dayDoc = (await getDoc(`schedule_days/${day}`))!
    expect(dayDoc.cliff2['780'].email).toBe(NEW)
    expect((await getDoc('strikes/s1'))!.email).toBe(NEW)
    expect(await getDoc(`user_status/${NEW}`)).toMatchObject({ email: NEW, strikes: 1, manualPause: true })
    expect(await exists(`user_status/${OLD}`)).toBe(false)
    expect((await getDoc(`profiles/${NEW}`))!.channel).toBe('@aaron')
    expect(await exists(`profiles/${OLD}`)).toBe(false)
    const g = (await getDoc('gear_bookings/g1'))!
    expect(g.crewEmails).toEqual([NEW]); expect(g.crew[0].email).toBe(NEW); expect(g.usedBy).toEqual([NEW, FRIEND])
    expect(await exists('flag_reviews/late-gear__g1__aaron-old-example-com')).toBe(false)
    expect((await getDoc('flag_reviews/late-gear__g1__aaron-example-com'))!).toMatchObject({ flagId: 'late-gear:g1:aaron-example-com', email: NEW, status: 'excused' })
    expect((await getDoc('app_settings/schedule'))!.priority[0].email).toBe(NEW)
    expect(await exists('push_tokens/t1')).toBe(false)
    expect((await getDoc('items/i1'))!.updatedBy).toBe(OLD)   // props are never touched
    // the new email works, the old one can't sign in
    expect((await call('listFilmingFriends', {}, OLD)).error).toBe('PERMISSION_DENIED')
    expect((await call('changeUserEmail', { from: OLD, to: 'x@example.com' }, OWNER)).error).toBe('NOT_FOUND')
  })
  it('moves to a brand-new email (no account there yet)', async () => {
    const r = (await call('changeUserEmail', { from: FRIEND, to: 'fran.new@example.com', apply: true }, OWNER)).result
    expect(r.merging).toBe(false)
    expect(await getDoc('users/fran.new@example.com')).toMatchObject({ name: 'Fran', role: 'creator', active: true })
    expect((await getDoc('gear_bookings/g1'))!.creatorEmail).toBe('fran.new@example.com')
  })
  it("refuses the owner's email and bad input", async () => {
    expect((await call('changeUserEmail', { from: OLD, to: OWNER }, OWNER)).error).toBe('INVALID_ARGUMENT')
    expect((await call('changeUserEmail', { from: OLD, to: 'nope' }, OWNER)).error).toBe('INVALID_ARGUMENT')
    expect((await call('changeUserEmail', { from: 'ghost@example.com', to: 'g2@example.com' }, OWNER)).error).toBe('NOT_FOUND')
  })
})
