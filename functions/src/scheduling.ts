// House schedule (Cliff 1 / Cliff 2 / offsite): book, cancel, block time, settings.
// Every booking is written in a transaction together with schedule_days/{date}, which
// is what makes double-booking a house impossible (same idea as gear_holds for gear).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { db, requireRole, CALLABLE, OWNER_EMAIL, type Caller } from './auth.js'
import { todayInStudio, isDay } from './booking.js'
import { nowStamp } from './gearBooking.js'
import {
  cleanScheduleSettings, checkSlot, priorityLocked, blockAt, slotKey, slotWindow, monthOf, fmtSlot, isPriorityDay,
  SCHEDULE_MESSAGES, MONTHLY_HOUSE, BLOCK_TYPES, type ScheduleSettings, type ScheduleDay, type Place, type House,
  type ShootKind, type BlockType, type ScheduleProblem,
} from './schedule.js'

const TEAM = ['owner', 'equipment']
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const isTeam = (c: Caller) => TEAM.includes(c.role)
const fail = (problem: ScheduleProblem, extra = '') =>
  new HttpsError('failed-precondition', SCHEDULE_MESSAGES[problem] + extra, { problem })

export async function loadScheduleSettings(): Promise<ScheduleSettings> {
  return cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data())
}

// Who the shoot is for: yourself, or (schedule team only) anyone with an active account.
async function shootFor(caller: Caller, forEmail: unknown): Promise<{ email: string; name: string }> {
  const email = str(forEmail, 200).toLowerCase()
  if (!email || email === caller.email) return { email: caller.email, name: caller.name }
  if (!isTeam(caller)) throw new HttpsError('permission-denied', 'Only the schedule team can book for someone else.')
  if (email === OWNER_EMAIL) return { email, name: 'Owner' }
  const u = (await db.doc(`users/${email}`).get()).data()
  if (!u || u.active !== true) throw new HttpsError('not-found', 'That person has no active account.')
  return { email, name: u.name || email }
}

export const bookShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const today = todayInStudio(), now = nowStamp()
  const problem = checkSlot(d.place, d.date, d.start, s, today, now)
  if (problem) throw fail(problem)
  const place = d.place as Place, date = d.date as string, start = d.start as number
  const who = await shootFor(caller, d.forEmail)
  const team = isTeam(caller)
  const where = place === 'offsite' ? str(d.where, 200) : ''
  if (place === 'offsite' && !where) throw fail('no-where')
  if (place !== 'offsite' && !team && priorityLocked(date, place, s, who.email, now)) throw fail('locked')

  // Monthly (guaranteed) slots count only at Cliff 1; everything else is an extra slot.
  let kind: ShootKind = place === 'offsite' ? 'offsite' : place === MONTHLY_HOUSE && d.kind === 'monthly' ? 'monthly' : 'extra'
  if (kind === 'monthly') {
    const mine = await db.collection('shoots').where('creatorEmail', '==', who.email).where('month', '==', monthOf(date)).get()
    const used = mine.docs.filter(x => x.get('status') === 'booked' && x.get('kind') === 'monthly').length
    if (used >= s.monthlySlots) throw fail('no-monthly-left')
  }

  const win = slotWindow(date, start, s.slotMinutes)
  const at = new Date().toISOString()
  const ref = db.collection('shoots').doc()
  const dayRef = db.doc(`schedule_days/${date}`)
  await db.runTransaction(async tx => {
    const day = ((await tx.get(dayRef)).data() ?? { date }) as ScheduleDay
    if (place === 'offsite') {
      tx.set(dayRef, { date, offsite: FieldValue.arrayUnion({ shootId: ref.id, name: who.name, start, end: start + s.slotMinutes, where }) }, { merge: true })
    } else {
      if (blockAt(day, place, start, s.slotMinutes)) throw fail('blocked')
      if (day[place]?.[slotKey(start)]) throw fail('taken')
      tx.set(dayRef, { date, [place]: { [slotKey(start)]: { shootId: ref.id, name: who.name, kind } } }, { merge: true })
    }
    tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, place, where, date, month: monthOf(date),
      start, end: start + s.slotMinutes, from: win.from, to: win.to, kind, status: 'booked',
      bookedBy: caller.email, createdAt: at, updatedAt: at,
      history: [{ at, by: caller.email, action: 'booked', note: `${place === 'offsite' ? where : s.houses[place].name} · ${fmtSlot(start, s.slotMinutes)}${who.email !== caller.email ? ` · for ${who.name}` : ''}` }],
    })
  })
  return { id: ref.id, kind }
})

export const cancelShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const id = str(req.data?.id, 100)
  const ref = db.doc(`shoots/${id}`)
  const s = await loadScheduleSettings()
  const now = nowStamp(), today = todayInStudio()
  let lateCancel = false
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Shoot not found.')
    const team = isTeam(caller)
    if (!team && b.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'booked') throw new HttpsError('failed-precondition', 'This shoot is already cancelled.')
    if (!team && b.from <= now) throw new HttpsError('failed-precondition', 'This shoot has already started. Ask the schedule team if something went wrong.')
    // Cancelling a priority-day slot on the day itself counts against the creator (strikes come in a later step).
    lateCancel = !team && b.date === today && isPriorityDay(b.date, b.place, s)
    const dayRef = db.doc(`schedule_days/${b.date}`)
    const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
    if (b.place === 'offsite') {
      tx.set(dayRef, { offsite: (day.offsite ?? []).filter(o => o.shootId !== id) }, { merge: true })
    } else if (day[b.place as House]?.[slotKey(b.start)]?.shootId === id) {
      tx.update(dayRef, { [`${b.place}.${slotKey(b.start)}`]: FieldValue.delete() })
    }
    const at = new Date().toISOString()
    tx.update(ref, {
      status: 'cancelled', cancelledBy: caller.email, updatedAt: at, ...(lateCancel ? { lateCancel: true } : {}),
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'cancelled', ...(team && b.creatorEmail !== caller.email ? { note: 'by the schedule team' } : lateCancel ? { note: 'same-day cancel of a priority-day slot' } : {}) }),
    })
  })
  return { ok: true, lateCancel }
})

// ─── Schedule team: blocked time and settings ────────────────────────────────

export const addScheduleBlock = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  if (!isDay(d.date)) throw fail('bad-date')
  if (d.house !== 'cliff1' && d.house !== 'cliff2') throw new HttpsError('invalid-argument', 'Pick a house.')
  const type: BlockType = (Object.keys(BLOCK_TYPES) as BlockType[]).includes(d.type) ? d.type : 'other'
  const first = s.slots[0], last = s.slots[s.slots.length - 1] + s.slotMinutes
  const start = d.allDay === true ? first : Number(d.start)
  const end = d.allDay === true ? last : Number(d.end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 + 6 * 60 || end <= start || start % 30 || end % 30) {
    throw new HttpsError('invalid-argument', 'Pick a start and end time.')
  }
  const block = { id: randomUUID().slice(0, 8), house: d.house as House, start, end, type, note: str(d.note, 200), by: caller.email }
  const dayRef = db.doc(`schedule_days/${d.date}`)
  await db.runTransaction(async tx => {
    const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
    // Never silently wipe out a booking: the team cancels it first (no strike), then blocks.
    const clash = Object.entries(day[block.house] ?? {}).filter(([k]) => Number(k) < end && start < Number(k) + s.slotMinutes).map(([, e]) => e.name)
    if (clash.length) {
      throw new HttpsError('failed-precondition', `Already booked then: ${clash.join(', ')}. Cancel their shoot first (no strike), then block the time.`, { problem: 'booked', names: clash })
    }
    tx.set(dayRef, { date: d.date, blocks: [...(day.blocks ?? []), block] }, { merge: true })
  })
  return { id: block.id }
})

export const removeScheduleBlock = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const date = req.data?.date, id = str(req.data?.id, 20)
  if (!isDay(date)) throw fail('bad-date')
  const dayRef = db.doc(`schedule_days/${date}`)
  await db.runTransaction(async tx => {
    const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
    tx.set(dayRef, { blocks: (day.blocks ?? []).filter(b => b.id !== id) }, { merge: true })
  })
  return { ok: true }
})

export const saveScheduleSettings = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'equipment'])
  const clean = cleanScheduleSettings(req.data)
  await db.doc('app_settings/schedule').set({ ...clean, updatedAt: new Date().toISOString(), updatedBy: caller.email })
  return clean
})

// People the schedule team can book for or add to the priority group (the team can't read users directly).
export const listSchedulePeople = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const snap = await db.collection('users').where('active', '==', true).get()
  return {
    people: snap.docs.map(u => ({ email: u.id, name: String(u.get('name') || u.id), role: String(u.get('role')) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
  }
})

