// "More like this" for one prop (functions/src/propsLike.ts): similar props + props booked together (everyone), and the
// duplicate check for the prop page (owner + arts). Neither costs AI: they read the fingerprints the app already has.
import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { Signals, Tier } from '../../functions/src/doubles'

export interface PropsLike { similar: { id: string; score: number }[]; together: { id: string; times: number }[]; indexed: boolean }
export interface DoubleOf { id: string; tier: Tier; score: number; signals: Signals }
export interface DoublesOf { pairs: DoubleOf[]; near: { id: string; score: number }[]; indexed: boolean }

const likeFn = httpsCallable<{ id: string }, PropsLike>(functions, 'propsLike')
export const doublesOf = httpsCallable<{ id: string }, DoublesOf>(functions, 'doublesOf')

// One answer per prop for the session (10 minutes): going back and forth between props doesn't ask again.
const cache = new Map<string, { at: number; v: Promise<PropsLike> }>()
export function propsLike(id: string): Promise<PropsLike> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v
  const v = likeFn({ id }).then(r => r.data)
  v.catch(() => cache.delete(id))
  cache.set(id, { at: Date.now(), v })
  return v
}

// "Hot" scores for Browse (functions/src/hot.ts): one copy for the session, refreshed after 30 minutes.
const hotFn = httpsCallable<void, { scores: Record<string, number> }>(functions, 'hotProps')
let hot: { at: number; scores: Record<string, number> } | null = null
let hotPending: Promise<Record<string, number>> | null = null
function loadHot(): Promise<Record<string, number>> {
  if (hot && Date.now() - hot.at < 30 * 60_000) return Promise.resolve(hot.scores)
  hotPending ??= hotFn().then(r => { hot = { at: Date.now(), scores: r.data.scores ?? {} }; return hot.scores })
    .catch(() => ({} as Record<string, number>)).finally(() => { hotPending = null })
  return hotPending
}
/** Start loading the scores right after sign-in, so Browse's first visit is already in "hot" order (no reshuffle under a tap). */
export function warmHot() { void loadHot() }
export function useHotScores(on = true): Record<string, number> {
  const [s, setS] = useState<Record<string, number>>(() => hot?.scores ?? {})
  useEffect(() => { if (on) loadHot().then(setS) }, [on])
  return s
}
