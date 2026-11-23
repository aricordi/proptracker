import { describe, it, expect } from 'vitest'
import { compareVersions, isBehind } from '../../src/lib/version'

describe('app version numbers', () => {
  it('compares major, minor and patch as numbers', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
  it('treats anything that is not a version as 0.0.0', () => {
    expect(compareVersions('junk', '0.0.1')).toBe(-1)
  })
  it('says who is behind the live version', () => {
    expect(isBehind('1.0.0', '1.1.0')).toBe(true)
    expect(isBehind('1.1.0', '1.1.0')).toBe(false)
    expect(isBehind(undefined, '1.1.0')).toBe(false)
  })
})
