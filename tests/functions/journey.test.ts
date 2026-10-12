// The full pick → pack → pickup → return → check-in journey, against the real
// server functions in the emulator.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { addDays, todayInStudio } from '../../functions/src/booking'

const ARTS = 'j-arts@example.com', ALEX = 'alex@example.com', BLAIR = 'blair@example.com'
const day = (n: number) => addDays(todayInStudio(), n)
const PHOTO = 'http://127.0.0.1:9199/v0/b/demo/o/reservation-photos%2Fx%2Fpack%2Fp.jpg?alt=media'

async function newBooking(extra: Record<string, unknown> = {}) {
  const r = await call('createReservation', {
    title: 'Diner scene', startDate: day(5), endDate: day(6),
    lines: [{ itemId: 'cop', qty: 1 }, { itemId: 'chairs', qty: 4 }],
    builds: [{ description: 'Half-eaten birthday cake', qty: 1 }],
    ...extra,
  }, ALEX)
  expect(r.ok).toBe(true)
  return r.result.id as string
}

async function pickAll(id: string) {
  expect((await call('setLinePick', { id, itemId: 'cop', state: 'picked' }, ARTS)).ok).toBe(true)
  expect((await call('setLinePick', { id, itemId: 'chairs', state: 'picked' }, ARTS)).ok).toBe(true)
  expect((await call('setBuildState', { id, buildId: 'b1', state: 'done' }, ARTS)).ok).toBe(true)
}

beforeEach(async () => {
  await clearDatabase()
  for (const [email, role] of [[ARTS, 'arts'], [ALEX, 'creator'], [BLAIR, 'creator']]) {
    await put(`users/${email}`, { email, role, active: true, name: email.split('@')[0] })
  }
  await put('app_settings/booking', { leadTimeDays: 3, bufferDays: 1, maxDays: 7 })
  await put('items/cop', { name: 'Cop costume', quantity: 1, condition: 'good', tags: [] })
  await put('items/chairs', { name: 'Wooden chair', quantity: 10, condition: 'good', tags: [] })
})

describe('the happy path', () => {
  it('goes requested → preparing → packed → collected → returned', async () => {
    const id = await newBooking()
    expect((await getDoc(`reservations/${id}`))!.builds[0]).toMatchObject({ description: 'Half-eaten birthday cake', state: 'todo' })

    await pickAll(id)
    expect((await getDoc(`reservations/${id}`))!.status).toBe('preparing')

    expect((await call('markPacked', { id, photos: [PHOTO], note: 'Chairs are stacked by the door' }, ARTS)).ok).toBe(true)
    let res = (await getDoc(`reservations/${id}`))!
    expect(res.status).toBe('packed')
    expect(res.packPhotos).toEqual([PHOTO])

    expect((await call('confirmPickup', { id, allReceived: true }, ALEX)).ok).toBe(true)
    res = (await getDoc(`reservations/${id}`))!
    expect(res.status).toBe('collected')
    expect(res.pickup).toMatchObject({ by: ALEX, allReceived: true })

    expect((await call('startReturn', { id, photos: [PHOTO], note: 'Left on the returns shelf' }, ALEX)).ok).toBe(true)
    expect((await getDoc(`reservations/${id}`))!.status).toBe('return_pending')

    expect((await call('checkIn', { id, lines: [{ itemId: 'cop', result: 'ok' }, { itemId: 'chairs', result: 'ok' }] }, ARTS)).ok).toBe(true)
    res = (await getDoc(`reservations/${id}`))!
    expect(res.status).toBe('returned')
    expect(res.history.map((h: { status: string }) => h.status))
      .toEqual(['requested', 'preparing', 'packed', 'collected', 'return_pending', 'returned'])
    expect((await getDoc('item_bookings/cop'))!.entries).toHaveLength(0)
  })

  it('every step is queued as an email for later sending', async () => {
    const id = await newBooking()
    await pickAll(id)
    await call('markPacked', { id, photos: [PHOTO] }, ARTS)
    const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/outbox?pageSize=50`,
      { headers: { Authorization: 'Bearer owner' } })
    const subjects = ((await res.json()).documents ?? []).map((d: any) => d.fields.subject.stringValue)
    expect(subjects.some((s: string) => s.startsWith('New request'))).toBe(true)
    expect(subjects.some((s: string) => s.includes('packed and ready'))).toBe(true)
  })
})

describe('packing rules', () => {
  it('cannot be marked packed without a photo', async () => {
    const id = await newBooking()
    await pickAll(id)
    expect((await call('markPacked', { id, photos: [] }, ARTS)).error).toBe('INVALID_ARGUMENT')
  })
  it('cannot be marked packed until every item is picked or marked not available', async () => {
    const id = await newBooking()
    await call('setLinePick', { id, itemId: 'cop', state: 'picked' }, ARTS)
    const r = await call('markPacked', { id, photos: [PHOTO] }, ARTS)
    expect(r.error).toBe('FAILED_PRECONDITION')
    expect(r.message).toContain('2 item')
  })
  it('photo links must come from this app\'s storage', async () => {
    const id = await newBooking()
    await pickAll(id)
    expect((await call('markPacked', { id, photos: ['https://evil.example.com/x.jpg'] }, ARTS)).error).toBe('INVALID_ARGUMENT')
  })
  it('"not available" needs a reason, frees the prop right away, and still lets the rest go out', async () => {
    const id = await newBooking()
    expect((await call('setLinePick', { id, itemId: 'cop', state: 'unavailable' }, ARTS)).error).toBe('INVALID_ARGUMENT')
    expect((await call('setLinePick', { id, itemId: 'cop', state: 'unavailable', reason: 'Torn sleeve' }, ARTS)).ok).toBe(true)
    expect((await getDoc('item_bookings/cop'))!.entries).toHaveLength(0)
    await call('setLinePick', { id, itemId: 'chairs', state: 'picked' }, ARTS)
    await call('setBuildState', { id, buildId: 'b1', state: 'done' }, ARTS)
    expect((await call('markPacked', { id, photos: [PHOTO] }, ARTS)).ok).toBe(true)
    const line = (await getDoc(`reservations/${id}`))!.lines.find((l: { itemId: string }) => l.itemId === 'cop')
    expect(line.pick).toMatchObject({ state: 'unavailable', reason: 'Torn sleeve' })
  })
  it('creators cannot pick, pack or check in', async () => {
    const id = await newBooking()
    expect((await call('setLinePick', { id, itemId: 'cop', state: 'picked' }, ALEX)).error).toBe('PERMISSION_DENIED')
    expect((await call('markPacked', { id, photos: [PHOTO] }, ALEX)).error).toBe('PERMISSION_DENIED')
    expect((await call('checkIn', { id, lines: [] }, ALEX)).error).toBe('PERMISSION_DENIED')
  })
  it('steps must happen in order', async () => {
    const id = await newBooking()
    expect((await call('confirmPickup', { id, allReceived: true }, ALEX)).error).toBe('FAILED_PRECONDITION')
    expect((await call('startReturn', { id, photos: [PHOTO] }, ALEX)).error).toBe('FAILED_PRECONDITION')
  })
})

describe('pickup sign-off', () => {
  async function packed() {
    const id = await newBooking()
    await pickAll(id)
    await call('markPacked', { id, photos: [PHOTO] }, ARTS)
    return id
  }
  it('only the creator who booked can sign for it, not another creator or the arts team', async () => {
    const id = await packed()
    expect((await call('confirmPickup', { id, allReceived: true }, BLAIR)).error).toBe('PERMISSION_DENIED')
    expect((await call('confirmPickup', { id, allReceived: true }, ARTS)).error).toBe('PERMISSION_DENIED')
  })
  it('the creator can report something missing at pickup, which is recorded', async () => {
    const id = await packed()
    expect((await call('confirmPickup', { id, allReceived: false }, ALEX)).error).toBe('INVALID_ARGUMENT')
    expect((await call('confirmPickup', { id, allReceived: false, issue: 'Only 3 chairs' }, ALEX)).ok).toBe(true)
    expect((await getDoc(`reservations/${id}`))!.pickup).toMatchObject({ allReceived: false, issue: 'Only 3 chairs' })
  })
  it('after pickup it can no longer be cancelled', async () => {
    const id = await packed()
    await call('confirmPickup', { id, allReceived: true }, ALEX)
    expect((await call('cancelReservation', { id }, ALEX)).error).toBe('FAILED_PRECONDITION')
  })
})

describe('returns and check-in', () => {
  async function collected() {
    const id = await newBooking()
    await pickAll(id)
    await call('markPacked', { id, photos: [PHOTO] }, ARTS)
    await call('confirmPickup', { id, allReceived: true }, ALEX)
    return id
  }
  it('creators must include a return photo', async () => {
    const id = await collected()
    expect((await call('startReturn', { id, photos: [] }, ALEX)).error).toBe('INVALID_ARGUMENT')
    expect((await call('startReturn', { id, photos: [PHOTO] }, BLAIR)).error).toBe('PERMISSION_DENIED')
  })
  it('every prop needs a result, and damaged/missing need a note', async () => {
    const id = await collected()
    await call('startReturn', { id, photos: [PHOTO] }, ALEX)
    expect((await call('checkIn', { id, lines: [{ itemId: 'cop', result: 'ok' }] }, ARTS)).error).toBe('INVALID_ARGUMENT')
    expect((await call('checkIn', { id, lines: [{ itemId: 'cop', result: 'damaged' }, { itemId: 'chairs', result: 'ok' }] }, ARTS)).error).toBe('INVALID_ARGUMENT')
  })
  it('damaged marks the prop damaged; missing units stop being bookable', async () => {
    const id = await collected()
    await call('startReturn', { id, photos: [PHOTO] }, ALEX)
    expect((await call('checkIn', { id, lines: [
      { itemId: 'cop', result: 'damaged', note: 'Ripped seam' },
      { itemId: 'chairs', result: 'missing', missingQty: 2, note: 'Only 2 came back' },
    ] }, ARTS)).ok).toBe(true)
    expect((await getDoc('items/cop'))!.condition).toBe('damaged')
    expect((await getDoc('items/chairs'))!.missingQty).toBe(2)
    // 10 chairs, 2 missing: only 8 can be booked now
    const nine = await call('createReservation', { title: 'x', startDate: day(20), endDate: day(20), lines: [{ itemId: 'chairs', qty: 9 }] }, BLAIR)
    expect(nine.details.conflicts[0].free).toBe(8)
  })
  it('a built prop can be added to the inventory at check-in', async () => {
    const id = await collected()
    await call('startReturn', { id, photos: [PHOTO] }, ALEX)
    await call('checkIn', { id, lines: [{ itemId: 'cop', result: 'ok' }, { itemId: 'chairs', result: 'ok' }],
      builds: [{ buildId: 'b1', addToInventory: true }] }, ARTS)
    const build = (await getDoc(`reservations/${id}`))!.builds[0]
    expect(build.addedItemId).toBeTruthy()
    expect((await getDoc(`items/${build.addedItemId}`))!.name).toBe('Half-eaten birthday cake')
  })
  it('arts can check in a drop-off made without the app; it is flagged', async () => {
    const id = await collected()
    expect((await call('checkIn', { id, lines: [{ itemId: 'cop', result: 'ok' }, { itemId: 'chairs', result: 'ok' }] }, ARTS)).ok).toBe(true)
    expect((await getDoc(`reservations/${id}`))!.returnedWithoutCreatorPhoto).toBe(true)
  })
})

describe('build-only requests', () => {
  it('a request can be only things to build', async () => {
    const r = await call('createReservation', { title: 'Cake', startDate: day(5), endDate: day(5), lines: [],
      builds: [{ description: 'Giant prop key', qty: 2 }] }, ALEX)
    expect(r.ok).toBe(true)
  })
  it('a build request needs a description', async () => {
    const r = await call('createReservation', { title: 'Cake', startDate: day(5), endDate: day(5), builds: [{ description: '', qty: 1 }] }, ALEX)
    expect(r.error).toBe('INVALID_ARGUMENT')
  })
})
