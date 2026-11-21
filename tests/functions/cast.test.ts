// "Who's in this video?" (Nov 21): invite people into your video; they say yes or no; the invite follows the shoot.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ANA = 'ana@example.com', KYLE = 'kyle@example.com', DEE = 'dee@example.com', BEN = 'ben@example.com'
const DAY = addDays(todayInStudio(), 9)

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
  await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
  await put('users/farrell@example.com', { email: 'farrell@example.com', role: 'arts', active: true, name: 'Farrell' })
  await put('app_settings/schedule', { instantBookers: [{ email: ANA, name: 'Ana' }] })
})

async function anaShoot() {
  const r = await call('bookShoot', { place: 'cliff2', date: DAY, start: 900 }, ANA)
  expect(r.ok, r.message).toBe(true)
  return r.result.id as string
}

describe('video invites', () => {
  it('the host invites people (Props-only creators too); they see a copy of the time and place and can say yes', async () => {
    const id = await anaShoot()
    const r = await call('inviteToVideo', { shootId: id, emails: [KYLE, DEE] }, ANA)
    expect(r.ok, r.message).toBe(true)
    const inv = (await getDoc(`cast_invites/${id}_${KYLE}`))!
    expect(inv).toMatchObject({ shootId: id, hostEmail: ANA, toEmail: KYLE, status: 'pending', date: DAY, start: 900, end: 1020, placeName: 'Cliff 2' })
    // A Props-only creator can answer.
    expect((await call('answerVideoInvite', { id: `${id}_${DEE}`, accept: true }, DEE)).ok).toBe(true)
    expect((await getDoc(`cast_invites/${id}_${DEE}`))!.status).toBe('accepted')
    // Someone else can't answer it.
    expect((await call('answerVideoInvite', { id: `${id}_${KYLE}`, accept: true }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('answerVideoInvite', { id: `${id}_${KYLE}`, accept: false }, KYLE)).ok).toBe(true)
    expect((await getDoc(`cast_invites/${id}_${KYLE}`))!.status).toBe('declined')
  })

  it('only the host (or the schedule team) can invite and remove; staff who don\'t film can\'t be invited', async () => {
    const id = await anaShoot()
    expect((await call('inviteToVideo', { shootId: id, emails: [KYLE] }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('inviteToVideo', { shootId: id, emails: ['farrell@example.com'] }, ANA)).ok).toBe(false)
    await call('inviteToVideo', { shootId: id, emails: [KYLE] }, ANA)
    expect((await call('removeFromVideo', { id: `${id}_${KYLE}` }, BEN)).error).toBe('PERMISSION_DENIED')
    expect((await call('removeFromVideo', { id: `${id}_${KYLE}` }, ANA)).ok).toBe(true)
    expect((await getDoc(`cast_invites/${id}_${KYLE}`))!.status).toBe('removed')
    // Inviting again after being removed starts a fresh invite.
    await call('inviteToVideo', { shootId: id, emails: [KYLE] }, ANA)
    expect((await getDoc(`cast_invites/${id}_${KYLE}`))!.status).toBe('pending')
  })

  it('people who said yes can step out later', async () => {
    const id = await anaShoot()
    await call('inviteToVideo', { shootId: id, emails: [KYLE] }, ANA)
    expect((await call('answerVideoInvite', { id: `${id}_${KYLE}`, leave: true }, KYLE)).ok).toBe(false)   // not a yes yet
    await call('answerVideoInvite', { id: `${id}_${KYLE}`, accept: true }, KYLE)
    expect((await call('answerVideoInvite', { id: `${id}_${KYLE}`, leave: true }, KYLE)).ok).toBe(true)
    expect((await getDoc(`cast_invites/${id}_${KYLE}`))!.status).toBe('left')
  })

  it('follows the shoot: a move updates the time, a cancel marks it off', async () => {
    const id = await anaShoot()
    await call('inviteToVideo', { shootId: id, emails: [KYLE] }, ANA)
    await call('answerVideoInvite', { id: `${id}_${KYLE}`, accept: true }, KYLE)
    expect((await call('moveShoot', { id, place: 'cliff2', date: DAY, start: 1140 }, ANA)).ok).toBe(true)
    await waitFor(async () => (await getDoc(`cast_invites/${id}_${KYLE}`))?.start === 1140)
    expect((await call('cancelShoot', { id }, ANA)).ok).toBe(true)
    await waitFor(async () => (await getDoc(`cast_invites/${id}_${KYLE}`))?.status === 'cancelled')
  })

  it('back to back with "in each other\'s videos": the friend is invited into yours and you\'re in theirs', async () => {
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [KYLE, 'guest:Bob'], castWith: [KYLE, 'guest:bob'] }, ANA)
    expect(r.ok, r.message).toBe(true)
    const mine = r.result.shootIds[0], kylesShoot = r.result.friendShootIds[0]
    expect((await getDoc(`cast_invites/${mine}_${KYLE}`))!.status).toBe('pending')
    expect((await getDoc(`cast_invites/${kylesShoot}_${ANA}`))).toMatchObject({ status: 'accepted', hostEmail: KYLE, start: 900 })
  })

  it('without the tick nobody is invited', async () => {
    const r = await call('bookWithFriends', { place: 'cliff2', date: DAY, start: 780, friends: [KYLE] }, ANA)
    expect(await getDoc(`cast_invites/${r.result.shootIds[0]}_${KYLE}`)).toBeNull()
  })
})
