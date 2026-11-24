// Reading between the lines (owner, Nov 24: "if they say 'I want to film a video with Justin and Rolly tomorrow' it should
// understand what he's trying to say"). Pure helpers, no database, unit-tested:
//   • resolvePerson: a name as people say it ("Rolly", "jus", "Eddy", "Justn", "@kyle") → who it is, who it might be, or nobody;
//     a typo or loose match is never booked silently: it comes back as "maybe" so the assistant asks "did you mean…?".
//   • resolveWhen: "tomorrow", "sat", "next friday", "this weekend", "next week", "nov 28", "the 30th" → the days to look at.
import { nicknamesOf } from '../calendarText.js'
import { normalizeWhen, namedDate } from '../timeFinder.js'
import { addDays, weekday } from '../booking.js'

export interface Named { email: string; name: string }
export type PersonMatch<T> = { status: 'one' | 'many' | 'maybe' | 'none'; hits: T[] }

const plain = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 '-]/g, ' ').replace(/\s+/g, ' ').trim()

/** Letters that differ between two words (insert, delete, change, swap of two neighbours). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 9
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}
const typoOk = (said: string, real: string) => {
  if (said.length < 4 || real.length < 4) return false
  return editDistance(said, real) <= (Math.min(said.length, real.length) >= 7 ? 2 : 1)
}

/** Who a name means. `isId` lets the caller recognise its own anonymous person ids. Never matches by email address. */
export function resolvePerson<T extends Named>(people: T[], said: string, me: string, isId?: (p: T, said: string) => boolean): PersonMatch<T> {
  const raw = said.trim().replace(/^@+/, '')
  const others = people.filter(p => p.email !== me)
  if (!raw || raw.includes('@')) return { status: 'none', hits: [] }
  if (isId && /^p_[0-9a-f]{12}$/i.test(raw)) {
    const hits = others.filter(p => isId(p, raw.toLowerCase()))
    return { status: hits.length ? 'one' : 'none', hits }
  }
  const n = plain(raw)
  if (!n) return { status: 'none', hits: [] }
  const parts = (p: T) => plain(p.name).split(' ').filter(Boolean)
  const pick = (hits: T[]): PersonMatch<T> => hits.length === 1 ? { status: 'one', hits } : { status: 'many', hits }
  // 1. Exact: the whole name, then the first name, then the last name.
  const full = others.filter(p => plain(p.name) === n)
  if (full.length) return pick(full)
  const words = n.split(' ')
  if (words.length > 1) {
    // "Justin F" / "Justin Figs": first name + the start of the last name.
    const fl = others.filter(p => { const w = parts(p); return w[0] === words[0] && w.length > 1 && w.slice(1).join(' ').startsWith(words.slice(1).join(' ')) })
    if (fl.length) return pick(fl)
  }
  const first = others.filter(p => parts(p)[0] === n)
  if (first.length) return pick(first)
  const last = others.filter(p => { const w = parts(p); return w.length > 1 && w[w.length - 1] === n })
  if (last.length) return pick(last)
  // 2. Nicknames both ways ("Eddy" → Eduard, "Rolly" → Roland, "Mike" → Michael).
  const nick = others.filter(p => { const f = parts(p)[0] ?? ''; return nicknamesOf(n).includes(f) || nicknamesOf(f).includes(n) })
  if (nick.length) return pick(nick)
  // 3. The start of a first name ("jus" → Justin, "ari" → Ariel): sure only when it fits one person.
  if (n.length >= 3 && words.length === 1) {
    const pre = others.filter(p => (parts(p)[0] ?? '').startsWith(n))
    if (pre.length === 1) return { status: 'one', hits: pre }
    if (pre.length > 1) return { status: 'many', hits: pre.slice(0, 6) }
  }
  // 4. A likely typo or a loose short form ("Justn", "Rolli", "Valentina"): only ever a suggestion to confirm.
  const loose = others.filter(p => {
    const w = parts(p), f = w[0] ?? ''
    if (typoOk(n, f) || typoOk(n, plain(p.name)) || (w.length > 1 && typoOk(n, w[w.length - 1]))) return true
    // Same first 3 letters and close in length ("rolly" ~ "roland", "val" handled above).
    return n.length >= 4 && f.length >= 4 && n.slice(0, 3) === f.slice(0, 3) && Math.abs(n.length - f.length) <= 3
  })
  if (loose.length) return { status: 'maybe', hits: loose.slice(0, 4) }
  return { status: 'none', hits: [] }
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
/** The days a casual "when" means, from today (studio time). null = nothing understood (the caller asks or uses a default). */
export function resolveWhen(text: string, today: string): { days: string[]; label: string } | null {
  const t = normalizeWhen(text)
  if (!t.trim()) return null
  const range = (from: string, n: number, label: string) => ({ days: Array.from({ length: n }, (_, i) => addDays(from, i)), label })
  if (/\bin 2 days\b|\bday after tomorrow\b/.test(t)) return range(addDays(today, 2), 1, 'the day after tomorrow')
  if (/\btomorrow\b/.test(t)) return range(addDays(today, 1), 1, 'tomorrow')
  if (/\btoday\b|\btonight\b|\bthis (afternoon|evening|morning)\b/.test(t)) return range(today, 1, 'today')
  const wdNow = weekday(today)
  if (/\b(this )?weekend\b/.test(t)) {
    const next = /\bnext weekend\b/.test(t)
    let sat = today; while (weekday(sat) !== 6) sat = addDays(sat, 1)
    if (wdNow === 0 && !next) return range(today, 1, 'this weekend')   // Sunday: what's left of it
    if (next) sat = addDays(sat, 7)
    return range(sat, 2, next ? 'next weekend' : 'this weekend')
  }
  if (/\bnext week\b/.test(t)) {
    let mon = addDays(today, 1); while (weekday(mon) !== 1) mon = addDays(mon, 1)
    return range(mon, 7, 'next week')
  }
  if (/\bthis week\b/.test(t)) { let n = 1; while (weekday(addDays(today, n)) !== 1 && n < 7) n++; return range(today, n, 'this week') }
  const named = namedDate(t, today)
  if (named && named !== 'bad') return range(named, 1, named)
  for (let i = 0; i < 7; i++) {
    const w = WEEKDAYS[i]
    if (!new RegExp(`\\b${w}\\b`).test(t)) continue
    let d = addDays(today, 1); while (weekday(d) !== i) d = addDays(d, 1)
    if (new RegExp(`\\bnext ${w}\\b`).test(t)) {   // "next Friday" = the Friday of next week (Monday–Sunday)
      let mon = addDays(today, 1); while (weekday(mon) !== 1) mon = addDays(mon, 1)
      if (d < mon) d = addDays(d, 7)
    }
    if (wdNow === i && /\b(this|today)\b/.test(t)) d = today
    return range(d, 1, w[0].toUpperCase() + w.slice(1))
  }
  return null
}
