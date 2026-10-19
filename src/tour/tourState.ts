// Has this person finished the app tour? Remembered on the phone straight away and on their profile
// (profiles/{email}.tourDoneAt) so a new phone doesn't ask again. Progress (which step) stays on the phone.
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { saveProfile } from '../services/profiles'

const DONE = (email: string) => `pc.tourDone.${email}`
const STEP = (email: string) => `pc.tourStep.${email}`
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode: fine */ } }

// undefined = still checking. Not required → always done.
export function useTourDone(email: string, required: boolean): [boolean | undefined, () => void] {
  const [done, setDone] = useState<boolean | undefined>(() => !required || read(DONE(email)) ? true : undefined)
  useEffect(() => {
    if (done !== undefined) return
    getDoc(doc(db, 'profiles', email))
      .then(s => { const yes = !!s.get('tourDoneAt'); if (yes) write(DONE(email), '1'); setDone(yes) })
      .catch(() => setDone(false))
  }, [email, done])
  return [done, () => setDone(true)]
}

export function markTourDone(email: string) {
  write(DONE(email), '1'); write(STEP(email), null)
  saveProfile(email, { tourDoneAt: new Date().toISOString() }).catch(() => { /* the phone still remembers */ })
}

export const savedStep = (email: string) => Number(read(STEP(email)) ?? 0) || 0
export const saveStep = (email: string, n: number) => write(STEP(email), String(n))
