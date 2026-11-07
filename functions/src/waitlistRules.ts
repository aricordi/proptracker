// "Notify me if it opens" (owner, Nov 7): the pure rules of the house-slot waitlist, shared by the server (waitlist.ts)
// and the app. No database here, so every rule is unit-tested.
import { blockAt, holdActive, houseSlotsOn, needsGuideline, priorityLocked, slotKey, slotWindow, type House, type ScheduleDay, type ScheduleSettings } from './schedule.js'

export const MAX_WAITING = 5   // waiting entries per person at once
export type WaitStatus = 'waiting' | 'offered' | 'done' | 'left' | 'expired'
export interface WaitEntry { id?: string; date: string; house: House; start: number; email: string; name: string; at: string; status: WaitStatus; inviteId?: string; offeredAt?: string }

/** One record per person and slot, so joining twice never makes two. */
export const waitId = (date: string, house: House, start: number, emailKey: string) => `${date}_${house}_${start}_${emailKey}`

/** Slots (house + start) that held something before this write and are empty after it: a cancel, a decline, a hold that
 * ran out, a move away. Taking a slot (a hold or a shoot appearing) never counts, so the offer's own write can't loop. */
export function freedSlots(before: ScheduleDay | undefined, after: ScheduleDay | undefined): { house: House; start: number }[] {
  const out: { house: House; start: number }[] = []
  for (const house of ['cliff1', 'cliff2'] as const) {
    const was = before?.[house] ?? {}, now = after?.[house] ?? {}
    for (const k of Object.keys(was)) if (!now[k] && /^\d+$/.test(k)) out.push({ house, start: Number(k) })
  }
  return out
}

/** Who is on the slot right now, for joining the list: free, blocked, yours, or someone else's (booked, asked or held). */
export function slotOccupant(day: ScheduleDay | undefined, house: House, start: number, s: ScheduleSettings, email: string, now: string): 'free' | 'blocked' | 'mine' | 'taken' {
  const e = day?.[house]?.[slotKey(start)]
  const active = !!e && (e.hold ? holdActive(e, now) : !!e.shootId)
  if (!active && blockAt(day, house, start, s.slotMinutes)) return 'blocked'
  if (!active) return 'free'
  return e!.email?.toLowerCase() === email.toLowerCase() ? 'mine' : 'taken'
}

/** Why the server would refuse to put this person on the list, before they tap (the same checks as joinWaitlist, minus
 * who holds the slot): the time has started, they already film at a house that day, the priority lock, or a Cliff 1
 * priority-day slot that needs a guideline. null = they can wait for it. The bell and the chat only offer it when null. */
export function waitRefusal(day: ScheduleDay | undefined, date: string, house: House, start: number, s: ScheduleSettings, email: string, now: string):
  'past' | 'day-limit' | 'locked' | 'guideline' | null {
  if (slotWindow(date, start, s.slotMinutes).from <= now) return 'past'
  if (houseSlotsOn(day, email, now) >= s.slotsPerDay) return 'day-limit'
  if (priorityLocked(date, house, s, email, now)) return 'locked'
  if (needsGuideline(date, house, email, s)) return 'guideline'
  return null
}

/** Place in line among the people still waiting for that slot (1 = next), oldest first. */
export function positionOf(entries: Pick<WaitEntry, 'email' | 'at' | 'status'>[], email: string): number {
  const waiting = entries.filter(x => x.status === 'waiting').sort((a, b) => a.at.localeCompare(b.at) || a.email.localeCompare(b.email))
  const i = waiting.findIndex(x => x.email === email)
  return i < 0 ? 0 : i + 1
}

/** The next person to offer a freed slot to, oldest first. */
export const nextInLine = <T extends Pick<WaitEntry, 'at' | 'email' | 'status'>>(entries: T[]): T[] =>
  entries.filter(x => x.status === 'waiting').sort((a, b) => a.at.localeCompare(b.at) || a.email.localeCompare(b.email))

/** The chat (time finder): the exact time they asked for on that one day is someone else's, so offer the waitlist. */
export function waitlistSpotFor(day: ScheduleDay | undefined, date: string, houses: House[], at: number | undefined, s: ScheduleSettings, email: string, now: string,
  options: { date: string; start: number }[]): { date: string; house: House; start: number } | null {
  if (at === undefined || !s.slots.includes(at)) return null
  if (options.some(o => o.date === date && o.start === at)) return null   // that time is free somewhere: no need to wait
  for (const house of houses) {
    if (slotOccupant(day, house, at, s, email, now) === 'taken' && !waitRefusal(day, date, house, at, s, email, now)) return { date, house, start: at }
  }
  return null
}
