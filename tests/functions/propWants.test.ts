// "Wanted but booked" (owner, Nov 7): a creator opens a prop that's booked out on their shoot's day → one quiet record.
import { beforeEach, describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'farrell@example.com', ANA = 'ana@example.com', BEN = 'ben@example.com'
const DEMO = 'dee@example.com', ADMIN = 'sam@example.com'
const prop = (name: string, x: Record<string, unknown> = {}) => ({ name, collection: 'company', categoryId: 'prop', quantity: 1, condition: 'good', tags: [], photos: [], ...x })
const idFor = (item: string, day: string, email: string) => `prop_wants/${item}_${day}_${createHash('sha1').update(email).digest('hex').slice(0, 16)}`

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put(`users/${BEN}`, { email: BEN, role: 'creator', active: true, name: 'Ben' })
  await put(`users/${DEMO}`, { email: DEMO, role: 'creator', active: true, name: 'Dee', access: 'props' })
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
})

describe('noteWanted', () => {
  it('writes one record per prop, day and person, and never twice', async () => {
    await put('items/lamp', prop('Brass lamp', { quantity: 2 }))
    const day = addDays(todayInStudio(), 6)
    const first = await call('noteWanted', { itemId: 'lamp', day }, ANA)
    expect(first.ok, first.message).toBe(true)
    expect(first.result).toEqual({ noted: true })
    const rec = await getDoc(idFor('lamp', day, ANA))
    expect(rec).toMatchObject({ itemId: 'lamp', day, email: ANA, quantity: 2 })
    expect(typeof rec?.at).toBe('string')

    // Opening the page again: nothing new.
    expect((await call('noteWanted', { itemId: 'lamp', day }, ANA)).result).toEqual({ noted: false })
    // Someone else, or another day, counts separately. The owner (filming as a creator) too.
    expect((await call('noteWanted', { itemId: 'lamp', day }, BEN)).result).toEqual({ noted: true })
    expect((await call('noteWanted', { itemId: 'lamp', day: addDays(day, 1) }, ANA)).result).toEqual({ noted: true })
    expect((await call('noteWanted', { itemId: 'lamp', day }, OWNER)).result).toEqual({ noted: true })
  })

  it("doesn't count when it's booked out by their own request for that day (they got it)", async () => {
    await put('items/lamp', prop('Brass lamp'))
    const day = addDays(todayInStudio(), 4)
    const r = (id: string, who: string, status: string) => put(`reservations/${id}`, { creatorEmail: who, status, startDate: day, endDate: day, itemIds: ['lamp'], lines: [{ itemId: 'lamp', itemName: 'Brass lamp', qty: 1 }] })
    await r('mine', ANA, 'requested')
    await r('old', BEN, 'cancelled')
    expect((await call('noteWanted', { itemId: 'lamp', day }, ANA)).result).toEqual({ noted: false })
    expect(await getDoc(idFor('lamp', day, ANA))).toBeNull()
    expect((await call('noteWanted', { itemId: 'lamp', day }, BEN)).result).toEqual({ noted: true })   // his was cancelled
  })

  it('only counts Prime Capitol props that can be booked, on a real upcoming day, for people who book', async () => {
    await put('items/lamp', prop('Brass lamp'))
    await put('items/mine', prop('Grandma lamp', { collection: 'personal' }))
    await put('items/gone', prop('Old lamp', { archived: true }))
    await put('items/merged', prop('Lamp copy', { mergedInto: 'lamp' }))
    const day = addDays(todayInStudio(), 3)
    for (const itemId of ['mine', 'gone', 'merged', 'nope']) expect((await call('noteWanted', { itemId, day }, ANA)).error).toBe('NOT_FOUND')
    expect((await call('noteWanted', { itemId: 'a/b', day }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('noteWanted', { itemId: 'lamp', day: 'soon' }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('noteWanted', { itemId: 'lamp', day: addDays(todayInStudio(), -2) }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('noteWanted', { itemId: 'lamp', day: addDays(todayInStudio(), 500) }, ANA)).error).toBe('INVALID_ARGUMENT')
    // Props-only creators, staff and strangers don't book, so they never count.
    for (const who of [DEMO, ARTS, ADMIN, 'stranger@example.com']) expect((await call('noteWanted', { itemId: 'lamp', day }, who)).error).toBe('PERMISSION_DENIED')
    expect(await getDoc(idFor('lamp', day, DEMO))).toBeNull()
  })
})
