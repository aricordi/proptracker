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
export { castWhen, castDay, first as firstName, videoNoteFor, inviteNote, type MyTime } from '../../functions/src/cast'

const LIVE_SHOOT = ['booked', 'requested']
/** Still coming up and still on: a pending invite or a yes, for a shoot that hasn't ended. */
export const isUpcoming = (c: CastRow, now = nowStamp()) => CAST_LIVE.includes(c.status) && LIVE_SHOOT.includes(c.shootStatus) && (!c.to || c.to > now)

// One shared live list per person (the chat, calendar, day sheet, My shoots and Me all read it): one listener, not five.
const store: Record<string, { rows: CastRow[] | null; subs: Set<(r: CastRow[] | null) => void>; stop?: () => void; timer?: ReturnType<typeof setTimeout> }> = {}
function watch(email: string, cb: (r: CastRow[] | null) => void) {
  const e = store[email] ??= { rows: null, subs: new Set() }
  if (e.timer) { clearTimeout(e.timer); e.timer = undefined }
  e.subs.add(cb)
  if (!e.stop) {
    const from = addDays(studioDayOf(new Date().toISOString()), -1)
    // includeMetadataChanges + skipping an EMPTY answer from the phone's cache before the first server answer: otherwise the
    // Videos screen flashed "Nothing yet" while the More row (already loaded) said "1 waiting for your answer".
    e.stop = onSnapshot(query(collection(db, 'cast_invites'), where('toEmail', '==', email), where('date', '>=', from), orderBy('date')), { includeMetadataChanges: true },
      snap => {
        if (snap.metadata.fromCache && snap.empty && e.rows === null) {
          // No signal: after a few seconds, trust the (empty) phone copy so the screen doesn't say "Loading…" forever.
          setTimeout(() => { if (e.rows === null && e.stop) { e.rows = []; e.subs.forEach(f => f(e.rows)) } }, 6000)
          return
        }
        if (e.rows && !snap.docChanges().length) return   // only the metadata changed (cache → server): nothing new to show
        e.rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as CastRow)).sort((a, b) => (a.from || a.date).localeCompare(b.from || b.date)); e.subs.forEach(f => f(e.rows)) },
      () => { e.rows = []; e.subs.forEach(f => f(e.rows)) })
  }
  return () => {
    e.subs.delete(cb)
    if (!e.subs.size) e.timer = setTimeout(() => { if (!e.subs.size) { e.stop?.(); e.stop = undefined; e.rows = null } }, 60_000)
  }
}

/** Every video I'm invited to or in, from yesterday on (soonest first). */
export function useMyVideos(email: string | undefined): CastRow[] | null {
  const [rows, setRows] = useState<CastRow[] | null>(() => (email && store[email]?.rows) || null)
  useEffect(() => {
    if (!email) { setRows([]); return }
    setRows(store[email]?.rows ?? null)
    return watch(email, setRows)
  }, [email])
  return rows
}

/** Who's in MY upcoming videos, by shoot (for faces on my shoot rows): pending + said yes. */
export function useMyCast(email: string | undefined): Record<string, CastRow[]> {
  const [map, setMap] = useState<Record<string, CastRow[]>>({})
  useEffect(() => {
    if (!email) return
    const from = addDays(studioDayOf(new Date().toISOString()), -1)
    return onSnapshot(query(collection(db, 'cast_invites'), where('hostEmail', '==', email), where('date', '>=', from), orderBy('date')), snap => {
      const m: Record<string, CastRow[]> = {}
      snap.docs.forEach(d => { const r = { id: d.id, ...d.data() } as CastRow; if (CAST_LIVE.includes(r.status)) (m[r.shootId] ??= []).push(r) })
      setMap(m)
    }, () => setMap({}))
  }, [email])
  return map
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
