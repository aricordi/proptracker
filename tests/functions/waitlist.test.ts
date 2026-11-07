// "Notify me if it opens" (waitlist): join a taken slot; when it frees up, the first in line gets it held for 20 minutes.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const ANA = 'ana@example.com', KYLE = 'kyle@example.com', JANA = 'jana@example.com', BEN = 'ben@example.com', DEE = 'dee@example.com'
const DAY = addDays(todayInStudio(), 9)
const docs = async (path: string) => {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })
  const body = await res.json()
  return (body.documents ?? []).map((d: any) => ({ id: d.name.split('/').pop(), status: d.fields?.status?.stringValue, email: d.fields?.email?.stringValue, toEmail: d.fields?.toEmail?.stringValue, waitlist: d.fields?.waitlist?.booleanValue }))
}
const heldFor = async (start = 900) => (await getDoc(`schedule_days/${DAY}`))?.cliff2?.[String(start)]?.hold ? (await getDoc(`schedule_days/${DAY}`))!.cliff2[String(start)].email : null
const inviteFor = async (email: string) => (await docs('schedule_invites')).find((i: any) => i.toEmail === email && i.waitlist && i.status === 'pending')
const entryOf = async (email: string) => (await docs('waitlist')).find((w: any) => w.email === email)

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [KYLE, 'Kyle'], [JANA, 'Jana'], [BEN, 'Ben']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n })
  await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
})

async function benBooks(start = 900) {
  const r = await call('bookShoot', { place: 'cliff2', date: DAY, start }, BEN)
  expect(r.ok).toBe(true)
  return r.result.id as string
}

describe('joining the list', () => {
  it('only for a real future slot someone else has; returns the place in line', async () => {
    await benBooks()
    const a = await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, ANA)
    expect(a.ok).toBe(true)
    expect(a.result.position).toBe(1)
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, KYLE)).result.position).toBe(2)
    // Joining twice keeps one entry and the same place.
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, ANA)).result.position).toBe(1)
    expect((await docs('waitlist')).length).toBe(2)
    // Free slot, your own slot, the past, a made-up time.
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 1020 }, ANA)).details?.problem).toBe('free')
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, BEN)).details?.problem).toBe('mine')
    expect((await call('joinWaitlist', { date: addDays(todayInStudio(), -1), house: 'cliff2', start: 900 }, ANA)).details?.problem).toBe('past')
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 905 }, ANA)).error).toBe('INVALID_ARGUMENT')
    // Props-only creators can't.
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, DEE)).details?.problem).toBe('demo')
    // My list shows my place; leaving takes me off.
    expect((await call('myWaitlist', {}, KYLE)).result.entries[0]).toMatchObject({ date: DAY, house: 'cliff2', start: 900, position: 2 })
    expect((await call('leaveWaitlist', { id: a.result.id }, KYLE)).ok).toBe(false)   // not his entry
    expect((await call('leaveWaitlist', { id: a.result.id }, ANA)).ok).toBe(true)
    expect((await call('myWaitlist', {}, KYLE)).result.entries[0].position).toBe(1)
  })

  it('not on a day you already film at the houses (one slot a day)', async () => {
    await benBooks()
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 1140 }, ANA)).ok).toBe(true)
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, ANA)).details?.problem).toBe('day-limit')
  })

  it('at most 5 times at once', async () => {
    // Six of Ben's slots that day, put straight on the schedule.
    const fill: Record<string, unknown> = {}
    for (const st of [420, 540, 660, 780, 900, 1020]) fill[String(st)] = { shootId: `x${st}`, name: 'Ben', email: BEN, kind: 'extra' }
    await put(`schedule_days/${DAY}`, { date: DAY, cliff2: fill })
    for (const st of [420, 540, 660, 780, 900]) expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: st }, ANA)).ok).toBe(true)
    expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 1020 }, ANA)).details?.problem).toBe('too-many')
  })
})

describe('when the slot opens up', () => {
  it('cancel → held for #1; #1 can\'t → #2; time runs out → #3; #3 confirms → their own request', async () => {
    const benShoot = await benBooks()
    for (const who of [ANA, KYLE, JANA]) expect((await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, who)).ok).toBe(true)

    // Ben cancels: the slot is held for Ana, with an invite marked as from the waitlist.
    expect((await call('cancelShoot', { id: benShoot }, BEN)).ok).toBe(true)
    expect(await waitFor(async () => (await heldFor()) === ANA)).toBe(true)
    const anaInvite = await inviteFor(ANA)
    expect(anaInvite).toBeTruthy()
    expect((await entryOf(ANA)).status).toBe('offered')
    // Someone else can't book the held slot.
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 900 }, BEN)).ok).toBe(false)

    // Ana can't make it: Kyle is next.
    expect((await call('answerInvite', { id: anaInvite.id, accept: false }, ANA)).ok).toBe(true)
    expect(await waitFor(async () => (await heldFor()) === KYLE)).toBe(true)
    expect(await waitFor(async () => (await entryOf(ANA)).status === 'left')).toBe(true)

    // Kyle's 20 minutes run out (what the 10-minute sweep does: the hold goes, the invite expires): Jana is next.
    const kyleInvite = await inviteFor(KYLE)
    const inv = (await getDoc(`schedule_invites/${kyleInvite.id}`))!
    await put(`schedule_invites/${kyleInvite.id}`, { ...inv, status: 'expired' })
    const day = (await getDoc(`schedule_days/${DAY}`))!
    delete day.cliff2['900']
    await put(`schedule_days/${DAY}`, day)
    expect(await waitFor(async () => (await heldFor()) === JANA)).toBe(true)
    expect(await waitFor(async () => (await entryOf(KYLE)).status === 'expired')).toBe(true)

    // Jana confirms: it becomes her shoot (a request the team approves), not "invited by" anyone.
    const janaInvite = await inviteFor(JANA)
    const a = await call('answerInvite', { id: janaInvite.id, accept: true }, JANA)
    expect(a.ok).toBe(true)
    const shoot = (await getDoc(`shoots/${a.result.shootId}`))!
    expect(shoot).toMatchObject({ creatorEmail: JANA, start: 900, status: 'requested', fromWaitlist: true })
    expect(shoot.invitedBy).toBeUndefined()
    expect(await waitFor(async () => (await entryOf(JANA)).status === 'done')).toBe(true)
    expect((await getDoc(`schedule_days/${DAY}`))!.cliff2['900'].shootId).toBe(a.result.shootId)
  })

  it('skips someone who now films that day', async () => {
    const benShoot = await benBooks()
    for (const who of [ANA, KYLE]) await call('joinWaitlist', { date: DAY, house: 'cliff2', start: 900 }, who)
    expect((await call('bookShoot', { place: 'cliff2', date: DAY, start: 1140 }, ANA)).ok).toBe(true)
    expect((await call('cancelShoot', { id: benShoot }, BEN)).ok).toBe(true)
    expect(await waitFor(async () => (await heldFor()) === KYLE)).toBe(true)
    expect((await entryOf(ANA)).status).toBe('expired')
  })
})

describe('the chat', () => {
  it('asking for an exact time someone else has offers the waitlist for that slot', async () => {
    await benBooks()
    const d = new Date(`${DAY}T12:00:00Z`)
    const named = `${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase()} ${d.getUTCDate()}`
    const r = await call('askForTime', { text: `cliff 2 on ${named} at 3pm` }, ANA)
    expect(r.ok).toBe(true)
    expect(r.result.waitlist).toEqual({ date: DAY, house: 'cliff2', start: 900 })
    // A free time gives no waitlist offer.
    expect((await call('askForTime', { text: `cliff 2 on ${named} at 5pm` }, ANA)).result.waitlist).toBeUndefined()
  })
})
