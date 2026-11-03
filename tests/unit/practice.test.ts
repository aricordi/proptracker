// Practice site (owner, Nov 3): practice behaviour may NEVER switch on in the live project.
import { describe, it, expect } from 'vitest'
import { isPractice, LIVE_PROJECT } from '../../functions/src/practiceMode'

describe('isPractice', () => {
  it('needs PRACTICE=1 and a project that is not the live one', () => {
    expect(isPractice({ PRACTICE: '1', GCLOUD_PROJECT: 'prime-capitol-practice' })).toBe(true)
    expect(isPractice({ PRACTICE: '1', GOOGLE_CLOUD_PROJECT: 'prime-capitol-practice' })).toBe(true)
  })
  it('is never on in the live project, even with PRACTICE=1', () => {
    expect(isPractice({ PRACTICE: '1', GCLOUD_PROJECT: LIVE_PROJECT })).toBe(false)
    expect(isPractice({ PRACTICE: '1', GOOGLE_CLOUD_PROJECT: LIVE_PROJECT })).toBe(false)
  })
  it('is off without the flag or without a project', () => {
    expect(isPractice({ GCLOUD_PROJECT: 'prime-capitol-practice' })).toBe(false)
    expect(isPractice({ PRACTICE: 'true', GCLOUD_PROJECT: 'prime-capitol-practice' })).toBe(false)
    expect(isPractice({ PRACTICE: '1' })).toBe(false)
  })
})
