// "More like this" for one prop (functions/src/propsLike.ts): similar props + props booked together (everyone), and the
// duplicate check for the prop page (owner + arts). Neither costs AI: they read the fingerprints the app already has.
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
