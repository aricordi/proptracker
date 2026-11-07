// SUGGEST THE USUAL PARTNER (owner, Nov 7): who this creator films back to back with most often in the last 90 days,
// limited to people who can still film (the friend list). Only a one-tap shortcut: never added for them.
// Built from the schedule's day docs (every member can read them; creators can't read other people's shoots/),
// fetched once and shared by the Calendar's booking sheet and the chat (cached 10 minutes).
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, documentId } from 'firebase/firestore'
import { db } from '../firebase'
import { addDays, todayInStudio } from '../../functions/src/booking'
import { collabShootsFromDays, usualPartners, partnerLabel, type CollabDay, type CollabShoot } from '../lib/collabs'
import { listFilmingFriends } from '../services/schedule'

export interface UsualPartner { email: string; name: string; label: string; times: number }
type Friend = { email: string; name: string }
interface Loaded { days: CollabDay[]; friends: Friend[] }

const KEEP_MS = 10 * 60_000
let cache: { at: number; from: string; promise: Promise<Loaded> } | null = null

function load(): Promise<Loaded> {
  const today = todayInStudio()
  const from = addDays(today, -90)
  if (cache && cache.from === from && Date.now() - cache.at < KEEP_MS) return cache.promise
  const promise = Promise.all([
    getDocs(query(collection(db, 'schedule_days'), where(documentId(), '>=', from), where(documentId(), '<=', today)))
      .then(snap => snap.docs.map(d => ({ date: d.id, ...d.data() }) as CollabDay)).catch(() => [] as CollabDay[]),
    listFilmingFriends({}).then(r => r.data.people).catch(() => [] as Friend[]),
  ]).then(([days, friends]) => ({ days, friends }))
  cache = { at: Date.now(), from, promise }
  promise.then(r => { if (!r.friends.length && cache?.promise === promise) cache = null })   // try again next time
  return promise
}

/** The creator's usual partners (most often first, ≤3). Empty while loading, when `enabled` is false, or when there are none. */
export function useUsualPartners(email: string, slotMinutes: number, enabled = true): UsualPartner[] {
  const [data, setData] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!enabled || !email) return
    let live = true
    load().then(r => { if (live) setData(r) })
    return () => { live = false }
  }, [enabled, email])
  return useMemo(() => {
    if (!data || !enabled) return []
    const shoots: CollabShoot[] = collabShootsFromDays(data.days, slotMinutes)
    return usualPartners(email, shoots, data.friends).map(p => ({ ...p, label: partnerLabel(p, data.friends) }))
  }, [data, email, slotMinutes, enabled])
}
