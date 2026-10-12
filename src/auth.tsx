import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'
import type { AppUser, Role } from './types'

export interface Session {
  user: User
  profile: AppUser
  role: Role
  isOwner: boolean
  isStaff: boolean   // owner or arts department
}

export const SessionContext = createContext<Session | null>(null)

// Only use inside the signed-in part of the app (everything under <App>'s routes).
export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession used outside a signed-in session')
  return s
}

export function makeSession(user: User, profile: AppUser): Session {
  return {
    user,
    profile,
    role: profile.role,
    isOwner: profile.role === 'owner',
    isStaff: profile.role === 'owner' || profile.role === 'arts',
  }
}
