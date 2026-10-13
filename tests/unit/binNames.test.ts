import { describe, it, expect } from 'vitest'
import { binKey, lookAlikeBins, tidyBinLabel } from '../../functions/src/binNames'

describe('matching bin names written different ways', () => {
  it('treats punctuation, spaces, "Bin" and leading zeros as the same bin', () => {
    const same = ['B.31', 'B:31', 'B: 31', 'b 31', 'B-31', 'B#31', 'Bin B31', 'BIN: B.31', 'B031', 'B31']
    for (const s of same) expect(binKey(s), s).toBe('B31')
    expect(binKey('Bin 1')).toBe(binKey('bin 01'))
  })
  it('keeps different bins apart', () => {
    expect(binKey('B.31')).not.toBe(binKey('B.13'))
    expect(binKey('B.31')).not.toBe(binKey('C.31'))
    expect(binKey('B.3')).not.toBe(binKey('B.31'))
    expect(binKey('Binder 3')).toBe('BINDER3')   // a word starting with "bin" isn't the word "Bin"
    expect(binKey('100')).toBe('100')
  })
  it('groups existing look-alike bins', () => {
    const groups = lookAlikeBins([
      { id: '1', label: 'B.31' }, { id: '2', label: 'B:31' }, { id: '3', label: 'B: 31' },
      { id: '4', label: 'C.2' }, { id: '5', label: 'Bin 7' }, { id: '6', label: 'bin 07' },
    ])
    expect(groups.map(g => g.map(b => b.id))).toEqual([['1', '2', '3'], ['5', '6']])
  })
  it('tidies new bin names', () => {
    expect(tidyBinLabel('  bin   5 ')).toBe('Bin 5')
  })
})
