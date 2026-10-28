import {
  collection, doc, onSnapshot, query, orderBy, getDoc, setDoc, updateDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../firebase'
import type { AppUser, Role } from '../types'

const col = collection(db, 'users')

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function subscribeToUser(email: string, cb: (u: AppUser | null) => void, onError: () => void) {
  return onSnapshot(
    doc(col, normalizeEmail(email)),
    snap => cb(snap.exists() ? (snap.data() as AppUser) : null),
    onError,
  )
}

export function subscribeToUsers(cb: (users: AppUser[]) => void) {
  return onSnapshot(
    query(col, orderBy('email')),
    snap => cb(snap.docs.map(d => d.data() as AppUser)),
    () => cb([]),
  )
}

function actor() {
  return normalizeEmail(auth.currentUser?.email ?? 'unknown')
}

export type InviteResult = 'invited' | 'already-exists'

export async function inviteUser(email: string, role: Role, name?: string): Promise<InviteResult> {
  const id = normalizeEmail(email)
  const ref = doc(col, id)
  if ((await getDoc(ref)).exists()) return 'already-exists'
  const now = new Date().toISOString()
  await setDoc(ref, {
    email: id,
    role,
    active: true,
    // Test launch (owner, Oct 27): every new creator starts on Props only; the owner switches them to Full app.
    ...(role === 'creator' ? { access: 'props' } : {}),
    ...(name?.trim() ? { name: name.trim() } : {}),
    invitedBy: actor(),
    invitedAt: now,
  })
  return 'invited'
}

export async function updateUser(email: string, data: Partial<Pick<AppUser, 'role' | 'active' | 'name' | 'access'>>) {
  return updateDoc(doc(col, normalizeEmail(email)), {
    ...data,
    updatedAt: new Date().toISOString(),
    updatedBy: actor(),
  })
}

// Owner only (Oct 27): move a person, and everything filed under their email, to a new email (merges with an
// existing account at that email). First call without `apply` to see what would change.
export interface EmailMovePreview {
  from: string; to: string; merging: boolean; oldName: string | null; newName: string | null
  summary: { what: string; count: number }[]; profile: boolean; phones: number; applied: boolean
}
export async function changeUserEmail(from: string, to: string, apply: boolean) {
  const r = await httpsCallable<{ from: string; to: string; apply: boolean }, EmailMovePreview>(functions, 'changeUserEmail', { timeout: 540000 })({ from, to: normalizeEmail(to), apply })
  return r.data
}
