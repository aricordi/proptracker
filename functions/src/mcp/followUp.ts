// Things the assistant brings up by itself (owner, Nov 24):
//  • "it should fix problems itself… explain why": bookings that weren't approved (with the schedule team's reason), ran out,
//    or were given to a priority booking, so the assistant can say why and offer new times.
//  • "Oh, I see this person is filming on this day with these people. Maybe you could film with them": the people they usually
//    film with who have a shoot coming up, with the free time right before or after it at that house.
// Read only. Other creators' shoots are on the shared schedule already; only first names + times are shown.
import { db } from '../auth.js'
import { nowStamp } from '../gearBooking.js'
import { todayInStudio, addDays } from '../booking.js'
import { freeGaps, aheadDaysFor, type House, type ScheduleDay } from '../schedule.js'
import { loadScheduleSettings } from '../scheduling.js'
import { firstName, hm, type Json, type McpUser } from './common.js'

const PLACE: Record<string, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }

export interface Rebook { id: string; day: string; place: string; start: string; end: string; why: string }
/** Their bookings from the last 7 days that didn't go through and haven't been replaced by another booking that day. */
export async function toRebook(u: McpUser): Promise<Rebook[]> {
  if (u.reviewer) return []
  const today = todayInStudio(), since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const snap = await db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', today).get()
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
  const live = new Set(all.filter(x => x.status === 'booked' || x.status === 'requested').map(x => String(x.date)))
  return all.filter(x => String(x.updatedAt ?? x.deniedAt ?? '') >= since && !live.has(String(x.date))
    && (x.status === 'denied' || x.status === 'expired' || (x.status === 'cancelled' && x.bumped)))
    .map(x => ({ id: x.id, day: String(x.date), place: PLACE[String(x.place)] ?? String(x.place), start: hm(Number(x.start)), end: hm(Number(x.end)),
      why: x.status === 'denied' ? `not approved${x.deniedReason ? `: "${String(x.deniedReason)}"` : ''}`
        : x.status === 'expired' ? 'nobody approved it before it started' : 'the time went to a priority booking' }))
    .slice(0, 5)
}

export interface FriendShoot { name: string; day: string; place: string; start: string; end: string; free_before?: string; free_after?: string }
/** Upcoming shoots (next 2 weeks) of the people they film with most, and the free time right next to them. */
export async function friendsFilming(u: McpUser): Promise<FriendShoot[]> {
  if (u.reviewer) return []
  const today = todayInStudio(), now = nowStamp()
  const past = await db.collection('shoots').where('people', 'array-contains', u.email).get()
  const counts = new Map<string, number>()
  for (const d of past.docs) for (const e of (d.get('people') ?? []) as string[]) if (e !== u.email && !e.startsWith('guest:')) counts.set(e, (counts.get(e) ?? 0) + 1)
  const own = await db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', addDays(today, -90)).get()
  for (const d of own.docs) for (const e of (d.get('people') ?? []) as string[]) if (e !== u.email && !e.startsWith('guest:')) counts.set(e, (counts.get(e) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e]) => e)
  if (!top.length) return []
  const sch = await loadScheduleSettings()
  const last = addDays(today, aheadDaysFor(u.email, sch, false))
  const snap = await db.collection('shoots').where('creatorEmail', 'in', top).where('date', '>=', today).get()
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
    .filter(x => (x.status === 'booked' || x.status === 'requested') && String(x.date) <= last && String(x.from) > now && !((x.people ?? []) as string[]).includes(u.email))
    .sort((a, b) => String(a.from).localeCompare(String(b.from))).slice(0, 6)
  const days = [...new Set(rows.map(x => String(x.date)))]
  const docs = days.length ? await db.getAll(...days.map(d => db.doc(`schedule_days/${d}`))) : []
  const byDay = new Map(days.map((d, i) => [d, docs[i].data() as ScheduleDay | undefined]))
  return rows.map(x => {
    const out: FriendShoot = { name: firstName(String(x.creatorName ?? '')), day: String(x.date), place: PLACE[String(x.place)] ?? String(x.place), start: hm(Number(x.start)), end: hm(Number(x.end)) }
    if (x.place === 'cliff1' || x.place === 'cliff2') {
      const gaps = freeGaps(byDay.get(String(x.date)), String(x.date), x.place as House, sch, now, sch.slotMinutes)
      const after = gaps.find(g => g.start === Number(x.end)), before = gaps.find(g => g.end === Number(x.start))
      if (after) out.free_after = `${hm(after.start)}–${hm(after.start + sch.slotMinutes)}`
      if (before) out.free_before = `${hm(before.end - sch.slotMinutes)}–${hm(before.end)}`
    }
    return out
  })
}
