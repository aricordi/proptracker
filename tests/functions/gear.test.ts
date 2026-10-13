// Gear: the equipment team's list of pieces, and bundles built from it.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', GEAR = 'gear-team@example.com', ARTS = 'gear-arts@example.com', CREATOR = 'gear-creator@example.com'

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true })
})

describe('gear pieces', () => {
  it('only the owner and the equipment team manage gear', async () => {
    for (const who of [ARTS, CREATOR]) expect((await call('saveGearItem', { name: 'Battery', category: 'Power', have: 2 }, who)).error).toBe('PERMISSION_DENIED')
    const r = await call('saveGearItem', { name: '  NP-FZ100 battery ', category: 'Power', have: 6, value: 79 }, GEAR)
    expect(await getDoc(`gear_items/${r.result.id}`)).toMatchObject({ name: 'NP-FZ100 battery', category: 'Power', have: 6, value: 79, archived: false, createdBy: GEAR })
    expect((await call('saveGearItem', { name: 'Thing', category: 'Nonsense', have: 1 }, OWNER)).ok).toBe(true)
  })
  it('a serial number means one of it', async () => {
    const r = await call('saveGearItem', { name: 'Sony FX3', category: 'Camera', have: 5, serial: 'FX3-001' }, GEAR)
    expect(await getDoc(`gear_items/${r.result.id}`)).toMatchObject({ have: 1, serial: 'FX3-001' })
  })
  it('refuses bad input', async () => {
    expect((await call('saveGearItem', { name: '', have: 1 }, GEAR)).error).toBe('INVALID_ARGUMENT')
    expect((await call('saveGearItem', { name: 'X', have: -1 }, GEAR)).error).toBe('INVALID_ARGUMENT')
    expect((await call('saveGearItem', { name: 'X', have: 1.5 }, GEAR)).error).toBe('INVALID_ARGUMENT')
    expect((await call('saveGearItem', { id: 'missing', name: 'X', have: 1 }, GEAR)).error).toBe('NOT_FOUND')
  })
})

describe('bundles', () => {
  beforeEach(async () => {
    await put('gear_items/cam', { name: 'Sony FX3 body', category: 'Camera', have: 1, archived: false })
    await put('gear_items/bat', { name: 'NP-FZ100 battery', category: 'Power', have: 4, archived: false })
  })

  it('builds a bundle from free pieces; a piece can only be in one bundle', async () => {
    expect((await call('saveGearBundle', { name: 'FX3', pieces: [{ itemId: 'cam', qty: 1 }] }, CREATOR)).error).toBe('PERMISSION_DENIED')
    const r = await call('saveGearBundle', { name: 'FX3 Bundle', category: 'Camera', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 2 }, { itemId: 'bat', qty: 1 }] }, GEAR)
    expect(await getDoc(`gear_bundles/${r.result.id}`)).toMatchObject({ name: 'FX3 Bundle', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 3 }], archived: false })

    // The camera is taken; only 1 battery is still free.
    const second = await call('saveGearBundle', { name: 'Second', pieces: [{ itemId: 'cam', qty: 1 }] }, GEAR)
    expect(second.error).toBe('FAILED_PRECONDITION')
    expect(second.message).toMatch(/Only 0 "Sony FX3 body"/)
    expect((await call('saveGearBundle', { name: 'Spare', pieces: [{ itemId: 'bat', qty: 2 }] }, GEAR)).error).toBe('FAILED_PRECONDITION')
    expect((await call('saveGearBundle', { name: 'Spare', pieces: [{ itemId: 'bat', qty: 1 }] }, GEAR)).ok).toBe(true)

    // Editing the first bundle can keep its own pieces.
    expect((await call('saveGearBundle', { id: r.result.id, name: 'FX3 Bundle v2', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 3 }] }, GEAR)).ok).toBe(true)
    expect((await call('saveGearBundle', { name: 'Empty', pieces: [] }, GEAR)).error).toBe('FAILED_PRECONDITION')
  })

  it("can't lower or archive a piece that's in a bundle; archiving a bundle frees its pieces", async () => {
    const r = await call('saveGearBundle', { name: 'FX3 Bundle', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 3 }] }, GEAR)
    expect((await call('saveGearItem', { id: 'bat', name: 'NP-FZ100 battery', category: 'Power', have: 2 }, GEAR)).error).toBe('FAILED_PRECONDITION')
    expect((await call('saveGearItem', { id: 'cam', name: 'Sony FX3 body', category: 'Camera', have: 1, archived: true }, GEAR)).error).toBe('FAILED_PRECONDITION')

    expect((await call('setGearBundleArchived', { id: r.result.id, archived: true }, GEAR)).ok).toBe(true)
    expect((await call('saveGearBundle', { name: 'New FX3', pieces: [{ itemId: 'cam', qty: 1 }] }, GEAR)).ok).toBe(true)
    // The old bundle can't come back now: its camera is in the new one.
    const back = await call('setGearBundleArchived', { id: r.result.id, archived: false }, GEAR)
    expect(back.error).toBe('FAILED_PRECONDITION')
    expect(back.message).toMatch(/Can't bring it back/)
  })
})
