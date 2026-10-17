// House schedule (Cliff 1 / Cliff 2 / offsite): live data + server calls.
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, where, orderBy, documentId } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { cleanScheduleSettings, DEFAULT_SCHEDULE, type ScheduleSettings, type ScheduleDay, type Place, type ShootKind, type BlockType, type House } from '../../functions/src/schedule'

export * from '../../functions/src/schedule'

export interface Shoot {
  id: string
  creatorEmail: string; creatorName: string
  place: Place; where?: string
  date: string; month: string; start: number; end: number; from: string; to: string
  kind: ShootKind
  status: 'booked' | 'cancelled'
  bookedBy: string; lateCancel?: boolean
  createdAt: string
  history: { at: string; by: string; action: string; note?: string }[]
}

// Settings (slot times, priority group…), live. Defaults until loaded.
export function useScheduleSettings(): ScheduleSettings {
  const [s, setS] = useState<ScheduleSettings>(DEFAULT_SCHEDULE)
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'schedule'),
    snap => setS(cleanScheduleSettings(snap.data())), () => setS(DEFAULT_SCHEDULE)), [])
  return s
}

// Every day doc between two dates (inclusive), live, keyed by date.
export function useScheduleDays(from: string, to: string): Record<string, ScheduleDay> | null {
  const [days, setDays] = useState<Record<string, ScheduleDay> | null>(null)
  useEffect(() => onSnapshot(
    query(collection(db, 'schedule_days'), where(documentId(), '>=', from), where(documentId(), '<=', to)),
    snap => setDays(Object.fromEntries(snap.docs.map(d => [d.id, { date: d.id, ...d.data() } as ScheduleDay]))),
    () => setDays({})), [from, to])
  return days
}

// One person's upcoming shoots (booked), live.
export function useMyShoots(email: string, fromDate: string): Shoot[] | null {
  const [list, setList] = useState<Shoot[] | null>(null)
  useEffect(() => onSnapshot(
    query(collection(db, 'shoots'), where('creatorEmail', '==', email), where('date', '>=', fromDate), orderBy('date')),
    snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shoot)).filter(s => s.status === 'booked').sort((a, b) => a.from.localeCompare(b.from))),
    () => setList([])), [email, fromDate])
  return list
}

export function useShoot(id: string | null): Shoot | null | undefined {
  const [s, setS] = useState<Shoot | null | undefined>(undefined)
  useEffect(() => {
    if (!id) { setS(undefined); return }
    return onSnapshot(doc(db, 'shoots', id), snap => setS(snap.exists() ? ({ id: snap.id, ...snap.data() } as Shoot) : null), () => setS(null))
  }, [id])
  return s
}

export const bookShoot = httpsCallable<{ place: Place; date: string; start: number; kind?: ShootKind; forEmail?: string; where?: string }, { id: string; kind: ShootKind }>(functions, 'bookShoot')
export const cancelShoot = httpsCallable<{ id: string }, { ok: boolean; lateCancel: boolean }>(functions, 'cancelShoot')
export const addScheduleBlock = httpsCallable<{ date: string; house: House; start?: number; end?: number; allDay?: boolean; type: BlockType; note?: string }, { id: string }>(functions, 'addScheduleBlock')
export const removeScheduleBlock = httpsCallable<{ date: string; id: string }, { ok: boolean }>(functions, 'removeScheduleBlock')
export const saveScheduleSettings = httpsCallable<Partial<ScheduleSettings>, ScheduleSettings>(functions, 'saveScheduleSettings')
export const listSchedulePeople = httpsCallable<Record<string, never>, { people: { email: string; name: string; role: string }[] }>(functions, 'listSchedulePeople')

// Error text from a server call, in plain words.
export const errorText = (e: unknown) => (e as { message?: string })?.message || 'Something went wrong. Try again.'
