// Hourly check that queues emails nobody triggers by tapping a button:
//  • a creator's props have become late (to the creator and the arts department);
//  • an upcoming booking is at risk because a prop is late, damaged or missing
//    (to that booking's creator and the arts department).
// Each notice is sent once: the reservation remembers it (lateNotifiedAt, riskNotified).
// import { onSchedule } from 'firebase-functions/v2/scheduler'  (for the hourly check below)
import { onCall } from 'firebase-functions/v2/https'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { loadSettings } from './reservations.js'
import {
  isLate, lineRisk, returnDueDay, todayInStudio, turnaroundFor, RETURN_DEADLINE_HOUR,
  type BookingEntry, type Risk,
} from './booking.js'

const RISK_TEXT: Record<Risk, string> = {
  late: "hasn't been returned yet by the person who had it before",
  damaged: 'came back damaged',
  missing: 'has units missing',
}

function queue(batch: FirebaseFirestore.WriteBatch, to: string, subject: string, body: string, reservationId: string) {
  batch.set(db.collection('outbox').doc(), { to, subject, body, reservationId, createdAt: new Date().toISOString(), sent: false })
}

export async function runNotices(now = new Date()) {
  const settings = await loadSettings()
  const today = todayInStudio(now)
  const batch = db.batch()
  let late = 0, atRisk = 0

  // 1. Newly late bookings.
  const out = await db.collection('reservations').where('status', '==', 'collected').get()
  for (const d of out.docs) {
    const r = d.data()
    if (r.lateNotifiedAt || !isLate('collected', r.endDate, settings, now)) continue
    const due = `${RETURN_DEADLINE_HOUR}am on ${returnDueDay(r.endDate, settings)}`
    queue(batch, r.creatorEmail, `Late: please return the props from "${r.title}"`,
      `The props from "${r.title}" were due back by ${due}. Please bring them to the arts department as soon as you can.\n\nYou can't book more props until they're returned.`, d.id)
    queue(batch, 'arts-team', `Late: "${r.title}" (${r.creatorName})`,
      `${r.creatorName} (${r.creatorEmail}) hasn't returned the props from "${r.title}". They were due back by ${due}.`, d.id)
    batch.update(d.ref, { lateNotifiedAt: now.toISOString() })
    late++
  }

  // 2. Upcoming bookings whose props might not be ready.
  const upcoming = (await db.collection('reservations').where('status', 'in', ['requested', 'preparing']).get())
    .docs.filter(d => (d.get('startDate') as string) >= today)
  const itemIds = [...new Set(upcoming.flatMap(d => (d.get('lines') as DocumentData[] ?? []).map(l => l.itemId as string)))]
  if (itemIds.length) {
    const refs = itemIds.flatMap(id => [db.doc(`items/${id}`), db.doc(`item_bookings/${id}`)])
    const snaps = await db.getAll(...refs)
    const items = new Map(itemIds.map((id, i) => [id, snaps[i * 2].data()]))
    const entries = new Map(itemIds.map((id, i) => [id, (snaps[i * 2 + 1].get('entries') as BookingEntry[] | undefined) ?? []]))
    const cats = await db.collection('categories').get()
    const catTurnaround = Object.fromEntries(cats.docs.map(c => [c.id, c.get('turnaroundDays') as number | undefined]))

    for (const d of upcoming) {
      const r = d.data()
      const told: string[] = r.riskNotified ?? []
      const fresh: { name: string; itemId: string; risk: Risk }[] = []
      for (const l of (r.lines ?? []) as DocumentData[]) {
        const item = items.get(l.itemId)
        if (!item || l.pick || told.includes(l.itemId)) continue
        const risk = lineRisk({
          reservationId: d.id, qty: l.qty, start: r.startDate, end: r.endDate,
          stock: { quantity: Number(item.quantity) || 1, missingQty: Number(item.missingQty ?? 0) },
          damaged: item.condition === 'damaged', entries: entries.get(l.itemId) ?? [], today,
          bufferDays: turnaroundFor(item.categoryId ?? item.itemType ?? 'prop', catTurnaround, settings.bufferDays),
          closed: settings, now,
        })
        if (risk) fresh.push({ name: l.itemName, itemId: l.itemId, risk })
      }
      if (!fresh.length) continue
      const list = fresh.map(f => `• ${f.name} ${RISK_TEXT[f.risk]}`).join('\n')
      queue(batch, r.creatorEmail, `Heads up: some props for "${r.title}" might not be ready`,
        `For your shoot on ${r.startDate}:\n${list}\n\nYour booking still stands. The arts department has been told; if something can't be ready they'll mark it not available. You may want to look for something similar in Prime Capitol.`, d.id)
      queue(batch, 'arts-team', `At risk: "${r.title}" (${r.startDate})`,
        `${r.creatorName}'s booking "${r.title}" on ${r.startDate}:\n${list}\n\nChase it up, or mark it "not available" with a reason so the creator knows.`, d.id)
      batch.update(d.ref, { riskNotified: FieldValue.arrayUnion(...fresh.map(f => f.itemId)) })
      atRisk++
    }
  }

  if (late || atRisk) await batch.commit()
  return { late, atRisk }
}

// Every hour, Toronto time. Turned OFF until email is set up (it needs Google
// Cloud Scheduler, which the owner approves separately). To turn on: uncomment.
// export const checkLateAndAtRisk = onSchedule({ schedule: 'every 60 minutes', timeZone: 'America/Toronto' }, async () => {
//   await runNotices()
// })

// Owner: run the same check right now (also used by the automated tests).
export const checkNoticesNow = onCall(CALLABLE, async req => {
  await requireRole(req, ['owner'])
  return runNotices()
})
