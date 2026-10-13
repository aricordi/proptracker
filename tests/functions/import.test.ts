// Batch import (Phase 6) against pretend Drive folders ("test:N") and the fake AI.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'import-arts@example.com', ALEX = 'alex@example.com'

async function runToEnd(jobId: string) {
  let r
  for (let i = 0; i < 20; i++) {
    r = await call('processImport', { jobId }, OWNER)
    expect(r.ok).toBe(true)
    if (r.result.capped || r.result.counts.pending === 0) break
  }
  return r!.result
}

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Sam' })
  await put(`users/${ALEX}`, { email: ALEX, role: 'creator', active: true, name: 'Alex' })
  await put('categories/prop', { label: 'Prop', active: true, order: 0 })
  await put('locations/loc-main', { name: 'Main prop room' })
  await put('bins/b1', { label: 'A1', locationId: 'loc-main', qrSlug: 'b1' })
})

describe('batch import', () => {
  it('only the owner can start or run an import', async () => {
    expect((await call('startImport', { links: ['test:3'], dryRun: true }, ARTS)).error).toBe('PERMISSION_DENIED')
    expect((await call('startImport', { links: ['test:3'], dryRun: true }, ALEX)).error).toBe('PERMISSION_DENIED')
    expect((await call('importInfo', {}, ARTS)).result.serviceAccount).toMatch(/@/)
  })

  it('rejects links that are not Drive folders', async () => {
    const r = await call('startImport', { links: ['https://example.com/nope'] }, OWNER)
    expect(r.error).toBe('INVALID_ARGUMENT')
  })

  it('dry run does 10, then the full run picks up only the rest', async () => {
    const dry = await call('startImport', { links: ['test:15'], dryRun: true }, OWNER)
    expect(dry.result).toMatchObject({ queued: 10, alreadyImported: 0, found: 15 })
    const done = await runToEnd(dry.result.jobId)
    expect(done.counts).toMatchObject({ pending: 0, analyzed: 10, failed: 0 })
    expect(done.spentUsd).toBeCloseTo(0.02, 5)   // fake AI: $0.002 a photo

    const item = (await getDoc('import_items/test0001x15'))!
    expect(item.status).toBe('analyzed')
    expect(item.photoUrl).toMatch(/items%2Fimported%2Ftest0001x15\.jpg/)
    expect(item.suggestion).toMatchObject({ categoryId: 'prop', tags: ['test', 'imported'] })

    const full = await call('startImport', { links: ['test:15'] }, OWNER)
    expect(full.result).toMatchObject({ queued: 5, alreadyImported: 10 })
    const again = await call('startImport', { links: ['test:15'] }, OWNER)
    expect(again.result).toMatchObject({ queued: 0, jobId: null })
  })

  it('approving creates real props, tags and bins; approving twice changes nothing', async () => {
    const { result } = await call('startImport', { links: ['test:4'], dryRun: true }, OWNER)
    await runToEnd(result.jobId)
    const r = await call('approveImports', { items: [
      { id: 'test0001x4', name: 'Red Rotary Phone', tags: ['phone', 'Phones', 'vintage'], quantity: 2, newBinLabel: 'bin a1' },
      { id: 'test0002x4', newBinLabel: 'C7' },
      { id: 'test0003x4', binId: null },
    ] }, ARTS)
    expect(r.result.results.every((x: { itemId?: string }) => x.itemId)).toBe(true)

    const [a, b, c] = await Promise.all(r.result.results.map((x: { itemId: string }) => getDoc(`items/${x.itemId}`)))
    expect(a).toMatchObject({ name: 'Red Rotary Phone', quantity: 2, binId: 'b1', locationId: 'loc-main', createdBy: ARTS, condition: 'good', archived: false })
    expect(a!.tags).toHaveLength(2)   // "phone" and "Phones" are one tag
    expect(a!.photos[0]).toMatch(/test0001x4/)
    expect(b!.locationId).toBe('imported')       // new bin from the sign, in "Imported – needs sorting"
    expect((await getDoc(`bins/${b!.binId}`))!.label).toBe('C7')
    expect((await getDoc('locations/imported'))!.name).toMatch(/Imported/)
    expect(c!.binId).toBeUndefined()

    const twice = await call('approveImports', { items: [{ id: 'test0001x4' }] }, ARTS)
    expect(twice.result.results[0].itemId).toBe(r.result.results[0].itemId)

    expect((await call('skipImports', { ids: ['test0004x4'] }, ARTS)).result.skipped).toBe(1)
    expect((await getDoc(`import_jobs/${result.jobId}`))!.counts).toMatchObject({ analyzed: 0, approved: 3, skipped: 1 })
    expect((await call('approveImports', { items: [{ id: 'test0004x4' }] }, ARTS)).result.results[0].error).toBeTruthy()
  })

  it('signs saying "bin 5", "BIN 5" or "Bin  5" all become one bin called "Bin 5"', async () => {
    const { result } = await call('startImport', { links: ['test:3'], dryRun: true }, OWNER)
    await runToEnd(result.jobId)
    const r = await call('approveImports', { items: [
      { id: 'test0001x3', newBinLabel: 'bin 5' }, { id: 'test0002x3', newBinLabel: 'BIN 5' }, { id: 'test0003x3', newBinLabel: 'Bin  5' },
    ] }, ARTS)
    const items = await Promise.all(r.result.results.map((x: { itemId: string }) => getDoc(`items/${x.itemId}`)))
    expect(new Set(items.map(i => i!.binId)).size).toBe(1)
    expect((await getDoc(`bins/${items[0]!.binId}`))!.label).toBe('Bin 5')
  })

  it('stops at the cost cap, and the queue waits instead of failing', async () => {
    await put('app_settings/import', { capUsd: 0.03, spentUsd: 0 })
    const { result } = await call('startImport', { links: ['test:12'] }, OWNER)
    const end = await runToEnd(result.jobId)
    expect(end.capped).toBe(true)
    expect(end.spentUsd).toBeLessThanOrEqual(0.03)
    expect(end.counts.analyzed).toBeGreaterThan(0)
    expect(end.counts.pending).toBeGreaterThan(0)
    expect(end.counts.failed).toBe(0)
  })
})
