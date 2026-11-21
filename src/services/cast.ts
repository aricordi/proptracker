// "Who's in this video?" (owner, Nov 21): invites to appear in someone's video. Rules + wording in functions/src/cast.ts.
import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { nowStamp } from '../../functions/src/gearBooking'
import { addDays } from '../../functions/src/booking'
import { CAST_LIVE, type CastInvite } from '../../functions/src/cast'
import { studioDayOf } from '../lib/dates'

export type CastRow = CastInvite & { id: string }
export { castWhen, castDay, first as firstName } from '../../functions/src/cast'

const LIVE_SHOOT = ['booked', 'requested']
/** Still coming up and still on: a pending invite or a yes, for a shoot that hasn't ended. */
export const isUpcoming = (c: CastRow, now = nowStamp()) => CAST_LIVE.includes(c.status) && LIVE_SHOOT.includes(c.shootStatus) && (!c.to || c.to > now)

/** Every video I'm invited to or in, from yesterday on (soonest first). */
export function useMyVideos(email: string | undefined): CastRow[] | null {
  const [rows, setRows] = useState<CastRow[] | null>(null)
  useEffect(() => {
    if (!email) { setRows([]); return }
    const from = addDays(studioDayOf(new Date().toISOString()), -1)
    return onSnapshot(query(collection(db, 'cast_invites'), where('toEmail', '==', email), where('date', '>=', from), orderBy('date')),
      snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as CastRow)).sort((a, b) => (a.from || a.date).localeCompare(b.from || b.date))),
      () => setRows([]))
  }, [email])
  return rows
}

/** The people invited to one shoot (the host sees their own; the schedule team sees any). */
export function useShootCast(shootId: string | null | undefined, hostEmail: string, team: boolean): CastRow[] {
  const [rows, setRows] = useState<CastRow[]>([])
  useEffect(() => {
    if (!shootId) { setRows([]); return }
    const q = team
      ? query(collection(db, 'cast_invites'), where('shootId', '==', shootId))
      : query(collection(db, 'cast_invites'), where('shootId', '==', shootId), where('hostEmail', '==', hostEmail))
    return onSnapshot(q, snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as CastRow))), () => setRows([]))
  }, [shootId, hostEmail, team])
  return rows
}

export const inviteToVideo = httpsCallable<{ shootId: string; emails: string[] }, { invited: string[] }>(functions, 'inviteToVideo')
export const answerVideoInvite = httpsCallable<{ id: string; accept?: boolean; leave?: boolean }, { status: string | null }>(functions, 'answerVideoInvite')
export const removeFromVideo = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'removeFromVideo')
