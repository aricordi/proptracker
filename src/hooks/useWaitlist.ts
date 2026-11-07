// "Notify me if it opens" (owner, Nov 7): the person's own waitlist entries, live, with their place in line.
// One hook for the calendar's day sheet, the taken-slot sheet and the chat.
import { useCallback, useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { House } from '../../functions/src/schedule'

export interface MyWait { id: string; date: string; house: House; start: number; status: 'waiting' | 'offered'; position: number }
export const joinWaitlist = httpsCallable<{ date: string; house: House; start: number }, { id: string; status: 'waiting' | 'offered'; position: number }>(functions, 'joinWaitlist')
export const leaveWaitlist = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'leaveWaitlist')
const myWaitlist = httpsCallable<Record<string, never>, { entries: MyWait[] }>(functions, 'myWaitlist')
export const waitKey = (date: string, house: House, start: number) => `${date}_${house}_${start}`

/** `enabled` = only people who book (creators, the owner). Returns entries by waitKey. */
export function useMyWaitlist(email: string, enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, MyWait>>({})
  useEffect(() => {
    if (!enabled || !email) { setEntries({}); return }
    let alive = true
    // Live list of my entries; the place in line comes from the server (other people's entries aren't readable).
    const off = onSnapshot(query(collection(db, 'waitlist'), where('email', '==', email)), snap => {
      const live = snap.docs.filter(d => ['waiting', 'offered'].includes(d.get('status')))
      if (!live.length) { setEntries({}); return }
      myWaitlist({}).then(r => { if (alive) setEntries(Object.fromEntries(r.data.entries.map(e => [waitKey(e.date, e.house, e.start), e]))) }).catch(() => {})
    }, () => setEntries({}))
    return () => { alive = false; off() }
  }, [email, enabled])
  const join = useCallback(async (date: string, house: House, start: number) => {
    const r = (await joinWaitlist({ date, house, start })).data
    setEntries(x => ({ ...x, [waitKey(date, house, start)]: { id: r.id, date, house, start, status: r.status, position: r.position } }))
    return r
  }, [])
  const leave = useCallback(async (w: MyWait) => {
    await leaveWaitlist({ id: w.id })
    setEntries(x => { const n = { ...x }; delete n[waitKey(w.date, w.house, w.start)]; return n })
  }, [])
  return { entries, join, leave }
}
