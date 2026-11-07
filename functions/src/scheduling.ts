// House schedule (Cliff 1 / Cliff 2 / offsite): book, move, swap, cancel, block time, settings.
// Every booking change is written in a transaction together with schedule_days/{date}, which
// is what makes double-booking a house impossible (same idea as gear_holds for gear).
import { isStorageLink } from './storageLinks.js'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { db, requireRole, CALLABLE, OWNER_EMAIL, isDemoCreator, type Caller } from './auth.js'
import { todayInStudio, isDay, addDays } from './booking.js'
import { nowStamp, fmtTime, addMinutes } from './gearBooking.js'
import { addStrike } from './strikes.js'
import { openLinks, assertNoLinksForDayChange } from './shootLinks.js'
import { cancelForShoot } from './reservations.js'
import { cancelGearForShoot, leaveCrew } from './gearBookings.js'
import { houseSlotsOn, needsGuideline,
  cleanScheduleSettings, checkSlot, holdActive, INVITE_HOLD_MINUTES, priorityLocked, blockAt, slotKey, slotWindow, monthOf, offsiteHoursOk, isShortNotice, cancelCountsAsNoShow, timeSetByTeam,
  SCHEDULE_MESSAGES, MONTHLY_HOUSE, BLOCK_TYPES, type ScheduleSettings, type ScheduleDay, type SlotEntry, type OffsiteEntry, type Place, type House,
  type ShootKind, type BlockType, type ScheduleProblem,
} from './schedule.js'

const TEAM = ['owner', 'equipment']
const ANYONE = ['owner', 'arts', 'creator', 'equipment'] as const
// Owner (Oct 19): the arts department handles props only; it never books shoots (creators + the schedule team do).
const BOOKERS = ['owner', 'creator', 'equipment'] as const
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const isTeam = (c: Caller) => TEAM.includes(c.role)
// The priority lock: the schedule team can override it when booking for someone else, but the owner booking for
// themselves follows it like a creator (owner, Oct 27: "I might not always have priority").
const skipsLock = (c: Caller, forEmail: string) => isTeam(c) && !(c.role === 'owner' && forEmail === c.email)
const fail = (problem: ScheduleProblem, message = SCHEDULE_MESSAGES[problem]) =>
  new HttpsError('failed-precondition', message, { problem })
// Cliff 1 Thursdays + Saturdays need a filming guideline (PDF) from creators outside the priority group (owner, Nov 3).
// The schedule team booking for someone doesn't need one. Returns what to store on the shoot.
function guidelineFor(caller: Caller, email: string, spot: { place: Place; date: string }, s: ScheduleSettings, raw: unknown) {
  const g = raw && typeof raw === 'object' ? raw as { url?: unknown; name?: unknown } : null
  // Only a PDF in the app's own storage, in the folder of the person booking (or the shoot's person); never an
  // outside link that staff would then open (audit, Nov 7).
  const url = isStorageLink(g?.url, `guidelines/${caller.email}/`) || isStorageLink(g?.url, `guidelines/${email}/`) ? (g!.url as string) : ''
  if (url) return { url, name: str(g?.name, 120) || 'Guideline.pdf' }
  if (spot.place !== 'offsite' && !isTeam(caller) && needsGuideline(spot.date, spot.place, email, s))
    throw new HttpsError('failed-precondition', 'Thursdays and Saturdays at Cliff 1 need your filming guideline. Attach the PDF and ask again.', { problem: 'guideline' })
  return null
}
const shortNoticeFail = (s: ScheduleSettings) =>
  fail('short-notice', `Less than ${s.noticeHours} hours to go. Swap with someone instead, or cancel (it counts as a no-show).`)

// Owner, Nov 2: NO instant bookings. A creator's booking is a REQUEST that holds the slot until the equipment team (or an
// admin / the owner) approves or denies it. The schedule team booking for someone, the owner booking for themselves, and the
// people on the "books without approval" list (Kyle) are approved at once.
export const APPROVERS = ['owner', 'equipment', 'admin'] as const
export const needsApproval = (caller: Caller, forEmail: string, s: ScheduleSettings) =>
  !isTeam(caller) && !s.instantBookers.some(p => p.email === forEmail.toLowerCase())

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
  if (isDemoCreator(u.role, u.access)) throw new HttpsError('failed-precondition', `${u.name || email} is still on Props only (demo mode), so they can't have shoots yet.`, { problem: 'demo' })
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
type Entry = { shootId: string; name: string; email: string; kind: ShootKind; pending?: boolean; move?: boolean }
const flags = (e: Entry) => ({ ...(e.pending ? { pending: true } : {}), ...(e.move ? { move: true } : {}) })
function placeIn(day: ScheduleDay, spot: Spot, entry: Entry, s: ScheduleSettings) {
  if (spot.place === 'offsite') {
    day.offsite = [...(day.offsite ?? []), { shootId: entry.shootId, name: entry.name, email: entry.email, start: spot.start, end: spot.end, where: spot.where, ...flags(entry) }]
    return
  }
  if (blockAt(day, spot.place, spot.start, s.slotMinutes)) throw fail('blocked')
  const taken = day[spot.place]?.[slotKey(spot.start)]
  // A held slot is only free again once the hold has ended, or for the person it's held for.
  if (taken?.hold) { if (holdActive(taken, nowStamp()) && taken.email !== entry.email) throw fail('held') }
  else if (taken && taken.shootId !== entry.shootId) throw fail('taken')
  day[spot.place] = { ...(day[spot.place] ?? {}), [slotKey(spot.start)]: { shootId: entry.shootId, name: entry.name, email: entry.email, kind: entry.kind, ...flags(entry) } }
}
// Approval helpers on a day doc: clear the "requested" mark, drop a waiting move, or finish an approved move.
const strip = <T extends { pending?: boolean; move?: boolean }>(e: T): T => { const { pending: _p, move: _m, ...rest } = e; return rest as T }
function eachEntry(day: ScheduleDay, shootId: string, fn: (e: SlotEntry | OffsiteEntry) => SlotEntry | OffsiteEntry | null) {
  for (const h of ['cliff1', 'cliff2'] as const) {
    const slots = day[h]; if (!slots) continue
    const next: Record<string, SlotEntry> = {}
    for (const [k, e] of Object.entries(slots)) { const r = e.shootId === shootId ? fn(e) : e; if (r) next[k] = r as SlotEntry }
    day[h] = next
  }
  if (day.offsite) day.offsite = day.offsite.map(e => e.shootId === shootId ? fn(e) : e).filter(Boolean) as OffsiteEntry[]
}
const approveIn = (day: ScheduleDay, id: string) => eachEntry(day, id, e => e.move ? e : strip(e))
const dropMove = (day: ScheduleDay, id: string) => eachEntry(day, id, e => e.move ? null : e)
const keepOnlyMove = (day: ScheduleDay, id: string) => eachEntry(day, id, e => e.move ? strip(e) : null)
function takeOut(day: ScheduleDay, spot: { place: Place; start: number }, shootId: string, promote = true) {
  if (spot.place === 'offsite') { day.offsite = (day.offsite ?? []).filter(o => o.shootId !== shootId); return }
  // Every slot this shoot fills (an imported off-grid shoot can fill two), and any clash listing.
  const house = spot.place
  const slots = day[house] ?? {}
  const freed = Object.entries(slots).filter(([, e]) => e.shootId === shootId).map(([k]) => k)
  if (freed.length) day[house] = Object.fromEntries(Object.entries(slots).filter(([, e]) => e.shootId !== shootId))
  if (day.clashes?.some(c => c.shootId === shootId)) day.clashes = day.clashes.filter(c => c.shootId !== shootId)
  if (promote) promoteClashes(day, house, freed, shootId)
}
// A shoot that was waiting underneath as a clash (an imported event on the same slot) takes the slot it was clashing on
// (audit: the slot showed Free and could be booked twice, and the clash never cleared). Only into slots that are empty now.
function promoteClashes(day: ScheduleDay, house: House, freed: string[], shootId: string) {
  for (const k of freed) {
    if (day[house]?.[k]) continue
    const c = (day.clashes ?? []).find(x => x.house === house && x.slot === k && !x.blockId && x.shootId && x.shootId !== shootId)
    if (!c) continue
    day[house] = { ...(day[house] ?? {}), [k]: { shootId: c.shootId, name: c.name, email: c.email ?? '', kind: 'extra',
      ...(c.start === Number(k) && c.end === Number(k) + 120 ? {} : { time: { start: c.start, end: c.end } }) } }
    day.clashes = (day.clashes ?? []).filter(x => x !== c)
  }
}
// The slots a shoot holds on a day apart from a waiting move (what an approved same-day move gives up).
const heldKeys = (day: ScheduleDay, shootId: string) => (['cliff1', 'cliff2'] as const).map(h =>
  ({ house: h, keys: Object.entries(day[h] ?? {}).filter(([, e]) => e.shootId === shootId && !e.move).map(([k]) => k) }))

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

// Friends' slots held by a back-to-back booking (bookWithFriends) go when that booking leaves the schedule (cancelled,
// denied, given away): the holds are cleared and the invites withdrawn (audit, Nov 7: the friend could still confirm a slot
// next to nobody). Read inside the transaction before any write; clear in the day docs; mark the invites after.
type HeldInvite = { ref: FirebaseFirestore.DocumentReference; date: string; place: House; start: number }
async function pendingInvitesOf(tx: Transaction, shootId: string): Promise<HeldInvite[]> {
  const snap = await tx.get(db.collection('schedule_invites').where('fromShootId', '==', shootId).where('status', '==', 'pending'))
  return snap.docs.map(d => ({ ref: d.ref, date: String(d.get('date')), place: d.get('place') as House, start: Number(d.get('start')) }))
}
function clearHolds(days: Record<string, ScheduleDay>, invs: HeldInvite[]) {
  for (const inv of invs) {
    const map = days[inv.date]?.[inv.place]
    if (map?.[slotKey(inv.start)]?.hold?.inviteId !== inv.ref.id) continue
    const { [slotKey(inv.start)]: _gone, ...rest } = map   // eslint-disable-line @typescript-eslint/no-unused-vars
    days[inv.date][inv.place] = rest
  }
}
const withdrawInvites = (tx: Transaction, invs: HeldInvite[], at: string) =>
  invs.forEach(i => tx.update(i.ref, { status: 'withdrawn', answeredAt: at, reason: 'shoot-gone' }))

// One house slot a day per creator (owner, Oct 18; settings.slotsPerDay). The schedule team is never limited, so
// "manually allowed" = the team books the extra slot for them. Checked on the day doc inside the transaction.
function assertDayLimit(day: ScheduleDay, email: string, adding: number, s: ScheduleSettings, except: string[] = [], who?: string) {
  if (houseSlotsOn(day, email, nowStamp(), except) + adding <= s.slotsPerDay) return
  if (who) throw new HttpsError('failed-precondition', `${who} already has a house slot that day (one 2-hour slot a day each).`, { problem: 'day-limit' })
  throw fail('day-limit')
}

async function monthlyUsed(email: string, month: string, exceptId?: string) {
  const mine = await db.collection('shoots').where('creatorEmail', '==', email).where('month', '==', month).get()
  return mine.docs.filter(x => x.id !== exceptId && ['booked', 'requested'].includes(x.get('status')) && x.get('kind') === 'monthly').length
}

export const bookShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...BOOKERS])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const spot = readSpot(d, s)
  const who = await shootFor(caller, d.forEmail)
  if (spot.place !== 'offsite' && !skipsLock(caller, who.email) && priorityLocked(spot.date, spot.place, s, who.email, nowStamp())) throw fail('locked')

  // Monthly (guaranteed) slots count only at Cliff 1; everything else is an extra slot.
  const kind: ShootKind = spot.place === 'offsite' ? 'offsite' : spot.place === MONTHLY_HOUSE && d.kind === 'monthly' ? 'monthly' : 'extra'
  if (kind === 'monthly' && await monthlyUsed(who.email, monthOf(spot.date)) >= s.monthlySlots) throw fail('no-monthly-left')

  // Top priority (Kyle) taking a slot someone else has: the holder is moved out (cancelled, neutral notice, their next request first in line).
  if (d.take === true && spot.place !== 'offsite') {
    if (!s.instantBookers.some(p => p.email === who.email) || who.email !== caller.email) throw new HttpsError('permission-denied', 'Only people with top priority can take a slot that is already booked.')
    const holder = ((await dayRefOf(spot.date).get()).data() as ScheduleDay | undefined)?.[spot.place]?.[slotKey(spot.start)]
    if (holder?.shootId && !holder.hold) {
      if (s.instantBookers.some(p => p.email === holder.email)) throw fail('taken')
      const r = await giveSlotTo(caller, { date: spot.date, house: spot.place, start: spot.start, toEmail: who.email }, s)
      return { id: r.shootId, kind: 'extra', status: 'booked', bumped: r.holderName }
    }
  }
  const guideline = guidelineFor(caller, who.email, spot, s, d.guideline)
  const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
  const at = new Date().toISOString()
  const ref = db.collection('shoots').doc()
  const pending = needsApproval(caller, who.email, s)
  await db.runTransaction(async tx => {
    const write = await editDays(tx, [spot.date], days => {
      if (spot.place !== 'offsite' && !isTeam(caller)) assertDayLimit(days[spot.date], who.email, 1, s)
      placeIn(days[spot.date], spot, { shootId: ref.id, name: who.name, email: who.email, kind, pending }, s)
    })
    write()
    tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date),
      from: win.from, to: win.to, kind, status: pending ? 'requested' : 'booked', bookedBy: caller.email, createdAt: at, updatedAt: at,
      ...(pending ? { requestedAt: at } : {}), ...(guideline ? { guideline } : {}),
      history: [{ at, by: caller.email, action: pending ? 'requested' : 'booked', note: `${spotLabel(spot, s)}${who.email !== caller.email ? ` · for ${who.name}` : ''}` }],
    })
  })
  return { id: ref.id, kind, status: pending ? 'requested' : 'booked' }
})

// Cancel. With less than the notice period (48 h) left, a creator's cancel counts as a no-show:
// the app must say so and the creator must confirm (confirmNoShow). The team never gets a no-show. Free anyway: the
// 10-minute undo, and shoots booked (or asked for) less than 24 h before they start (cancelCountsAsNoShow).
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
    if (b.status !== 'booked' && b.status !== 'requested') throw new HttpsError('failed-precondition', 'This shoot is already cancelled.')
    if (!team && b.from <= now) throw new HttpsError('failed-precondition', 'This shoot has already started. Ask the schedule team if something went wrong.')
    // Withdrawing a request that was never approved is always free; so is a shoot booked less than 24 h before it starts.
    noShow = !team && cancelCountsAsNoShow(b as Parameters<typeof cancelCountsAsNoShow>[0], now, s)
    who = { email: b.creatorEmail, name: b.creatorName }
    if (noShow && req.data?.confirmNoShow !== true) throw shortNoticeFail(s)
    const mr = b.moveRequest as Spot | undefined
    const invs = await pendingInvitesOf(tx, id)
    const write = await editDays(tx, [b.date, ...(mr ? [mr.date] : []), ...invs.map(i => i.date)], days => {
      takeOut(days[b.date], b as Spot, id)
      if (mr) takeOut(days[mr.date], mr, id)
      clearHolds(days, invs)
    })
    write()
    const at = new Date().toISOString()
    withdrawInvites(tx, invs, at)
    tx.update(ref, {
      status: 'cancelled', cancelledBy: caller.email, updatedAt: at, ...(noShow ? { lateCancel: true, noShow: 'late-cancel' } : {}),
      ...(mr ? { moveRequest: FieldValue.delete() } : {}),
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'cancelled',
        ...(team && b.creatorEmail !== caller.email ? { note: 'by the schedule team' } : noShow ? { note: `less than ${s.noticeHours} h before · counts as a no-show` } : {}) }),
    })
  })
  if (noShow) await addStrike(who.email, who.name, 'late-cancel', id, caller.email)
  return { ok: true, lateCancel: noShow, ...await releaseLinks(caller, id, who.email) }
})

// Props and gear for a shoot that won't happen aren't needed any more. Ones already picked up stay out until returned.
async function releaseLinks(caller: Caller, id: string, whoEmail: string) {
  const who = { email: whoEmail }
  const links = await openLinks(id)
  let cancelledProps = 0, cancelledGear = 0
  for (const p of links.props.filter(x => ['requested', 'preparing', 'packed'].includes(x.status))) {
    try { await cancelForShoot(caller, p.id); cancelledProps++ } catch (e) { console.warn('cancel props for shoot', id, p.id, e) }
  }
  for (const g of links.gear.filter(x => x.status === 'held')) {
    try { await cancelGearForShoot(caller.email, g.id); cancelledGear++ } catch (e) { console.warn('cancel gear for shoot', id, g.id, e) }
  }
  // Shared gear from a friend: this person comes off it (picked-up gear stays on everyone's record).
  for (const g of links.sharedGear.filter(x => x.status === 'held')) {
    try { await leaveCrew(g.id, who.email, caller.email, 'is off the shared gear (their shoot was cancelled)') } catch (e) { console.warn('leave shared gear', id, g.id, e) }
  }
  const stillOut = links.props.length - cancelledProps + links.gear.length - cancelledGear
  return { cancelledProps, cancelledGear, stillOut }
}

// Move to another free slot (or other offsite hours) in one step: the old slot is only
// given up if the new one is free. Creators need the notice period; the team doesn't.
export const moveShoot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...BOOKERS])
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
  await assertNoLinksForDayChange(id, pre.date, spot.date)
  if (spot.place !== 'offsite' && !skipsLock(caller, pre.creatorEmail) && priorityLocked(spot.date, spot.place, s, pre.creatorEmail, now)) throw fail('locked')
  // Moving onto a Cliff 1 Thursday/Saturday needs a guideline too (unless the shoot already has one).
  const guideline = pre.guideline && !d.guideline ? null : guidelineFor(caller, pre.creatorEmail, spot, s, d.guideline)
  // A monthly slot stays monthly at Cliff 1 (checked against the new month); anywhere else it becomes an extra slot.
  let kind: ShootKind = spot.place === 'offsite' ? 'offsite' : spot.place === MONTHLY_HOUSE ? pre.kind : 'extra'
  if (kind === 'monthly' && monthOf(spot.date) !== pre.month && await monthlyUsed(pre.creatorEmail, monthOf(spot.date), id) >= s.monthlySlots) kind = 'extra'

  let result: 'moved' | 'requested' = 'moved'
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Shoot not found.')
    if (!team && b.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'Not allowed')
    if (b.status !== 'booked' && b.status !== 'requested') throw new HttpsError('failed-precondition', 'This shoot is cancelled.')
    if (!team && b.from <= now) throw new HttpsError('failed-precondition', 'This shoot has already started.')
    // A request that isn't approved yet just moves (it stays a request). An approved shoot's move is a NEW request
    // (owner, Nov 2): the new spot is held as "move" and the old spot stays theirs until it's approved.
    const stillRequest = b.status === 'requested'
    const asRequest = !stillRequest && needsApproval(caller, b.creatorEmail, s)
    // Inside the notice period a creator can't move, unless the team set this time for them (a priority booking or a team move).
    if (!team && !stillRequest && isShortNotice(b.from, now, s) && !timeSetByTeam(b)) throw shortNoticeFail(s)
    const old = b.moveRequest as Spot | undefined
    const write = await editDays(tx, [b.date, spot.date, ...(old ? [old.date] : [])], days => {
      if (old) dropMove(days[old.date], id)
      if (spot.place !== 'offsite' && !team) assertDayLimit(days[spot.date], b.creatorEmail, 1, s, [id])
      if (!asRequest) takeOut(days[b.date], b as Spot, id)
      placeIn(days[spot.date], spot, { shootId: id, name: b.creatorName, email: b.creatorEmail, kind, pending: asRequest || stillRequest, move: asRequest }, s)
    })
    write()
    const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
    const at = new Date().toISOString()
    if (asRequest) {
      result = 'requested'
      tx.update(ref, {
        moveRequest: { ...spot, from: win.from, to: win.to, kind, at }, updatedAt: at, ...(guideline ? { guideline } : {}),
        history: FieldValue.arrayUnion({ at, by: caller.email, action: 'move-requested', note: `from ${spotLabel(b as Spot, s)} to ${spotLabel(spot, s)}` }),
      })
      return
    }
    // Who chose the new time: the team moving someone else's shoot stamps teamMovedAt (cancelling it stays free); the creator
    // picking a time themselves clears the stamp (and an old priority-booking move).
    const byTeam = team && b.creatorEmail !== caller.email
    tx.update(ref, {
      ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, updatedAt: at, ...(old ? { moveRequest: FieldValue.delete() } : {}), ...(guideline ? { guideline } : {}),
      ...(byTeam ? { teamMovedAt: at } : { teamMovedAt: FieldValue.delete(), bumped: FieldValue.delete() }),
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'moved', note: `from ${spotLabel(b as Spot, s)} to ${spotLabel(spot, s)}${byTeam ? ' · by the schedule team' : ''}` }),
    })
  })
  return { ok: true, kind, status: result }
})

// ─── Approvals (owner, Nov 2): the equipment team, admins and the owner approve or deny every creator request ───
// A request (status 'requested') becomes a booking; a waiting move (moveRequest) moves the booking. Denying needs a
// reason the creator reads; a denied request frees its slot and anything added to it.
export const decideBooking = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...APPROVERS])
  const id = str(req.data?.id, 100), approve = req.data?.approve === true, reason = str(req.data?.reason, 300)
  if (!approve && reason.length < 3) throw new HttpsError('invalid-argument', 'Write a short reason so they know why.')
  const ref = db.doc(`shoots/${id}`)
  const s = await loadScheduleSettings()
  // Approving a move to ANOTHER DAY while props or gear are booked for the old day would strand them: same rule as moving.
  const pre = (await ref.get()).data()
  if (approve && pre?.status === 'booked' && pre.moveRequest) await assertNoLinksForDayChange(id, pre.date, pre.moveRequest.date)
  let denied = false, who = ''
  await db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data()
    if (!b) throw new HttpsError('not-found', 'Shoot not found.')
    const at = new Date().toISOString(), by = caller.email, name = caller.name
    const mr = b.moveRequest as (Spot & { from: string; to: string; kind: ShootKind }) | undefined
    // Too late to approve: the time already started (audit, Nov 5; the 10-minute timer drops these).
    if (approve && (mr?.from ?? b.from) <= nowStamp()) throw new HttpsError('failed-precondition', 'That time has already started, so it can\'t be approved any more.')
    if (b.status === 'booked' && mr) {
      const write = await editDays(tx, [b.date, mr.date], days => {
        if (approve) {
          if (b.date !== mr.date) { takeOut(days[b.date], b as Spot, id); keepOnlyMove(days[mr.date], id) }
          else {
            // Same day: the old slot is given up here, so a calendar event waiting under it as a clash takes it (like takeOut).
            const old = heldKeys(days[b.date], id)
            keepOnlyMove(days[mr.date], id)
            for (const o of old) promoteClashes(days[b.date], o.house, o.keys, id)
          }
        }
        else dropMove(days[mr.date], id)
      })
      write()
      const spot: Spot = { place: mr.place, date: mr.date, start: mr.start, end: mr.end, where: mr.where }
      tx.update(ref, {
        // The creator asked for this time themselves, so a team-move stamp from before no longer applies.
        ...(approve ? { ...spot, month: monthOf(mr.date), from: mr.from, to: mr.to, kind: mr.kind, teamMovedAt: FieldValue.delete(), bumped: FieldValue.delete() } : {}),
        moveRequest: FieldValue.delete(), updatedAt: at,
        history: FieldValue.arrayUnion(approve
          ? { at, by, action: 'move-approved', note: `from ${spotLabel(b as Spot, s)} to ${spotLabel(spot, s)} · approved by ${name}` }
          : { at, by, action: 'move-denied', note: `${spotLabel(spot, s)} · ${reason}` }),
      })
      return
    }
    if (b.status !== 'requested') throw new HttpsError('failed-precondition', 'Someone already decided on this one.')
    const invs = approve ? [] : await pendingInvitesOf(tx, id)
    const write = await editDays(tx, [b.date, ...invs.map(i => i.date)], days => {
      if (approve) approveIn(days[b.date], id)
      else { takeOut(days[b.date], b as Spot, id); clearHolds(days, invs) }
    })
    write()
    withdrawInvites(tx, invs, at)
    tx.update(ref, approve
      ? { status: 'booked', approvedBy: by, approvedAt: at, updatedAt: at, history: FieldValue.arrayUnion({ at, by, action: 'approved', note: `by ${name}` }) }
      : { status: 'denied', deniedBy: by, deniedAt: at, deniedReason: reason, updatedAt: at, history: FieldValue.arrayUnion({ at, by, action: 'denied', note: reason }) })
    denied = !approve; who = b.creatorEmail
  })
  if (who) await db.doc(`user_status/${who}`).set({ firstInLine: FieldValue.delete() }, { merge: true })
  if (denied) await releaseLinks(caller, id, who)
  return { ok: true }
})

// Requests nobody decided on by the time the slot starts are dropped (owner, Nov 2). Called by the 10-minute timer.
const SCHEDULE_CALLER: Caller = { email: 'schedule', name: 'Schedule', role: 'owner', isStaff: true }
export async function expireRequests(now = nowStamp()) {
  let expired = 0
  const dropped: { id: string; email: string }[] = []
  const pending = await db.collection('shoots').where('status', '==', 'requested').get()
  for (const d of pending.docs.filter(x => (x.get('from') ?? '') <= now)) {
    await db.runTransaction(async tx => {
      const b = (await tx.get(d.ref)).data()
      if (!b || b.status !== 'requested') return
      const write = await editDays(tx, [b.date], days => takeOut(days[b.date], b as Spot, d.id)); write()
      const at = new Date().toISOString()
      tx.update(d.ref, { status: 'expired', updatedAt: at, history: FieldValue.arrayUnion({ at, by: 'schedule', action: 'expired', note: 'nobody approved it before the start' }) })
      expired++
      dropped.push({ id: d.id, email: b.creatorEmail })
    })
  }
  // Anything added to a request that ran out (props, gear, a friend's shared gear) is let go too, like a denied request.
  for (const x of dropped) { try { await releaseLinks(SCHEDULE_CALLER, x.id, x.email) } catch (e) { console.warn('release links of expired request', x.id, e) } }
  const moves = await db.collection('shoots').where('moveRequest.from', '<=', now).get()
  for (const d of moves.docs) {
    await db.runTransaction(async tx => {
      const b = (await tx.get(d.ref)).data(); const mr = b?.moveRequest
      if (!b || !mr || mr.from > now) return
      const write = await editDays(tx, [mr.date], days => dropMove(days[mr.date], d.id)); write()
      const at = new Date().toISOString()
      tx.update(d.ref, { moveRequest: FieldValue.delete(), updatedAt: at, history: FieldValue.arrayUnion({ at, by: 'schedule', action: 'move-expired', note: 'nobody approved the move before the new time' }) })
      expired++
    })
  }
  // Friend holds nobody answered (audit, Nov 5: holds and invites stayed forever; blocks were refused over a hold long gone).
  const lapsed = await db.collection('schedule_invites').where('status', '==', 'pending').get()
  for (const d of lapsed.docs.filter(x => String(x.get('until') ?? '') <= now)) {
    await db.runTransaction(async tx => {
      const inv = (await tx.get(d.ref)).data()
      if (!inv || inv.status !== 'pending' || inv.until > now) return
      const write = await editDays(tx, [inv.date], days => {
        const map = days[inv.date][inv.place as House]
        if (map?.[slotKey(inv.start)]?.hold?.inviteId !== d.id) return
        const { [slotKey(inv.start)]: _gone, ...rest } = map   // eslint-disable-line @typescript-eslint/no-unused-vars
        days[inv.date][inv.place as House] = rest
      })
      write()
      tx.update(d.ref, { status: 'expired', answeredAt: new Date().toISOString() })
    })
  }
  return expired
}

// A swap can't put someone on a priority-day slot before it opens to everyone, or on one that needs a filming guideline
// they never gave (audit, Nov 5: swaps went round both rules).
function assertSwapRules(a: FirebaseFirestore.DocumentData, b: FirebaseFirestore.DocumentData, s: ScheduleSettings, now: string) {
  for (const [who, spot] of [[a, b], [b, a]] as const) {
    if (spot.place === 'offsite') continue
    if (priorityLocked(spot.date, spot.place, s, who.creatorEmail, now)) throw new HttpsError('failed-precondition', `${who.creatorName} isn't in the priority group, so they can't take that priority-day slot before it opens to everyone.`, { problem: 'locked' })
    if (needsGuideline(spot.date, spot.place, who.creatorEmail, s) && !who.guideline) throw new HttpsError('failed-precondition', `That priority-day slot needs a filming guideline, and ${who.creatorName}'s shoot doesn't have one.`, { problem: 'guideline' })
  }
}

// ─── Swaps: two creators trade house slots. Allowed any time before either starts,
// and the only way to give up a slot inside the notice period without a no-show. ──

export const requestSwap = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...BOOKERS])
  const mineId = str(req.data?.myShootId, 100), theirsId = str(req.data?.theirShootId, 100)
  if (!mineId || !theirsId) throw new HttpsError('invalid-argument', 'Pick the two shoots to swap.')
  const [mine, theirs] = (await db.getAll(db.doc(`shoots/${mineId}`), db.doc(`shoots/${theirsId}`))).map(x => x.data())
  const now = nowStamp()
  if (!mine || !theirs) throw new HttpsError('not-found', 'Shoot not found.')
  if (mine.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'You can only offer your own shoot.')
  if (theirs.creatorEmail === caller.email) throw new HttpsError('invalid-argument', 'Pick someone else\'s shoot.')
  if (mine.status === 'requested' || theirs.status === 'requested') throw new HttpsError('failed-precondition', 'Only approved shoots can be swapped. Wait for the equipment team to approve it first.')
  if (mine.status !== 'booked' || theirs.status !== 'booked') throw new HttpsError('failed-precondition', 'One of these shoots is cancelled.')
  if (mine.moveRequest || theirs.moveRequest) throw new HttpsError('failed-precondition', 'One of these shoots is waiting for a move to be approved. Wait for the answer first.')
  if (mine.place === 'offsite' || theirs.place === 'offsite') throw new HttpsError('failed-precondition', 'Only house slots can be swapped.')
  if (mine.from <= now || theirs.from <= now) throw new HttpsError('failed-precondition', 'One of these shoots has already started.')
  await assertNoLinksForDayChange(mineId, mine.date, theirs.date)
  assertSwapRules(mine, theirs, await loadScheduleSettings(), now)
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
  const pre = (await ref.get()).data()
  if (accept && pre?.status === 'pending') {
    await assertNoLinksForDayChange(pre.fromShootId, pre.from.date, pre.to.date)
    await assertNoLinksForDayChange(pre.toShootId, pre.to.date, pre.from.date)
  }
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
    const same = (x: any, y: any) => x && x.status === 'booked' && !x.moveRequest && x.place === y.place && x.date === y.date && x.start === y.start
    if (!same(a, r.from) || !same(b, r.to) || a!.from <= now || b!.from <= now) {
      tx.update(ref, { status: 'expired', answeredAt: at })
      expired = true
      return
    }
    if (!isTeam(caller)) assertSwapRules(a!, b!, s, now)
    const write = await editDays(tx, [a!.date, b!.date], days => {
      if (!isTeam(caller) && a!.date !== b!.date) {
        assertDayLimit(days[b!.date], a!.creatorEmail, 1, s, [aS.id, bS.id], a!.creatorName)
        assertDayLimit(days[a!.date], b!.creatorEmail, 1, s, [aS.id, bS.id], b!.creatorName)
      }
      // No clash promotion here: each slot is refilled right away by the other shoot, and a waiting calendar clash stays
      // listed against the new holder (promoting it made the next placeIn fail 'taken', so the swap could never be accepted).
      takeOut(days[a!.date], a as Spot, aS.id, false); takeOut(days[b!.date], b as Spot, bS.id, false)
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
        // Both creators agreed on the new times, so a team-move stamp from before no longer applies.
        ...(isTeam(caller) ? {} : { teamMovedAt: FieldValue.delete(), bumped: FieldValue.delete() }),
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
  // Repeat weekly (owner, Nov 3: e.g. the trainer every Thursday at 2): the same block on the next N weeks too. A week where
  // someone already has that time is skipped (never wipes a booking) and listed in the answer.
  const weeks = Number.isInteger(d.repeatWeeks) ? Math.max(1, Math.min(26, d.repeatWeeks)) : 1
  const series = weeks > 1 ? randomUUID().slice(0, 8) : undefined
  const placed: string[] = [], skipped: { date: string; names: string[] }[] = []
  let firstId = ''
  for (let w = 0; w < weeks; w++) {
    const date = addDays(d.date, 7 * w)
    const soft = d.soft === true
    const block = { id: randomUUID().slice(0, 8), house: d.house as House, start, end, type, note: str(d.note, 200), by: caller.email, ...(series ? { series } : {}), ...(soft ? { soft: true } : {}) }
    const dayRef = dayRefOf(date)
    await db.runTransaction(async tx => {
      const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
      // Never silently wipe out a booking: the team cancels or moves it first (no strike), then blocks.
      // A heads-up never blocks anyone, so it can go on top of bookings.
      // (A friend hold that already ran out isn't a booking.)
      const clash = soft ? [] : Object.entries(day[block.house] ?? {}).filter(([k, e]) => Number(k) < end && start < Number(k) + s.slotMinutes && !(e.hold && !holdActive(e, nowStamp()))).map(([, e]) => e.name)
      if (clash.length) {
        if (w === 0) throw new HttpsError('failed-precondition', `Already booked then: ${clash.join(', ')}. Move or cancel their shoot first (no strike), then block the time.`, { problem: 'booked', names: clash })
        skipped.push({ date, names: clash }); return
      }
      tx.set(dayRef, { date, blocks: [...(day.blocks ?? []), block] }, { merge: true })
      placed.push(date); if (!firstId) firstId = block.id
    })
  }
  return { id: firstId, placed, skipped }
})

export const removeScheduleBlock = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner', 'equipment'])
  // Blocks from Google Calendar have longer ids ('g' + the event id), so read the whole id (audit: cut at 20, nothing matched
  // and the app said it worked). Clash listings that point at the block go with it.
  const date = req.data?.date, id = str(req.data?.id, 100)
  if (!isDay(date)) throw fail('bad-date')
  if (!id) throw new HttpsError('invalid-argument', 'Which block?')
  const dayRef = dayRefOf(date)
  await db.runTransaction(async tx => {
    const day = ((await tx.get(dayRef)).data() ?? {}) as ScheduleDay
    if (!(day.blocks ?? []).some(b => b.id === id)) throw new HttpsError('not-found', 'That block was already removed.')
    tx.set(dayRef, { blocks: (day.blocks ?? []).filter(b => b.id !== id), clashes: (day.clashes ?? []).filter(c => c.blockId !== id) }, { merge: true })
  })
  return { ok: true }
})

export const saveScheduleSettings = onCall(CALLABLE, async req => {
  // Owner only (owner, Oct 20): slot times, priority days, strike limits affect everyone, so they're maintenance.
  const caller = await requireRole(req, ['owner'])
  const clean = cleanScheduleSettings(req.data)
  await db.doc('app_settings/schedule').set({ ...clean, updatedAt: new Date().toISOString(), updatedBy: caller.email })
  return clean
})

// People who film (owner, Oct 27): active creators + the owner (who isn't in users). Arts, equipment and admins never.
export async function filmingPeople(opts: { includeDemo?: boolean } = {}) {
  const snap = await db.collection('users').where('active', '==', true).get()
  // Demo-mode creators (Props only) can't book, so they're left out until the owner switches them to Full app.
  // includeDemo (owner, Nov 4: "fix the calendar before giving people access"): the calendar import may still put
  // their existing shoots on the schedule, so they show up there.
  const people = snap.docs.filter(u => (u.get('role') === 'creator' && (opts.includeDemo || !isDemoCreator('creator', u.get('access')))) || u.id === OWNER_EMAIL)
    .map(u => ({ email: u.id, name: String(u.get('name') || u.id), role: u.id === OWNER_EMAIL ? 'owner' : 'creator' }))
  if (!people.some(p => p.email === OWNER_EMAIL)) people.push({ email: OWNER_EMAIL, name: 'Alex', role: 'owner' })
  return people.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

// People the schedule team can book for or add to the priority group (the team can't read users directly).
// The schedule team, and admins (they approve requests and can make a priority booking for someone).
export const listSchedulePeople = onCall(CALLABLE, async req => {
  await requireRole(req, [...APPROVERS])
  return { people: await filmingPeople() }
})

// People you can film with (Book a shoot → "+ 1 friend"): active creators and the owner, names only (admins don't film).
export const listFilmingFriends = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const people = (await filmingPeople()).filter(p => p.email !== caller.email).map(p => ({ email: p.email, name: p.name }))
  return { people }
})

// Place a shoot for someone with no rule checks except "the slot is free" (used by the calendar import).
export async function placeShootAsTeam(spot: Spot, who: { email: string; name: string }, by: string, extra: Record<string, unknown> = {}, opts: { kind?: ShootKind; note?: string } = {}) {
  const s = await loadScheduleSettings()
  if (!isDay(spot.date)) throw fail('bad-date')
  const kind: ShootKind = spot.place === 'offsite' ? 'offsite' : opts.kind ?? 'extra'
  const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
  const at = new Date().toISOString()
  const ref = db.collection('shoots').doc()
  await db.runTransaction(async tx => {
    const write = await editDays(tx, [spot.date], days => placeIn(days[spot.date], spot, { shootId: ref.id, name: who.name, email: who.email, kind }, s))
    write()
    tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, status: 'booked',
      bookedBy: by, createdAt: at, updatedAt: at, ...extra,
      history: [{ at, by, action: 'booked', note: opts.note ?? `${spotLabel(spot, s)} · imported from Google Calendar` }],
    })
  })
  return ref.id
}

// Take a shoot off the schedule as the system (the monthly draw's undo). False when it was no longer booked.
export async function cancelShootAsTeam(id: string, by: string, note: string) {
  const ref = db.doc(`shoots/${id}`)
  let done = false
  await db.runTransaction(async tx => {
    const sh = (await tx.get(ref)).data()
    if (!sh || sh.status !== 'booked') return
    const write = await editDays(tx, [sh.date], days => takeOut(days[sh.date], sh as Spot, id))
    write()
    const at = new Date().toISOString()
    tx.update(ref, { status: 'cancelled', cancelledAt: at, cancelledBy: by, updatedAt: at, history: FieldValue.arrayUnion({ at, by, action: 'cancelled', note }) })
    done = true
  })
  return done
}

// A shoot from the old Google Calendar (owner, Oct 19): keeps its REAL hours even when they don't match the grid
// (2:30–5 PM fills the 1–3 and 3–5 slots, so nobody can book over it), ignores blocks, and if another shoot already
// has one of those slots it is still imported and listed as a clash (old events only; new bookings can never clash).
export async function importShootAsTeam(spot: Spot, who: { email: string; name: string }, by: string, extra: Record<string, unknown> = {}, existingId?: string) {
  const s = await loadScheduleSettings()
  if (!isDay(spot.date)) throw fail('bad-date')
  if (!(spot.end > spot.start)) throw fail('bad-hours')
  const keysFor = (sp: Spot) => {
    const touched = s.slots.filter(k => k < sp.end && k + s.slotMinutes > sp.start)
    return (touched.length ? touched : [s.slots.reduce((b, k) => Math.abs(k - sp.start) < Math.abs(b - sp.start) ? k : b, s.slots[0])]).map(slotKey)
  }
  const onGrid = s.slots.includes(spot.start) && spot.end - spot.start === s.slotMinutes
  const win = slotWindow(spot.date, spot.start, spot.end - spot.start)
  const at = new Date().toISOString()
  // existingId: the same Google event was changed there (re-import) → move the app's copy, same shoot.
  const ref = existingId ? db.doc(`shoots/${existingId}`) : db.collection('shoots').doc()
  let clashWith: string[] = []
  await db.runTransaction(async tx => {
    const old = existingId ? (await tx.get(ref)).data() : undefined
    if (existingId && !old) throw new HttpsError('not-found', 'That shoot is gone.')
    const write = await editDays(tx, [...(old && old.status === 'booked' ? [old.date] : []), spot.date], days => {
      clashWith = []
      if (old && old.status === 'booked') takeOut(days[old.date], old as Spot, ref.id)
      const day = days[spot.date]
      if (spot.place === 'offsite') {
        day.offsite = [...(day.offsite ?? []), { shootId: ref.id, name: who.name, email: who.email, start: spot.start, end: spot.end, where: spot.where }]
        return
      }
      const house = spot.place as House
      const map = { ...(day[house] ?? {}) }
      for (const k of keysFor(spot)) {
        const there = map[k]
        if (there && !(there.hold && !holdActive(there, nowStamp())) && there.shootId !== ref.id) {
          clashWith.push(there.name)
          day.clashes = [...(day.clashes ?? []), { house, slot: k, shootId: ref.id, name: who.name, email: who.email, start: spot.start, end: spot.end }]
        } else map[k] = { shootId: ref.id, name: who.name, email: who.email, kind: 'extra', ...(onGrid ? {} : { time: { start: spot.start, end: spot.end } }) }
      }
      day[house] = map
    })
    write()
    clashWith = [...new Set(clashWith)]
    const clash = clashWith.length ? { clash: true, clashWith } : { clash: FieldValue.delete(), clashWith: FieldValue.delete() }
    const note = `${spotLabel(spot, s)}${clashWith.length ? ` · CLASH with ${clashWith.join(', ')}` : ''}`
    const kind: ShootKind = spot.place === 'offsite' ? 'offsite' : 'extra'
    if (old) tx.update(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, status: 'booked', updatedAt: at, ...extra, ...clash,
      history: FieldValue.arrayUnion({ at, by, action: 'moved', note: `changed in Google Calendar · now ${note}` }),
    })
    else tx.set(ref, {
      creatorEmail: who.email, creatorName: who.name, ...spot, month: monthOf(spot.date), from: win.from, to: win.to, kind, status: 'booked',
      bookedBy: by, createdAt: at, updatedAt: at, ...extra, ...(extra.toCheck ? { told: false } : {}), ...(clashWith.length ? { clash: true, clashWith } : {}),
      history: [{ at, by, action: 'booked', note: `${note} · imported from Google Calendar` }],
    })
  })
  return { id: ref.id, clashWith }
}

// The event was deleted in Google Calendar: take the app's copy off the schedule (the calendar itself is untouched).
export async function removeImportedShoot(shootId: string, by: string, toCheck = false) {
  const ref = db.doc(`shoots/${shootId}`)
  let email = ''
  await db.runTransaction(async tx => {
    const sh = (await tx.get(ref)).data()
    if (!sh || sh.status !== 'booked') return
    email = String(sh.creatorEmail ?? '')
    const write = await editDays(tx, [sh.date], days => takeOut(days[sh.date], sh as Spot, shootId))
    write()
    const at = new Date().toISOString()
    // toCheck: the automatic check did it; the creator is told once the equipment team confirms it (Calendar tab).
    tx.update(ref, { status: 'cancelled', updatedAt: at, ...(toCheck ? { toCheck: true } : {}), history: FieldValue.arrayUnion({ at, by, action: 'cancelled', note: 'removed from Google Calendar' }) })
  })
  // Props and gear asked for this shoot aren't needed any more (audit: they were left waiting for a shoot that was gone).
  // toCheck (the automatic check): not yet. The event may have been deleted in Google by mistake and come back; they are let
  // go when the equipment team confirms the card (releaseCancelledImport, from settleQueue).
  if (email && !toCheck) await releaseLinks(SCHEDULE_CALLER, shootId, email).catch(e => console.warn('release links of removed import', shootId, e))
}

// A cancelled imported shoot the team just confirmed: let go of its props and gear (see removeImportedShoot).
export async function releaseCancelledImport(shootId: string) {
  const sh = (await db.doc(`shoots/${shootId}`).get()).data()
  if (!sh || sh.status !== 'cancelled' || !sh.creatorEmail) return
  await releaseLinks(SCHEDULE_CALLER, shootId, String(sh.creatorEmail)).catch(e => console.warn('release links of confirmed removed import', shootId, e))
}

// ─── Filming back to back with friends ───────────────────────────────────────
// Book your slot(s), and hold the slot after yours for each friend (in the order given) for
// INVITE_HOLD_MINUTES. Each friend confirms their own slot (answerInvite); a hold nobody
// confirms simply ends and the slot is free for everyone again. While held, the schedule
// shows "Held for <name>". An invite from a priority-group creator covers a priority day.

function placeHold(day: ScheduleDay, house: House, start: number, entry: SlotEntry, s: ScheduleSettings) {
  if (blockAt(day, house, start, s.slotMinutes)) throw fail('blocked')
  const taken = day[house]?.[slotKey(start)]
  if (taken?.hold ? holdActive(taken, nowStamp()) : taken) throw fail(taken?.hold ? 'held' : 'taken')
  day[house] = { ...(day[house] ?? {}), [slotKey(start)]: entry }
}

export const bookWithFriends = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...BOOKERS])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const spot = readSpot(d, s)
  if (spot.place === 'offsite') throw new HttpsError('invalid-argument', 'Back-to-back booking is for the houses.')
  const house = spot.place as House
  const mySlots = Number.isInteger(d.mySlots) && d.mySlots >= 1 && d.mySlots <= 3 ? d.mySlots as number : 1
  if (!isTeam(caller) && mySlots > s.slotsPerDay) throw fail('day-limit')
  const friendEmails = [...new Set((Array.isArray(d.friends) ? d.friends : []).map((e: unknown) => str(e, 200).toLowerCase()).filter(Boolean))]
    .filter(e => e !== caller.email).slice(0, 4) as string[]
  const friends: { email: string; name: string }[] = []
  for (const email of friendEmails) {
    const u = email === OWNER_EMAIL ? { active: true, name: 'Owner' } : (await db.doc(`users/${email}`).get()).data()
    if (!u || u.active !== true) throw new HttpsError('not-found', `${email} has no active account.`)
    if (isDemoCreator((u as { role?: string }).role, (u as { access?: string }).access)) throw new HttpsError('failed-precondition', `${u.name || email} can't book yet (Props only for now).`, { problem: 'demo' })
    // Only creators and the owner film (same rule as the friend list and hand-over; audit, Nov 7).
    if (email !== OWNER_EMAIL && (u as { role?: string }).role !== 'creator') throw new HttpsError('failed-precondition', `${u.name || email} doesn't film, so they can't be invited to a slot.`, { problem: 'not-filming' })
    friends.push({ email, name: u.name || email })
  }
  const now = nowStamp()
  if (!skipsLock(caller, caller.email) && priorityLocked(spot.date, house, s, caller.email, now)) throw fail('locked')
  const guideline = guidelineFor(caller, caller.email, spot, s, d.guideline)
  const total = mySlots + friends.length
  const starts = Array.from({ length: total }, (_, j) => spot.start + j * s.slotMinutes)
  if (starts.some(st => !s.slots.includes(st))) throw new HttpsError('failed-precondition', 'There aren\'t enough back-to-back slots left that day. Start earlier.')
  const kind: ShootKind = house === MONTHLY_HOUSE && d.kind === 'monthly' ? 'monthly' : 'extra'
  if (kind === 'monthly' && await monthlyUsed(caller.email, monthOf(spot.date)) + mySlots > s.monthlySlots) throw fail('no-monthly-left')

  const until = addMinutes(now, INVITE_HOLD_MINUTES), at = new Date().toISOString()
  const pending = needsApproval(caller, caller.email, s)
  const shootRefs = starts.slice(0, mySlots).map(() => db.collection('shoots').doc())
  const inviteRefs = friends.map(() => db.collection('schedule_invites').doc())
  const withNames = friends.map(f => f.name).join(' and ')
  await db.runTransaction(async tx => {
    const write = await editDays(tx, [spot.date], days => {
      if (!isTeam(caller)) {
        assertDayLimit(days[spot.date], caller.email, mySlots, s)
        friends.forEach(f => assertDayLimit(days[spot.date], f.email, 1, s, [], f.name))
      }
      shootRefs.forEach((ref, j) => placeIn(days[spot.date], { ...spot, start: starts[j], end: starts[j] + s.slotMinutes }, { shootId: ref.id, name: caller.name, email: caller.email, kind, pending }, s))
      friends.forEach((f, j) => placeHold(days[spot.date], house, starts[mySlots + j],
        { shootId: '', name: f.name, email: f.email, kind: 'extra', hold: { until, inviteId: inviteRefs[j].id, fromName: caller.name } }, s))
    })
    write()
    shootRefs.forEach((ref, j) => {
      const sp = { ...spot, start: starts[j], end: starts[j] + s.slotMinutes }
      const win = slotWindow(sp.date, sp.start, s.slotMinutes)
      tx.set(ref, {
        creatorEmail: caller.email, creatorName: caller.name, ...sp, month: monthOf(sp.date), from: win.from, to: win.to, kind, ...(guideline ? { guideline } : {}),
        status: pending ? 'requested' : 'booked', bookedBy: caller.email, createdAt: at, updatedAt: at, ...(pending ? { requestedAt: at } : {}),
        history: [{ at, by: caller.email, action: pending ? 'requested' : 'booked', note: `${spotLabel(sp, s)}${withNames ? ` · with ${withNames}` : ''}` }],
      })
    })
    friends.forEach((f, j) => tx.set(inviteRefs[j], {
      fromEmail: caller.email, fromName: caller.name, fromShootId: shootRefs[0].id, toEmail: f.email, toName: f.name,
      place: house, date: spot.date, start: starts[mySlots + j], end: starts[mySlots + j] + s.slotMinutes,
      until, status: 'pending', createdAt: at,
    }))
  })
  return { shootIds: shootRefs.map(r => r.id), inviteIds: inviteRefs.map(r => r.id), until, status: pending ? 'requested' : 'booked' }
})

// A friend confirms (or declines) the slot held for them. The person who invited can also withdraw it.
export const answerInvite = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...ANYONE])
  const id = str(req.data?.id, 100), accept = req.data?.accept === true
  const ref = db.doc(`schedule_invites/${id}`)
  const s = await loadScheduleSettings()
  const shootRef = db.collection('shoots').doc()
  let outcome = ''
  await db.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data()
    if (!inv) throw new HttpsError('not-found', 'Invite not found.')
    const withdraw = inv.fromEmail === caller.email && !accept
    if (inv.toEmail !== caller.email && !withdraw) throw new HttpsError('permission-denied', 'This invite is for someone else.')
    if (inv.status !== 'pending') throw new HttpsError('failed-precondition', 'This invite was already answered.')
    // The inviter's shoot is gone (cancelled, not approved, given away): there's nobody to film back to back with.
    const from = accept && inv.fromShootId ? (await tx.get(db.doc(`shoots/${inv.fromShootId}`))).data() : null
    const now = nowStamp(), at = new Date().toISOString()
    const ours = (days: Record<string, ScheduleDay>) => days[inv.date][inv.place as House]?.[slotKey(inv.start)]?.hold?.inviteId === id
    const clear = (days: Record<string, ScheduleDay>) => {
      if (!ours(days)) return
      const { [slotKey(inv.start)]: _gone, ...rest } = days[inv.date][inv.place as House]!
      days[inv.date][inv.place as House] = rest
    }
    if (!accept) {
      const write = await editDays(tx, [inv.date], clear); write()
      tx.update(ref, { status: withdraw ? 'withdrawn' : 'declined', answeredAt: at })
      outcome = 'declined'; return
    }
    if (inv.until <= now) {
      const write = await editDays(tx, [inv.date], clear); write()
      tx.update(ref, { status: 'expired', answeredAt: at })
      outcome = 'expired'; return
    }
    if (from && !['booked', 'requested'].includes(from.status)) {
      const write = await editDays(tx, [inv.date], clear); write()
      tx.update(ref, { status: 'withdrawn', answeredAt: at, reason: 'shoot-gone' })
      outcome = 'gone'; return
    }
    const sp: Spot = { place: inv.place, date: inv.date, start: inv.start, end: inv.end, where: '' }
    const pending = needsApproval(caller, inv.toEmail, s)
    const write = await editDays(tx, [inv.date], days => {
      if (!ours(days)) throw fail('taken')
      clear(days)
      assertDayLimit(days[inv.date], inv.toEmail, 1, s)
      placeIn(days[inv.date], sp, { shootId: shootRef.id, name: inv.toName, email: inv.toEmail, kind: 'extra', pending }, s)
    })
    write()
    const win = slotWindow(sp.date, sp.start, s.slotMinutes)
    tx.set(shootRef, {
      creatorEmail: inv.toEmail, creatorName: inv.toName, ...sp, month: monthOf(sp.date), from: win.from, to: win.to, kind: 'extra',
      status: pending ? 'requested' : 'booked', bookedBy: caller.email, createdAt: at, updatedAt: at, invitedBy: inv.fromEmail, ...(pending ? { requestedAt: at } : {}),
      history: [{ at, by: caller.email, action: pending ? 'requested' : 'booked', note: `${spotLabel(sp, s)} · invited by ${inv.fromName}` }],
    })
    tx.update(ref, { status: 'accepted', answeredAt: at, shootId: shootRef.id })
    outcome = 'accepted'
  })
  if (outcome === 'expired') throw new HttpsError('failed-precondition', `The ${INVITE_HOLD_MINUTES} minutes ran out, so the slot opened to everyone. Book it on the schedule if it's still free.`, { problem: 'expired' })
  if (outcome === 'gone') throw new HttpsError('failed-precondition', 'Their shoot was cancelled, so this invite is off and the slot is open to everyone. Book it on the schedule if you still want it.', { problem: 'expired' })
  return { ok: true, shootId: outcome === 'accepted' ? shootRef.id : null }
})

// ─── Priority booking (owner, Nov 2: Kyle / Stromedy have priority) ──────────────────────────────────────────────
// Someone with top priority needs a slot another creator holds. The schedule team (owner, equipment, admins) gives it:
// the holder is MOVED to a free time that day (props and gear follow, same day) or, if no time works, their shoot is
// CANCELLED. Either way they get a neutral "schedule change" notice, and after a cancel their NEXT request goes first
// (user_status.firstInLine). The slot goes to a new shoot for that person, or to their own event from Google Calendar
// that clashed with it (clashShootId). A person on "Books without approval" can also take a slot themselves (bookShoot
// with take: true); then the holder is cancelled the same way.
export interface GiveArgs { date: string; house: House; start: number; toEmail?: string; clashShootId?: string; moveTo?: { house: House; start: number } | null; note?: string }
export async function giveSlotTo(caller: Caller, a: GiveArgs, s: ScheduleSettings) {
  if (!isDay(a.date) || !['cliff1', 'cliff2'].includes(a.house) || !s.slots.includes(a.start)) throw fail('bad-date', 'Pick a slot on the schedule.')
  if (a.moveTo && (!['cliff1', 'cliff2'].includes(a.moveTo.house) || !s.slots.includes(a.moveTo.start))) throw new HttpsError('invalid-argument', 'Pick a free time to move them to.')
  const key = slotKey(a.start), now = nowStamp(), at = new Date().toISOString()
  const pre = (await dayRefOf(a.date).get()).data() as ScheduleDay | undefined
  const holderId = pre?.[a.house]?.[key]?.shootId
  if (!holderId) throw new HttpsError('failed-precondition', 'Nobody has that slot any more. Book it the normal way.')
  const holderRef = db.doc(`shoots/${holderId}`)
  const clashRef = a.clashShootId ? db.doc(`shoots/${a.clashShootId}`) : null
  const newRef = db.collection('shoots').doc()
  let out = { holderEmail: '', holderName: '', moved: false, toName: '', shootId: '' }
  let clashLeft = false
  await db.runTransaction(async tx => {
    const h = (await tx.get(holderRef)).data()
    const c = clashRef ? (await tx.get(clashRef)).data() : undefined
    if (!h || !['booked', 'requested'].includes(h.status)) throw new HttpsError('failed-precondition', 'That shoot changed in the meantime. Look again.')
    if (h.from <= now) throw new HttpsError('failed-precondition', 'That shoot has already started.')
    if (clashRef && (!c || c.status !== 'booked')) throw new HttpsError('failed-precondition', 'That calendar event is gone.')
    let to: { email: string; name: string }
    if (c) to = { email: c.creatorEmail, name: c.creatorName }
    else {
      const email = str(a.toEmail, 200).toLowerCase()
      if (!email) throw new HttpsError('invalid-argument', 'Who gets the slot?')
      const inst = s.instantBookers.find(p => p.email === email)
      const u = email === OWNER_EMAIL ? { name: 'Owner', active: true, role: 'owner' } : (await tx.get(db.doc(`users/${email}`))).data()
      if (!u || u.active !== true) throw new HttpsError('not-found', 'That person has no active account.')
      to = { email, name: inst?.name || u.name || email }
    }
    if (to.email === h.creatorEmail) throw new HttpsError('failed-precondition', `${h.creatorName} already has this slot.`)
    // Cancelled (not moved): a friend's slot held next to theirs goes too.
    const invs = a.moveTo ? [] : await pendingInvitesOf(tx, holderId)
    const spot: Spot = { place: a.house, date: a.date, start: a.start, end: a.start + s.slotMinutes, where: '' }
    const moveSpot: Spot | null = a.moveTo ? { place: a.moveTo.house, date: a.date, start: a.moveTo.start, end: a.moveTo.start + s.slotMinutes, where: '' } : null
    const write = await editDays(tx, [a.date], days => {
      const day = days[a.date]
      if (day[a.house]?.[key]?.shootId !== holderId) throw new HttpsError('failed-precondition', 'That slot changed in the meantime. Look again.')
      // A slot someone asked to MOVE into (or a shoot with a move waiting) is sorted out first (audit: giving it away left the
      // move request behind, and approving it later took the wrong slot).
      // (Said differently to someone with top priority taking it themselves: they can't approve anything.)
      if (day[a.house]?.[key]?.move || h.moveRequest) throw new HttpsError('failed-precondition', (APPROVERS as readonly string[]).includes(caller.role)
        ? `${h.creatorName} has a move request waiting. Approve or deny it first.`
        : 'This slot has a change waiting for the team to decide. Pick another time, or try again later.')
      takeOut(day, h as Spot, holderId, false)
      clearHolds(days, invs)
      if (moveSpot) {
        if (moveSpot.place === a.house && moveSpot.start === a.start) throw new HttpsError('invalid-argument', 'Pick a different time to move them to.')
        if (moveSpot.start < a.start + s.slotMinutes && moveSpot.start + s.slotMinutes > a.start && moveSpot.place === a.house) throw new HttpsError('invalid-argument', 'Pick a different time to move them to.')
        placeIn(day, moveSpot, { shootId: holderId, name: h.creatorName, email: h.creatorEmail, kind: h.kind, pending: h.status === 'requested' }, s)
      }
      if (c) {
        const mine = (day.clashes ?? []).filter(x => x.shootId === clashRef!.id && x.house === a.house)
        const map = { ...(day[a.house] ?? {}) }
        const freed = mine.filter(x => !map[x.slot])
        if (!freed.length) throw new HttpsError('failed-precondition', 'That calendar event doesn\'t clash with this slot.')
        const onGrid = s.slots.includes(c.start) && c.end - c.start === s.slotMinutes
        for (const x of freed) map[x.slot] = { shootId: clashRef!.id, name: to.name, email: to.email, kind: 'extra', ...(onGrid ? {} : { time: { start: c.start, end: c.end } }) }
        day[a.house] = map
        day.clashes = (day.clashes ?? []).filter(x => !freed.includes(x))
        clashLeft = day.clashes.some(x => x.shootId === clashRef!.id)
      } else placeIn(day, spot, { shootId: newRef.id, name: to.name, email: to.email, kind: 'extra' }, s)
    })
    write()
    const why = `${to.name} needed it${a.note ? ` · ${str(a.note, 200)}` : ''}`
    const bumped = { for: to.email, forName: to.name, by: caller.email, at, ...(moveSpot ? { movedFrom: { place: a.house, start: a.start } } : {}) }
    if (moveSpot) {
      const win = slotWindow(a.date, moveSpot.start, s.slotMinutes)
      tx.update(holderRef, { place: moveSpot.place, start: moveSpot.start, end: moveSpot.end, from: win.from, to: win.to, kind: moveSpot.place === MONTHLY_HOUSE ? h.kind : h.kind === 'monthly' ? 'extra' : h.kind,
        bumped, updatedAt: at, history: FieldValue.arrayUnion({ at, by: caller.email, action: 'bumped', note: `moved to ${spotLabel(moveSpot, s)} · ${why}` }) })
    } else {
      withdrawInvites(tx, invs, at)
      tx.update(holderRef, { status: 'cancelled', cancelledBy: caller.email, bumped, updatedAt: at,
        history: FieldValue.arrayUnion({ at, by: caller.email, action: 'bumped', note: `cancelled · ${why}` }) })
    }
    if (c) {
      tx.update(clashRef!, { updatedAt: at, ...(clashLeft ? {} : { clash: FieldValue.delete(), clashWith: FieldValue.delete() }),
        history: FieldValue.arrayUnion({ at, by: caller.email, action: 'given', note: `${spotLabel(spot, s)} given to ${to.name} (was ${h.creatorName})` }) })
    } else {
      const win = slotWindow(a.date, a.start, s.slotMinutes)
      tx.set(newRef, { creatorEmail: to.email, creatorName: to.name, ...spot, month: monthOf(a.date), from: win.from, to: win.to, kind: 'extra', status: 'booked',
        bookedBy: caller.email, createdAt: at, updatedAt: at, history: [{ at, by: caller.email, action: 'booked', note: `${spotLabel(spot, s)} · given by ${caller.name} (was ${h.creatorName})` }] })
    }
    out = { holderEmail: h.creatorEmail, holderName: h.creatorName, moved: !!moveSpot, toName: to.name, shootId: c ? clashRef!.id : newRef.id }
  })
  if (!out.moved) {
    await db.doc(`user_status/${out.holderEmail}`).set({ firstInLine: { at, date: a.date, forName: out.toName } }, { merge: true })
    await releaseLinks(caller, holderId, out.holderEmail)
  }
  return { ok: true, ...out, holderId }
}

export const giveSlot = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, [...APPROVERS])
  const d = req.data ?? {}
  const s = await loadScheduleSettings()
  const moveTo = d.moveTo && typeof d.moveTo === 'object' ? { house: d.moveTo.house as House, start: Number(d.moveTo.start) } : null
  return giveSlotTo(caller, { date: str(d.date, 10), house: d.house, start: Number(d.start), toEmail: d.toEmail, clashShootId: str(d.clashShootId, 100) || undefined, moveTo, note: d.note }, s)
})
