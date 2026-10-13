import { describe, it, expect } from 'vitest'
import { groupPairs, spreadOf, isSpread, shelfList, pairKey, crossKeys, insideKeys } from '../../src/lib/duplicates'

const p = (a: string, b: string, score = 0.9) => ({ a, b, score })

describe('grouping look-alikes', () => {
  it('joins any number of copies into one group, even through a chain', () => {
    const g = groupPairs([p('A', 'B'), p('C', 'D'), p('B', 'C', 0.95)])   // 4 copies, linked A-B-C-D
    expect(g).toHaveLength(1)
    expect(g[0].ids.sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(g[0].keys).toHaveLength(3)
    expect(g[0].score).toBe(0.95)
  })
  it('keeps unrelated look-alikes in separate groups, best match first', () => {
    const g = groupPairs([p('A', 'B', 0.88), p('X', 'Y', 0.97), p('Y', 'Z')])
    expect(g.map(x => x.ids.sort())).toEqual([['X', 'Y', 'Z'], ['A', 'B']])
  })
  it('handles every pair of a 4-copy group and repeated pairs', () => {
    const ids = ['A', 'B', 'C', 'D']
    const all = ids.flatMap((x, i) => ids.slice(i + 1).map(y => p(x, y)))
    const g = groupPairs([...all, p('B', 'A')])
    expect(g).toHaveLength(1)
    expect(g[0].keys).toHaveLength(6)
    expect(g[0].keys).toContain(pairKey('B', 'A'))
  })
  it('handles big chains without trouble', () => {
    const chain = Array.from({ length: 500 }, (_, i) => p(`p${i}`, `p${i + 1}`))
    expect(groupPairs(chain)[0].ids).toHaveLength(501)
  })
})

describe('copies spread over several bins', () => {
  const prop = (id: string, binId?: string, quantity = 1) => ({ id, name: 'Police Costume', quantity, binId })
  it('4 copies in 4 bins, some sharing a bin, some with no bin', () => {
    expect(spreadOf([prop('a', 'b1'), prop('b', 'b2'), prop('c', 'b3'), prop('d', 'b4')])).toHaveLength(4)
    expect(isSpread([prop('a', 'b1'), prop('b', 'b1', 2)])).toBe(false)
    expect(spreadOf([prop('a', 'b1'), prop('b', 'b1', 2), prop('c', 'b2')])).toEqual([
      { binId: 'b1', qty: 3, count: 2 }, { binId: 'b2', qty: 1, count: 1 }])
    expect(isSpread([prop('a', 'b1'), prop('b')])).toBe(true)       // one has no bin
    expect(isSpread([prop('a'), prop('b')])).toBe(false)            // neither has a bin
  })
  it('makes a list for the arts team of what to gather', () => {
    const names: Record<string, string> = { b1: 'B.31', b2: 'C.4', b3: 'D.2', b4: 'E.9' }
    const text = shelfList([
      [prop('a', 'b1'), prop('b', 'b2'), prop('c', 'b3'), prop('d', 'b4', 2)],
      [{ ...prop('x', 'b1'), name: 'Lamp' }, { ...prop('y', 'b1'), name: 'Lamp' }],   // same bin: not listed
    ], id => names[id])
    expect(text).toContain('• Police Costume: B.31 ×1, C.4 ×1, D.2 ×1, E.9 ×2')
    expect(text).not.toContain('Lamp')
    expect(shelfList([], id => id)).toBe('')
  })
})

describe('ticking the same ones and releasing the rest', () => {
  it('releasing only cuts the links between the ticked and the unticked ones', () => {
    // A mixed group of 5: A, B, C are one prop; D and E are a different prop (and match F elsewhere).
    const pairs = [p('A', 'B'), p('B', 'C'), p('C', 'D'), p('D', 'E'), p('A', 'E'), p('E', 'F')]
    const released = new Set(crossKeys(['A', 'B', 'C'], ['D', 'E', 'F']))
    const confirmed = new Set(insideKeys(['A', 'B', 'C']))   // flagged "to gather"
    const left = pairs.filter(x => !released.has(pairKey(x.a, x.b)) && !confirmed.has(pairKey(x.a, x.b)))
    const g = groupPairs(left)
    expect(g).toHaveLength(1)
    expect(g[0].ids.sort()).toEqual(['D', 'E', 'F'])   // still candidates with each other and with F
  })
  it('counts each pair once', () => {
    expect(insideKeys(['A', 'B', 'C', 'D'])).toHaveLength(6)
    expect(crossKeys(['A', 'B'], ['C', 'D', 'A'])).toEqual([pairKey('A', 'C'), pairKey('A', 'D'), pairKey('B', 'C'), pairKey('B', 'D'), pairKey('B', 'A')])
    expect(insideKeys(['A'])).toEqual([])
  })
})
