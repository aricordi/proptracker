// Working out a deal when the time someone wants is taken (owner, Nov 24: "putting on the wait list, enabling notifications so
// they get notified, Cliff 1 is free 30 minutes later, that kind of problem solving"). Read only: it lists the options; the
// assistant offers them and books / joins the waitlist / asks for a swap only after the person says yes.
// Never a swap with top-priority people (instant bookers, e.g. Kyle): their time is theirs.
import { db } from '../auth.js'
import { nowStamp } from '../gearBooking.js'
import { conflictAt, freeGaps, priorityLocked, HOUSES, type House, type ScheduleDay } from '../schedule.js'
import { loadScheduleSettings } from '../scheduling.js'
import { firstName, hm, type Json, type McpUser } from './common.js'

const NAME: Record<House, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2' }

export async function dealsFor(place: House, day: string, start: number, end: number, u: McpUser): Promise<{ text: string; structured: Json } | null> {
  const sch = await loadScheduleSettings()
  const now = nowStamp()
  const doc = (await db.doc(`schedule_days/${day}`).get()).data() as ScheduleDay | undefined
  const len = end - start
  const c = conflictAt(doc, place, start, end, sch, now)
  if (!c) return null
  // Closest free time of the same length, at each house (shifting the start as little as possible).
  const near = (h: House) => {
    if (priorityLocked(day, h, sch, u.email, now)) return null
    let best: { start: number; end: number; shift: number } | null = null
    for (const g of freeGaps(doc, day, h, sch, now, len)) {
      const s0 = Math.min(Math.max(start, g.start), g.end - len)
      const shift = Math.abs(s0 - start)
      if (!best || shift < best.shift) best = { start: s0, end: s0 + len, shift }
    }
    return best
  }
  const same = near(place), other = near(HOUSES.find(h => h !== place)!)
  const holder = c.t === 'block' ? null : c.b.entry
  const holderEmail = holder?.email ?? ''
  const priority = !!holderEmail && sch.instantBookers.some(p => p.email === holderEmail)
  const what = c.t === 'block' ? `${NAME[place]} is blocked then (${c.block.note || c.block.type || 'house time'})`
    : c.t === 'held' ? `${NAME[place]} is held for someone then`
    : `${firstName(String(holder?.name ?? 'Someone'))} has ${NAME[place]} ${hm(c.b.start)}–${hm(c.b.end)}`
  // Their own approved house shoots of the same length could be offered in a swap (only for ordinary bookings, never priority).
  let mine: Json[] = []
  if (c.t === 'booking' && !c.b.entry.pending && !priority && holderEmail !== u.email) {
    const snap = await db.collection('shoots').where('creatorEmail', '==', u.email).where('status', '==', 'booked').get()
    mine = snap.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
      .filter(x => x.place !== 'offsite' && String(x.from) > now && Number(x.end) - Number(x.start) === Number(c.b.end) - Number(c.b.start))
      .slice(0, 3).map(x => ({ shoot_id: x.id, label: `${NAME[x.place as House]} ${x.date} ${hm(Number(x.start))}–${hm(Number(x.end))}` }))
  }
  const options: Json[] = []
  if (same && same.shift) options.push({ kind: 'nearest_time', place, day, start: hm(same.start), end: hm(same.end), say: `${NAME[place]} is free ${hm(same.start)}–${hm(same.end)} (${same.shift} min ${same.start > start ? 'later' : 'earlier'})` })
  if (other) options.push({ kind: 'other_house', place: HOUSES.find(h => h !== place), day, start: hm(other.start), end: hm(other.end), say: `${NAME[HOUSES.find(h => h !== place)!]} is free ${hm(other.start)}–${hm(other.end)}${other.shift ? '' : ' (same time)'}` })
  if (c.t !== 'block') options.push({ kind: 'waitlist', place, day, start: hm(c.b.start), say: `Join the waitlist for ${hm(c.b.start)}: if it opens up it's held for them for 20 minutes and they get a notification (notifications must be on in the app: More → Notifications)` })
  if (mine.length && c.t === 'booking') options.push({ kind: 'swap', their_day: day, their_place: place, their_start: hm(c.b.start), my_shoots: mine, say: `only if they've ALREADY agreed with ${firstName(String(holder?.name ?? 'them'))} to trade times (most people don't swap; don't suggest it unprompted): send the swap for one of their same-length shoots (${mine.map(m => m.label).join(', ')})` })
  const text = `${what}. Ways to still make it work: ${options.map((o, i) => `${i + 1}) ${o.say}`).join('; ') || 'nothing nearby that day: try plan_shoot for other days'}.${priority ? ' That time is a priority booking, so no swap.' : ''} Offer these; act only on their yes (book_shoot / join_waitlist / request_swap).`
  return { text, structured: { taken: true, reason: what, options } }
}
