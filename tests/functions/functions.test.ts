// Calls the real server functions running in the local emulator, in fake-AI
// mode (no Gemini key, no cost). Checks both that they work and who may use them.
import { beforeAll, describe, it, expect } from 'vitest'

const PROJECT = 'demo-proptracker'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const FN = `http://127.0.0.1:5001/${PROJECT}/northamerica-northeast1`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }

function toValue(v: unknown): unknown {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return { integerValue: String(v) }
  return { stringValue: String(v) }
}
async function put(path: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const res = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) })
  if (!res.ok) throw new Error(await res.text())
}
async function exists(path: string) {
  return (await fetch(`${FS}/${path}`, { headers: ADMIN })).ok
}

// A pretend Google sign-in, as the emulator allows.
async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestUri: 'http://localhost',
      returnSecureToken: true,
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: email, email, email_verified: true }))}&providerId=google.com`,
    }),
  })
  return (await res.json()).idToken as string
}

async function call(name: string, data: unknown, email?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (email) headers.Authorization = `Bearer ${await tokenFor(email)}`
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) })
  const body = await res.json()
  return { ok: res.ok, result: body.result, error: body.error?.status as string | undefined }
}

const waitFor = async (check: () => Promise<boolean>, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 300))) {
    if (await check()) return true
  }
  return false
}

const OWNER = 'alexisricordi@gmail.com', ARTS = 'fn-arts@example.com', CREATOR = 'fn-creator@example.com'

beforeAll(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
  await put(`users/${CREATOR}`, { email: CREATOR, role: 'creator', active: true })
  await put('categories/costume', { label: 'Costume', order: 1, active: true })
  await put('tags/t1', { label: 'police', normalizedKey: 'police', usageCount: 1 })
  await put('items/cop', { name: 'Police officer costume', categoryId: 'costume', tags: ['t1'], description: 'Navy uniform with badge' })
  await put('items/chair', { name: 'Wooden dining chair', categoryId: 'prop', tags: [], description: 'Oak chair' })
  await put('items/lamp', { name: 'Brass desk lamp', categoryId: 'prop', tags: [], description: 'Green shade' })
  expect(await waitFor(() => exists('item_vectors/lamp'))).toBe(true)
}, 30000)

describe('smart search', () => {
  it('new and edited props are indexed automatically', async () => {
    await put('items/phone', { name: 'Rotary telephone', categoryId: 'prop', tags: [] })
    expect(await waitFor(() => exists('item_vectors/phone'))).toBe(true)
  })
  it('creators can search and the closest prop comes first', async () => {
    const { ok, result } = await call('searchSimilar', { query: 'police uniform badge' }, CREATOR)
    expect(ok).toBe(true)
    expect(result.results[0].id).toBe('cop')
  })
  it('uninvited and signed-out people are refused', async () => {
    expect((await call('searchSimilar', { query: 'police' }, 'stranger@example.com')).error).toBe('PERMISSION_DENIED')
    expect((await call('searchSimilar', { query: 'police' })).error).toBe('PERMISSION_DENIED')
  })
})

describe('AI fill-in from a photo', () => {
  const photo = { imageBase64: Buffer.from('fake image').toString('base64'), mimeType: 'image/jpeg' }
  it('arts department gets name, category, tags and description', async () => {
    const { ok, result } = await call('analyzePropPhoto', photo, ARTS)
    expect(ok).toBe(true)
    expect(result.name).toBeTruthy()
    expect(result.categoryId).toBe('costume') // picked from the real category list
    expect(result.tags.length).toBeGreaterThan(0)
    expect(result.description).toBeTruthy()
  })
  it('creators cannot use it', async () => {
    expect((await call('analyzePropPhoto', photo, CREATOR)).error).toBe('PERMISSION_DENIED')
  })
  it('rejects things that are not images', async () => {
    expect((await call('analyzePropPhoto', { ...photo, mimeType: 'text/plain' }, ARTS)).error).toBe('INVALID_ARGUMENT')
  })
})

describe('rebuild smart search', () => {
  it('only the owner can run it', async () => {
    expect((await call('rebuildSearchIndex', null, ARTS)).error).toBe('PERMISSION_DENIED')
  })
  it('skips props that are already up to date', async () => {
    const { ok, result } = await call('rebuildSearchIndex', null, OWNER)
    expect(ok).toBe(true)
    expect(result.failed).toBe(0)
    expect(result.unchanged).toBe(result.total)
  })
})
