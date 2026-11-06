// Clean-up doubles (owner, Nov 6): one list of pairs from every clue; the AI checks pairs and suggests names (test mode here).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'farrell@example.com', ANA = 'ana@example.com'
const BUCKET = 'demo-proptracker.appspot.com'
const upload = (name: string, body: string) => fetch(`http://127.0.0.1:9199/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
  { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'image/jpeg' }, body })
const link = (p: string) => `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(p)}?alt=media`
const prop = (name: string, photo: string | null, x: Record<string, unknown> = {}) => ({ name, collection: 'company', quantity: 1, condition: 'good', tags: [], photos: photo ? [link(photo)] : [], ...x })

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
})

describe('find doubles', () => {
  it('merges the clues: same picture first, then same name in the same bin; removed props and "not the same" pairs left out', async () => {
    const tag = Math.random().toString(36).slice(2, 8)
    await upload(`items/t/${tag}-a.jpg`, `same picture ${tag}`)
    await upload(`items/t/${tag}-b.jpg`, `same picture ${tag}`)
    await upload(`items/t/${tag}-c.jpg`, `third picture ${tag}`)
    await put('items/p1', prop('Telephone', `items/t/${tag}-a.jpg`))
    await put('items/p2', prop('Red phone', `items/t/${tag}-b.jpg`))
    await put('items/p3', prop('Brass lamp', null, { binId: 'b1' }))
    await put('items/p4', prop('Brass lamps', null, { binId: 'b1' }))
    await put('items/p5', prop('Brass lamp', null, { binId: 'b1', archived: true, removedAt: '2026-11-06T00:00:00Z' }))
    await put('items/p6', prop('Cane', `items/t/${tag}-c.jpg`, { binId: 'b2' }))
    await put('items/p7', prop('Cane', null, { binId: 'b2' }))
    await put('health/dismissed', { duplicatePairs: ['p6|p7'] })
    expect((await call('findDoubles', {}, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('findDoubles', {}, ARTS)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.pairs.map((p: { a: string; b: string; tier: string }) => `${p.a}|${p.b}:${p.tier}`)).toEqual(['p1|p2:sure', 'p3|p4:likely'])
  })
})

describe('AI help (test mode)', () => {
  it('checks pairs once (the answer is kept), and suggests names; arts + owner only', async () => {
    await put('items/a', prop('Brass lamp', null))
    await put('items/b', prop('brass lamp', null))
    await put('items/c', prop('Cop hat', null))
    expect((await call('aiCheckPairs', { pairs: [{ a: 'a', b: 'b' }] }, ANA)).error).toBe('PERMISSION_DENIED')
    // No photo: no AI opinion for that pair (and nothing is kept).
    const none = await call('aiCheckPairs', { pairs: [{ a: 'a', b: 'b' }] }, ARTS)
    expect(none.ok, none.message).toBe(true)
    expect(none.result.verdicts).toEqual({})
    // A kept answer is returned without asking the AI again.
    await put('dup_verdicts/a__c', { key: 'a|c', same: false, confidence: 'high', reason: 'A lamp and a hat.' })
    const cached = await call('aiCheckPairs', { pairs: [{ a: 'c', b: 'a' }] }, ARTS)
    expect(cached.result.verdicts['a|c']).toMatchObject({ same: false, confidence: 'high' })
    await put('items/odd', prop('IMG_2034', null, { description: 'red rotary telephone with a coiled cord' }))
    const n = await call('suggestPropNames', { ids: ['odd', 'gone'] }, ARTS)
    expect(n.ok, n.message).toBe(true)
    expect(n.result.names.odd).toBeTruthy()
    expect(n.result.names.gone).toBeUndefined()
    expect((await getDoc('items/odd'))!.name).toBe('IMG_2034')   // only a suggestion: nothing renamed
    const usage = await getDoc(`ai_usage/${new Date().toLocaleString('sv-SE', { timeZone: 'America/Toronto' }).slice(0, 7)}`)
    expect(usage?.by?.['cleanup-names']).toBe(2)
    expect((await call('suggestPropNames', { ids: ['odd'] }, OWNER)).ok).toBe(true)
  })
})

describe('combining the same prop photographed twice', () => {
  it('keeps the higher count', async () => {
    await put('items/k', prop('Wine glass', null, { quantity: 1 }))
    await put('items/r', prop('Wine glass', null, { quantity: 3 }))
    const m = await call('mergeProps', { keepId: 'k', removeId: 'r', mode: 'angles' }, ARTS)
    expect(m.ok, m.message).toBe(true)
    expect((await getDoc('items/k'))!.quantity).toBe(3)
  })
})
