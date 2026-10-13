import { describe, it, expect } from 'vitest'
import { isRateLimit } from '../../functions/src/limits'

describe('telling "slow down" apart from real failures', () => {
  it('waits on Google rate limits and busy errors', () => {
    expect(isRateLimit('Gemini 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(true)
    expect(isRateLimit('Google Drive 403: {"reason":"userRateLimitExceeded"}')).toBe(true)
    expect(isRateLimit('Gemini 503: The model is overloaded')).toBe(true)
  })
  it('fails photos that are genuinely broken', () => {
    expect(isRateLimit('This photo format could not be read.')).toBe(false)
    expect(isRateLimit("Can't see that folder.")).toBe(false)
  })
})
