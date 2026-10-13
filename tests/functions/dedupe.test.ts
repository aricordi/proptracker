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

describe('merging look-alike bins', () => {
  it('moves every prop into the kept bin and removes the others', async () => {
    await put('bins/b1', { label: 'B.31', locationId: 'imported', qrSlug: 'b1' })
    await put('bins/b2', { label: 'B:31', locationId: 'imported', qrSlug: 'b2' })
    await put('bins/b3', { label: 'B: 31', locationId: 'garage', qrSlug: 'b3' })
    await put('items/cop1', prop('Police Costume', { binId: 'b2', locationId: 'imported' }))
    await put('items/lamp', prop('Brass Lamp', { binId: 'b3', locationId: 'garage' }))

    expect((await call('mergeBins', { keepId: 'b1', removeIds: ['b2', 'b3'] }, CREATOR)).error).toBe('PERMISSION_DENIED')
    const r = await call('mergeBins', { keepId: 'b1', removeIds: ['b2', 'b3'] }, ARTS)
    expect(r.result).toEqual({ moved: 2, removed: 2 })
    expect((await getDoc('items/cop1'))).toMatchObject({ binId: 'b1', locationId: 'imported', updatedBy: ARTS })
    expect((await getDoc('items/lamp'))).toMatchObject({ binId: 'b1', locationId: 'imported', name: 'Brass Lamp' })
    expect(await exists('bins/b2')).toBe(false)
    expect(await exists('bins/b3')).toBe(false)
    expect(await exists('bins/b1')).toBe(true)
  })
})

describe('duplicates in different bins', () => {
  it('after moving them together, the kept prop gets the chosen bin', async () => {
    await put('bins/b1', { label: 'B.31', locationId: 'room1', qrSlug: 'b1' })
    await put('bins/b2', { label: 'C.4', locationId: 'room2', qrSlug: 'b2' })
    await put('bins/b9', { label: 'Z.9', locationId: 'room9', qrSlug: 'b9' })
    await put('items/cop1', prop('Police Costume', { binId: 'b1', locationId: 'room1', importedFrom: { driveFileId: 'f1', fileName: 'a.jpg', folder: 'x' } }))
    await put('items/cop2', prop('Police Costume', { binId: 'b2', locationId: 'room2', importedFrom: { driveFileId: 'f2', fileName: 'b.jpg', folder: 'x' } }))

    expect((await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'copies', binId: 'b9' }, ARTS)).error).toBe('INVALID_ARGUMENT')
    const r = await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'copies', binId: 'b2' }, ARTS)
    expect(r.result.removed).toBe('deleted')
    expect(await getDoc('items/cop1')).toMatchObject({ quantity: 2, binId: 'b2', locationId: 'room2' })
  })
})

describe('three copies in three bins', () => {
  it('merging them one by one (the one in the chosen bin first) ends with one prop in that bin', async () => {
    for (const [id, bin] of [['b1', 'B.31'], ['b2', 'C.4'], ['b3', 'D.2']]) await put(`bins/${id}`, { label: bin, locationId: `room-${id}`, qrSlug: id })
    const imp = (f: string) => ({ importedFrom: { driveFileId: f, fileName: `${f}.jpg`, folder: 'x' } })
    await put('items/cop1', prop('Police Costume', { binId: 'b1', ...imp('f1') }))
    await put('items/cop2', prop('Police Costume', { binId: 'b2', ...imp('f2') }))
    await put('items/cop3', prop('Police Costume', { binId: 'b3', ...imp('f3') }))
    // Keep cop1; everything ends up in D.2 (cop3's bin), so cop3 is merged first.
    expect((await call('mergeProps', { keepId: 'cop1', removeId: 'cop3', mode: 'copies', binId: 'b3' }, ARTS)).error).toBeUndefined()
    expect((await call('mergeProps', { keepId: 'cop1', removeId: 'cop2', mode: 'copies', binId: 'b3' }, ARTS)).error).toBeUndefined()
    expect(await getDoc('items/cop1')).toMatchObject({ quantity: 3, binId: 'b3', locationId: 'room-b3' })
    expect(await exists('items/cop2')).toBe(false)
    expect(await exists('items/cop3')).toBe(false)
  })
})
