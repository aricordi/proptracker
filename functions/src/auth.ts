// Shared by all server functions: the database handle and "who is calling?".
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'

// Every function runs in Montréal. Set here because every module imports this one first.
// maxInstances 20 (was 5): at 5, bursts got instant 500s with no log ("no available instance"), Oct 22. Idle copies cost nothing.
setGlobalOptions({ region: 'northamerica-northeast1', maxInstances: 20 })

initializeApp()
export const db = getFirestore()

// Keep in sync with src/config.ts, firestore.rules and storage.rules.
export const OWNER_EMAIL = 'alexisricordi@gmail.com'

export type Role = 'owner' | 'arts' | 'creator' | 'equipment' | 'admin'   // equipment = gear team (gear only, no props)
// admin (owner, Oct 20): a VIEWER. Sees what the arts department and the equipment team see (through the security
// rules), books their own shoots/props/gear exactly like a creator, and can invite creators + change the booking rules
// (both client writes allowed by the rules). On the server an admin is treated as a creator, never as staff.

export interface Caller {
  email: string
  name: string
  role: Role
  isStaff: boolean
}

export async function getCaller(req: CallableRequest): Promise<Caller | null> {
  const token = req.auth?.token
  if (!token?.email || token.email_verified !== true) return null
  const email = token.email.toLowerCase()
  const fallbackName = typeof token.name === 'string' ? token.name : email
  if (email === OWNER_EMAIL) return { email, name: fallbackName, role: 'owner', isStaff: true }
  const snap = await db.doc(`users/${email}`).get()
  const data = snap.data()
  if (!snap.exists || data?.active !== true) return null
  const role = data.role as Role
  return { email, name: data.name || fallbackName, role, isStaff: role === 'owner' || role === 'arts' }
}

// Admins don't film (owner, Oct 27): they only pass where 'admin' is listed. `noAdmin` is kept for old call sites.
const ADMIN_COVERS: Role[] = []
// Notice periods, pauses and late-gear blocks apply to creators.
export const booksLikeCreator = (c: Caller) => c.role === 'creator'
export async function requireRole(req: CallableRequest, allowed: Role[], opts: { noAdmin?: boolean } = {}): Promise<Caller> {
  const caller = await getCaller(req)
  const ok = !!caller && (allowed.includes(caller.role)
    || (caller.role === 'admin' && !opts.noAdmin && allowed.some(r => ADMIN_COVERS.includes(r))))
  if (!ok) throw new HttpsError('permission-denied', 'Not allowed')
  return caller!
}

// Options for every function the app calls. "public" only means the app may
// reach the function at all; each function still checks sign-in and role
// itself (requireRole). Set explicitly so every deploy re-applies it.
export const CALLABLE = { invoker: 'public' as const }
