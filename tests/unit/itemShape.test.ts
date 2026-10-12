import { describe, it, expect } from 'vitest'
import { normalizeItem } from '../../src/services/itemShape'

// Records shaped exactly like props saved by the old version of the app.
const legacy = {
  name: 'Fake eyeballs',
  photoUrl: 'https://example.com/eyes.jpg',
  tags: ['t1'],
  itemType: 'costume',
  status: 'available',
  cost: 12.5,
  whereToRebuy: 'Dollarama',
  createdAt: '2025-01-01', updatedAt: '2025-01-02', createdBy: 'u', updatedBy: 'u',
}

describe('reading props saved by the old app', () => {
  it('keeps every original field', () => {
    const item = normalizeItem('a', legacy)
    for (const [k, v] of Object.entries(legacy)) expect(item[k as keyof typeof item]).toEqual(v)
  })
  it('fills the new fields with sensible defaults', () => {
    const item = normalizeItem('a', legacy)
    expect(item.photos).toEqual(['https://example.com/eyes.jpg'])
    expect(item.categoryId).toBe('costume')
    expect(item.quantity).toBe(1)
    expect(item.condition).toBe('good')
    expect(item.replacementCost).toBe(12.5)
    expect(item.archived).toBe(false)
  })
  it('turns the old "damaged" status into a damaged condition', () => {
    const item = normalizeItem('a', { ...legacy, status: 'damaged' })
    expect(item.condition).toBe('damaged')
    expect(item.status).toBe('available')
  })
  it('keeps checked-out props checked out', () => {
    expect(normalizeItem('a', { ...legacy, status: 'checked-out' }).status).toBe('checked-out')
  })
  it('handles a prop with no photo, type or tags at all', () => {
    const item = normalizeItem('a', { name: 'Mystery' })
    expect(item.photos).toEqual([])
    expect(item.categoryId).toBe('prop')
    expect(item.tags).toEqual([])
  })
})

describe('reading props saved by the new app', () => {
  it('uses the new fields when present', () => {
    const item = normalizeItem('b', {
      ...legacy, photos: ['p1', 'p2'], categoryId: 'gear', quantity: 10,
      condition: 'fair', replacementCost: 40, archived: true,
    })
    expect(item.photos).toEqual(['p1', 'p2'])
    expect(item.photoUrl).toBe('p1')
    expect(item.categoryId).toBe('gear')
    expect(item.quantity).toBe(10)
    expect(item.condition).toBe('fair')
    expect(item.replacementCost).toBe(40)
    expect(item.archived).toBe(true)
  })
})
