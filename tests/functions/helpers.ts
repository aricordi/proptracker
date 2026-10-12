// Helpers for talking to the local emulator from tests.
export const PROJECT = 'demo-proptracker'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const FN = `http://127.0.0.1:5001/${PROJECT}/northamerica-northeast1`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }

function toValue(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } }
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return { integerValue: String(v) }
  return { stringValue: String(v) }
}
export async function put(path: string, data: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const res = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) })
  if (!res.ok) throw new Error(await res.text())
}
export async function exists(path: string) {
  return (await fetch(`${FS}/${path}`, { headers: ADMIN })).ok
}

// A pretend Google sign-in, as the emulator allows.
const tokens = new Map<string, string>()
export async function tokenFor(email: string) {
  if (tokens.has(email)) return tokens.get(email)!
  const res = await fetch(`${AUTH}/accounts:signInWithIdp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestUri: 'http://localhost',
      returnSecureToken: true,
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: email, email, email_verified: true }))}&providerId=google.com`,
    }),
  })
  const token = (await res.json()).idToken as string
  tokens.set(email, token)
  return token
}

export async function call(name: string, data: unknown, email?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (email) headers.Authorization = `Bearer ${await tokenFor(email)}`
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) })
  const body = await res.json()
  return { ok: res.ok, result: body.result, error: body.error?.status as string | undefined, message: body.error?.message as string | undefined, details: body.error?.details }
}

export const waitFor = async (check: () => Promise<boolean>, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 300))) {
    if (await check()) return true
  }
  return false
}


export async function clearDatabase() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

export async function getDoc(path: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${FS}/${path}`, { headers: ADMIN })
  if (!res.ok) return null
  return fromFields((await res.json()).fields ?? {})
}

function fromValue(v: any): any {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue)
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {})
  return undefined
}
function fromFields(f: Record<string, any>) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]))
}
