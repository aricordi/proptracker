import { describe, it, expect } from 'vitest'
import {
  tagsLookAlike, findDuplicateTags, planTagMerge, unusedTags,
  nameSimilarity, findDuplicateProps, emptyBins, emptyLocations,
} from '../../src/lib/maintenance'
import { matchesQuery, availabilityOf, byName } from '../../src/lib/search'
import { normalizeItem } from '../../src/services/itemShape'
import type { Tag } from '../../src/types'

const tag = (id: string, label: string): Tag => ({ id, label, normalizedKey: label, usageCount: 0 })
const item = (id: string, extra: Record<string, unknown> = {}) => normalizeItem(id, { name: id, tags: [], ...extra })

describe('duplicate tags', () => {
  it('matches plurals, capitals and small typos on longer words', () => {
    expect(tagsLookAlike('chair', 'Chairs')).toBe(true)
    expect(tagsLookAlike('vintage', 'vintag')).toBe(true)
    expect(tagsLookAlike('halloween', 'haloween')).toBe(true)
  })
  it('does not flag different short words', () => {
    expect(tagsLookAlike('cat', 'hat')).toBe(false)
    expect(tagsLookAlike('red', 'bed')).toBe(false)
    expect(tagsLookAlike('police', 'polite')).toBe(true) // 6 letters, 1 change: flagged for a human to judge
  })
  it('groups look-alikes and suggests keeping the most-used one', () => {
    const tags = [tag('a', 'chair'), tag('b', 'chairs'), tag('c', 'table')]
    const items = [item('1', { tags: ['b'] }), item('2', { tags: ['b'] }), item('3', { tags: ['a'] })]
    const groups = findDuplicateTags(tags, items)
    expect(groups).toHaveLength(1)
    expect(groups[0].tags.map(t => t.id)).toEqual(['b', 'a'])
  })
  it('merge plan replaces old tags without creating doubles', () => {
    const items = [item('1', { tags: ['a', 'b'] }), item('2', { tags: ['c'] }), item('3', { tags: ['b', 'x'] })]
    expect(planTagMerge('a', ['b'], items)).toEqual([
      { itemId: '1', tags: ['a'] },
      { itemId: '3', tags: ['a', 'x'] },
    ])
  })
  it('finds tags no prop uses', () => {
    expect(unusedTags([tag('a', 'x'), tag('b', 'y')], [item('1', { tags: ['a'] })]).map(t => t.id)).toEqual(['b'])
  })
})

describe('duplicate props', () => {
  it('scores near-identical names high and different names low', () => {
    expect(nameSimilarity('Rotary Phone', 'Rotary phone (black)')).toBeGreaterThan(0.7)
    expect(nameSimilarity('Rotary Phone', 'Wooden chair')).toBeLessThan(0.3)
  })
  it('flags likely duplicates but ignores archived props', () => {
    const items = [item('Police costume'), item('Police costume '), item('Old police costume', { archived: true }), item('Lamp')]
    const pairs = findDuplicateProps(items, 0.8)
    expect(pairs).toHaveLength(1)
  })
})

describe('empty storage', () => {
  const bins = [{ id: 'b1', label: 'A1', locationId: 'l1', qrSlug: 'b1' }, { id: 'b2', label: 'A2', locationId: 'l1', qrSlug: 'b2' }]
  const locs = [{ id: 'l1', name: 'Main' }, { id: 'l2', name: 'Spare' }]
  it('finds bins and storage areas with nothing in them', () => {
    const items = [item('x', { binId: 'b1', locationId: 'l1' }), item('y', { binId: 'b2', archived: true })]
    expect(emptyBins(bins, items).map(b => b.id)).toEqual(['b2'])
    expect(emptyLocations(locs, bins, items).map(l => l.id)).toEqual(['l2'])
  })
})

describe('search', () => {
  const tags = { t1: tag('t1', 'red'), t2: tag('t2', 'vintage') }
  const chair = item('Wooden chair', { tags: ['t1'], description: 'Oak dining chair', notes: 'Wobbly leg' })
  it('matches name, tags, description and notes', () => {
    expect(matchesQuery(chair, 'wooden', tags)).toBe(true)
    expect(matchesQuery(chair, 'red', tags)).toBe(true)
    expect(matchesQuery(chair, 'oak', tags)).toBe(true)
    expect(matchesQuery(chair, 'wobbly', tags)).toBe(true)
  })
  it('finds props by their hidden search words, and plurals find singulars', () => {
    const mask = item('Bearded Man Mask', { searchWords: ['president', 'abraham lincoln', 'civil war'] })
    expect(matchesQuery(mask, 'president', tags)).toBe(true)
    expect(matchesQuery(mask, 'Presidents', tags)).toBe(true)
    expect(matchesQuery(mask, 'lincoln mask', tags)).toBe(true)
    expect(matchesQuery(mask, 'king', tags)).toBe(false)
    expect(matchesQuery(chair, 'chairs', tags)).toBe(true)
  })
  it('needs every typed word to match', () => {
    expect(matchesQuery(chair, 'red chair', tags)).toBe(true)
    expect(matchesQuery(chair, 'red table', tags)).toBe(false)
  })
  it('does not search internal-only fields', () => {
    const c = item('Cop costume', { characters: ['detective'], whereToRebuy: 'Amazon' })
    expect(matchesQuery(c, 'amazon', tags)).toBe(false)
  })
  it('works out availability', () => {
    expect(availabilityOf(item('a'))).toBe('available')
    expect(availabilityOf(item('a', { status: 'checked-out' }))).toBe('checked-out')
    expect(availabilityOf(item('a', { status: 'damaged' }))).toBe('damaged')
  })
  it('sorts A to Z ignoring capitals, with numbers in natural order', () => {
    const names = ['chair 10', 'Apple', 'chair 2', 'banana'].map(n => item(n)).sort(byName).map(i => i.name)
    expect(names).toEqual(['Apple', 'banana', 'chair 2', 'chair 10'])
  })
})
