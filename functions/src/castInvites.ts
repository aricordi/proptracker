// "Who's in this video?" (owner, Nov 21): invite the people who appear in your video; they accept or decline, and once in,
// the shoot shows on their side ("You're in Ariel's video") with reminders. Rules + messages live in cast.ts (pure).
// cast_invites/{shootId}_{email}: readable by the person invited, the host and the schedule team; written only here.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { loadScheduleSettings } from './scheduling.js'
import { sendPush } from './push.js'
import { placeName } from './pushMessages.js'
import { nowStamp } from './gearBooking.js'
import {
  CAST_LIVE, MAX_CAST, castId, snapshotOf, shootIsLive, castFollow, invitedPush, answeredPush, removedPush, type CastInvite,
} from './cast.js'

const TEAM = ['owner', 'equipment']
const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max)

/** Someone who can be in a video: an active creator (Full app or Props only) or the owner. */
async function person(email: string): Promise<{ email: string; name: string } | null> {
  if (email === OWNER_EMAIL) return { email, name: 'Alex' }
  const u = (await db.doc(`users/${email}`).get()).data()
  if (!u || u.active !== true || u.role !== 'creator') return null
  return { email, name: String(u.name || email) }
}

/** Add people to a shoot's cast. `accepted` = already said yes (e.g. the booker of a back-to-back block). Returns who was added. */
export async function addCast(shootId: string, invitees: { email: string; name: string; accepted?: boolean }[], invitedBy: string) {
  const ref = db.doc(`shoots/${shootId}`)
  const sh = (await ref.get()).data()
  if (!sh || !shootIsLive(sh)) throw new HttpsError('failed-precondition', 'This shoot isn\'t on the schedule any more.')
  const s = await loadScheduleSettings()
  const snap = snapshotOf(sh, placeName(sh, s))
  const at = new Date().toISOString()
  const added: CastInvite[] = []
  const existing = await db.collection('cast_invites').where('shootId', '==', shootId).get()
  let live = existing.docs.filter(d => CAST_LIVE.includes(d.get('status'))).length
  for (const p of invitees) {
    const email = p.email.toLowerCase()
    if (!email || email === sh.creatorEmail || email.startsWith('guest:')) continue
    const id = castId(shootId, email)
    const was = existing.docs.find(d => d.id === id)?.data() as CastInvite | undefined
    if (was && CAST_LIVE.includes(was.status) && !(p.accepted && was.status === 'pending')) continue
    if (!was || !CAST_LIVE.includes(was.status)) {
      if (live >= MAX_CAST) throw new HttpsError('resource-exhausted', `Up to ${MAX_CAST} people per video.`)
      live++
    }
    const inv: CastInvite = {
      shootId, hostEmail: String(sh.creatorEmail), hostName: String(sh.creatorName || sh.creatorEmail),
      toEmail: email, toName: p.name, ...snap,
      status: p.accepted ? 'accepted' : 'pending', invitedBy, invitedAt: at, updatedAt: at, ...(p.accepted ? { answeredAt: at } : {}),
    }
    await db.doc(`cast_invites/${id}`).set(inv)
    added.push(inv)
    if (!p.accepted) await sendPush(invitedPush(id, inv)).catch(e => logger.warn('cast invite push', String(e)))
  }
  return added
}

// The host (or the schedule team) invites people into the video.
export const inviteToVideo = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator', 'equipment'])
  const shootId = str(req.data?.shootId, 100)
  const sh = (await db.doc(`shoots/${shootId}`).get()).data()
  if (!sh) throw new HttpsError('not-found', 'Shoot not found.')
  if (sh.creatorEmail !== caller.email && !TEAM.includes(caller.role)) throw new HttpsError('permission-denied', 'Only the person filming can invite people to this video.')
  if (!shootIsLive(sh)) throw new HttpsError('failed-precondition', 'This shoot isn\'t on the schedule any more.')
  if (sh.from && nowStamp() >= sh.from) throw new HttpsError('failed-precondition', 'This shoot has already started.')
  const emails = (Array.isArray(req.data?.emails) ? req.data.emails : []).map((e: unknown) => str(e, 200).trim().toLowerCase()).filter(Boolean).slice(0, MAX_CAST) as string[]
  if (!emails.length) throw new HttpsError('invalid-argument', 'Pick at least one person.')
  const people: { email: string; name: string }[] = []
  for (const e of emails) {
    if (e === sh.creatorEmail) continue
    const p = await person(e)
    if (!p) throw new HttpsError('not-found', `${e} doesn't have an active account in the app.`)
    people.push(p)
  }
  const added = await addCast(shootId, people, caller.email)
  return { invited: added.map(a => a.toEmail) }
})

// The person invited says yes or no; later they can step out ("leave") of a video they said yes to.
export const answerVideoInvite = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'], { demoOk: true })
  const id = str(req.data?.id, 300), leave = req.data?.leave === true, accept = req.data?.accept === true
  const ref = db.doc(`cast_invites/${id}`)
  const out: { inv: CastInvite | null; what: 'accepted' | 'declined' | 'left' } = { inv: null, what: 'declined' }
  await db.runTransaction(async tx => {
    const inv = (await tx.get(ref)).data() as CastInvite | undefined
    if (!inv) throw new HttpsError('not-found', 'Invite not found.')
    if (inv.toEmail !== caller.email) throw new HttpsError('permission-denied', 'This invite is for someone else.')
    if (inv.status === 'cancelled' || inv.status === 'removed') throw new HttpsError('failed-precondition', 'This video isn\'t happening with you any more.')
    if (inv.from && nowStamp() >= inv.to) throw new HttpsError('failed-precondition', 'This shoot is already over.')
    const at = new Date().toISOString()
    if (leave) {
      if (inv.status !== 'accepted') throw new HttpsError('failed-precondition', 'You haven\'t said yes to this one.')
      out.what = 'left'
    } else {
      if (inv.status === (accept ? 'accepted' : 'declined')) return
      out.what = accept ? 'accepted' : 'declined'
    }
    tx.update(ref, { status: out.what, answeredAt: at, updatedAt: at })
    out.inv = { ...inv, status: out.what }
  })
  if (out.inv) await sendPush(answeredPush(id, out.inv, out.what)).catch(e => logger.warn('cast answer push', String(e)))
  return { status: out.inv?.status ?? null }
})

// The host (or the schedule team) takes someone out of the video.
export const removeFromVideo = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator', 'equipment'])
  const id = str(req.data?.id, 300)
  const ref = db.doc(`cast_invites/${id}`)
  const inv = (await ref.get()).data() as CastInvite | undefined
  if (!inv) throw new HttpsError('not-found', 'Invite not found.')
  if (inv.hostEmail !== caller.email && !TEAM.includes(caller.role)) throw new HttpsError('permission-denied', 'Only the person filming can change who\'s in the video.')
  if (!CAST_LIVE.includes(inv.status)) return { ok: true }
  await ref.update({ status: 'removed', updatedAt: new Date().toISOString() })
  await sendPush(removedPush(id, inv)).catch(e => logger.warn('cast removed push', String(e)))
  return { ok: true }
})

// The host's shoot changed: copy the new time/place onto every invite, and tell the people who said yes when it moved or is off.
export const syncCastFromShoot = onDocumentWritten('shoots/{id}', async e => {
  const before = e.data?.before.data(), after = e.data?.after.data()
  if (before && after && before.date === after.date && before.start === after.start && before.end === after.end && before.place === after.place
    && before.where === after.where && before.status === after.status && before.bothHouses === after.bothHouses
    && before.time?.start === after.time?.start && before.time?.end === after.time?.end) return
  const invites = await db.collection('cast_invites').where('shootId', '==', e.params.id).get()
  if (invites.empty) return
  const s = await loadScheduleSettings()
  const name = after ? placeName(after, s) : ''
  for (const d of invites.docs) {
    try {
      const { update, push } = castFollow(d.data() as CastInvite, after, name, d.id)
      if (update) await d.ref.update({ ...update, updatedAt: new Date().toISOString() })
      if (push) await sendPush(push)
    } catch (err) { logger.warn('cast follow', d.id, String(err)) }
  }
})
