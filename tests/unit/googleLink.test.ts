import { describe, it, expect } from 'vitest'
import { authUrl, grantedOf, isClientId, redirectUriFor, safeOrigin, secretEnd, SCOPES } from '../../functions/src/googleLink'

describe('Prime Capitol Google account helpers', () => {
  it('asks Google for a lasting connection with only calendar events + send email (plus who signed in)', () => {
    const u = new URL(authUrl({ clientId: '1-a.apps.googleusercontent.com', redirectUri: 'https://x/cb', state: 'abc', loginHint: 'bookings@primecapitol.ca' }))
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toContain('consent')
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', SCOPES.calendar, SCOPES.gmail].sort())
    expect(u.searchParams.get('state')).toBe('abc')
    expect(u.searchParams.get('login_hint')).toBe('bookings@primecapitol.ca')
  })
  it('reads which boxes were ticked', () => {
    expect(grantedOf(`openid ${SCOPES.calendar}`)).toEqual({ calendar: true, gmail: false })
    expect(grantedOf(undefined)).toEqual({ calendar: false, gmail: false })
  })
  it('only sends people back to the app\'s own addresses', () => {
    expect(safeOrigin('https://proptracker-9732e.web.app')).toBe('https://proptracker-9732e.web.app')
    expect(safeOrigin('https://evil.example')).toBe('https://proptracker.arbcreative.co')
  })
  it('checks client IDs, hides secrets, builds the return address', () => {
    expect(isClientId('1234-abc123.apps.googleusercontent.com')).toBe(true)
    expect(isClientId('hello')).toBe(false)
    expect(secretEnd('GOCSPX-abcdefgh1234')).toBe('…1234')
    expect(redirectUriFor('proptracker-9732e', false)).toBe('https://northamerica-northeast1-proptracker-9732e.cloudfunctions.net/googleConnectDone')
  })
})
