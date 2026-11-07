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

// SUGGEST THE USUAL PARTNER (owner, Nov 7): creators can't read other people's shoots, but every member can read the
// schedule's day docs (schedule_days). These turn day docs into CollabShoots so the same pattern works on the phone.
interface DaySlot { shootId?: string; name?: string; email?: string; time?: { start: number; end: number }; pending?: boolean; hold?: unknown }
export interface CollabDay { date: string; cliff1?: Record<string, DaySlot>; cliff2?: Record<string, DaySlot> }

const stamp = (date: string, min: number) => `${date}T${String(min).padStart(4, '0')}`   // only compared within one day

/** Day docs → one CollabShoot per shoot (a shoot spread over several grid slots counts once). Holds are skipped. */
export function collabShootsFromDays(days: CollabDay[], slotMinutes: number): CollabShoot[] {
  const out: CollabShoot[] = []
  for (const d of days) for (const place of ['cliff1', 'cliff2'] as const) {
    const byShoot = new Map<string, { s: CollabShoot; start: number; end: number }>()
    for (const [k, e] of Object.entries(d[place] ?? {})) {
      if (!e?.shootId || !e.email || e.hold) continue
      const start = e.time?.start ?? Number(k), end = e.time?.end ?? Number(k) + slotMinutes
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      const was = byShoot.get(e.shootId)
      if (was) { was.start = Math.min(was.start, start); was.end = Math.max(was.end, end); continue }
      byShoot.set(e.shootId, { start, end, s: { id: e.shootId, creatorEmail: e.email.toLowerCase(), creatorName: e.name ?? '', place, date: d.date, from: '', to: '', status: e.pending ? 'requested' : 'booked' } })
    }
    for (const { s, start, end } of byShoot.values()) out.push({ ...s, from: stamp(d.date, start), to: stamp(d.date, end) })
  }
  return out
}

/** This person's usual partners (most often first) who can still film (`allowed` = the friend list), with the friend list's names. */
export function usualPartners(email: string, shoots: CollabShoot[], allowed: { email: string; name: string }[], max = 3): { email: string; name: string; times: number }[] {
  const me = email.toLowerCase()
  const byEmail = new Map(allowed.map(p => [p.email.toLowerCase(), p]))
  return usual(partnersOf(me, shoots)).flatMap(p => {
    const a = byEmail.get(p.email)
    return a && p.email !== me ? [{ email: a.email, name: a.name, times: p.times }] : []
  }).slice(0, max)
}

/** What to call a partner in a chip: the first name, or the full name when someone else in the list shares it. */
export function partnerLabel(p: { email: string; name: string }, allowed: { email: string; name: string }[]): string {
  const first = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const shared = allowed.some(o => o.email !== p.email && first(o.name) === first(p.name))
  return shared ? p.name.trim() : p.name.trim().split(/\s+/)[0]
}
