import { describe, it, expect } from 'vitest'
import { bundledCounts, looseCount, tidyPieces, bundleProblems, haveProblem, pieceTotal } from '../../functions/src/gearStock'

const items = [
  { id: 'cam', name: 'Sony FX3 body', have: 1 },
  { id: 'bat', name: 'NP-FZ100 battery', have: 6 },
  { id: 'old', name: 'Old lens', have: 2, archived: true },
]
const bundles = [
  { id: 'b1', pieces: [{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 2 }] },
  { id: 'b2', pieces: [{ itemId: 'bat', qty: 3 }] },
  { id: 'gone', pieces: [{ itemId: 'bat', qty: 1 }], archived: true },   // archived bundles free their pieces
]

describe('gear stock', () => {
  it('counts pieces tied up in bundles, ignoring archived ones (and optionally one bundle)', () => {
    expect(bundledCounts(bundles).get('bat')).toBe(5)
    expect(bundledCounts(bundles, 'b2').get('bat')).toBe(2)
    expect(looseCount(items[1], bundledCounts(bundles))).toBe(1)
    expect(looseCount(items[2], bundledCounts(bundles))).toBe(0)
  })
  it('a piece can only be in one bundle at a time', () => {
    expect(bundleProblems([{ itemId: 'bat', qty: 1 }], items, bundles)).toEqual([])
    expect(bundleProblems([{ itemId: 'bat', qty: 2 }], items, bundles)[0]).toMatch(/Only 1 "NP-FZ100 battery" is not already in another bundle/)
    expect(bundleProblems([{ itemId: 'cam', qty: 1 }], items, bundles)).toHaveLength(1)
    // Editing b1 itself: its own pieces count as free for it.
    expect(bundleProblems([{ itemId: 'cam', qty: 1 }, { itemId: 'bat', qty: 3 }], items, bundles, 'b1')).toEqual([])
  })
  it('refuses empty bundles and pieces that no longer exist', () => {
    expect(bundleProblems([], items, bundles)).toEqual(['Add at least one piece.'])
    expect(bundleProblems([{ itemId: 'old', qty: 1 }], items, bundles)[0]).toMatch(/no longer exists/)
    expect(bundleProblems([{ itemId: 'nope', qty: 1 }], items, bundles)[0]).toMatch(/no longer exists/)
  })
  it('tidies pieces: joins repeats, drops zero/bad quantities', () => {
    expect(tidyPieces([{ itemId: 'bat', qty: 1 }, { itemId: 'bat', qty: 2 }, { itemId: 'cam', qty: 0 }, { itemId: 'x', qty: 1.5 }, null, 'junk']))
      .toEqual([{ itemId: 'bat', qty: 3 }])
    expect(tidyPieces('nope')).toEqual([])
    expect(pieceTotal([{ itemId: 'a', qty: 2 }, { itemId: 'b', qty: 3 }])).toBe(5)
  })
  it("can't lower how many you have below what's in bundles", () => {
    expect(haveProblem(items[1], 5, bundles)).toBeNull()
    expect(haveProblem(items[1], 4, bundles)).toMatch(/5 "NP-FZ100 battery" are in bundles/)
  })
})
