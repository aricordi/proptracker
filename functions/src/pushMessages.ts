// What each phone notification says, and who gets it. Pure functions (no database), so every
// message is unit-tested. push.ts delivers them; reminders are worked out here too.
import { fmtTime, addMinutes, isGearLate } from './gearBooking.js'
import { LATE_FEE_PERCENT } from './gearStock.js'
import { responsible } from './gearCrew.js'
import { returnDueDay, lastDayToBook, RETURN_DEADLINE_HOUR, type ClosedDays } from './booking.js'
import { checkinWindow, isMissed, explainUntil, type ScheduleSettings } from './schedule.js'

type Doc = Record<string, any> | null | undefined
// Who: email addresses, or a whole team ('arts-team' = props, 'gear-team' = equipment + schedule).
export interface Push { to: string[]; title: string; body: string; url: string; tag?: string }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const stampTime = (s: string) => fmtTime(Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)))
const first = (name: string | undefined) => (name || 'Someone').split(' ')[0]
export const placeName = (x: { place?: string; where?: string }, s: ScheduleSettings) =>
  x.place === 'cliff1' || x.place === 'cliff2' ? s.houses[x.place].name : (x.where || 'Offsite')
const when = (x: { date?: string; start?: number } | Record<string, any>) => `${dayLabel(x.date)} · ${fmtTime(x.start)}`

// ─── Things that happen (instant) ────────────────────────────────────────────

export function inviteChange(id: string, b: Doc, a: Doc, s: ScheduleSettings): Push[] {
  if (!a) return []
  if (!b && a.status === 'pending') return [{
    to: [a.toEmail], tag: `invite-${id}`, url: '/schedule',
    title: `${first(a.fromName)} invited you to film 🎬`,
    body: `${placeName(a, s)} · ${when(a)}, right after them. Confirm by ${stampTime(a.until)} or the slot opens to everyone.`,
  }]
  if (b?.status === 'pending' && a.status === 'accepted') return [{ to: [a.fromEmail], tag: `invite-${id}`, url: '/schedule', title: `${first(a.toName)} confirmed ✓`, body: `${placeName(a, s)} · ${when(a)}. You're filming back to back.` }]
  if (b?.status === 'pending' && a.status === 'declined') return [{ to: [a.fromEmail], tag: `invite-${id}`, url: '/schedule', title: `${first(a.toName)} can't make it`, body: `Their slot (${when(a)}) is open again.` }]
  return []
}

export function swapChange(id: string, b: Doc, a: Doc, s: ScheduleSettings): Push[] {
  if (!a) return []
  if (!b && a.status === 'pending') return [{
    to: [a.toEmail], tag: `swap-${id}`, url: '/schedule',
    title: `${first(a.fromName)} wants to swap slots`,
    body: `You'd get ${placeName(a.from, s)} · ${when(a.from)}; they'd get your ${placeName(a.to, s)} · ${when(a.to)}.`,
  }]
  if (b?.status === 'pending' && a.status === 'accepted') return [{ to: [a.fromEmail], tag: `swap-${id}`, url: '/schedule', title: 'Swap done ✓', body: `${first(a.toName)} said yes. You're now on ${placeName(a.to, s)} · ${when(a.to)}.` }]
  if (b?.status === 'pending' && a.status === 'declined') return [{ to: [a.fromEmail], tag: `swap-${id}`, url: '/schedule', title: `${first(a.toName)} said no to the swap`, body: 'Your shoot stays as it was.' }]
  return []
}

const lastBy = (x: Doc) => (x?.history as { by?: string }[] | undefined)?.at(-1)?.by
export function reservationChange(id: string, b: Doc, a: Doc): Push[] {
  if (!a) return []
  const url = `/reservations/${id}`, tag = `props-${id}`
  if (!b) return [{ to: ['arts-team'], url, tag, title: 'New props request', body: `${a.creatorName} · "${a.title}" · ${dayLabel(a.startDate)}` }]
  if (b.status === a.status) return []
  switch (a.status) {
    case 'packed': return [{ to: [a.creatorEmail], url, tag, title: 'Your props are ready 📦', body: `"${a.title}" is packed. Pick it up for your ${dayLabel(a.startDate)} shoot.` }]
    case 'declined': return [{ to: [a.creatorEmail], url, tag, title: 'Props request declined', body: a.statusReason ? `"${a.title}": ${a.statusReason}` : `"${a.title}" was declined.` }]
    case 'cancelled': return lastBy(a) !== a.creatorEmail ? [{ to: [a.creatorEmail], url, tag, title: 'Props request cancelled', body: `"${a.title}" was cancelled by the team.` }] : []
    case 'return_pending': return [{ to: ['arts-team'], url, tag, title: 'Props returned', body: `${a.creatorName}'s "${a.title}" is back. Check it in.` }]
    default: return []
  }
}

export function gearChange(id: string, b: Doc, a: Doc): Push[] {
  if (!a) return []
  const url = `/gear/bookings/${id}`, tag = `gear-${id}`
  // Friends newly added to shared gear (back-to-back shoots): they're responsible for it too.
  const added = ((a.crewEmails ?? []) as string[]).filter(e => !((b?.crewEmails ?? []) as string[]).includes(e))
  const shared: Push[] = added.length && a.status === 'held' ? [{ to: added, url, tag, title: 'Gear shared with you 🎥',
    body: `${String(a.creatorName ?? '').split(' ')[0] || 'A friend'} booked "${a.title}" for your back-to-back shoots (${dayLabel(a.date)} ${fmtTime(a.start)}). Whoever uses it is responsible for it.` }] : []
  // Handed over on the spot: the new person ticks every piece and signs.
  if (!b && a.handedFrom) return [
    { to: [a.creatorEmail], url, tag, title: 'Gear handed to you 🎥', body: `${String(a.handedFrom.name ?? '').split(' ')[0] || 'Someone'} handed you "${a.title}" until ${fmtTime(a.end)}. Open it, tick every piece, then sign.` },
    { to: ['gear-team'], url, tag, title: 'Gear handed over', body: `${a.handedFrom.name} → ${a.creatorName} · "${a.title}" until ${fmtTime(a.end)}` },
  ]
  if (!b) return [{ to: ['gear-team'], url, tag, title: 'New gear hold', body: `${a.creatorName} · "${a.title}" · ${dayLabel(a.date)} ${fmtTime(a.start)}` }, ...shared]
  if (b.status === a.status) return shared
  const all = responsible(a)
  switch (a.status) {
    case 'declined': return [{ to: all, url, tag, title: 'Gear request declined', body: a.declineReason ? `"${a.title}": ${a.declineReason}` : `"${a.title}" was declined.` }]
    case 'cancelled': {
      const by = lastBy(a) ?? '', others = all.filter(e => e !== by)
      if (!all.includes(by)) return [{ to: all, url, tag, title: 'Gear hold cancelled', body: `"${a.title}" was cancelled by the team.` }]
      return others.length ? [{ to: others, url, tag, title: 'Shared gear cancelled', body: `${String(a.creatorName ?? '').split(' ')[0]} cancelled "${a.title}".` }] : []
    }
    case 'checked_in': {
      if (!a.handedTo) return []
      const by = lastBy(a) ?? '', others = all.filter(e => e !== by)
      const used = ((a.usedByNames ?? []) as string[]).map(n => n.split(' ')[0]).join(', ')
      return others.length ? [{ to: others, url, tag, title: 'Shared gear handed over', body: `"${a.title}" went to ${a.handedTo.name}.${all.length > 1 ? ` Marked as used by: ${used}. Not right? Tell the equipment team.` : ''}` }] : []
    }
    case 'returned': {
      // Shared gear: tell the others who was marked as using it, so nobody's put on (or left off) without knowing.
      const by = lastBy(a) ?? '', others = all.length > 1 ? all.filter(e => e !== by) : []
      const used = ((a.usedByNames ?? []) as string[]).map(n => n.split(' ')[0]).join(', ')
      return [{ to: ['gear-team'], url, tag, title: 'Gear returned', body: `${a.creatorName}'s "${a.title}" is back. Check it in.` },
        ...(others.length ? [{ to: others, url, tag, title: 'Shared gear returned', body: `"${a.title}" is back. Marked as used by: ${used || 'nobody'}. Not right? Tell the equipment team.` }] : [])]
    }
    default: return []
  }
}

export function reportCreated(id: string, r: Doc): Push[] {
  if (!r) return []
  const what = [r.overMinutes ? `ran over ${r.overMinutes} min` : '', r.mess ? 'left a mess' : ''].filter(Boolean).join(' and ')
  const note = typeof r.note === 'string' && r.note ? ` "${r.note.length > 90 ? r.note.slice(0, 89) + '…' : r.note}"` : ''
  return [{ to: ['gear-team'], url: '/schedule/team', tag: `report-${id}`, title: 'New report to review', body: `${first(r.byName)} says ${first(r.onName)} ${what || 'had a problem'} (${dayLabel(r.date)}).${note}` }]
}

const STRIKE_WHY: Record<string, string> = { 'late-cancel': 'a late cancel', 'no-show': 'a missed shoot', report: 'a report from another creator' }
export function strikeCreated(id: string, st: Doc, s: ScheduleSettings): Push[] {
  if (!st?.email) return []
  return [{ to: [st.email], url: '/account', tag: `strike-${id}`, title: 'You got a strike',
    body: `For ${STRIKE_WHY[st.reason] ?? 'a schedule problem'}. ${s.strikeCount} strikes in ${s.strikeDays} days pause props and gear for ${s.pauseDays} days.` }]
}

// The schedule team booked, moved or cancelled someone's shoot: tell that creator.
export function shootChange(id: string, b: Doc, a: Doc, s: ScheduleSettings): Push[] {
  if (!a) return []
  const hist = (a.history ?? []) as { by?: string; action?: string; note?: string }[]
  if (hist.length <= ((b?.history ?? []) as unknown[]).length) return []
  const h = hist.at(-1)!
  if (!h.by || h.by === a.creatorEmail) return []
  const url = `/schedule?shoot=${id}`, tag = `shoot-${id}`
  if (h.action === 'booked' && !b) return [{ to: [a.creatorEmail], url, tag, title: 'You have a new shoot 🎬', body: `The schedule team booked you: ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'moved') return [{ to: [a.creatorEmail], url, tag, title: 'Your shoot moved', body: `Now ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'cancelled') return [{ to: [a.creatorEmail], url, tag, title: 'Your shoot was cancelled', body: `${placeName(a, s)} · ${when(a)} was cancelled by the schedule team.` }]
  return []
}

// ─── Reminders (the timer runs every 10 minutes) ─────────────────────────────
// Each reminder has a key; push.ts sends a key only once (push_sent/{key}).
export interface Reminder { key: string; push: Push }

export function shootReminders(id: string, sh: Doc, now: string, s: ScheduleSettings, hasNeeds: boolean, closed: ClosedDays, propsLead: number): Reminder[] {
  if (!sh || sh.status !== 'booked' || !sh.creatorEmail) return []
  const out: Reminder[] = []
  const url = `/schedule?shoot=${id}`, to = [sh.creatorEmail], where = placeName(sh, s)
  const house = sh.place !== 'offsite'
  const win = checkinWindow(sh as { from: string; to: string }, now, s)
  // Check-in time (houses only): one ping when it opens.
  if (house && win === 'open' && !sh.checkin) out.push({ key: `checkin_${id}`, push: { to, url, tag: `shoot-${id}`, title: 'Time to check in 📸', body: `${where} · ${fmtTime(sh.start)}. Open your shoot and take a set photo.` } })
  // An hour before (when check-in isn't open yet).
  else if (win === 'early' && now >= addMinutes(sh.from, -60)) out.push({ key: `hour_${id}`, push: { to, url, tag: `shoot-${id}`, title: `Your shoot starts at ${fmtTime(sh.start)}`, body: `${where}.${house ? ` Check-in opens ${s.checkinBefore} min before.` : ''}` } })
  // Missed check-in: a chance to explain.
  if (house && isMissed(sh as any, now) && now < explainUntil(sh as { to: string }, s)) out.push({ key: `missed_${id}`, push: { to, url, tag: `shoot-${id}`, title: 'Missed your check-in?', body: `Tell the schedule team what happened by ${stampTime(explainUntil(sh as { to: string }, s))}.` } })
  // Last day to add props + gear (from 9 AM), only if nothing is added yet.
  if (!hasNeeds && sh.date > now.slice(0, 10) && lastDayToBook(sh.date, propsLead, closed) === now.slice(0, 10) && Number(now.slice(11, 13)) >= 9)
    out.push({ key: `cutoff_${id}`, push: { to, url, tag: `needs-${id}`, title: 'Last day to add props & gear', body: `For your ${dayLabel(sh.date)} shoot at ${where}.` } })
  return out
}

export function propsReminders(id: string, r: Doc, now: string, closed: ClosedDays): Reminder[] {
  if (!r || r.status !== 'collected' || !r.creatorEmail) return []
  const url = `/reservations/${id}`, to = [r.creatorEmail], tag = `props-${id}`
  const due = returnDueDay(r.endDate, closed), today = now.slice(0, 10), hour = Number(now.slice(11, 13))
  if (today > due || (today === due && hour >= RETURN_DEADLINE_HOUR)) return [{ key: `propslate_${id}`, push: { to, url, tag, title: 'Your props are late', body: `Please bring back "${r.title}" as soon as you can. Late props pause new requests.` } }]
  if (today === due && hour >= 8) return [{ key: `propsdue_${id}`, push: { to, url, tag, title: 'Props due back by 10 AM', body: `"${r.title}" goes back to the prop room today.` } }]
  return []
}

export function gearReminders(id: string, g: Doc, now: string): Reminder[] {
  if (!g || g.status !== 'out' || !g.creatorEmail) return []
  const url = `/gear/bookings/${id}`, to = responsible(g), tag = `gear-${id}`
  if (isGearLate(g as { status: string; to: string }, now)) return [{ key: `gearlate_${id}`, push: { to, url, tag, title: 'Your gear is late', body: `Please bring back "${g.title}" now. Late returns carry a fee of ${LATE_FEE_PERCENT}% of the gear's value and pause new holds.` } }]
  if (now >= addMinutes(g.to, -30) && now < g.to) return [{ key: `geardue_${id}`, push: { to, url, tag, title: `Gear due back at ${stampTime(g.to)}`, body: `"${g.title}": everything back in the case, batteries charging, then a photo. Late returns carry a ${LATE_FEE_PERCENT}% fee.` } }]
  return []
}
