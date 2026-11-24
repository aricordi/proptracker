import { describe, it, expect } from 'vitest'
import { studioWallToIso } from '../../functions/src/mcp/refImage'
import { lineFor } from '../../functions/src/mcp/more'

describe('connector props returns', () => {
  it('reads the camera time as Toronto time', () => {
    // A camera clock of 2:00 PM in November (EST, UTC-5) is 19:00 UTC.
    expect(studioWallToIso(new Date(Date.UTC(2026, 10, 24, 14, 0, 0)).toISOString())).toBe('2026-11-24T19:00:00.000Z')
    // In July (EDT, UTC-4).
    expect(studioWallToIso(new Date(Date.UTC(2026, 6, 4, 9, 30, 0)).toISOString())).toBe('2026-07-04T13:30:00.000Z')
  })
  it('finds the prop on the request from casual words, asks when unclear', () => {
    const lines = [{ itemId: 'a', itemName: 'Red rotary phone', qty: 1 }, { itemId: 'b', itemName: 'Black rotary phone', qty: 1 }, { itemId: 'c', itemName: 'Cop hat', qty: 2 }]
    expect(lineFor('cop hats', lines).line?.itemId).toBe('c')
    expect(lineFor('the red phone', lines).line?.itemId).toBe('a')
    expect(lineFor('phone', lines).options).toEqual(['Red rotary phone', 'Black rotary phone'])
    expect(lineFor('b', lines).line?.itemId).toBe('b')
  })
})
