// The Prime Capitol Google account: owner-only setup, connect (pretend in the emulator), email through it, disconnect.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, waitFor, clearDatabase, exists } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ADMIN = 'admin@example.com', GEAR = 'gear@example.com'

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true, name: 'Maanik' })
})

describe('Prime Capitol Google account', () => {
  it('only the owner can see or change it', async () => {
    for (const who of [ADMIN, GEAR]) {
      expect((await call('googleAccountStatus', {}, who)).error).toBe('PERMISSION_DENIED')
      expect((await call('saveGoogleClient', { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-abcdefgh1234' }, who)).error).toBe('PERMISSION_DENIED')
      expect((await call('googleConnectStart', {}, who)).error).toBe('PERMISSION_DENIED')
    }
  })

  it('saves the sign-in setup but never sends the secret back', async () => {
    expect((await call('saveGoogleClient', { clientId: 'nope', clientSecret: 'GOCSPX-abcdefgh1234' }, OWNER)).error).toBe('INVALID_ARGUMENT')
    expect((await call('saveGoogleClient', { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-abcdefgh1234' }, OWNER)).ok).toBe(true)
    const s = await call('googleAccountStatus', {}, OWNER)
    expect(s.result.clientId).toBe('1-a.apps.googleusercontent.com')
    expect(s.result.secret).toBe('…1234')
    expect(JSON.stringify(s.result)).not.toContain('GOCSPX')
    expect(s.result.redirectUri).toMatch(/googleConnectDone$/)
    // Changing only the ID keeps the saved secret.
    expect((await call('saveGoogleClient', { clientId: '2-b.apps.googleusercontent.com' }, OWNER)).ok).toBe(true)
    expect((await call('googleAccountStatus', {}, OWNER)).result.secret).toBe('…1234')
  })

  it('connects, is used for the calendar address and for email, then disconnects', async () => {
    const start = await call('googleConnectStart', { origin: 'https://proptracker-9732e.web.app' }, OWNER)
    expect(start.result.url).toBe('https://proptracker-9732e.web.app/google?connected=1')
    const s = (await call('googleAccountStatus', {}, OWNER)).result
    expect(s.connected).toMatchObject({ email: 'bookings@example.com', calendar: true, gmail: true, connectedBy: OWNER })

    await put('app_settings/schedule', { googleCalendarId: 'shoots@group.calendar.google.com' })
    expect((await call('testCalendarLink', {}, OWNER)).result.account).toBe('bookings@example.com')

    await put('app_settings/email', { enabled: true, service: 'google', fromName: 'Prime Capitol' })
    const sent = await call('sendTestEmail', {}, OWNER)
    expect(sent.ok).toBe(true)
    expect(await waitFor(async () => (await getDoc(`outbox/${sent.result.id}`))?.status === 'sent')).toBe(true)
    expect((await getDoc(`outbox/${sent.result.id}`)).via).toBe('bookings@example.com')

    expect((await call('googleDisconnect', {}, OWNER)).ok).toBe(true)
    expect(await exists('private_google/link')).toBe(false)
    expect((await call('googleAccountStatus', {}, OWNER)).result.connected).toBe(null)
    const again = await call('sendTestEmail', {}, OWNER)
    expect(await waitFor(async () => (await getDoc(`outbox/${again.result.id}`))?.status === 'failed')).toBe(true)
  })
})
