import { describe, it, expect } from 'vitest'
import { shouldCut } from '../../functions/src/killSwitch'

describe('bill limit', () => {
  it('cuts only once the spend reaches the budget', () => {
    expect(shouldCut({ costAmount: 59.99, budgetAmount: 60 })).toBe(false)
    expect(shouldCut({ costAmount: 60, budgetAmount: 60 })).toBe(true)
    expect(shouldCut({ costAmount: 104500, budgetAmount: 60 })).toBe(true)
  })
  it('ignores odd posts', () => {
    expect(shouldCut({})).toBe(false)
    expect(shouldCut({ costAmount: 10, budgetAmount: 0 })).toBe(false)
  })
})
