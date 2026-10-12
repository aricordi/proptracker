// Calls the real server functions running in the local emulator, in fake-AI
// mode (no Gemini key, no cost). Checks both that they work and who may use them.
import { beforeAll, describe, it, expect } from 'vitest'

import { put, exists, call, waitFor, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'fn-arts@example.com', CREATOR = 'fn-creator@example.com'

beforeAll(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true })
  await put('categories/costume', { label: 'Costume', order: 1, active: true })
  await put('tags/t1', { label: 'police', normalizedKey: 'police', usageCount: 1 })
  await put('items/cop', { name: 'Police officer costume', categoryId: 'costume', tags: ['t1'], description: 'Navy uniform with badge' })
  await put('items/chair', { name: 'Wooden dining chair', categoryId: 'prop', tags: [], description: 'Oak chair' })
  await put('items/lamp', { name: 'Brass desk lamp', categoryId: 'prop', tags: [], description: 'Green shade' })
  expect(await waitFor(() => exists('item_vectors/lamp'))).toBe(true)
}, 30000)

describe('smart search', () => {
  it('new and edited props are indexed automatically', async () => {
    await put('items/phone', { name: 'Rotary telephone', categoryId: 'prop', tags: [] })
    expect(await waitFor(() => exists('item_vectors/phone'))).toBe(true)
  })
  it('creators can search and the closest prop comes first', async () => {
    const { ok, result } = await call('searchSimilar', { query: 'police uniform badge' }, CREATOR)
    expect(ok).toBe(true)
    expect(result.results[0].id).toBe('cop')
  })
  it('uninvited and signed-out people are refused', async () => {
    expect((await call('searchSimilar', { query: 'police' }, 'stranger@example.com')).error).toBe('PERMISSION_DENIED')
    expect((await call('searchSimilar', { query: 'police' })).error).toBe('PERMISSION_DENIED')
  })
})

describe('AI fill-in from a photo', () => {
  const photo = { imageBase64: Buffer.from('fake image').toString('base64'), mimeType: 'image/jpeg' }
  it('arts department gets name, category, tags and description', async () => {
    const { ok, result } = await call('analyzePropPhoto', photo, ARTS)
    expect(ok).toBe(true)
    expect(result.name).toBeTruthy()
    expect(result.categoryId).toBe('costume') // picked from the real category list
    expect(result.tags.length).toBeGreaterThan(0)
    expect(result.description).toBeTruthy()
  })
  it('creators cannot use it', async () => {
    expect((await call('analyzePropPhoto', photo, CREATOR)).error).toBe('PERMISSION_DENIED')
  })
  it('rejects things that are not images', async () => {
    expect((await call('analyzePropPhoto', { ...photo, mimeType: 'text/plain' }, ARTS)).error).toBe('INVALID_ARGUMENT')
  })
})

describe('rebuild smart search', () => {
  it('only the owner can run it', async () => {
    expect((await call('rebuildSearchIndex', null, ARTS)).error).toBe('PERMISSION_DENIED')
  })
  it('skips props that are already up to date', async () => {
    const { ok, result } = await call('rebuildSearchIndex', null, OWNER)
    expect(ok).toBe(true)
    expect(result.failed).toBe(0)
    expect(result.unchanged).toBe(result.total)
  })
})
