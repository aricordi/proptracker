// House schedule (Cliff 1 / Cliff 2 / offsite): live data + server calls.
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, where, orderBy, documentId } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { cleanScheduleSettings, DEFAULT_SCHEDULE, type ScheduleSettings, type ScheduleDay, type Place, type ShootKind, type BlockType, type House } from '../../functions/src/schedule'
import { friendlyError } from '../lib/errors'

export * from '../../functions/src/schedule'
// Owner (Oct 19, option A): the "monthly vs extra" choice is hidden until the wishlist + fair draw exists.
// Every booking is just a shoot (saved as 'extra'); the draw will hand out the guaranteed monthly slots.
export const MONTHLY_SLOTS_ON = false

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
  checkin?: { at: string; photos: string[] }
  wrap?: { at: string; title: string }
  explanation?: { at: string; text: string }
  outcome?: 'filmed' | 'noshow'
  noShow?: 'late-cancel' | 'missed'
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

export const bookShoot = httpsCallable<{ place: Place; date: string; start: number; end?: number; kind?: ShootKind; forEmail?: string; where?: string }, { id: string; kind: ShootKind }>(functions, 'bookShoot')
export const cancelShoot = httpsCallable<{ id: string; confirmNoShow?: boolean }, { ok: boolean; lateCancel: boolean }>(functions, 'cancelShoot')
export const moveShoot = httpsCallable<{ id: string; place?: Place; date: string; start: number; end?: number; where?: string }, { ok: boolean; kind: ShootKind }>(functions, 'moveShoot')
export const requestSwap = httpsCallable<{ myShootId: string; theirShootId: string }, { id: string }>(functions, 'requestSwap')
export const answerSwap = httpsCallable<{ id: string; accept: boolean }, { ok: boolean }>(functions, 'answerSwap')

export interface SwapRequest {
  id: string
  fromShootId: string; toShootId: string
  fromEmail: string; fromName: string; toEmail: string; toName: string
  from: { place: Place; date: string; start: number; end: number }
  to: { place: Place; date: string; start: number; end: number }
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  createdAt: string
}
// Pending swap requests sent to me and by me, live.
export function useMySwaps(email: string): { incoming: SwapRequest[]; outgoing: SwapRequest[] } {
  const [incoming, setIn] = useState<SwapRequest[]>([])
  const [outgoing, setOut] = useState<SwapRequest[]>([])
  useEffect(() => {
    const q = (field: string, set: (x: SwapRequest[]) => void) => onSnapshot(
      query(collection(db, 'swap_requests'), where(field, '==', email), where('status', '==', 'pending')),
      snap => set(snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest))), () => set([]))
    const a = q('toEmail', setIn), b = q('fromEmail', setOut)
    return () => { a(); b() }
  }, [email])
  return { incoming, outgoing }
}
// ─── Back to back with friends + "Ask for a time" ────────────────────────────
export interface ScheduleInvite {
  id: string; fromEmail: string; fromName: string; fromShootId: string; toEmail: string; toName: string
  place: House; date: string; start: number; end: number; until: string
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'; shootId?: string; createdAt: string
}
// Invites to film right after someone (held for 20 min), sent to me and by me, live. Recent ones only.
export function useMyInvites(email: string): { incoming: ScheduleInvite[]; outgoing: ScheduleInvite[] } {
  const [incoming, setIn] = useState<ScheduleInvite[]>([])
  const [outgoing, setOut] = useState<ScheduleInvite[]>([])
  useEffect(() => {
    const since = new Date(Date.now() - 2 * 86400000).toISOString()
    const q = (field: string, set: (x: ScheduleInvite[]) => void) => onSnapshot(
      query(collection(db, 'schedule_invites'), where(field, '==', email)),
      snap => set(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleInvite)).filter(i => i.createdAt >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt))), () => set([]))
    const a = q('toEmail', setIn), b = q('fromEmail', setOut)
    return () => { a(); b() }
  }, [email])
  return { incoming, outgoing }
}
export const bookWithFriends = httpsCallable<{ place: House; date: string; start: number; friends: string[]; mySlots?: number; kind?: ShootKind }, { shootIds: string[]; inviteIds: string[]; until: string }>(functions, 'bookWithFriends')
export const answerInvite = httpsCallable<{ id: string; accept: boolean }, { ok: boolean; shootId: string | null }>(functions, 'answerInvite')
export interface TimeAskResult {
  reply: string
  ask: Record<string, unknown>
  friends: { email: string; name: string }[]
  options: { date: string; place: House; start: number; slots: { email: string; name: string; start: number; me: boolean }[] }[]
}
export const askForTime = httpsCallable<{ text: string; previous?: Record<string, unknown> }, TimeAskResult>(functions, 'askForTime')

export const addScheduleBlock = httpsCallable<{ date: string; house: House; start?: number; end?: number; allDay?: boolean; type: BlockType; note?: string }, { id: string }>(functions, 'addScheduleBlock')
export const removeScheduleBlock = httpsCallable<{ date: string; id: string }, { ok: boolean }>(functions, 'removeScheduleBlock')
export const saveScheduleSettings = httpsCallable<Partial<ScheduleSettings>, ScheduleSettings>(functions, 'saveScheduleSettings')
export const listFilmingFriends = httpsCallable<Record<string, never>, { people: { email: string; name: string }[] }>(functions, 'listFilmingFriends')
export const listSchedulePeople = httpsCallable<Record<string, never>, { people: { email: string; name: string; role: string }[] }>(functions, 'listSchedulePeople')

export const myCalendarLink = httpsCallable<{ reset?: boolean }, { url: string; webcal: string }>(functions, 'myCalendarLink')
export const testCalendarLink = httpsCallable<Record<string, never>, { ok: boolean; account: string }>(functions, 'testCalendarLink')

export const checkInShoot = httpsCallable<{ id: string; photos: string[]; report?: { overMinutes?: number; mess?: boolean; photos?: string[] } }, { ok: boolean; reported: string | null }>(functions, 'checkInShoot')
export const wrapShoot = httpsCallable<{ id: string; title: string }, { ok: boolean }>(functions, 'wrapShoot')
export const explainMissedCheckIn = httpsCallable<{ id: string; text: string }, { ok: boolean }>(functions, 'explainMissedCheckIn')
export const decideShoot = httpsCallable<{ id: string; outcome: 'filmed' | 'noshow' }, { ok: boolean }>(functions, 'decideShoot')
export const reviewReport = httpsCallable<{ id: string; uphold: boolean }, { ok: boolean }>(functions, 'reviewReport')
export const liftPause = httpsCallable<{ email: string }, { ok: boolean }>(functions, 'liftPause')
// Managing creators by hand (owner + admins, Oct 20).
export const giveStrike = httpsCallable<{ email: string; about: string; note: string; shootId?: string }, { ok: boolean; strikes: number; paused: boolean }>(functions, 'giveStrike')
export const removeStrike = httpsCallable<{ id: string; note: string }, { ok: boolean; strikes: number; lifted: boolean }>(functions, 'removeStrike')
export const pauseCreator = httpsCallable<{ email: string; days: number; note: string }, { ok: boolean; pausedUntil: string }>(functions, 'pauseCreator')

export interface UserStatus { email: string; name?: string; strikes?: number; pausedUntil?: string | null; manualPause?: boolean; pauseNote?: string }
export interface ScheduleReport { id: string; onShootId: string; onEmail: string; onName: string; byEmail: string; byName: string; date: string; place: Place; overMinutes: number; mess: boolean; note?: string; photos: string[]; status: string; createdAt: string }

// Your strikes / pause, live.
export function useMyStatus(email: string): UserStatus | null {
  const [st, setSt] = useState<UserStatus | null>(null)
  useEffect(() => onSnapshot(doc(db, 'user_status', email), snap => setSt(snap.exists() ? snap.data() as UserStatus : null), () => setSt(null)), [email])
  return st
}
// Team: every shoot from a date on, all statuses (for check-ins and creator records).
export function useShootsSince(fromDate: string, enabled: boolean): Shoot[] | null {
  const [list, setList] = useState<Shoot[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(query(collection(db, 'shoots'), where('date', '>=', fromDate)), snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shoot))), () => setList([]))
  }, [fromDate, enabled])
  return list
}
export function useOpenReports(enabled: boolean): ScheduleReport[] {
  const [list, setList] = useState<ScheduleReport[]>([])
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(query(collection(db, 'schedule_reports'), where('status', '==', 'open')), snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleReport))), () => setList([]))
  }, [enabled])
  return list
}
export function useAllStatuses(enabled: boolean): Record<string, UserStatus> {
  const [m, setM] = useState<Record<string, UserStatus>>({})
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(collection(db, 'user_status'), snap => setM(Object.fromEntries(snap.docs.map(d => [d.id, d.data() as UserStatus]))), () => setM({}))
  }, [enabled])
  return m
}

// Creator dashboard (owner + admins): every shoot of one person (any status), reports and strikes from a date on.
export function useShootsOf(email: string, fromDate: string): Shoot[] | null {
  const [list, setList] = useState<Shoot[] | null>(null)
  useEffect(() => onSnapshot(query(collection(db, 'shoots'), where('creatorEmail', '==', email), where('date', '>=', fromDate), orderBy('date')),
    snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shoot))), () => setList([])), [email, fromDate])
  return list
}
export function useReportsSince(fromDate: string, enabled: boolean, onEmail?: string): ScheduleReport[] {
  const [list, setList] = useState<ScheduleReport[]>([])
  useEffect(() => {
    if (!enabled) return
    const q = onEmail ? query(collection(db, 'schedule_reports'), where('onEmail', '==', onEmail)) : query(collection(db, 'schedule_reports'), where('date', '>=', fromDate))
    return onSnapshot(q, snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleReport)).filter(r => r.date >= fromDate)), () => setList([]))
  }, [fromDate, enabled, onEmail])
  return list
}
// Analytics (owner + admins): friend invites from a date on.
export function useInvitesSince(fromDate: string, enabled: boolean): ScheduleInvite[] {
  const [list, setList] = useState<ScheduleInvite[]>([])
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(query(collection(db, 'schedule_invites'), where('date', '>=', fromDate)), snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleInvite))), () => setList([]))
  }, [fromDate, enabled])
  return list
}
export interface Strike { id: string; email: string; name?: string; reason: string; shootId?: string; at: string; by?: string; flagId?: string; note?: string; about?: string; removedAt?: string; removedBy?: string; removeNote?: string }
export function useStrikesSince(fromDate: string, enabled: boolean, email?: string): Strike[] {
  const [list, setList] = useState<Strike[]>([])
  useEffect(() => {
    if (!enabled) return
    const q = email ? query(collection(db, 'strikes'), where('email', '==', email)) : query(collection(db, 'strikes'), where('at', '>=', fromDate))
    return onSnapshot(q, snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() } as Strike)).filter(x => x.at.slice(0, 10) >= fromDate)), () => setList([]))
  }, [fromDate, enabled, email])
  return list
}

// What an admin did about a flag (owner + admins read).
export type FlagAction = 'excuse' | 'unexcuse' | 'warn' | 'strike' | 'handled'
export interface FlagReview { id: string; flagId: string; email: string; kind: string; label?: string; status: 'excused' | 'warned' | 'struck' | 'handled' | 'open'
  strikeId?: string; updatedAt: string; updatedBy: string; actions: { at: string; by: string; action: FlagAction; note?: string; strikeId?: string }[] }
export function useFlagReviews(enabled: boolean): Map<string, FlagReview> {
  const [m, setM] = useState<Map<string, FlagReview>>(new Map())
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(collection(db, 'flag_reviews'), snap => setM(new Map(snap.docs.map(d => { const r = { id: d.id, ...d.data() } as FlagReview; return [r.flagId, r] }))), () => setM(new Map()))
  }, [enabled])
  return m
}
export const reviewFlag = httpsCallable<{ flagId: string; action: FlagAction; note?: string; email: string; kind: string; label?: string; shootId?: string },
  { ok: boolean; status: string; strike: { strikes: number; paused: boolean } | null }>(functions, 'reviewFlag')

// Error text from a server call, in plain words.
export const errorText = (e: unknown) => friendlyError(e, 'Something went wrong. Try again.')
