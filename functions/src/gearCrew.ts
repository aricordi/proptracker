// Shared gear for friends filming back to back (owner, Oct 20: "one booking for the group but everyone
// needs to be responsible"). One gear booking covers the whole block; every friend on its crew can pick
// it up, return it, and has it on their record. Pure helpers, shared by the server and the app.
import { GEAR_DAY_START, GEAR_DAY_END } from './gearBooking.js'

export interface CrewShoot { id: string; email: string; name: string; date: string; place: string; start: number; end: number }
export interface CrewMember { email: string; name: string; shootId: string }

export const MAX_CREW = 4   // you + up to 3 friends

// Other people's shoots that run back to back with mine (same day, same place), following the chain
// both ways: You 1–3 · Kyle 3–5 · Jana 5–7 → Kyle and Jana. Your own other shoots are skipped.
export function backToBack(mine: CrewShoot, all: CrewShoot[]): CrewShoot[] {
  const same = all.filter(s => s.id !== mine.id && s.date === mine.date && s.place === mine.place)
  const out: CrewShoot[] = []
  let start = mine.start, end = mine.end
  for (let grew = true; grew;) {
    grew = false
    for (const s of same) {
      if (out.includes(s)) continue
      if (s.end === start || s.start === end) {
        if (s.email === mine.email) continue
        out.push(s); start = Math.min(start, s.start); end = Math.max(end, s.end); grew = true
      }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// Is mine + these friends one unbroken block on the same day and in the same place?
export function crewProblem(mine: CrewShoot, friends: CrewShoot[]): string | null {
  if (friends.length > MAX_CREW - 1) return `Gear can be shared by up to ${MAX_CREW} people.`
  const all = [mine, ...friends]
  if (new Set(all.map(s => s.email)).size !== all.length) return 'Each friend can only be on the gear once.'
  if (friends.some(f => f.date !== mine.date || f.place !== mine.place)) return 'Shared gear is only for friends filming back to back with you, the same day and in the same place.'
  const sorted = [...all].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start !== sorted[i - 1].end) return 'Shared gear is only for friends filming back to back with you (no gaps).'
  }
  return null
}

// The gear hours for the whole block (trimmed to 6 AM–midnight like any gear booking).
export function crewHours(shoots: { start: number; end: number }[]) {
  const s = Math.min(...shoots.map(x => x.start)), e = Math.max(...shoots.map(x => x.end))
  const start = Math.min(Math.max(s, GEAR_DAY_START), GEAR_DAY_END - 30)
  const end = Math.max(Math.min(e, GEAR_DAY_END), start + 30)
  return { start, end }
}

// Everyone responsible for a gear booking: whoever booked it and their crew.
export const responsible = (b: { creatorEmail?: string; crewEmails?: string[] }) =>
  [...new Set([b.creatorEmail, ...(b.crewEmails ?? [])].filter((x): x is string => !!x))]
export const isResponsible = (b: { creatorEmail?: string; crewEmails?: string[] }, email: string) => responsible(b).includes(email)
