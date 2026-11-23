// TEAM LOG (owner, Nov 23: "a history/log of everything Maanik approves and looks at so we can go back and undo or double
// check"). Every decision the schedule team makes (approve, deny, move, swap, cancel, priority booking, blocked time, Google
// Calendar cards, check-in decisions) writes one `team_log/{id}` entry: who, when, what, which shoot. When the decision can be
// reversed safely, the entry carries `undo` = exactly how; undoTeamAction (scheduling.ts) runs it through the normal checks,
// as the person pressing Undo, so it can never do something the app wouldn't allow by hand.
import { db } from './auth.js'
import type { Caller } from './auth.js'

export type UndoPlan =
  | { kind: 'unapprove'; shootId: string }
  | { kind: 'rebook'; shootId: string; forEmail: string; place: string; date: string; start: number; end: number; where?: string }
  | { kind: 'move'; shootId: string; place: string; date: string; start: number; end: number; where?: string }
  | { kind: 'swap'; a: string; b: string }
  | { kind: 'removeBlocks'; blocks: { date: string; id: string }[] }
  | { kind: 'addBlock'; date: string; house: string; start: number; end: number; type: string; note: string; soft?: boolean }
  | { kind: 'reopenCard'; id: string }
  | { kind: 'unignore'; phrase: string }

export interface TeamLogEntry {
  action: string             // approved | denied | move-approved | move-denied | moved | cancelled | swapped | priority | blocked | unblocked |
                             // calendar-confirmed | calendar-fixed | calendar-skipped | calendar-ignored | decided | report | put-back | approval-undone
  label: string              // plain words: "Approved Val · Cliff 2 · Mon, Dec 7 · 11 AM–1 PM"
  shootIds?: string[]
  date?: string
  who?: string               // the creator it was about (email)
  whoName?: string
  undo?: UndoPlan | null
}

export async function teamLog(caller: Pick<Caller, 'email' | 'name' | 'role'>, e: TeamLogEntry) {
  try {
    await db.collection('team_log').add({
      ...e, undo: e.undo ?? null, shootIds: e.shootIds ?? [], by: caller.email, byName: caller.name, role: caller.role,
      at: new Date().toISOString(),
    })
  } catch (err) { console.warn('team log', err) }   // a log failure never undoes the decision itself
}
