// Duplicate finder (after the import): free look-alike pairs, AI photo check, merge.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor, exists } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'dup-arts@example.com', CREATOR = 'dup-creator@example.com'
const PHOTO = 'http://127.0.0.1:8080/'   // anything the server can download, for the fake AI
const prop = (name: string, extra: Record<string, unknown> = {}) =>
  ({ collection: 'company', name, quantity: 1, condition: 'good', tags: [], photos: [`${PHOTO}?${Math.random()}`], description: 'Blue police uniform', ...extra })

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true })
  await put('items/cop1', prop('Police Costume', { importedFrom: { driveFileId: 'f1', fileName: 'a.jpg', folder: 'x' } }))
  await put('items/cop2', prop('Police Costume', { importedFrom: { driveFileId: 'f2', fileName: 'b.jpg', folder: 'x' } }))
  await put('items/lamp', prop('Brass Lamp', { description: 'Old lamp' }))
  for (const id of ['cop1', 'cop2', 'lamp']) expect(await waitFor(() => exists(`item_vectors/${id}`))).toBe(true)
})

describe('finding duplicates', () => {
  it('pairs up look-alikes and skips ones marked "not duplicates"', async () => {
    const r = await call('findDuplicates', {}, ARTS)
    expect(r.result.pairs).toHaveLength(1)
    expect([r.result.pairs[0].a, r.result.pairs[0].b].sort()).toEqual(['cop1', 'cop2'])
    expect(r.result.pairs[0].score).toBeGreaterThan(0.99)

    await put('health/dismissed', { duplicatePairs: ['cop1|cop2'] })
    expect((await call('findDuplicates', {}, ARTS)).result.pairs).toHaveLength(0)
  })
  it('the AI can compare the two photos', async () => {
    const r = await call('comparePropPhotos', { a: 'cop1', b: 'cop2' }, ARTS)
    expect(r.result).toMatchObject({ same: true })
    expect((await getDoc('app_settings/import'))!.spentUsd).toBeCloseTo(0.001, 5)
  })
})

describe('merging a pair', () => {
  it('creators cannot merge; the arts department can', async () => {
    expect((await call('mergeProps', { keepId: 'cop1', removeId: 'cop2' }, CREATOR)).error).toBe('PERMISSION_DENIED')
    const r = await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'copies' }, ARTS)
    expect(r.result.removed).toBe('deleted')
  })
  it('identical copies: quantities add up, photos combine, the imported duplicate is deleted', async () => {
    await put('import_items/f2', { fileId: 'f2', itemId: 'cop2', status: 'approved', jobId: 'j' })
    const r = await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'copies' }, OWNER)
    expect(r.result.removed).toBe('deleted')
    const keep = (await getDoc('items/cop1'))!
    expect(keep.quantity).toBe(2)
    expect(keep.photos).toHaveLength(2)
    expect(await getDoc('items/cop2')).toBeNull()
    expect((await getDoc('import_items/f2'))!.itemId).toBe('cop1')   // re-importing won't bring it back
  })
  it('more angles: quantity stays, photos combine', async () => {
    await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'angles' }, OWNER)
    expect((await getDoc('items/cop1'))!).toMatchObject({ quantity: 1 })
  })
  it('props added by hand are archived, not deleted', async () => {
    const r = await call('mergeProps', { keepId: 'cop1', removeId: 'lamp', mode: 'copies' }, OWNER)
    expect(r.result.removed).toBe('archived')
    expect((await getDoc('items/lamp'))!).toMatchObject({ archived: true, mergedInto: 'cop1' })
  })
  it('a prop in a current booking is not merged away', async () => {
    await put('item_bookings/cop2', { entries: [{ reservationId: 'r1', start: '2026-10-20', end: '2026-10-20', qty: 1 }] })
    expect((await call('mergeProps', { keepId: 'cop1', removeId: 'cop2' }, OWNER)).error).toBe('FAILED_PRECONDITION')
  })
})
