// Undo from the team log (owner, Nov 23). Each undo runs the normal action through its usual checks, AS THE PERSON PRESSING
// UNDO, so it can never do something the app wouldn't let them do by hand (e.g. a slot taken since can't be re-booked).
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { db, requireRole, CALLABLE } from './auth.js'
import { teamLog, type UndoPlan } from './teamLog.js'
import { unapproveShoot, bookShoot, moveShoot, swapShootsAsTeam, addScheduleBlock, removeScheduleBlock } from './scheduling.js'
import { reopenQueueCard, ignoreCalendarEvents } from './calendar.js'

export const undoTeamAction = onCall({ ...CALLABLE, timeoutSeconds: 120 }, async req => {
  const caller = await requireRole(req, ['owner', 'equipment', 'admin'])
  const id = String(req.data?.id ?? '').slice(0, 100)
  const ref = db.doc(`team_log/${id}`)
  const e = (await ref.get()).data()
  if (!e) throw new HttpsError('not-found', 'That log entry is gone.')
  if (e.undoneAt) throw new HttpsError('failed-precondition', `Already undone by ${e.undoneByName || e.undoneBy}.`)
  const plan = e.undo as UndoPlan | null
  if (!plan) throw new HttpsError('failed-precondition', 'This one can\'t be undone from here. Open it and change it by hand.')
  const as = <T>(data: T) => ({ ...req, data } as unknown as CallableRequest<T>)
  let what = ''
  switch (plan.kind) {
    case 'unapprove': await unapproveShoot(caller, plan.shootId); what = 'back to waiting for approval'; break
    case 'rebook': {
      const r = await bookShoot.run(as({ place: plan.place, date: plan.date, start: plan.start, end: plan.end, where: plan.where ?? '', forEmail: plan.forEmail })) as { id: string }
      what = 'booked again'; await ref.update({ newShootId: r.id }); break
    }
    case 'move': await moveShoot.run(as({ id: plan.shootId, place: plan.place, date: plan.date, start: plan.start, end: plan.end, where: plan.where ?? '' })); what = 'moved back'; break
    case 'swap': await swapShootsAsTeam.run(as({ a: plan.a, b: plan.b })); what = 'swapped back'; break
    case 'removeBlocks': {
      for (const b of plan.blocks) {
        try { await removeScheduleBlock.run(as({ date: b.date, id: b.id })) } catch (err) { if ((err as HttpsError).code !== 'not-found') throw err }
      }
      what = 'blocked time removed'; break
    }
    case 'addBlock': await addScheduleBlock.run(as({ date: plan.date, house: plan.house, start: plan.start, end: plan.end, type: plan.type, note: plan.note, soft: plan.soft === true })); what = 'blocked time put back'; break
    case 'reopenCard': await reopenQueueCard(plan.id); what = 'back in the Calendar tab'; break
    case 'unignore': await ignoreCalendarEvents.run(as({ phrase: plan.phrase, remove: true })); what = 'no longer ignored'; break
    default: throw new HttpsError('failed-precondition', 'Unknown undo.')
  }
  const at = new Date().toISOString()
  await ref.update({ undoneAt: at, undoneBy: caller.email, undoneByName: caller.name, undoneWhat: what })
  await teamLog(caller, { action: 'undone', label: `Undid: ${e.label} (${what})`, shootIds: e.shootIds ?? [], date: e.date, who: e.who, whoName: e.whoName })
  return { ok: true, what }
})
