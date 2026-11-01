// The monthly Cliff 1 draw (Nov 1): your wishlist, the draw result, and the team's buttons.
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { Wish, How } from '../../functions/src/monthlyDraw'
export * from '../../functions/src/monthlyDraw'

export interface WishDoc { month: string; email: string; name: string; wishes: Wish[]; updatedAt: string }
export interface DrawPlacement { email: string; name: string; date: string; start: number; how: How; rank?: number; with?: string; shootId: string }
export interface MonthlyDraw {
  month: string; status: 'running' | 'done' | 'failed' | 'undone'; ranAt?: string; by?: string
  placements?: DrawPlacement[]; short?: { email: string; name: string; missing: number }[]; people?: number; wishers?: number
  kept?: string[]; error?: string
}

export function useMyWishes(month: string, email: string): WishDoc | null | undefined {
  const [w, setW] = useState<WishDoc | null | undefined>(undefined)
  useEffect(() => onSnapshot(doc(db, 'monthly_wishes', `${month}_${email}`), s => setW(s.exists() ? s.data() as WishDoc : null), () => setW(null)), [month, email])
  return w
}
export function useAllWishes(month: string, enabled: boolean): WishDoc[] {
  const [w, setW] = useState<WishDoc[]>([])
  useEffect(() => enabled ? onSnapshot(query(collection(db, 'monthly_wishes'), where('month', '==', month)), s => setW(s.docs.map(d => d.data() as WishDoc)), () => setW([])) : undefined, [month, enabled])
  return w
}
export function useDraw(month: string): MonthlyDraw | null | undefined {
  const [d, setD] = useState<MonthlyDraw | null | undefined>(undefined)
  useEffect(() => onSnapshot(doc(db, 'monthly_draws', month), s => setD(s.exists() ? s.data() as MonthlyDraw : null), () => setD(null)), [month])
  return d
}

export const saveWishlist = httpsCallable<{ month: string; wishes: Wish[] }, { ok: boolean; count: number }>(functions, 'saveWishlist')
export const runMonthlyDraw = httpsCallable<{ month: string }, { placed: number; short: unknown[]; failed: number }>(functions, 'runMonthlyDraw', { timeout: 310_000 })
export const undoMonthlyDraw = httpsCallable<{ month: string }, { removed: number; kept: string[] }>(functions, 'undoMonthlyDraw', { timeout: 310_000 })

export const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const monthShort = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' })
export const howLabel = (p: { how: How; rank?: number; with?: string }) =>
  p.how === 'auto' ? 'Picked by the app' : p.how === 'partner' ? `With ${p.with} (their wish)` : `Your wish #${p.rank}${p.with ? ` · with ${p.with}` : ''}`
