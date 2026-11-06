// Clean-up tools for the arts crew (owner, Nov 6).
import { describe, it, expect } from 'vitest'
import { oddName, matchesFilter, cleanupCounts, likelyDoubles, sameNameSameBin, bestToKeep, shelfOrder, isRemoved, groupPairKeys, sameName } from '../../src/lib/cleanup'
import { groupSamePhotos, storagePath } from '../../functions/src/samePhotos'
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
  it('keeps the checked one', () => {
    expect(bestToKeep([items[0], items[1]]).id).toBe('2')
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

describe('same photo twice (server grouping)', () => {
  const url = (p: string) => `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(p)}?alt=media&token=t`
  it('reads storage paths from download links', () => {
    expect(storagePath(url('items/imported/abc.jpg'))).toBe('items/imported/abc.jpg')
    expect(storagePath('https://example.com/photo.jpg')).toBeNull()
  })
  it('groups props sharing an identical photo file, joins chains, skips dismissed groups', () => {
    const md5 = new Map([['items/a.jpg', 'H1'], ['items/b.jpg', 'H1'], ['items/c.jpg', 'H2'], ['items/d.jpg', 'H2'], ['items/e.jpg', 'H3'], ['items/f.jpg', 'H4'], ['items/g.jpg', 'H4']])
    const items = [
      { id: 'p1', photos: [url('items/a.jpg')] },
      { id: 'p2', photos: [url('items/b.jpg'), url('items/c.jpg')] },
      { id: 'p3', photos: [url('items/d.jpg')] },
      { id: 'p4', photos: [url('items/e.jpg')] },
      { id: 'p5', photos: [url('items/f.jpg')] },
      { id: 'p6', photos: [url('items/g.jpg')] },
    ]
    const groups = groupSamePhotos(items, md5, new Set(['p5|p6']))
    expect(groups.map(g => [...g].sort())).toEqual([['p1', 'p2', 'p3']])
  })
})
