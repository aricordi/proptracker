// Attack test (Nov 19, before the creator launch): every server function is called by people who must be refused.
// Runs only in the emulator. Finds the functions by reading functions/src, so a NEW function is checked automatically.
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, it, expect } from 'vitest'
import { put, call, clearDatabase } from './helpers'

const SRC = 'functions/src'
const FN = 'http://127.0.0.1:5001/demo-proptracker/northamerica-northeast1'
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const OWNER = 'alexisricordi@gmail.com'

// Functions that Props-only creators may use (searching props, the AI helpers, push, problem reports).
const DEMO_OK = new Set(['searchSimilar', 'photoSearch', 'propsLike', 'hotProps', 'ideaToProps', 'askApp', 'askChat', 'reportBug',
  'registerPush', 'unregisterPush', 'testPush'])
// Owner-only maintenance and money: everyone else must be refused.
const OWNER_ONLY = ['changeUserEmail', 'saveScheduleSettings', 'saveGoogleClient', 'googleConnectStart', 'googleDisconnect',
  'googleAccountStatus', 'cleanUpPhotos', 'costReport', 'undoImport', 'startImport', 'processImport', 'rebuildSearchIndex',
  'improveSearchWords', 'updateBugReport', 'testCalendarLink', 'makeMissingThumbs', 'sendTestEmail', 'checkNoticesNow']

const callables = readdirSync(SRC).filter(f => f.endsWith('.ts')).flatMap(f =>
  [...readFileSync(`${SRC}/${f}`, 'utf8').matchAll(/export const (\w+)\s*=\s*onCall\(/g)].map(m => m[1]))

async function unverifiedToken(email: string) {
  const res = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true,
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: 'fake-' + email, email, email_verified: false }))}&providerId=google.com` }),
  })
  return (await res.json()).idToken as string
}
async function callWith(name: string, token: string) {
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: {} }) })
  const body = await res.json()
  return { ok: res.ok, error: body.error?.status as string | undefined }
}
const REFUSED = ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'FAILED_PRECONDITION']

beforeAll(async () => {
  await clearDatabase()
  await put('users/creator@example.com', { email: 'creator@example.com', role: 'creator', active: true, access: 'full' })
  await put('users/demo@example.com', { email: 'demo@example.com', role: 'creator', active: true, access: 'props' })
  await put('users/gone@example.com', { email: 'gone@example.com', role: 'equipment', active: false })
  await put('users/arts@example.com', { email: 'arts@example.com', role: 'arts', active: true })
  await put('users/gear@example.com', { email: 'gear@example.com', role: 'equipment', active: true })
  await put('users/admin@example.com', { email: 'admin@example.com', role: 'admin', active: true })
})

describe('every server function refuses people who are not in', () => {
  it('finds the functions', () => { expect(callables.length).toBeGreaterThan(90) })

  it('signed out, never invited, turned off, or an unverified copy of the owner\'s email: all refused', async () => {
    const fake = await unverifiedToken(OWNER)
    const leaks: string[] = []
    for (const name of callables) {
      for (const [who, r] of [
        ['signed out', await call(name, {})],
        ['never invited', await call(name, {}, 'stranger@example.com')],
        ['turned off', await call(name, {}, 'gone@example.com')],
        ['fake owner', await callWith(name, fake)],
      ] as const) {
        if (r.ok || !REFUSED.includes(String(r.error))) leaks.push(`${name} let ${who} in (${r.ok ? 'ok' : r.error})`)
      }
    }
    expect(leaks).toEqual([])
  }, 600_000)

  it('Props-only creators are refused everywhere except searching props, the AI helpers, push and problem reports', async () => {
    const leaks: string[] = []
    for (const name of callables) {
      if (DEMO_OK.has(name)) continue
      const r = await call(name, {}, 'demo@example.com')
      if (r.ok || !REFUSED.includes(String(r.error))) leaks.push(`${name} let a Props-only creator in (${r.ok ? 'ok' : r.error})`)
    }
    expect(leaks).toEqual([])
  }, 600_000)

  it('owner-only tools refuse every other role', async () => {
    const leaks: string[] = []
    for (const name of OWNER_ONLY) {
      expect(callables, `${name} still exists`).toContain(name)
      for (const who of ['creator@example.com', 'arts@example.com', 'gear@example.com', 'admin@example.com']) {
        const r = await call(name, {}, who)
        if (r.ok || r.error !== 'PERMISSION_DENIED') leaks.push(`${name} let ${who} in (${r.ok ? 'ok' : r.error})`)
      }
    }
    expect(leaks).toEqual([])
  }, 600_000)
})
