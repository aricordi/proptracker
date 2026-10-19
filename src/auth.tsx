import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'
import type { AppUser, Role } from './types'

export interface Session {
  user: User
  profile: AppUser
  role: Role          // the role the screens act as (may be a "View as" preview)
  realRole: Role      // the person's actual role
  isOwner: boolean
  isStaff: boolean    // owner or arts department
  isGearStaff: boolean   // owner or equipment team
  shootFlow: boolean     // creator-style app (Home / Book / Browse / Me): creators and the owner (who films too)
  canBook: boolean       // may book props and gear (creators + owner). Arts handle requests, they don't book (owner, Oct 19)
  viewingAs: Role | null                 // set while the owner previews another role
  setViewAs: (role: Role | null) => void // owner only
}

export const SessionContext = createContext<Session | null>(null)

// Only use inside the signed-in part of the app (everything under <App>'s routes).
export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession used outside a signed-in session')
  return s
}

// "View as" lets the owner see exactly which screens and buttons each role gets.
// It only changes what the app shows; the server still knows who you really are.
export function makeSession(user: User, profile: AppUser, viewAs: Role | null, setViewAs: (r: Role | null) => void): Session {
  const realRole = profile.role
  const role = realRole === 'owner' && viewAs ? viewAs : realRole
  return {
    user,
    profile,
    role,
    realRole,
    isOwner: role === 'owner',
    isStaff: role === 'owner' || role === 'arts',
    isGearStaff: role === 'owner' || role === 'equipment',
    shootFlow: role === 'creator' || role === 'owner',
    canBook: role === 'creator' || role === 'owner',
    viewingAs: role !== realRole ? role : null,
    setViewAs,
  }
}
