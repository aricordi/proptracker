// What each phone notification says, and who gets it. Pure functions (no database), so every
// message is unit-tested. push.ts delivers them; reminders are worked out here too.
import { fmtTime, addMinutes, isGearLate } from './gearBooking.js'
import { LATE_FEE_PERCENT } from './gearStock.js'
import { responsible } from './gearCrew.js'
import { returnDueDay, lastDayToBook, RETURN_DEADLINE_HOUR, type ClosedDays } from './booking.js'
import { checkinWindow, isMissed, expectsCheckIn, explainUntil, type ScheduleSettings } from './schedule.js'

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
    to: [a.toEmail], tag: `invite-${id}`, url: '/',
    title: `${first(a.fromName)} invited you to film 🎬`,
    body: `${placeName(a, s)} · ${when(a)}, right after them. Confirm by ${stampTime(a.until)} or the slot opens to everyone.`,
  }]
  if (b?.status === 'pending' && a.status === 'accepted') return [{ to: [a.fromEmail], tag: `invite-${id}`, url: '/schedule', title: `${first(a.toName)} confirmed ✓`, body: `${placeName(a, s)} · ${when(a)}. You're filming back to back.` }]
  if (b?.status === 'pending' && a.status === 'declined') return [{ to: [a.fromEmail], tag: `invite-${id}`, url: '/schedule', title: `${first(a.toName)} can't make it`, body: `Their slot (${when(a)}) is open again.` }]
  // Nov 3: the hold ran out, or the inviter took it back.
  if (b?.status === 'pending' && a.status === 'expired') return [
    { to: [a.fromEmail], tag: `invite-${id}`, url: '/schedule', title: `${first(a.toName)} didn't confirm in time`, body: `Their slot (${when(a)}) is open to everyone again.` },
    { to: [a.toEmail], tag: `invite-${id}`, url: '/', title: 'Invite ran out', body: `${first(a.fromName)}'s invite for ${when(a)} wasn't confirmed in time. The slot may still be free: book it yourself.` }]
  if (b?.status === 'pending' && a.status === 'withdrawn') return [{ to: [a.toEmail], tag: `invite-${id}`, url: '/', title: 'Invite withdrawn',
    body: a.reason === 'shoot-gone' ? `${first(a.fromName)}'s shoot was cancelled, so the invite for ${when(a)} is off.` : `${first(a.fromName)} took back the invite for ${when(a)}.` }]
  return []
}

export function swapChange(id: string, b: Doc, a: Doc, s: ScheduleSettings): Push[] {
  if (!a) return []
  if (!b && a.status === 'pending') return [{
    to: [a.toEmail], tag: `swap-${id}`, url: '/',
    title: `${first(a.fromName)} wants to swap slots`,
    body: `You'd get ${placeName(a.from, s)} · ${when(a.from)}; they'd get your ${placeName(a.to, s)} · ${when(a.to)}.`,
  }]
  if (b?.status === 'pending' && a.status === 'accepted') return [{ to: [a.fromEmail], tag: `swap-${id}`, url: '/schedule', title: 'Swap done ✓', body: `${first(a.toName)} said yes. You're now on ${placeName(a.to, s)} · ${when(a.to)}.` }]
  if (b?.status === 'pending' && a.status === 'declined') return [{ to: [a.fromEmail], tag: `swap-${id}`, url: '/schedule', title: `${first(a.toName)} said no to the swap`, body: 'Your shoot stays as it was.' }]
  if (b?.status === 'pending' && a.status === 'withdrawn') return [{ to: [a.toEmail], tag: `swap-${id}`, url: '/', title: 'Swap withdrawn', body: `${first(a.fromName)} took back the swap. Your shoot stays as it was.` }]
  if (b?.status === 'pending' && a.status === 'expired') return [{ to: [a.fromEmail, a.toEmail], tag: `swap-${id}`, url: '/', title: 'Swap no longer possible', body: 'One of the shoots changed, so the swap was called off. Both shoots stay as they are.' }]
  return []
}

const lastBy = (x: Doc) => (x?.history as { by?: string }[] | undefined)?.at(-1)?.by
type PickLine = { itemId?: string; itemName?: string; pick?: { state?: string; reason?: string }; checkIn?: { result?: string } }
type Build = { id?: string; description?: string; state?: string; reason?: string }
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
// Props the arts department marked "not available" / builds marked "can't be made" in this change (audit, Nov 7:
// the creator only heard by email, and email is off).
function newlyUnavailable(b: Doc, a: Doc): { name: string; reason?: string }[] {
  const wasLine = new Set(((b?.lines ?? []) as PickLine[]).filter(l => l.pick?.state === 'unavailable').map(l => l.itemId))
  const wasBuild = new Set(((b?.builds ?? []) as Build[]).filter(x => x.state === 'unavailable').map(x => x.id ?? x.description))
  return [
    ...((a?.lines ?? []) as PickLine[]).filter(l => l.pick?.state === 'unavailable' && !wasLine.has(l.itemId)).map(l => ({ name: l.itemName || 'A prop', reason: l.pick?.reason })),
    ...((a?.builds ?? []) as Build[]).filter(x => x.state === 'unavailable' && !wasBuild.has(x.id ?? x.description)).map(x => ({ name: x.description || 'Something to make or find', reason: x.reason })),
  ]
}
export function reservationChange(id: string, b: Doc, a: Doc): Push[] {
  if (!a) return []
  const url = `/reservations/${id}`, tag = `props-${id}`
  if (!b) return [{ to: ['arts-team'], url, tag, title: 'New props request', body: `${a.creatorName} · "${a.title}" · ${dayLabel(a.startDate)}` }]
  const gone = ['cancelled', 'declined'].includes(a.status) ? [] : newlyUnavailable(b, a)
  const goneMsg: Push[] = gone.length ? [{ to: [a.creatorEmail], url, tag: `props-na-${id}`,
    title: gone.length === 1 ? `"${cut(gone[0].name, 40)}" isn't available` : `${gone.length} props aren't available`,
    body: cut(`${gone.map(g => g.reason ? `${g.name}: ${g.reason}` : g.name).join('; ')}. The rest of "${a.title}" still goes. Tap to see the request.`, 220) }] : []
  if (b.status === a.status) return goneMsg
  const notAvail = ((a.lines ?? []) as PickLine[]).filter(l => l.pick?.state === 'unavailable').length + ((a.builds ?? []) as Build[]).filter(x => x.state === 'unavailable').length
  const status = ((): Push[] => {
    switch (a.status) {
      case 'packed': return [{ to: [a.creatorEmail], url, tag, title: 'Your props are ready 📦', body: `"${a.title}" is packed. Pick it up for your ${dayLabel(a.startDate)} shoot.${notAvail ? ` ${notAvail} ${notAvail === 1 ? 'thing isn\'t' : 'things aren\'t'} available: tap to see.` : ''}` }]
      case 'declined': return [{ to: [a.creatorEmail], url, tag, title: 'Props request declined', body: a.statusReason ? `"${a.title}": ${a.statusReason}` : `"${a.title}" was declined.` }]
      case 'collected': return a.pickup && !a.pickup.allReceived ? [{ to: ['arts-team'], url, tag, title: 'Pickup issue', body: `${a.creatorName} · "${a.title}": ${String(a.pickup.issue ?? 'something is missing').slice(0, 160)}` }] : []
      case 'cancelled': {
        const by = lastBy(a), self = by === a.creatorEmail, dropped = by === 'schedule'
        // The creator cancelled (or their shoot request ran out) while arts were already picking or had packed it: tell arts.
        const started = b.status === 'preparing' || b.status === 'packed'
        const arts: Push[] = started && (self || dropped) ? [{ to: ['arts-team'], url, tag, title: 'Props request cancelled',
          body: dropped ? `${a.creatorName}'s shoot was dropped, so "${a.title}" (${dayLabel(a.startDate)}) is off. Put the props back.`
            : `${a.creatorName} cancelled "${a.title}" (${dayLabel(a.startDate)}). Put the props back.` }] : []
        // 'schedule' = the shoot request ran out: the creator already gets "Request ran out" for the shoot itself.
        if (self || dropped) return arts
        return [{ to: [a.creatorEmail], url, tag, title: 'Props request cancelled', body: `"${a.title}" was cancelled by the team.` }]
      }
      case 'return_pending': {
        const dmg = ((a.returnInfo?.damaged ?? []) as { name: string; note?: string }[])
        return [{ to: ['arts-team'], url, tag, title: dmg.length ? 'Props returned · damage reported' : 'Props returned', body: `${a.creatorName}'s "${a.title}" is back.${dmg.length ? ` Damaged: ${dmg.map(d => `${d.name}${d.note ? ` (${d.note})` : ''}`).join(', ')}.` : ''} Check it in.` }]
      }
      // Nov 3: the creator knows their return is done and they're clear. Damaged or missing props are said plainly
      // (audit, Nov 7: the thank-you went out even when something was recorded as damaged or missing).
      case 'returned': {
        const issues = ((a.lines ?? []) as PickLine[]).filter(l => l.checkIn?.result === 'damaged' || l.checkIn?.result === 'missing')
        if (!issues.length) return [{ to: [a.creatorEmail], url, tag, title: 'Props checked in ✓', body: `"${a.title}" is checked back in. Thanks!` }]
        return [{ to: [a.creatorEmail], url, tag, title: 'Props checked in · something to look at',
          body: cut(`"${a.title}": ${issues.map(l => `${l.itemName || 'a prop'} ${l.checkIn!.result}`).join(', ')}. Questions? Ask the arts department.`, 220) }]
      }
      default: return []
    }
  })()
  return [...goneMsg, ...status]
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
  // Grab-and-go (Nov 2): taken on the day = one ping when it's actually out (with what's missing), none for the brief hold.
  if (!b && a.grab) return []
  if (b?.status === 'held' && a.status === 'out' && a.grab) {
    const miss = ((a.pickup?.missing ?? []) as { qty: number; name: string }[])
    return [{ to: ['gear-team'], url, tag, title: 'Gear taken', body: `${a.creatorName} took ${((a.lines ?? []) as { name: string }[]).map(l => l.name).join(', ')} until ${fmtTime(a.end)}${miss.length ? ` · missing: ${miss.map(m => `${m.qty}× ${m.name}`).join(', ')}` : ''}` }]
  }
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
      const dmg = ((a.return?.damage ?? []) as { name: string; note?: string }[])
      return [{ to: ['gear-team'], url, tag, title: dmg.length ? 'Gear returned · damage reported' : 'Gear returned', body: `${a.creatorName}'s "${a.title}" is back.${dmg.length ? ` Damaged: ${dmg.map(d => `${d.name}${d.note ? ` (${d.note})` : ''}`).join(', ')}.` : ''}${a.return?.charging === false ? ' Charging case not confirmed.' : ''} Check it in.` },
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
// Strikes an admin gave by hand (or from a flag) carry what it was about + the reason they had to write (audit, Nov 7).
const STRIKE_ABOUT: Record<string, string> = { props: 'a props problem', gear: 'a gear problem', schedule: 'a schedule problem', behaviour: 'behaviour', other: 'something the team noted' }
export function strikeCreated(id: string, st: Doc, s: ScheduleSettings): Push[] {
  if (!st?.email) return []
  const note = typeof st.note === 'string' ? st.note.trim() : ''
  const why = st.reason === 'manual'
    ? `For ${STRIKE_ABOUT[st.about] ?? STRIKE_ABOUT.other}${note ? `: "${cut(note, 120)}"` : ''}.`
    : `For ${STRIKE_WHY[st.reason] ?? 'a schedule problem'}.`
  return [{ to: [st.email], url: '/account', tag: `strike-${id}`, title: 'You got a strike',
    body: `${why} ${s.strikeCount} strikes in ${s.strikeDays} days pause props for ${s.pauseDays} days.` }]
}

// The schedule team booked, moved or cancelled someone's shoot: tell that creator.
export function shootChange(id: string, b: Doc, a: Doc, s: ScheduleSettings): Push[] {
  if (!a) return []
  const hist = (a.history ?? []) as { by?: string; action?: string; note?: string }[]
  if (hist.length <= ((b?.history ?? []) as unknown[]).length) return []
  const h = hist.at(-1)!
  // Creators' shoot news opens the chat on that shoot (chat first, Nov 2): status, check-in and wrap are right there.
  const url0 = `/?shoot=${id}`, tag0 = `shoot-${id}`
  // Requests (owner, Nov 2): the creator asks, the equipment team decides.
  if (h.action === 'requested') return [{ to: ['approvers'], url: '/approvals', tag: `req-${id}`, title: 'New booking request', body: `${a.creatorName}: ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'move-requested') return [{ to: ['approvers'], url: '/approvals', tag: `req-${id}`, title: 'Move request', body: `${a.creatorName} wants to move to ${placeName(a.moveRequest ?? a, s)} · ${when(a.moveRequest ?? a)}.` }]
  if (h.action === 'approved') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Booking approved ✓', body: `${placeName(a, s)} · ${when(a)} is in the calendar.` }]
  if (h.action === 'denied') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Booking not approved', body: `${placeName(a, s)} · ${when(a)}: ${h.note ?? ''}`.trim() }]
  if (h.action === 'move-approved') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Move approved ✓', body: `Your shoot is now ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'move-denied') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Move not approved', body: `You keep ${placeName(a, s)} · ${when(a)}. ${h.note ?? ''}`.trim() }]
  if (h.action === 'move-expired') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Move not approved in time', body: `You keep ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'expired') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Request ran out', body: `Nobody approved ${placeName(a, s)} · ${when(a)} in time. Request another time?` }]
  // A priority booking took the slot (owner, Nov 3: neutral, professional, no apology).
  if (h.action === 'bumped') return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Schedule change',
    body: a.status === 'cancelled'
      ? `${placeName(a, s)} · ${when(a)} is needed for a priority booking, so it was cancelled (no strike). Your next request is first in line. Tap to pick another time or move it offsite.`
      : `Your shoot moved to ${placeName(a, s)} · ${when(a)} for a priority booking. Props and gear moved with it.` }]
  if (h.action === 'given') return []
  // Calendar imports (owner, Nov 4): held back while "to check"; the creator hears once the equipment team confirms.
  if (h.action === 'import-confirmed') {
    if (h.note === 'past') return []   // a day already over: nobody needs a notification
    if (a.status === 'booked') return [{ to: [a.creatorEmail], url: url0, tag: tag0, ...(b?.told === false || h.note === 'new'
      ? { title: 'You have a new shoot 🎬', body: `The schedule team booked you: ${placeName(a, s)} · ${when(a)}.` }
      : { title: 'Your shoot changed', body: `Now ${placeName(a, s)} · ${when(a)}.` }) }]
    if (a.status === 'cancelled' && b?.told !== false) return [{ to: [a.creatorEmail], url: url0, tag: tag0, title: 'Your shoot was cancelled', body: `${placeName(a, s)} · ${when(a)} was taken off the schedule.` }]
    return []
  }
  if (a.toCheck) return []
  // A creator cancelled an APPROVED shoot (Nov 3): the schedule team knows the slot is free again.
  if (h.action === 'cancelled' && h.by === a.creatorEmail && b?.status === 'booked')
    return [{ to: ['gear-team'], url: '/approvals', tag: `shoot-${id}`, title: 'Shoot cancelled', body: `${a.creatorName} cancelled ${placeName(a, s)} · ${when(a)}. The slot is free again.` }]
  if (!h.by || h.by === a.creatorEmail) return []
  if (h.by === 'monthly draw') return []   // the draw sends one summary per person instead of one per shoot
  const url = `/?shoot=${id}`, tag = `shoot-${id}`
  if (h.action === 'booked' && !b) return [{ to: [a.creatorEmail], url, tag, title: 'You have a new shoot 🎬', body: `The schedule team booked you: ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'moved') return [{ to: [a.creatorEmail], url, tag, title: 'Your shoot moved', body: `Now ${placeName(a, s)} · ${when(a)}.` }]
  if (h.action === 'cancelled') return [{ to: [a.creatorEmail], url, tag, title: 'Your shoot was cancelled', body: `${placeName(a, s)} · ${when(a)} was cancelled by the schedule team.` }]
  return []
}

// ─── Reminders (the timer runs every 10 minutes) ─────────────────────────────
// Each reminder has a key; push.ts sends a key only once (push_sent/{key}).
export interface Reminder { key: string; push: Push }

export function shootReminders(id: string, sh: Doc, now: string, s: ScheduleSettings, hasNeeds: boolean, closed: ClosedDays, propsLead: number): Reminder[] {
  // Not for calendar imports nobody has confirmed (maybe the wrong person) or people on Props only (audit, Nov 5).
  // A request still waiting for approval only gets the "last day to add props" reminder (audit, Nov 7: props can be
  // added to a request, and an unapproved one could pass its cutoff without a word).
  if (!sh || !(sh.status === 'booked' || sh.status === 'requested') || !sh.creatorEmail || sh.toCheck || sh.checksIn === false) return []
  const out: Reminder[] = []
  const url = `/?shoot=${id}`, to = [sh.creatorEmail], where = placeName(sh, s)
  const cutoff = (): Reminder[] => !hasNeeds && sh.date > now.slice(0, 10) && lastDayToBook(sh.date, propsLead, closed) === now.slice(0, 10) && Number(now.slice(11, 13)) >= 9
    ? [{ key: `cutoff_${id}`, push: { to, url, tag: `needs-${id}`, title: 'Last day to add props', body: `For your ${dayLabel(sh.date)} shoot at ${where}.` } }] : []
  if (sh.status === 'requested') return cutoff()
  const house = sh.place !== 'offsite'
  const win = checkinWindow(sh as { from: string; to: string }, now, s)
  // Check-in time (houses only): one ping when it opens.
  if (house && win === 'open' && !sh.checkin && expectsCheckIn(sh as any)) out.push({ key: `checkin_${id}`, push: { to, url, tag: `shoot-${id}`, title: 'Time to check in 📸', body: `${where} · ${fmtTime(sh.start)}. Tap and take a quick selfie with your camera.` } })
  // An hour before (when check-in isn't open yet).
  else if (win === 'early' && now >= addMinutes(sh.from, -60)) out.push({ key: `hour_${id}`, push: { to, url, tag: `shoot-${id}`, title: `Your shoot starts at ${fmtTime(sh.start)}`, body: `${where}.${house ? ` Check-in opens ${s.checkinBefore} min before.` : ''}` } })
  // Checked in and the slot is over: one nudge to wrap ("what did you film?"), within 3 hours.
  if (sh.checkin && !sh.wrap && now >= (sh.to as string) && now < addMinutes(sh.to as string, 180))
    out.push({ key: `wrap_${id}`, push: { to, url, tag: `shoot-${id}`, title: 'That\'s a wrap? 🎬', body: 'Tell us what you filmed. One line is enough.' } })
  // Missed check-in: a chance to explain.
  if (house && isMissed(sh as any, now) && now < explainUntil(sh as { to: string }, s)) out.push({ key: `missed_${id}`, push: { to, url, tag: `shoot-${id}`, title: 'Missed your check-in?', body: `Tell the schedule team what happened by ${stampTime(explainUntil(sh as { to: string }, s))}.` } })
  // Last day to add props + gear (from 9 AM), only if nothing is added yet.
  out.push(...cutoff())
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
