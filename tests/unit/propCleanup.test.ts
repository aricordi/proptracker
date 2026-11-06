// Clean-up tools for the arts crew (owner, Nov 6).
import { describe, it, expect } from 'vitest'
import { oddName, matchesFilter, cleanupCounts, likelyDoubles, sameNameSameBin, bestToKeep, shelfOrder, isRemoved, groupPairKeys, sameName, binGuesses, looksComplete } from '../../src/lib/cleanup'
import { buildDoubles, afterMerge, tierOf, reasonsOf, storagePath, nameLikeness, groupDoubles, keysBetween, type DoublePair } from '../../functions/src/doubles'
import type { Item } from '../../src/types'

const it_ = (id: string, x: Partial<Item> = {}): Item => ({
  id, name: id, photos: [], tags: [], categoryId: 'prop', quantity: 1, condition: 'good', status: 'available', archived: false,
  collection: 'company', createdAt: '2026-11-01T00:00:00Z', updatedAt: '', createdBy: '', updatedBy: '', ...x,
}) as Item

describe('odd names', () => {
  it('spots names nobody would search for', () => {
    for (const n of ['', 'x', 'Item', 'unknown', 'IMG_2034', 'photo.jpg', '1234', 'the prop', 'Misc']) expect(oddName(n), n).toBe(true)
    for (const n of ['Red rotary phone', 'Cop hat', 'Pot', 'Black peacoat (XL)']) expect(oddName(n), n).toBe(false)
  })
})

describe('filters and counts', () => {
  const items = [
    it_('a', { name: 'Brass lamp', reviewedAt: '2026-11-06T10:00:00Z', binId: 'b1' }),
    it_('b', { name: 'Wine glass', binId: 'b1', quantity: 3 }),
    it_('c', { name: 'IMG_1', categoryId: 'costume', importedFrom: { driveFileId: 'f', fileName: 'x', folder: 'y' } }),
    it_('d', { archived: true, removedAt: '2026-11-06T11:00:00Z', removedNote: 'Not a prop' }),
    it_('e', { collection: 'personal' }),
  ]
  it('counts only Prime Capitol props still in the app', () => {
    expect(cleanupCounts(items)).toMatchObject({ total: 3, checked: 1, todo: 2, nobin: 1, many: 1, nophoto: 3, names: 1, costumes: 1, imported: 1, removed: 1 })
  })
  it('filters', () => {
    expect(matchesFilter(items[0], 'todo')).toBe(false)
    expect(matchesFilter(items[1], 'many')).toBe(true)
    expect(matchesFilter(items[2], 'nobin')).toBe(true)
    expect(isRemoved(items[3])).toBe(true)
  })
})

describe('doubles', () => {
  const items = [
    it_('1', { name: 'Red rotary phone', binId: 'b1' }),
    it_('2', { name: 'Red Rotary Phones', binId: 'b1', reviewedAt: '2026-11-06T00:00:00Z' }),
    it_('3', { name: 'Rotary phone', binId: 'b2' }),
    it_('4', { name: 'Cop hat', binId: 'b1' }),
    it_('5', { name: 'Red rotary phone', binId: 'b1', archived: true }),
  ]
  it('same name in the same bin (plurals and capitals ignored, removed ones left out)', () => {
    expect(sameName('Red rotary phone', 'red rotary phones')).toBe(true)
    expect(sameNameSameBin(items).map(g => g.map(i => i.id))).toEqual([['1', '2']])
  })
  it('likely doubles: most alike first, never itself or removed ones', () => {
    expect(likelyDoubles(items[0], items).map(i => i.id)).toEqual(['2', '3'])
  })
  it('keeps the checked one, then the original over an imported copy', () => {
    expect(bestToKeep([items[0], items[1]]).id).toBe('2')
    const orig = it_('o', { name: 'Rotary phone', binId: 'b1', photos: ['u'] })
    const copy = it_('c', { name: 'Rotary phones', binId: 'b1', photos: ['u', 'v'], importedFrom: { driveFileId: 'f', fileName: 'x', folder: 'y' } })
    expect(bestToKeep([copy, orig]).id).toBe('o')
  })
  it('pair keys match the Health "not duplicates" list format', () => {
    expect(groupPairKeys(['b', 'a', 'c'])).toEqual(['a|b', 'b|c', 'a|c'])
  })
})

describe('shelf order', () => {
  it('bin number order, no bin last, then name', () => {
    const labels: Record<string, string> = { b2: 'Bin 2', b10: 'Bin 10' }
    const list = shelfOrder([it_('z', { binId: 'b10' }), it_('y'), it_('b', { binId: 'b2' }), it_('a', { binId: 'b2' })], id => id ? labels[id] : undefined)
    expect(list.map(i => i.id)).toEqual(['a', 'b', 'z', 'y'])
  })
})

describe('doubles engine (every clue in one sorted list)', () => {
  const url = (p: string) => `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(p)}?alt=media&token=t`
  const md5 = new Map([['items/a.jpg', 'H1'], ['items/b.jpg', 'H1'], ['items/c.jpg', 'H2']])
  const items = [
    { id: 'p1', name: 'Red rotary phone', binId: 'b1', photos: [url('items/a.jpg')] },
    { id: 'p2', name: 'Telephone', binId: 'b9', photos: [url('items/b.jpg')] },           // same picture as p1
    { id: 'p3', name: 'Red rotary phones', binId: 'b1', photos: [url('items/c.jpg')] },  // same name, same bin
    { id: 'p4', name: 'Brass lamp', binId: 'b2', photos: [] },
    { id: 'p5', name: 'Old brass desk lamp', binId: 'b3', photos: [] },                 // only the fingerprint says so
    { id: 'p6', name: 'Cop hat', binId: 'b2', photos: [] },
  ]
  it('reads storage paths and name likeness', () => {
    expect(storagePath(url('items/imported/abc.jpg'))).toBe('items/imported/abc.jpg')
    expect(storagePath('https://example.com/photo.jpg')).toBeNull()
    expect(nameLikeness('Red rotary phone', 'red rotary phones')).toBe(1)
  })
  it('sure first (same picture), then likely, then maybe; dismissed pairs never come back', () => {
    const pairs = buildDoubles({ items, md5ByPath: md5, lookPairs: [{ a: 'p4', b: 'p5', score: 0.9 }, { a: 'p4', b: 'p6', score: 0.5 }], dismissed: new Set(['p2|p3']) })
    expect(pairs.map(p => [p.a, p.b, p.tier])).toEqual([['p1', 'p2', 'sure'], ['p1', 'p3', 'likely'], ['p4', 'p5', 'maybe']])
    expect(reasonsOf(pairs[1].signals)).toEqual(['Same name', 'Same bin'])
    expect(reasonsOf(pairs[2].signals)).toContain('90% alike')
  })
  it("the AI's opinion moves a pair up (sure it's the same) or down (different)", () => {
    expect(tierOf({ look: 0.87, ai: { same: true, confidence: 'high', reason: '' } })).toBe('likely')
    const pairs = buildDoubles({ items, lookPairs: [{ a: 'p4', b: 'p5', score: 0.9 }, { a: 'p4', b: 'p6', score: 0.88 }], verdicts: new Map([['p4|p5', { same: false, confidence: 'high' as const, reason: 'different shape' }]]) })
    const lamps = pairs.filter(p => p.a === 'p4')
    expect(lamps.map(p => `${p.a}|${p.b}:${p.tier}`)).toEqual(['p4|p6:likely', 'p4|p5:maybe'])   // p4|p6 share a bin
    expect(pairs[pairs.length - 1]).toMatchObject({ a: 'p4', b: 'p5' })                            // AI said different: last
    expect(lamps[1].score).toBeLessThan(0)
  })
  it('after combining, pairs follow the prop that stayed (chains of three collapse)', () => {
    const pairs = buildDoubles({ items, md5ByPath: md5 })
    const after = afterMerge(pairs, 'p1', 'p3')
    expect(after.some(p => p.a === 'p3' || p.b === 'p3')).toBe(false)
    expect(after.filter(p => (p.a === 'p1' && p.b === 'p2') || (p.a === 'p2' && p.b === 'p1'))).toHaveLength(1)
  })
})

describe('doubles in groups (3 or more copies)', () => {
  const pair = (a: string, b: string, tier: 'sure' | 'likely' | 'maybe', score: number, ai?: boolean): DoublePair =>
    ({ a, b, tier, score, signals: { look: score, ...(ai === undefined ? {} : { ai: { same: ai, confidence: 'high' as const, reason: ai ? 'same lamp' : 'different' } }) } })
  it('joins chains into one group (4 photos of the same lamp = one group), best first', () => {
    const g = groupDoubles([pair('a', 'b', 'likely', 0.95, true), pair('b', 'c', 'likely', 0.94), pair('c', 'd', 'maybe', 0.87), pair('x', 'y', 'sure', 2)])
    expect(g.map(x => [...x.ids].sort())).toEqual([['x', 'y'], ['a', 'b', 'c', 'd']])
    expect(g[1]).toMatchObject({ tier: 'likely', ai: { same: 1, different: 0, reason: 'same lamp' } })
    expect(g[1].keys).toHaveLength(3)
  })
  it('never glues more than 10 together through weak links', () => {
    const chain = Array.from({ length: 15 }, (_, i) => pair(`p${i}`, `p${i + 1}`, 'maybe', 0.9 - i * 0.001))
    const g = groupDoubles(chain)
    expect(Math.max(...g.map(x => x.ids.length))).toBeLessThanOrEqual(10)
  })
  it('pairs between the ticked ones and the ones left out', () => {
    expect(keysBetween(['a', 'b'], ['c'])).toEqual(['a|c', 'b|c'])
  })
})

describe('smart fixes', () => {
  it('puts props with no bin in the bin their photo folder is named after', () => {
    const items = [
      it_('x', { name: 'Fan', importedFrom: { driveFileId: '1', fileName: 'a', folder: 'Props/BIN A-02' } }),
      it_('y', { name: 'Hat', binId: 'b1', importedFrom: { driveFileId: '2', fileName: 'b', folder: 'A2' } }),
      it_('z', { name: 'Cup', importedFrom: { driveFileId: '3', fileName: 'c', folder: 'Random stuff' } }),
    ]
    const g = binGuesses(items, [{ id: 'b1', label: 'A2' }, { id: 'b2', label: 'C7' }])
    expect([...g.entries()].map(([b, l]) => [b, l.map(i => i.id)])).toEqual([['b1', ['x']]])
  })
  it('looks complete = real name, bin, photo, not checked, not a double', () => {
    const ok = it_('ok', { name: 'Brass lamp', binId: 'b1', photos: ['u'] })
    expect(looksComplete(ok, new Set())).toBe(true)
    expect(looksComplete(ok, new Set(['ok']))).toBe(false)
    expect(looksComplete({ ...ok, name: 'IMG_1' }, new Set())).toBe(false)
    expect(looksComplete({ ...ok, binId: undefined }, new Set())).toBe(false)
    expect(looksComplete({ ...ok, reviewedAt: 'x' }, new Set())).toBe(false)
  })
})
