// Who shows up as a "creator" in analytics, the scoreboard and the Creators list (owner, Oct 27: "only creators and
// me"). Admins, the arts department and the equipment team never appear, even if they booked something.
import { OWNER_EMAIL } from '../config'
import type { AppUser } from '../types'

// Everyone whose numbers count (past creators too, so their old shoots still add up).
export function countedEmails(users: AppUser[]): Set<string> {
  return new Set([OWNER_EMAIL, ...users.filter(u => u.role === 'creator').map(u => u.email)])
}

// The list to show, including people with nothing yet: active creators on the FULL APP + the owner. Creators on Props only
// (test launch demo mode, Oct 27) can't book, so they'd only sit at the bottom as "posting less"; they're left out until switched.
export function creatorPeople(users: AppUser[]): { email: string; name: string }[] {
  const owner = users.find(u => u.email === OWNER_EMAIL)
  return [
    { email: OWNER_EMAIL, name: owner?.name || 'Alex' },
    ...users.filter(u => u.active && u.role === 'creator' && u.access === 'full').map(u => ({ email: u.email, name: u.name || u.email })),
  ]
}
