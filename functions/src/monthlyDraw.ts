// The monthly draw for the guaranteed Cliff 1 slots (owner, Oct 16 + Nov 1): creators rank up to 8 wished slots between
// the 15th and the 20th; on the 20th at 6 PM everyone gets their slots for next month in fair rounds. Pure (shared with
// tests): no database here.
//  - Rounds: everyone gets ONE slot per round; the turn order is random (seeded by the month, so the same input gives
//    the same result) and flips every round ("snake"), so nobody is always first.
//  - Each turn takes the person's best still-free wish. Partners are placed back to back only when BOTH wished for the
//    same pair of touching slots naming each other.
//  - No wish left → the app places them, using the days and times they usually film.
//  - Spread out (owner, Nov 1: "we don't want creators to get 4 days back to back"): never two of someone's monthly
//    slots on the same day or on days next to each other; the app's own placements also aim for one per week.
import { addDays, weekday } from './booking.js'

export const WISHLIST_OPEN_DAY = 15      // wishes open on the 15th of the month before…
export const DRAW_DAY = 20               // …and the draw runs on the 20th…
export const DRAW_MINUTE = 18 * 60       // …at 6 PM (Toronto)
export const MAX_WISHES = 8
export const MIN_GAP_DAYS = 2            // 2 = at least one day in between

export interface Wish { date: string; start: number; partner?: string }
export interface DrawPerson {
  email: string
  name: string
  priority: boolean            // in the priority group (may have Cliff 1 on priority days)
  wishes: Wish[]               // ranked, best first
  usual: { weekdays: number[]; starts: number[] }   // from past shoots, for the app's own placements
  busyDays: string[]           // days they already have a house slot (one house slot a day)
}
export interface DrawInput {
  month: string                // 'YYYY-MM'
  people: DrawPerson[]
  free: { date: string; start: number }[]   // Cliff 1 slots still free in that month
  perPerson: number            // 4
  slotMinutes: number          // 120
  priorityWeekdays: number[]   // Cliff 1 days reserved for the priority group
  seed?: string
}
export type How = 'wish' | 'partner' | 'auto'
export interface Placement { email: string; name: string; date: string; start: number; how: How; rank?: number; with?: string }
export interface DrawResult { placements: Placement[]; short: { email: string; name: string; missing: number }[]; order: string[] }

// The month the next draw is for (the 20th of this month fills next month), and its wish window.
export const monthAfter = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
export const monthBefore = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
export const drawMonthFor = (today: string) => monthAfter(today.slice(0, 7))
export function wishWindow(month: string) {
  const before = monthBefore(month)
  const dd = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${dd(Math.floor(DRAW_MINUTE / 60))}:${dd(DRAW_MINUTE % 60)}`
  return { opens: `${before}-${dd(WISHLIST_OPEN_DAY)}T00:00`, closes: `${before}-${dd(DRAW_DAY)}T${hhmm}` }
}
export const daysOfMonth = (month: string) => {
  const out: string[] = []
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d)
  return out
}
const dayNo = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000

// Small seeded random numbers, so a re-run with the same wishes gives the same draw.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
}

export function runDraw(input: DrawInput): DrawResult {
  const { people, perPerson, slotMinutes } = input
  const rand = rng(input.seed ?? input.month)
  const order = [...people].sort((a, b) => a.email.localeCompare(b.email))
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const free = new Set(input.free.map(f => `${f.date}|${f.start}`))
  const given = new Map<string, Placement[]>(people.map(p => [p.email, []]))
  const busy = new Map<string, Set<string>>(people.map(p => [p.email, new Set(p.busyDays)]))
  const byEmail = new Map(people.map(p => [p.email, p]))
  const weeks = Math.max(1, Math.ceil(daysOfMonth(input.month).length / 7))

  const ok = (p: DrawPerson, date: string, start: number) =>
    date.startsWith(input.month) && free.has(`${date}|${start}`)
    && (p.priority || !input.priorityWeekdays.includes(weekday(date)))
    && !busy.get(p.email)!.has(date)
    && given.get(p.email)!.every(g => Math.abs(dayNo(g.date) - dayNo(date)) >= MIN_GAP_DAYS)
  const place = (p: DrawPerson, date: string, start: number, how: How, extra: Partial<Placement> = {}) => {
    free.delete(`${date}|${start}`); busy.get(p.email)!.add(date)
    given.get(p.email)!.push({ email: p.email, name: p.name, date, start, how, ...extra })
  }
  // The app's own pick: spread through the month (aim for this round's week), then their usual day and time.
  const auto = (p: DrawPerson, round: number) => {
    const target = Math.min(weeks - 1, Math.floor((round * weeks) / perPerson))
    let best: { date: string; start: number; score: number } | null = null
    for (const f of input.free) {
      if (!ok(p, f.date, f.start)) continue
      const week = Math.floor((Number(f.date.slice(8, 10)) - 1) / 7)
      const gap = given.get(p.email)!.reduce((m, g) => Math.min(m, Math.abs(dayNo(g.date) - dayNo(f.date))), 31)
      const score = (week === target ? 4 : -Math.abs(week - target)) + Math.min(gap, 7) / 2
        + (p.usual.weekdays.includes(weekday(f.date)) ? 3 : 0) + (p.usual.starts.includes(f.start) ? 2 : 0) + rand() * 0.01
      if (!best || score > best.score) best = { ...f, score }
    }
    if (best) place(p, best.date, best.start, 'auto')
  }

  for (let round = 0; round < perPerson; round++) {
    const turn = round % 2 === 0 ? order : [...order].reverse()
    for (const p of turn) {
      const mine = given.get(p.email)!
      if (mine.length > round || mine.length >= perPerson) continue   // already got this round's slot (as someone's partner)
      let done = false
      for (const [i, w] of p.wishes.entries()) {
        if (!ok(p, w.date, w.start)) continue
        const q = w.partner ? byEmail.get(w.partner) : undefined
        const qw = q?.wishes.find(x => x.partner === p.email && x.date === w.date && Math.abs(x.start - w.start) === slotMinutes)
        if (q && qw && given.get(q.email)!.length < perPerson && ok(q, qw.date, qw.start)) {
          place(p, w.date, w.start, 'wish', { rank: i + 1, with: q.name })
          place(q, qw.date, qw.start, 'partner', { rank: q.wishes.indexOf(qw) + 1, with: p.name })
        } else place(p, w.date, w.start, 'wish', { rank: i + 1 })
        done = true
        break
      }
      if (!done) auto(p, round)
    }
  }
  const placements = [...given.values()].flat().sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  const short = people.map(p => ({ email: p.email, name: p.name, missing: perPerson - given.get(p.email)!.length })).filter(x => x.missing > 0)
  return { placements, short, order: order.map(p => p.email) }
}
