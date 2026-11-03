// "The tripod is broken" (owner, Nov 3: report damage or missing pieces in the chat, any time it happens). A creator
// reports a problem on gear or props they have out; it goes on that booking's record and the right team gets a ping.
// Returning later still asks again, so nothing is lost if they forget.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { isResponsible } from './gearCrew.js'
import { sendPush } from './push.js'

const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''

export const reportProblem = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'creator'])
  const kind = req.data?.kind === 'props' ? 'props' : 'gear'
  const id = str(req.data?.id, 100), name = str(req.data?.name, 80), note = str(req.data?.note, 300)
  if (note.length < 3) throw new HttpsError('invalid-argument', 'Say what happened in a few words.')
  const at = new Date().toISOString()
  if (kind === 'gear') {
    const ref = db.doc(`gear_bookings/${id}`)
    const b = (await ref.get()).data()
    if (!b) throw new HttpsError('not-found', 'That gear booking is gone.')
    if (!isResponsible(b, caller.email)) throw new HttpsError('permission-denied', 'You can only report gear you have.')
    await ref.update({ updatedAt: at, problems: FieldValue.arrayUnion({ kind: 'reported', name: name || 'Gear', note, at, reportedBy: caller.email, qty: 1 }),
      history: FieldValue.arrayUnion({ at, by: caller.email, action: 'problem', note: `${name || 'Gear'}: ${note}` }) })
    await sendPush({ to: ['gear-team'], title: 'Gear problem reported', url: `/gear/bookings/${id}`, body: `${caller.name}: ${name ? `${name} · ` : ''}${note}` }).catch(() => 0)
  } else {
    const ref = db.doc(`reservations/${id}`)
    const r = (await ref.get()).data()
    if (!r) throw new HttpsError('not-found', 'That request is gone.')
    if (r.creatorEmail !== caller.email) throw new HttpsError('permission-denied', 'You can only report props you have.')
    await ref.update({ updatedAt: at, issues: FieldValue.arrayUnion({ name: name || 'Props', note, at, by: caller.email }),
      history: FieldValue.arrayUnion({ status: r.status, at, by: caller.email, reason: `Problem reported: ${name ? `${name} · ` : ''}${note}` }) })
    await sendPush({ to: ['arts-team'], title: 'Props problem reported', url: `/reservations/${id}`, body: `${caller.name}: ${name ? `${name} · ` : ''}${note}` }).catch(() => 0)
  }
  return { ok: true }
})
