// Google refuses sign-in inside apps' built-in browsers: the login screen spots them.
import { describe, it, expect } from 'vitest'
import { inAppBrowser } from '../../src/lib/inAppBrowser'

describe('built-in browsers', () => {
  it('spots Instagram, Facebook and Android app views', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0')).toBe('Instagram')
    expect(inAppBrowser('Mozilla/5.0 (iPhone) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]')).toBe('Facebook')
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36')).toBe('an app')
  })
  it('leaves real Safari and Chrome alone', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBeNull()
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBeNull()
  })
})
