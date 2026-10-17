// House schedule (Cliff 1 / Cliff 2 / offsite): book, move, swap, cancel, block time, settings.
// Every booking change is written in a transaction together with schedule_days/{date}, which
// is what makes double-booking a house impossible (same idea as gear_holds for gear).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { db, requireRole, CALLABLE, OWNER_EMAIL, type Caller } from './auth.js'
import { todayInStudio, isDay } from './booking.js'
import { nowStamp, fmtTime } from './gearBooking.js'
import { addStrike } from './strikes.js'
import {
  cleanScheduleSettings, checkSlot, priorityLocked, blockAt, slotKey, slotWindow, monthOf, offsiteHoursOk, isShortNotice, withinUndo,
  SCHEDULE_MESSAGES, MONTHLY_HOUSE, BLOCK_TYPES, type ScheduleSettings, type ScheduleDay, type Place, type House,
  type ShootKind, type BlockType, type ScheduleProblem,
} from './schedule.js'

const TEAM = ['owner', 'equipment']
const ANYONE = ['owner', 'arts', 'creator', 'equipment'] as const
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const isTeam = (c: Caller) => TEAM.includes(c.role)
const fail = (problem: ScheduleProblem, message = SCHEDULE_MESSAGES[problem]) =>
  new HttpsError('failed-precondition', message, { problem })
const shortNoticeFail = (s: ScheduleSettings) =>
  fail('short-notice', `Less than ${s.noticeHours} hours to go. Swap with someone instead, or cancel (it counts as a no-show).`)

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

interface Spot { place: Place; date: string; start: number; end: number; where: string }
const placeLabel = (p: Spot, s: ScheduleSettings) => p.place === 'offsite' ? p.where : s.houses[p.place].name
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const spotLabel = (p: Spot, s: ScheduleSettings) => `${placeLabel(p, s)} · ${dayLabel(p.date)} · ${fmtTime(p.start)}–${fmtTime(p.end)}`

// Read and check where a shoot is going (book or move). Throws a plain-words problem.
function readSpot(d: Record<string, any>, s: ScheduleSettings): Spot {
  const today = todayInStudio(), now = nowStamp()
  const problem = checkSlot(d.place, d.date, d.start, s, today, now)
  if (problem) throw fail(problem)
  const place = d.place as Place, start = d.start as number
  let end = start + s.slotMinutes, where = ''
  if (place === 'offsite') {
    if (!offsiteHoursOk(start, d.end)) throw fail('bad-hours')
    end = d.end
    where = str(d.where, 200)
    if (!where) throw fail('no-where')
  }
  return { place, date: d.date, start, end, where }
}

const dayRefOf = (date: string) => db.doc(`schedule_days/${date}`)

// Put a shoot into / take it out of its day's document (in memory; written by the caller).
function placeIn(day: ScheduleDay, spot: Spot, entry: { shootId: string; name: string; email: string; kind: ShootKind }, s: ScheduleSettings) {
  if (spot.place === 'offsite') {
    day.offsite = [...(day.offsite ?? []), { shootId: entry.shootId, name: entry.name, email: entry.email, start: spot.start, end: spot.end, where: spot.where }]
    return
  }
  if (blockAt(day, spot.place, spot.start, s.slotMinutes)) throw fail('blocked')
  const taken = day[spot.place]?.[slotKey(spot.start)]
  if (taken && taken.shootId !== entry.shootId) throw fail('taken')
  day[spot.place] = { ...(day[spot.place] ?? {}), [slotKey(spot.start)]: { shootId: entry.shootId, name: entry.name, email: entry.email, kind: entry.kind } }
}
function takeOut(day: ScheduleDay, spot: { place: Place; start: number }, shootId: string) {
  if (spot.place === 'offsite') { day.offsite = (day.offsite ?? []).filter(o => o.shootId !== shootId); return }
  const key = slotKey(spot.start)
  if (day[spot.place]?.[key]?.shootId === shootId) {
    const { [key]: _gone, ...rest } = day[spot.place]!
    day[spot.place] = rest
  }
}

// Load the day docs a change touches, let `change` edit them, then write them all back.
async function editDays(tx: Transaction, dates: string[], change: (days: Record<string, ScheduleDay>) => void) {
  const unique = [...new Set(dates)]
  const snaps = await Promise.all(unique.map(d => tx.get(dayRefOf(d))))
  const days: Record<string, ScheduleDay> = {}
  unique.forEach((d, i) => { days[d] = (snaps[i].data() ?? { date: d }) as ScheduleDay })
  return () => {
    change(days)
    for (const d of unique) tx.set(dayRefOf(d), { ...days[d], date: d })
  }
}

async function monthlyUsed(email: string, month: string, exceptId?: string) {
  const mine = await db.collection('shoots').where('creatorEmail', '==', email).where('month', '==', month).get()
  return mine.docs.filter(x => x.id !== exceptId && x.get('status') === 'booked' && x.get('kind') === 'monthly').length
}

export const bookShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const spot = readSpot(d, s)
  const who = await shootFor(caller, d.forEmail)
  if (spot.place !== 'offsite' && !isTeam(caller) && priorityLocked(spot.date, spot.place, s, who.email, nowStamp())) throw fail('locked')

  // Monthly (guaranteed) slots count only at Cliff 1; everything else is an extra slot.
  const kind: ShootKind = spot.place === 'offsite' ? 'offsite' : spot.place === MONTHLY_HOUSE && d.kind === 'monthly' ? 'monthly' : 'extra'
  if (kind === 'monthly' && await monthlyUsed(who.email, monthOf(spot.date)) >= s.monthlySlots) throw fail('no-monthly-left')

  const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
  const at = new Date().toISOString()
  const ref = db.collection('shoots').doc()
  await db.runTransaction(async tx => {
    const write = await editDays(tx, [spot.date], days => placeIn(days[spot.date], spot, { shootId: ref.id, name: who.name, email: who.email, kind }, s))
    write()
    tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date),
      from: win.from, to: win.to, kind, status: 'booked', bookedBy: caller.email, createdAt: at, updatedAt: at,
      history: [{ at, by: caller.email, action: 'booked', note: `${spotLabel(spot, s)}${who.email !== caller.email ? ` · for ${who.name}` : ''}` }],
    })
  })
  return { id: ref.id, kind }
})

// Cancel. With less than the notice period (48 h) left, a creator's cancel counts as a no-show:
// the app must say so and the creator must confirm (confirmNoShow). The team never gets a no-show.
export const cancelShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const id = str(req.data?.id, 100)
  const ref = db.doc(`shoots/${id}`)
  const s = await loadScheduleSettings()
  const now = nowStamp()
  let noShow = false
  let who = { email: '', name: '' }
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Shoot not found.')
    const team = isTeam(caller)
    if (!team && b.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'booked') throw new HttpsError('failed-precondition', 'This shoot is already cancelled.')
    if (!team && b.from <= now) throw new HttpsError('failed-precondition', 'This shoot has already started. Ask the schedule team if something went wrong.')
    noShow = !team && isShortNotice(b.from, now, s) && !withinUndo(b.createdAt)
    who = { email: b.creatorEmail, name: b.creatorName }
    if (noShow && req.data?.confirmNoShow !== true) throw shortNoticeFail(s)
    const write = await editDays(tx, [b.date], days => takeOut(days[b.date], b as Spot, id))
    write()
    const at = new Date().toISOString()
    tx.update(ref, {
      status: 'cancelled', cancelledBy: caller.email, updatedAt: at, ...(noShow ? { lateCancel: true, noShow: 'late-cancel' } : {}),
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'cancelled',
        ...(team && b.creatorEmail !== caller.email ? { note: 'by the schedule team' } : noShow ? { note: `less than ${s.noticeHours} h before · counts as a no-show` } : {}) }),
    })
  })
  if (noShow) await addStrike(who.email, who.name, 'late-cancel', id, caller.email)
  return { ok: true, lateCancel: noShow }
})

// Move to another free slot (or other offsite hours) in one step: the old slot is only
// given up if the new one is free. Creators need the notice period; the team doesn't.
export const moveShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const d = req.data ?? {}
  const id = str(d.id, 100)
  const ref = db.doc(`shoots/${id}`)
  const s = await loadScheduleSettings()
  const now = nowStamp()
  const team = isTeam(caller)
  const pre = (await ref.get()).data()
  if (!pre) throw new HttpsError('not-found', 'Shoot not found.')
  // Offsite shoots move to other offsite hours; house shoots move between the houses.
  const spot = readSpot({ ...d, place: d.place ?? pre.place, where: d.where ?? pre.where }, s)
  if ((pre.place === 'offsite') !== (spot.place === 'offsite')) throw new HttpsError('invalid-argument', 'Cancel and book again to switch between a house and an offsite shoot.')
  if (spot.place !== 'offsite' && !team && priorityLocked(spot.date, spot.place, s, pre.creatorEmail, now)) throw fail('locked')
  // A monthly slot stays monthly at Cliff 1 (checked against the new month); anywhere else it becomes an extra slot.
  let kind: ShootKind = spot.place === 'offsite' ? 'offsite' : spot.place === MONTHLY_HOUSE ? pre.kind : 'extra'
  if (kind === 'monthly' && monthOf(spot.date) !== pre.month && await monthlyUsed(pre.creatorEmail, monthOf(spot.date), id) >= s.monthlySlots) kind = 'extra'

  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Shoot not found.')
    if (!team && b.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'booked') throw new HttpsError('failed-precondition', 'This shoot is cancelled.')
    if (!team && b.from <= now) throw new HttpsError('failed-precondition', 'This shoot has already started.')
    if (!team && isShortNotice(b.from, now, s)) throw shortNoticeFail(s)
    const write = await editDays(tx, [b.date, spot.date], days => {
      takeOut(days[b.date], b as Spot, id)
      placeIn(days[spot.date], spot, { shootId: id, name: b.creatorName, email: b.creatorEmail, kind }, s)
    })
    write()
    const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
    const at = new Date().toISOString()
    tx.update(ref, {
      ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, updatedAt: at,
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'moved', note: `from ${spotLabel(b as Spot, s)} to ${spotLabel(spot, s)}${team && b.creatorEmail !== caller.email ? ' · by the schedule team' : ''}` }),
    })
  })
  return { ok: true, kind }
})

// ─── Swaps: two creators trade house slots. Allowed any time before either starts,
// and the only way to give up a slot inside the notice period without a no-show. ──

export const requestSwap = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const mineId = str(req.data?.myShootId, 100), theirsId = str(req.data?.theirShootId, 100)
  const [mine, theirs] = (await db.getAll(db.doc(`shoots/${mineId}`), db.doc(`shoots/${theirsId}`))).map(x => x.data())
  const now = nowStamp()
  if (!mine || !theirs) throw new HttpsError('not-found', 'Shoot not found.')
  if (mine.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'You can only offer your own shoot.')
  if (theirs.creatorEmail === caller.email) throw new HttpsError('invalid-argument', 'Pick someone else\'s shoot.')
  if (mine.status !== 'booked' || theirs.status !== 'booked') throw new HttpsError('failed-precondition', 'One of these shoots is cancelled.')
  if (mine.place === 'offsite' || theirs.place === 'offsite') throw new HttpsError('failed-precondition', 'Only house slots can be swapped.')
  if (mine.from <= now || theirs.from <= now) throw new HttpsError('failed-precondition', 'One of these shoots has already started.')
  const open = await db.collection('swap_requests').where('fromShootId', '==', mineId).where('status', '==', 'pending').get()
  if (!open.empty) throw new HttpsError('failed-precondition', 'You already asked someone to swap this shoot. Wait for their answer or withdraw it first.')
  const ref = db.collection('swap_requests').doc()
  const at = new Date().toISOString()
  const snap = (x: FirebaseFirestore.DocumentData) => ({ place: x.place, date: x.date, start: x.start, end: x.end })
  await ref.set({
    fromShootId: mineId, toShootId: theirsId, fromEmail: caller.email, fromName: mine.creatorName, toEmail: theirs.creatorEmail, toName: theirs.creatorName,
    from: snap(mine), to: snap(theirs), status: 'pending', createdAt: at,
  })
  return { id: ref.id }
})

export const answerSwap = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const id = str(req.data?.id, 100), accept = req.data?.accept === true
  const ref = db.doc(`swap_requests/${id}`)
  const s = await loadScheduleSettings()
  const at = new Date().toISOString()
  let expired = false
  await db.runTransaction(async tx => {
    expired = false
    const r = (await tx.get(ref)).data()
    if (!r) throw new HttpsError('not-found', 'Swap request not found.')
    const withdraw = r.fromEmail === caller.email
    if (r.toEmail !== caller.email && !withdraw && !isTeam(caller)) throw new HttpsError('permission-denied', 'Not allowed')
    if (r.status !== 'pending') throw new HttpsError('failed-precondition', 'This swap request was already answered.')
    if (!accept) { tx.update(ref, { status: withdraw ? 'withdrawn' : 'declined', answeredAt: at, answeredBy: caller.email }); return }
    if (withdraw && !isTeam(caller)) throw new HttpsError('permission-denied', 'The other person has to accept.')
    const aRef = db.doc(`shoots/${r.fromShootId}`), bRef = db.doc(`shoots/${r.toShootId}`)
    const [aS, bS] = await Promise.all([tx.get(aRef), tx.get(bRef)])
    const a = aS.data(), b = bS.data(), now = nowStamp()
    const same = (x: any, y: any) => x && x.status === 'booked' && x.place === y.place && x.date === y.date && x.start === y.start
    if (!same(a, r.from) || !same(b, r.to) || a!.from <= now || b!.from <= now) {
      tx.update(ref, { status: 'expired', answeredAt: at })
      expired = true
      return
    }
    const write = await editDays(tx, [a!.date, b!.date], days => {
      takeOut(days[a!.date], a as Spot, aS.id); takeOut(days[b!.date], b as Spot, bS.id)
      const kindAt = (x: any, place: Place): ShootKind => place === MONTHLY_HOUSE ? x.kind : 'extra'
      placeIn(days[b!.date], b as Spot, { shootId: aS.id, name: a!.creatorName, email: a!.creatorEmail, kind: kindAt(a, b!.place) }, s)
      placeIn(days[a!.date], a as Spot, { shootId: bS.id, name: b!.creatorName, email: b!.creatorEmail, kind: kindAt(b, a!.place) }, s)
    })
    write()
    const moveTo = (x: any, other: any, name: string) => {
      const win = slotWindow(other.date, other.start, other.end - other.start)
      return {
        place: other.place, date: other.date, start: other.start, end: other.end, where: '', month: monthOf(other.date), from: win.from, to: win.to,
        kind: other.place === MONTHLY_HOUSE ? x.kind : 'extra', updatedAt: at,
        history: FieldValue.arrayUnion({ at, by: caller.email, action: 'swapped', note: `with ${name}: now ${spotLabel(other, s)}` }),
      }
    }
    tx.update(aRef, moveTo(a, b, b!.creatorName))
    tx.update(bRef, moveTo(b, a, a!.creatorName))
    tx.update(ref, { status: 'accepted', answeredAt: at, answeredBy: caller.email })
  })
  if (expired) throw new HttpsError('failed-precondition', 'One of these shoots changed or already started, so this swap no longer works.')
  return { ok: true }
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
  const dayRef = dayRefOf(d.date)
  await db.runTransaction(async tx => {
    const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
    // Never silently wipe out a booking: the team cancels or moves it first (no strike), then blocks.
    const clash = Object.entries(day[block.house] ?? {}).filter(([k]) => Number(k) < end && start < Number(k) + s.slotMinutes).map(([, e]) => e.name)
    if (clash.length) {
      throw new HttpsError('failed-precondition', `Already booked then: ${clash.join(', ')}. Move or cancel their shoot first (no strike), then block the time.`, { problem: 'booked', names: clash })
    }
    tx.set(dayRef, { date: d.date, blocks: [...(day.blocks ?? []), block] }, { merge: true })
  })
  return { id: block.id }
})

export const removeScheduleBlock = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  const date = req.data?.date, id = str(req.data?.id, 20)
  if (!isDay(date)) throw fail('bad-date')
  const dayRef = dayRefOf(date)
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

// Place a shoot for someone with no rule checks except "the slot is free" (used by the calendar import).
export async function placeShootAsTeam(spot: Spot, who: { email: string; name: string }, by: string, extra: Record<string, unknown> = {}) {
  const s = await loadScheduleSettings()
  if (!isDay(spot.date)) throw fail('bad-date')
  const kind: ShootKind = spot.place === 'offsite' ? 'offsite' : 'extra'
  const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
  const at = new Date().toISOString()
  const ref = db.collection('shoots').doc()
  await db.runTransaction(async tx => {
    const write = await editDays(tx, [spot.date], days => placeIn(days[spot.date], spot, { shootId: ref.id, name: who.name, email: who.email, kind }, s))
    write()
    tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, status: 'booked',
      bookedBy: by, createdAt: at, updatedAt: at, ...extra,
      history: [{ at, by, action: 'booked', note: `${spotLabel(spot, s)} · imported from Google Calendar` }],
    })
  })
  return ref.id
}
