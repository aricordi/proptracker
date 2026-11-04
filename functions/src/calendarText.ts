// Reading old Google Calendar events (pure, shared with tests): which house they're at, and which aren't about filming.
import type { House } from './schedule.js'

// Which house an event is at, from its address or name (owner, Oct 30: "check what address the events say":
// 2375 Cliff = Cliff 1, 2371 Cliff = Cliff 2). null = it doesn't say.
export function houseFromText(text: string): House | null {
  const t = text.toLowerCase()
  if (/\b2371\b/.test(t) || /cliff\s*(#\s*)?(2|two|ii)\b/.test(t)) return 'cliff2'
  if (/\b2375\b/.test(t) || /cliff\s*(#\s*)?(1|one|i)\b/.test(t)) return 'cliff1'
  return null
}

// Events that aren't about filming (owner, Oct 30: "Valentyna away Nov 14 all day… useless"; birthdays are tracked in
// the app, not on the schedule). Hidden from the import unless they name a house. Returns why, or ''.
export function ignoreReason(e: { title: string; location: string; eventType?: string }) {
  const text = `${e.title} ${e.location}`
  if (houseFromText(text)) return ''
  if (e.eventType === 'birthday' || /\b(birthday|bday|b-day)\b|🎂/i.test(text)) return 'Birthday'
  if (e.eventType === 'outOfOffice' || /\b(away|ooo|out of (the )?office|vacation|vacay|holiday|holidays|day off|days off|off work|sick|pto|leave)\b/i.test(text)) return 'Someone away'
  if (e.eventType === 'workingLocation' || e.eventType === 'focusTime') return 'Not a booking'
  return ''
}


// What kind of blocked time an event is, from its words.
export function blockTypeOf(text: string): 'cleaners' | 'maintenance' | 'event' | 'rental' | 'other' {
  const t = text.toLowerCase()
  if (/clean/.test(t)) return 'cleaners'
  if (/maint|repair|plumb|fix/.test(t)) return 'maintenance'
  if (/airbnb|rental|guest|set ?scouter/.test(t)) return 'rental'
  if (/event|party/.test(t)) return 'event'
  return 'other'
}

// Clear enough to bring in by itself (owner, Nov 1: "bring in clear ones", until the old calendars are retired):
// the house is known (from the event's address/name, or a one-house calendar) AND it's either a shoot for a creator
// the app recognises, or blocked time that says what it is (cleaners, maintenance, Airbnb, Stromedy…).
export function isClearEvent(e: { title: string; location: string }, guess: { action: string; email?: string; house: string }, houseKnown: boolean) {
  if (!houseKnown || (guess.house !== 'cliff1' && guess.house !== 'cliff2')) return false
  if (guess.action === 'shoot') return !!guess.email
  if (guess.action === 'block') return blockTypeOf(`${e.title} ${e.location}`) !== 'other' || /stromedy/i.test(e.title)
  return false
}

// Everyone named in an event, in the order they appear (owner, Nov 4: some old events are ONE 6-hour booking for three
// creators filming together, e.g. "Kyle / Jana / Ari - Cliff 1"). First names, whole words; each person once.
export function namedPeople<P extends { email: string; name: string }>(text: string, people: P[]): P[] {
  const t = text.toLowerCase()
  const hits: { p: P; at: number }[] = []
  for (const p of people) {
    const first = (p.name.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (first.length < 2) continue
    const m = new RegExp(`\\b${first}\\b`).exec(t)
    if (m && !hits.some(h => h.p.email === p.email)) hits.push({ p, at: m.index })
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.p).slice(0, 4)
}

// One booking shared by several creators → back-to-back turns, one each, in the order picked (the app's way of filming
// together). Equal parts on 30-minute steps; the last person's turn ends when the event ends.
export function splitHours(start: number, end: number, n: number): { start: number; end: number }[] {
  if (n <= 1 || end - start < n * 30) return [{ start, end }]
  const len = Math.max(30, Math.round((end - start) / n / 30) * 30)
  return Array.from({ length: n }, (_, i) => ({ start: start + i * len, end: i === n - 1 ? end : start + (i + 1) * len }))
}

// Work that happens AT a house but doesn't stop filming (owner, Nov 4: "Tesla chargers installation… you could still
// technically film around it"). Only a first guess: the team picks "Heads-up" or "Blocks filming" on the import screen.
export function looksLikeHeadsUp(text: string): boolean {
  return /install|delivery|deliver|inspection|inspector|contractor|landscap|lawn|garden|yard|charger|tesla|roof|gutter|window clean|pest|snow|outside|exterior|driveway|meter|internet|wifi|technician/i.test(text)
}
