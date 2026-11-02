// Who films with whom (owner, Nov 2: "see if they book together on the same day with the same people… establish a pattern of
// who they like to film with"). Pure, no AI: two creators "filmed together" when their shoots are on the same day at the same
// house BACK TO BACK (one ends when the other starts), or one confirmed the other's invite (invitedBy). Requested shoots count
// too (they show intent); cancelled / denied / expired ones don't. The result is a pattern per person: usual partners, how
// many times, and when they last filmed together.

export interface CollabShoot {
  id: string; creatorEmail: string; creatorName: string; place: string; date: string; from: string; to: string
  status: string; invitedBy?: string
}
export interface Partner { email: string; name: string; times: number; last: string; invited: number }
export interface Pair { a: string; b: string; aName: string; bName: string; times: number; last: string }

const counts = (s: { status: string }) => s.status === 'booked' || s.status === 'requested'
const key = (x: string, y: string) => x < y ? `${x}|${y}` : `${y}|${x}`

/** Every pair that filmed together, most often first. A pair counts once per day (a 3-person chain = 3 pairs). */
export function collabPairs(shoots: CollabShoot[]): Pair[] {
  const live = shoots.filter(counts)
  const byDayHouse = new Map<string, CollabShoot[]>()
  for (const s of live) {
    if (s.place === 'offsite') continue
    const k = `${s.date}|${s.place}`
    byDayHouse.set(k, [...(byDayHouse.get(k) ?? []), s])
  }
  const names = new Map(live.map(s => [s.creatorEmail, s.creatorName]))
  const seen = new Map<string, Set<string>>()   // pair key → days counted
  const last = new Map<string, string>()
  const add = (x: string, y: string, date: string) => {
    if (!x || !y || x === y) return
    const k = key(x, y)
    const days = seen.get(k) ?? new Set<string>()
    days.add(date); seen.set(k, days)
    if ((last.get(k) ?? '') < date) last.set(k, date)
  }
  for (const list of byDayHouse.values()) {
    // Chains of back-to-back shoots: everyone in one unbroken block filmed "together" that day.
    const sorted = [...list].sort((p, q) => p.from.localeCompare(q.from))
    let block: CollabShoot[] = []
    const flush = () => { for (let i = 0; i < block.length; i++) for (let j = i + 1; j < block.length; j++) add(block[i].creatorEmail, block[j].creatorEmail, block[i].date); block = [] }
    for (const s of sorted) {
      if (block.length && block.some(b => b.to === s.from)) block.push(s)
      else { flush(); block = [s] }
    }
    flush()
  }
  for (const s of live) if (s.invitedBy) add(s.creatorEmail, s.invitedBy.toLowerCase(), s.date)
  return [...seen.entries()].map(([k, days]) => {
    const [a, b] = k.split('|')
    return { a, b, aName: names.get(a) ?? a.split('@')[0], bName: names.get(b) ?? b.split('@')[0], times: days.size, last: last.get(k)! }
  }).sort((p, q) => q.times - p.times || q.last.localeCompare(p.last))
}

/** One person's usual partners, most often first. `invited` = times one invited the other. */
export function partnersOf(email: string, shoots: CollabShoot[], pairs = collabPairs(shoots)): Partner[] {
  const invites = new Map<string, number>()
  for (const s of shoots) if (counts(s) && s.invitedBy) {
    const inv = s.invitedBy.toLowerCase()
    if (s.creatorEmail === email) invites.set(inv, (invites.get(inv) ?? 0) + 1)
    else if (inv === email) invites.set(s.creatorEmail, (invites.get(s.creatorEmail) ?? 0) + 1)
  }
  return pairs.filter(p => p.a === email || p.b === email).map(p => {
    const other = p.a === email ? p.b : p.a
    return { email: other, name: p.a === email ? p.bName : p.aName, times: p.times, last: p.last, invited: invites.get(other) ?? 0 }
  })
}

/** "Usual partner" = filmed together at least twice. */
export const USUAL_TIMES = 2
export const usual = (ps: Partner[]) => ps.filter(p => p.times >= USUAL_TIMES)

/** Who is right before/after this shoot at the same house (for the request screen: "back to back with Riley, a usual partner"). */
export function neighboursOf(s: CollabShoot, shoots: CollabShoot[]): CollabShoot[] {
  if (s.place === 'offsite') return []
  return shoots.filter(x => counts(x) && x.id !== s.id && x.date === s.date && x.place === s.place && x.creatorEmail !== s.creatorEmail
    && (x.to === s.from || x.from === s.to))
}
