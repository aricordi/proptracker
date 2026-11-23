// Team log (owner, Nov 23): every schedule-team decision, newest first, with Undo where it's safe. Written by the server only.
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'

export interface TeamLogEntry {
  id: string; action: string; label: string; shootIds: string[]; date?: string; who?: string; whoName?: string
  by: string; byName: string; role: string; at: string
  undo: { kind: string } | null; undoneAt?: string; undoneBy?: string; undoneByName?: string; undoneWhat?: string
}

export function subscribeTeamLog(cb: (list: TeamLogEntry[]) => void, max = 300) {
  return onSnapshot(query(collection(db, 'team_log'), orderBy('at', 'desc'), limit(max)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as TeamLogEntry))), () => cb([]))
}

export const undoTeamAction = httpsCallable<{ id: string }, { ok: boolean; what: string }>(functions, 'undoTeamAction', { timeout: 130_000 })
export const addOffAppPerson = httpsCallable<{ name: string }, { ok: boolean; email: string; name: string }>(functions, 'addOffAppPerson')

/** Plain group for the filter chips. */
export const ACTION_GROUP: Record<string, 'approvals' | 'changes' | 'calendar' | 'checkins'> = {
  approved: 'approvals', denied: 'approvals', 'move-approved': 'approvals', 'move-denied': 'approvals',
  moved: 'changes', cancelled: 'changes', swapped: 'changes', priority: 'changes', booked: 'changes', blocked: 'changes', unblocked: 'changes', undone: 'changes',
  'calendar-confirmed': 'calendar', 'calendar-fixed': 'calendar', 'calendar-skipped': 'calendar', 'calendar-ignored': 'calendar', 'calendar-redo': 'calendar',
  decided: 'checkins', report: 'checkins',
}
