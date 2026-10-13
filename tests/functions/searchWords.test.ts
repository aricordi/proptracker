// "Improve search words": AI top-up of hidden search words for existing props.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'words-arts@example.com'

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
  await put('items/mask', { collection: 'company', name: 'Lincoln Mask', tags: [], photos: [], searchWords: ['beard'] })
  await put('items/old', { collection: 'company', name: 'Old Hat', tags: [], archived: true })
  await put('items/done', { collection: 'company', name: 'Chair', tags: [], searchWordsAt: '2026-10-01T00:00:00Z' })
})

describe('improving search words', () => {
  it('only the owner can run it', async () => {
    expect((await call('improveSearchWords', { countOnly: true }, ARTS)).error).toBe('PERMISSION_DENIED')
  })
  it('counts, then adds words to props that need them (keeping their old ones), within the cost cap', async () => {
    const count = await call('improveSearchWords', { countOnly: true }, OWNER)
    expect(count.result).toMatchObject({ total: 2, remaining: 1 })   // archived skipped, "done" already has words

    const r = await call('improveSearchWords', {}, OWNER)
    expect(r.result).toMatchObject({ processed: 1, failed: 0, remaining: 0, capped: false })
    const mask = (await getDoc('items/mask'))!
    expect(mask.searchWords).toEqual(expect.arrayContaining(['beard', 'sample word', 'lincoln']))
    expect(mask.searchWordsAt).toBeTruthy()
    expect(mask.name).toBe('Lincoln Mask')
    expect((await getDoc('app_settings/import'))!.spentUsd).toBeCloseTo(0.002, 5)
    expect((await getDoc('items/old'))!.searchWords).toBeUndefined()
  })
  it('stops at the spending cap', async () => {
    await put('app_settings/import', { capUsd: 0.001, spentUsd: 0 })
    expect((await call('improveSearchWords', {}, OWNER)).error).toBe('RESOURCE_EXHAUSTED')
    expect((await getDoc('items/mask'))!.searchWordsAt).toBeUndefined()
  })
})
