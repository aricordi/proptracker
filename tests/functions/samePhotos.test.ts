// Clean-up tools (owner, Nov 6): "Same photo twice" finds props whose photos are the very same file.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'farrell@example.com', ANA = 'ana@example.com'
const BUCKET = 'demo-proptracker.appspot.com'
const upload = (name: string, body: string) => fetch(`http://127.0.0.1:9199/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
  { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'image/jpeg' }, body })
const link = (p: string) => `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(p)}?alt=media`
const prop = (name: string, photo: string, x: Record<string, unknown> = {}) => ({ name, collection: 'company', quantity: 1, condition: 'good', tags: [], photos: [link(photo)], ...x })

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
})

describe('same photo twice', () => {
  it('groups props with the very same picture; skips removed props and groups marked "not the same"; arts + owner only', async () => {
    const tag = Math.random().toString(36).slice(2, 8)
    await upload(`items/t/${tag}-a.jpg`, `same picture ${tag}`)
    await upload(`items/t/${tag}-b.jpg`, `same picture ${tag}`)
    await upload(`items/t/${tag}-c.jpg`, `another picture ${tag}`)
    await upload(`items/t/${tag}-d.jpg`, `third picture ${tag}`)
    await upload(`items/t/${tag}-e.jpg`, `third picture ${tag}`)
    await put('items/p1', prop('Red phone', `items/t/${tag}-a.jpg`))
    await put('items/p2', prop('Red phone (2)', `items/t/${tag}-b.jpg`))
    await put('items/p3', prop('Lamp', `items/t/${tag}-c.jpg`))
    await put('items/p4', prop('Hat', `items/t/${tag}-d.jpg`))
    await put('items/p5', prop('Hat again', `items/t/${tag}-e.jpg`, { archived: true, removedAt: '2026-11-06T00:00:00Z' }))
    await put('items/p6', prop('Cane', `items/t/${tag}-d.jpg`))
    await put('health/dismissed', { duplicatePairs: ['p4|p6'] })
    expect((await call('findSamePhotos', {}, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('findSamePhotos', {}, ARTS)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.groups.map((g: { ids: string[] }) => [...g.ids].sort())).toEqual([['p1', 'p2']])
    expect((await call('findSamePhotos', {}, OWNER)).ok).toBe(true)
  })
})
