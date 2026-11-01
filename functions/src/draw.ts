// Guaranteed Cliff 1 slots (owner, Nov 1: start in December; "every creator" gets 4 a month, spread out).
// 1) Wishlist: between the 15th and the 20th at 6 PM, creators rank up to 8 Cliff 1 slots for next month
//    (`monthly_wishes/{month}_{email}`, written only here).
// 2) Draw: on the 20th at 6 PM (checked by the 10-minute reminder job, no extra scheduled job) the app runs the fair
//    draw (monthlyDraw.ts) and books every slot as a 'monthly' shoot; the result is kept in `monthly_draws/{month}`.
//    Everyone gets one notification with their slots. The owner can also run it by hand, or undo it before the month starts.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { addDays, todayInStudio, weekday } from './booking.js'
import { nowStamp, stamp, fmtTime } from './gearBooking.js'
import { blockAt, holdActive, houseSlotsOn, slotKey, type ScheduleDay } from './schedule.js'
import { loadScheduleSettings, placeShootAsTeam, cancelShootAsTeam, filmingPeople } from './scheduling.js'
import { openLinks } from './shootLinks.js'
import { sendPush } from './push.js'
import { runDraw, wishWindow, daysOfMonth, drawMonthFor, MAX_WISHES, DRAW_DAY, DRAW_MINUTE, WISHLIST_OPEN_DAY, type DrawPerson, type Wish } from './monthlyDraw.js'

const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' })
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const wishDoc = (month: string, email: string) => db.doc(`monthly_wishes/${month}_${email}`)
const drawDoc = (month: string) => db.doc(`monthly_draws/${month}`)

// Everyone who gets monthly slots (owner, Nov 1: "every creator", Props only too) + the owner, who films.
async function drawPeople() {
  const snap = await db.collection('users').where('role', '==', 'creator').where('active', '==', true).get()
  const people = snap.docs.map(u => ({ email: u.id, name: String(u.get('name') || u.id) }))
  const owner = (await db.doc(`users/${OWNER_EMAIL}`).get()).get('name')
  if (!people.some(p => p.email === OWNER_EMAIL)) people.push({ email: OWNER_EMAIL, name: String(owner || 'Alex') })
  return people
}

// Save your ranked wishes (creators on the full app + the owner; the window is the same for everyone).
export const saveWishlist = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])
  const month = req.data?.month
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Pick a month.')
  const w = wishWindow(month), now = nowStamp()
  if (now < w.opens) throw new HttpsError('failed-precondition', `The ${monthName(month)} wishlist opens on the ${WISHLIST_OPEN_DAY}th.`)
  if (now >= w.closes || (await drawDoc(month).get()).get('status') === 'done') throw new HttpsError('failed-precondition', `The ${monthName(month)} draw already happened. Book extra slots on the schedule instead.`)
  const s = await loadScheduleSettings()
  const friends = new Set((await filmingPeople()).map(p => p.email))
  const raw = Array.isArray(req.data?.wishes) ? req.data.wishes : []
  if (raw.length > MAX_WISHES) throw new HttpsError('invalid-argument', `Up to ${MAX_WISHES} wishes.`)
  const priority = s.priority.some(p => p.email === caller.email)
  const wishes: Wish[] = []
  for (const x of raw) {
    const date = String(x?.date ?? ''), start = Number(x?.start)
    if (!date.startsWith(month) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !s.slots.includes(start)) throw new HttpsError('invalid-argument', 'One of the wishes isn\'t a Cliff 1 slot that month.')
    if (!priority && s.priorityWeekdays.includes(weekday(date))) throw new HttpsError('invalid-argument', `${dayLabel(date)} is a priority day at ${s.houses.cliff1.name}. Pick another day.`)
    if (wishes.some(o => o.date === date && o.start === start)) continue
    const partner = typeof x?.partner === 'string' ? x.partner.toLowerCase().trim() : ''
    if (partner && (partner === caller.email || !friends.has(partner))) throw new HttpsError('invalid-argument', 'Pick your partner from the list.')
    wishes.push({ date, start, ...(partner ? { partner } : {}) })
  }
  await wishDoc(month, caller.email).set({ month, email: caller.email, name: caller.name, wishes, updatedAt: new Date().toISOString() })
  return { ok: true, count: wishes.length }
})

// The draw itself: read everything, decide (monthlyDraw.ts), then book each slot. Never runs twice for a month.
export async function runMonthlyDrawFor(month: string, by: string) {
  const ref = drawDoc(month)
  // Claim the month first, so two runs (the timer + a tap) can't both book.
  await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data()
    if (d && (d.status === 'done' || d.status === 'running')) throw new HttpsError('already-exists', `The ${monthName(month)} draw already ran.`)
    tx.set(ref, { month, status: 'running', startedAt: new Date().toISOString(), by }, { merge: true })
  })
  try {
    const s = await loadScheduleSettings()
    const now = nowStamp()
    const dates = daysOfMonth(month)
    const dayDocs = await db.getAll(...dates.map(d => db.doc(`schedule_days/${d}`)))
    const days: Record<string, ScheduleDay | undefined> = Object.fromEntries(dayDocs.map((d, i) => [dates[i], d.data() as ScheduleDay | undefined]))
    const free = dates.flatMap(date => s.slots.filter(start => {
      const e = days[date]?.cliff1?.[slotKey(start)]
      return (!e || (e.hold && !holdActive(e, now))) && !blockAt(days[date], 'cliff1', start, s.slotMinutes) && stamp(date, start) > now
    }).map(start => ({ date, start })))
    const people = await drawPeople()
    const wishes = await db.collection('monthly_wishes').where('month', '==', month).get()
    const wishOf = new Map(wishes.docs.map(d => [d.get('email') as string, (d.get('wishes') ?? []) as Wish[]]))
    // Their usual days and times (last 90 days of house shoots), for the app's own placements.
    const past = await db.collection('shoots').where('date', '>=', addDays(todayInStudio(), -90)).get()
    const usualOf = (email: string) => {
      const mine = past.docs.map(d => d.data()).filter(x => x.creatorEmail === email && x.status === 'booked' && x.place !== 'offsite')
      const top = (xs: number[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([x]) => x)
      return { weekdays: top(mine.map(x => weekday(x.date))), starts: top(mine.map(x => Number(x.start))) }
    }
    const input: DrawPerson[] = people.map(p => ({
      ...p, priority: s.priority.some(x => x.email === p.email), wishes: wishOf.get(p.email) ?? [], usual: usualOf(p.email),
      busyDays: dates.filter(d => houseSlotsOn(days[d], p.email, now) > 0),
    }))
    const result = runDraw({ month, people: input, free, perPerson: s.monthlySlots, slotMinutes: s.slotMinutes, priorityWeekdays: s.priorityWeekdays })
    const placed: (typeof result.placements[number] & { shootId: string })[] = []
    const failed: typeof result.placements = []
    for (const p of result.placements) {
      const how = p.how === 'auto' ? 'placed by the app' : p.how === 'partner' ? `wish #${p.rank}, back to back with ${p.with}` : `wish #${p.rank}${p.with ? `, back to back with ${p.with}` : ''}`
      try {
        const shootId = await placeShootAsTeam({ place: 'cliff1', date: p.date, start: p.start, end: p.start + s.slotMinutes, where: '' }, { email: p.email, name: p.name }, 'monthly draw',
          { draw: month }, { kind: 'monthly', note: `${monthName(month)} guaranteed slot · from the draw (${how})` })
        placed.push({ ...p, shootId })
      } catch (e) { logger.warn('Draw placement failed', p, String(e)); failed.push(p) }
    }
    const short = people.map(p => ({ ...p, missing: s.monthlySlots - placed.filter(x => x.email === p.email).length })).filter(x => x.missing > 0)
    await ref.set({ month, status: 'done', ranAt: new Date().toISOString(), by, placements: placed, short, order: result.order, people: people.length, wishers: wishOf.size })
    // One notification each, with their slots; the team gets the summary.
    for (const p of people) {
      const mine = placed.filter(x => x.email === p.email)
      if (!mine.length) continue
      await sendPush({ to: [p.email], url: '/shoots', tag: `draw-${month}`, title: `Your ${monthName(month)} Cliff 1 slots 🎬`,
        body: mine.map(x => `${dayLabel(x.date)} ${fmtTime(x.start)}`).join(' · ') }).catch(() => 0)
    }
    await sendPush({ to: ['gear-team', OWNER_EMAIL], url: '/schedule/draw', tag: `draw-${month}`, title: `${monthName(month)} draw done`,
      body: `${placed.length} slots booked for ${people.length} people${short.length ? `; ${short.length} got fewer than ${s.monthlySlots}` : ''}.` }).catch(() => 0)
    return { placed: placed.length, short, failed: failed.length }
  } catch (e) {
    await ref.set({ status: 'failed', error: String((e as Error).message).slice(0, 300), failedAt: new Date().toISOString() }, { merge: true })
    throw e
  }
}

export const runMonthlyDraw = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  const caller = await requireRole(req, ['owner'])
  const month = req.data?.month
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Pick a month.')
  if (`${month}-01` <= todayInStudio()) throw new HttpsError('failed-precondition', 'That month has already started.')
  return runMonthlyDrawFor(month, caller.email)
})

// Undo (owner, before the month starts): takes the draw's shoots off the schedule. Shoots that already have props or
// gear on them are kept (and listed), so nothing a creator asked for disappears.
export const undoMonthlyDraw = onCall({ ...CALLABLE, timeoutSeconds: 300 }, async req => {
  const caller = await requireRole(req, ['owner'])
  const month = req.data?.month
  if (!isMonth(month)) throw new HttpsError('invalid-argument', 'Pick a month.')
  if (`${month}-01` <= todayInStudio()) throw new HttpsError('failed-precondition', 'That month has already started.')
  const d = (await drawDoc(month).get()).data()
  if (!d || (d.status !== 'done' && d.status !== 'failed')) throw new HttpsError('failed-precondition', 'There is no draw to undo.')
  const kept: string[] = []
  let removed = 0
  for (const sh of (await db.collection('shoots').where('draw', '==', month).get()).docs) {
    const links = await openLinks(sh.id)
    if (links.props.length + links.gear.length + links.sharedGear.length) { kept.push(`${sh.get('creatorName')} ${sh.get('date')}`); continue }
    if (await cancelShootAsTeam(sh.id, 'monthly draw', `${monthName(month)} draw undone by ${caller.name}`)) removed++
  }
  await drawDoc(month).set({ status: 'undone', undoneAt: new Date().toISOString(), undoneBy: caller.email, kept }, { merge: true })
  return { removed, kept }
})

// Called by the 10-minute reminder job: wishlist-open + last-day nudges, and the draw itself on the 20th at 6 PM.
export async function drawTick(now = nowStamp()) {
  const today = now.slice(0, 10), day = Number(today.slice(8, 10)), minute = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
  const month = drawMonthFor(today)
  const once = async (key: string) => { try { await db.doc(`push_sent/${key}`).create({ at: new Date().toISOString() }); return true } catch { return false } }
  const people = async () => (await filmingPeople()).map(p => p.email)   // full-app creators + owner can make wishes
  if (day === WISHLIST_OPEN_DAY && minute >= 9 * 60 && await once(`wish_open_${month}`)) {
    await sendPush({ to: await people(), url: '/schedule/wishlist', tag: `wish-${month}`, title: `Pick your ${monthName(month)} Cliff 1 slots`,
      body: `Rank up to ${MAX_WISHES} wishes by the ${DRAW_DAY}th at ${fmtTime(DRAW_MINUTE)}. Everyone gets their slots in a fair draw.` }).catch(() => 0)
  }
  if (day === DRAW_DAY && minute >= 12 * 60 && minute < DRAW_MINUTE && await once(`wish_last_${month}`)) {
    await sendPush({ to: await people(), url: '/schedule/wishlist', tag: `wish-${month}`, title: `Draw tonight at ${fmtTime(DRAW_MINUTE)}`,
      body: `Last chance to add your ${monthName(month)} wishes. No wishes? The app picks your slots for you.` }).catch(() => 0)
  }
  if (day === DRAW_DAY && minute >= DRAW_MINUTE) {
    const d = (await drawDoc(month).get()).data()
    if (!d || d.status === 'failed' && !d.retried) {
      if (d) await drawDoc(month).set({ retried: true }, { merge: true })
      try { await runMonthlyDrawFor(month, 'automatic') } catch (e) { logger.warn('Monthly draw failed', String(e)) }
    }
  }
}
