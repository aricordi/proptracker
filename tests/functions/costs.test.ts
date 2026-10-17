// Owner's running-costs report and the photo clean-up (on the test database).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ANA = 'ana@example.com'
const BUCKET = 'demo-proptracker.appspot.com'
const upload = (name: string) => fetch(`http://127.0.0.1:9199/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
  { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'image/jpeg' }, body: 'x'.repeat(100) })
const exists = async (name: string) => (await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(name)}`, { headers: { Authorization: 'Bearer owner' } })).ok

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
})

describe('running costs', () => {
  it('owner only; counts stored photos by folder; a fresh clean-up keeps everything new or in use', async () => {
    await upload('items/u1/used.jpg'); await upload('items/u1/new-unused.jpg'); await upload('reservation-photos/r1/pack/p.jpg')
    await put('items/chair', { name: 'Chair', collection: 'company', photos: [`http://127.0.0.1:9199/v0/b/${BUCKET}/o/items%2Fu1%2Fused.jpg?alt=media`] })
    expect((await call('costReport', {}, ANA)).error).toBe('PERMISSION_DENIED')
    const r = await call('costReport', {}, OWNER)
    expect(r.ok).toBe(true)
    expect(r.result.storage.byFolder.items.files).toBeGreaterThanOrEqual(2)
    expect(r.result.cleanup.wouldRemove).toBe(0)
    const c = await call('cleanUpPhotos', {}, OWNER)
    expect(c.result.removed).toBe(0)
    expect(await exists('items/u1/used.jpg')).toBe(true)
    expect(await exists('items/u1/new-unused.jpg')).toBe(true)
  })
})
