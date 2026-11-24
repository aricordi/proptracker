// Anonymous suggestions (owner, Nov 24): personal details never survive the clean-up.
import { describe, it, expect } from 'vitest'
import { cleanDemand } from '../../functions/src/mcp/demand'

describe('anonymous suggestion text', () => {
  it('drops emails, links, phone numbers, handles and person ids', () => {
    expect(cleanDemand('Book a MAKEUP artist for kyle@gmail.com')).toBe('book a makeup artist for')
    expect(cleanDemand('call me 514-555-1234 about drones')).toBe('call me about drones')
    expect(cleanDemand('see https://x.com/y and @jordan, p_0123456789ab')).toBe('see and ,')
    expect(cleanDemand('x'.repeat(300))).toHaveLength(120)
    expect(cleanDemand(null)).toBe('')
    expect(cleanDemand("Kyle's drone and Justin Figs' lights", ['Kyle Reed', 'Justin Figs'])).toBe("drone and ' lights")
  })
})
