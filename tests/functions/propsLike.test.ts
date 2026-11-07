// "More like this" on the prop page (owner, Nov 7): similar props + booked together for everyone, and the duplicate check
// for the arts department.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, exists, waitFor, clearDatabase } from './helpers'
import { todayInStudio, addDays } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'farrell@example.com', ANA = 'ana@example.com', DEMO = 'dee@example.com'
const BUCKET = 'demo-proptracker.appspot.com'
const upload = (name: string, body: string) => fetch(`http://127.0.0.1:9199/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
  { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'image/jpeg' }, body })
const link = (p: string) => `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(p)}?alt=media`
const prop = (name: string, x: Record<string, unknown> = {}) => ({ name, collection: 'company', categoryId: 'costume', quantity: 1, condition: 'good', tags: [], photos: [], ...x })
const ids = (list: { id: string }[]) => list.map(x => x.id)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana', access: 'full' })
  await put(`users/${DEMO}`, { email: DEMO, role: 'creator', active: true, name: 'Dee', access: 'props' })
})

describe('similar props and booked together', () => {
  it('everyone (Props-only too) gets look-alikes and props asked for in the same requests; never personal or archived ones', async () => {
    await put('items/cop', prop('Police uniform with badge'))
    await put('items/hat', prop('Police hat with badge'))
    await put('items/lamp', prop('Brass desk lamp', { categoryId: 'prop' }))
    await put('items/cup', prop('Coffee cup', { categoryId: 'prop' }))
    await put('items/mine', prop('Police cap with badge', { collection: 'personal' }))
    await put('items/gone', prop('Police vest with badge', { archived: true }))
    for (const id of ['cop', 'hat', 'mine', 'gone']) expect(await waitFor(() => exists(`item_vectors/${id}`))).toBe(true)
    const day = addDays(todayInStudio(), 5)
    const r = (id: string, itemIds: string[], status = 'requested') => put(`reservations/${id}`, { creatorEmail: ANA, status, startDate: day, endDate: day, itemIds, lines: itemIds.map(i => ({ itemId: i, itemName: i, qty: 1 })) })
    await r('r1', ['cop', 'lamp'])
    await r('r2', ['cop', 'lamp', 'cup'], 'returned')
    await r('r3', ['cop', 'cup'], 'cancelled')        // cancelled: doesn't count
    await r('r4', ['cop', 'gone'])                    // archived prop: never suggested

    const res = await call('propsLike', { id: 'cop' }, ANA)
    expect(res.ok, res.message).toBe(true)
    expect(res.result.together).toEqual([{ id: 'lamp', times: 2 }, { id: 'cup', times: 1 }])
    expect(ids(res.result.similar)).toContain('hat')
    expect(ids(res.result.similar)).not.toContain('mine')
    expect(ids(res.result.similar)).not.toContain('gone')
    expect(ids(res.result.similar)).not.toContain('cop')
    expect(res.result.indexed).toBe(true)

    expect((await call('propsLike', { id: 'cop' }, DEMO)).ok).toBe(true)                 // Props-only creators too
    expect((await call('propsLike', { id: 'mine' }, ANA)).error).toBe('NOT_FOUND')       // someone else's personal prop
    expect(ids((await call('propsLike', { id: 'mine' }, OWNER)).result.similar)).not.toContain('cop')   // personal → personal only
    expect((await call('propsLike', { id: 'a/b' }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('propsLike', { id: 'cop' }, 'stranger@example.com')).error).toBe('PERMISSION_DENIED')
  })
})

describe('duplicates of one prop', () => {
  it('finds the same picture, look-alikes and names for this prop only; arts + owner', async () => {
    const tag = Math.random().toString(36).slice(2, 8)
    await upload(`items/t/${tag}-a.jpg`, `same picture ${tag}`)
    await upload(`items/t/${tag}-b.jpg`, `same picture ${tag}`)
    await put('items/a', prop('Red rotary telephone', { photos: [link(`items/t/${tag}-a.jpg`)], binId: 'b1' }))
    await put('items/b', prop('Telephone', { photos: [link(`items/t/${tag}-b.jpg`)] }))
    await put('items/c', prop('Red rotary telephones', { binId: 'b1' }))
    await put('items/d', prop('Cane'))
    await put('items/e', prop('Red rotary telephone', { binId: 'b1', archived: true }))
    await put('items/f', prop('Rotary telephone red', { binId: 'b1' }))
    await put('health/dismissed', { duplicatePairs: ['a|f'] })
    expect(await waitFor(() => exists('item_vectors/a'))).toBe(true)
    expect((await call('doublesOf', { id: 'a' }, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('doublesOf', { id: 'a' }, ARTS)
    expect(r.ok, r.message).toBe(true)
    const pairs = r.result.pairs as { id: string; tier: string; signals: { photo?: boolean; bin?: boolean } }[]
    expect(pairs.find(p => p.id === 'b')).toMatchObject({ tier: 'sure', signals: { photo: true } })
    expect(pairs.find(p => p.id === 'c')).toMatchObject({ tier: 'likely', signals: { bin: true } })
    expect(ids(pairs)).not.toContain('d')
    expect(ids(pairs)).not.toContain('e')            // removed / archived
    expect(ids(pairs)).not.toContain('f')            // someone said "not the same"
    expect(ids(r.result.near)).not.toContain('f')
    expect(ids(pairs)[0]).toBe('b')                  // same picture first
  })
})
