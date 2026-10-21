// Where each flag stands (owner, Oct 21: "press the flag cards… a list of all flags… remediation options for each one").
// decide  = the team still has to decide (a missed check-in, a report from the next creator)
// todo    = nobody has done anything about it yet
// handled = a strike came with it, or an admin warned / struck / marked it handled
// excused = an admin excused it: it no longer counts (kept on record)
import type { Incident, Kind } from './analytics'
import { formatDay } from './dates'

export type FlagState = 'decide' | 'todo' | 'handled' | 'excused'
export const DECIDE_KINDS: Kind[] = ['missed-checkin', 'ran-over', 'mess']
export const STATE_LABEL: Record<FlagState, string> = { decide: 'Needs a decision', todo: 'Not looked at', handled: 'Handled', excused: 'Excused' }
export interface ReviewLike { status: string; strikeId?: string }

export function flagState(i: Incident, review: ReviewLike | undefined, excused = false): FlagState {
  if (excused || review?.status === 'excused') return 'excused'
  if (i.open && DECIDE_KINDS.includes(i.kind)) return 'decide'
  if (review && review.status !== 'open') return 'handled'
  if (i.kind === 'strike' || i.strikeId) return 'handled'
  return 'todo'
}
// Late props/gear that haven't come back yet.
export const stillOut = (i: Incident) => !!i.open && (i.kind === 'late-props' || i.kind === 'late-gear')

// A ready-to-edit note for "Send them a note", per kind of flag.
export function warnText(i: Incident): string {
  const d = formatDay(i.date, { weekday: 'long', month: 'short', day: 'numeric' })
  switch (i.kind) {
    case 'no-show': return `You booked the house on ${d} and didn't come. If you can't make it, please cancel ahead of time.`
    case 'late-cancel': return `You cancelled your ${d} shoot too late. Please give us more notice next time.`
    case 'late-start': return `You checked in late on ${d}. Please start on time so your slot runs smoothly.`
    case 'ran-over': return `You ran over your slot on ${d}. Please finish on time so the next creator can start.`
    case 'mess': return `The house was left a mess after your ${d} shoot. Please tidy up before you leave.`
    case 'missed-checkin': return `You didn't check in on ${d}. Please check in with a set photo every time you shoot.`
    case 'no-wrap': return `You didn't wrap your ${d} shoot. Please tap Wrap and say what you filmed.`
    case 'late-props': return stillOut(i) ? 'Your props are late. Please bring them back today.' : `Your props from ${d} came back late. Please return them on time.`
    case 'late-gear': return stillOut(i) ? 'Your gear is late. Please bring it back now.' : `Your gear from ${d} came back late. Please return it on time.`
    case 'props-damaged': return `Props from your ${d} shoot came back damaged or missing. Please talk to the arts department.`
    case 'gear-missing': return `A gear piece was missing after your ${d} shoot. Please talk to the equipment team.`
    case 'invite-lapsed': return `A friend held a slot for you on ${d} and it ran out. Please confirm or decline invites quickly.`
    default: return ''
  }
}
