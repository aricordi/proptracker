// "Who's in this video?" (owner, Nov 21): a creator invites the people who appear in their video. Each invite is its own
// record cast_invites/{shootId}_{email} with a COPY of the shoot's time and place, so the people in it see it on their side
// ("You're in Ariel's video") without being able to read anyone's shoots. Owner answers: anyone on the app can be invited
// (Props-only creators too); everyone shows up at the shoot's START time; reminders when invited, the night before and an
// hour before. Being in someone's video is information only: no check-in, no strikes, no props or gear responsibility.
// Pure (no Firebase imports): shared by the server functions, the app and the tests.
import { fmtTime, addMinutes } from './gearBooking.js'
// Same shapes as pushMessages.ts (kept local so the app doesn't pull the server's message file into its build).
export interface Push { to: string[]; title: string; body: string; url: string; tag?: string; except?: string[] }
export interface Reminder { key: string; push: Push }

export type CastStatus = 'pending' | 'accepted' | 'declined' | 'left' | 'removed' | 'cancelled'
export const CAST_LIVE: CastStatus[] = ['pending', 'accepted']
export const MAX_CAST = 12
export const NIGHT_BEFORE_HOUR = 19   // the night-before reminder goes out from 7 PM

export interface CastInvite {
  shootId: string
  hostEmail: string; hostName: string
  toEmail: string; toName: string
  place: string; where?: string; bothHouses?: boolean; placeName: string
  date: string; start: number; end: number; from: string; to: string
  shootStatus: string
  status: CastStatus
  invitedBy: string; invitedAt: string; answeredAt?: string; updatedAt: string
}

export const castId = (shootId: string, email: string) => `${shootId}_${email.toLowerCase()}`
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function castDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
export const first = (name: string | undefined) => (name || 'Someone').split(' ')[0]
/** "Thu Nov 20 · 1–3 PM · Cliff 1" */
export function castWhen(c: Pick<CastInvite, 'date' | 'start' | 'end' | 'placeName'>) {
  return `${castDay(c.date)} · ${fmtTime(c.start)}–${fmtTime(c.end)} · ${c.placeName}`
}

/** The shoot fields copied onto each invite (what the people in the video see). */
export function snapshotOf(sh: Record<string, any>, placeName: string) {
  return {
    place: String(sh.place ?? ''), where: String(sh.where ?? ''), bothHouses: sh.bothHouses === true, placeName,
    date: String(sh.date ?? ''), start: Number(sh.time?.start ?? sh.start ?? 0), end: Number(sh.time?.end ?? sh.end ?? 0),
    from: String(sh.from ?? ''), to: String(sh.to ?? ''), shootStatus: String(sh.status ?? ''),
  }
}
type Snap = ReturnType<typeof snapshotOf>
const LIVE_SHOOT = ['booked', 'requested']
export const shootIsLive = (sh: Record<string, any> | undefined | null) => !!sh && LIVE_SHOOT.includes(String(sh.status))
export const timeChanged = (a: Partial<Snap>, b: Partial<Snap>) =>
  a.date !== b.date || a.start !== b.start || a.end !== b.end || a.place !== b.place || a.where !== b.where || a.bothHouses !== b.bothHouses

/** What a change to the host's shoot means for one invite: new fields to write, and a message for the person (or none). */
export function castFollow(inv: CastInvite, after: Record<string, any> | undefined | null, placeName: string, id: string): { update: Partial<CastInvite> | null; push: Push | null } {
  if (!CAST_LIVE.includes(inv.status)) return { update: null, push: null }
  const url = '/videos', to = [inv.toEmail], host = first(inv.hostName)
  if (!shootIsLive(after)) {
    if (inv.status === 'cancelled') return { update: null, push: null }
    return {
      update: { status: 'cancelled', shootStatus: String(after?.status ?? 'gone') },
      push: inv.status === 'accepted' ? { to, url, tag: `cast-${id}`, title: `${host}'s video is off`, body: `${castWhen(inv)} isn't happening any more. Nothing for you to do.` } : null,
    }
  }
  const snap = snapshotOf(after!, placeName)
  const moved = timeChanged(inv, snap)
  const update: Partial<CastInvite> = { ...snap }
  if (!moved && snap.shootStatus === inv.shootStatus && snap.placeName === inv.placeName) return { update: null, push: null }
  // Their time was a request and the schedule team just approved it: tell the people who said yes it's really on.
  const approved = !moved && inv.shootStatus === 'requested' && snap.shootStatus === 'booked'
  return {
    update,
    push: moved && inv.status === 'accepted'
      ? { to, url, tag: `cast-${id}`, title: `${host}'s video moved`, body: `Now ${castWhen({ ...inv, ...snap })}. Be there at ${fmtTime(snap.start)}.` }
      : approved && inv.status === 'accepted'
        ? { to, url, tag: `cast-${id}`, title: `${host}'s video is confirmed ✓`, body: `${castWhen(inv)}. Be there at ${fmtTime(inv.start)}.` }
        : null,
  }
}

/** Night before (from 7 PM) and an hour before, for people who said yes. `now` = studio stamp 'YYYY-MM-DDTHH:MM'. */
export function castReminders(id: string, inv: CastInvite, now: string, today: string, tomorrow: string): Reminder[] {
  if (inv.status !== 'accepted' || !LIVE_SHOOT.includes(inv.shootStatus) || !inv.from || now >= inv.from) return []
  const to = [inv.toEmail], url = '/videos', tag = `cast-${id}`, host = first(inv.hostName), out: Reminder[] = []
  const hour = Number(now.slice(11, 13))
  if (inv.date === tomorrow && hour >= NIGHT_BEFORE_HOUR)
    out.push({ key: `castnight_${id}`, push: { to, url, tag, title: `Tomorrow: ${host}'s video`, body: `Be there at ${fmtTime(inv.start)} · ${inv.placeName}.` } })
  if ((inv.date === today || inv.date === tomorrow) && now >= addMinutes(inv.from, -60))
    out.push({ key: `cast1h_${id}`, push: { to, url, tag, title: `${host}'s video starts at ${fmtTime(inv.start)}`, body: `You're in it · ${inv.placeName}. Head over now.` } })
  return out
}

/** The message when someone is invited, and the one the host gets back. */
export const invitedPush = (id: string, inv: Pick<CastInvite, 'toEmail' | 'hostName' | 'date' | 'start' | 'end' | 'placeName'>): Push =>
  ({ to: [inv.toEmail], url: '/videos', tag: `cast-${id}`, title: `${first(inv.hostName)} wants you in their video 🎬`, body: `${castWhen(inv)}. Tap to say yes or no.` })
export function answeredPush(id: string, inv: Pick<CastInvite, 'hostEmail' | 'toName' | 'date' | 'start' | 'end' | 'placeName'>, what: 'accepted' | 'declined' | 'left'): Push {
  const who = first(inv.toName)
  const title = what === 'accepted' ? `${who} is in your video ✓` : what === 'left' ? `${who} can't be in your video any more` : `${who} can't make your video`
  return { to: [inv.hostEmail], url: `/schedule?shoot=${id.split('_')[0]}`, tag: `castans-${id}`, title, body: castWhen(inv) }
}
export const removedPush = (id: string, inv: Pick<CastInvite, 'toEmail' | 'hostName' | 'date' | 'start' | 'end' | 'placeName'>): Push =>
  ({ to: [inv.toEmail], url: '/videos', tag: `cast-${id}`, title: `You're no longer in ${first(inv.hostName)}'s video`, body: `${castWhen(inv)}. Nothing for you to do.` })

// ── Same-day smarts (owner, Nov 21: "mine starts after his so I show up to my slot and miss his") ──────────────────────
// A shoot of your own, as far as these helpers care: its day and real hours.
export interface MyTime { id?: string; date: string; start: number; end: number; label?: string }
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

/** One line for YOUR shoot when you're also in someone's video that day: "In Ariel's video at 1 PM first" (or a clash). */
export function videoNoteFor(mine: MyTime, videos: Pick<CastInvite, 'date' | 'start' | 'end' | 'hostName' | 'status'>[]): { text: string; clash: boolean } | null {
  const same = videos.filter(v => v.status === 'accepted' && v.date === mine.date).sort((a, b) => a.start - b.start)
  const clash = same.find(v => overlaps(v, mine))
  if (clash) return { text: `Clashes with ${first(clash.hostName)}'s video (${fmtTime(clash.start)}–${fmtTime(clash.end)})`, clash: true }
  const before = same.filter(v => v.start < mine.start)
  if (before.length) return { text: `In ${before.map(v => `${first(v.hostName)}'s video at ${fmtTime(v.start)}`).join(', ')} first`, clash: false }
  const after = same.find(v => v.start >= mine.end)
  return after ? { text: `Then ${first(after.hostName)}'s video at ${fmtTime(after.start)}`, clash: false } : null
}

/** On an invite: what else you have that day (your own shoots and videos you said yes to), so you answer knowing it. */
export function inviteNote(inv: Pick<CastInvite, 'date' | 'start' | 'end'>, mine: MyTime[], videos: (Pick<CastInvite, 'date' | 'start' | 'end' | 'hostName' | 'status'> & { id?: string })[], selfId?: string): { text: string; clash: boolean } | null {
  const own = mine.filter(m => m.date === inv.date).sort((a, b) => a.start - b.start)
  const vids = videos.filter(v => v.id !== selfId && v.status === 'accepted' && v.date === inv.date)
  const ownClash = own.find(m => overlaps(m, inv))
  if (ownClash) return { text: `Clashes with your own shoot ${fmtTime(ownClash.start)}–${fmtTime(ownClash.end)}${ownClash.label ? ` · ${ownClash.label}` : ''}`, clash: true }
  const vidClash = vids.find(v => overlaps(v, inv))
  if (vidClash) return { text: `Clashes with ${first(vidClash.hostName)}'s video (${fmtTime(vidClash.start)}–${fmtTime(vidClash.end)})`, clash: true }
  if (own.length) {
    const o = own[0]
    return { text: o.start > inv.start ? `Before your own shoot at ${fmtTime(o.start)}${o.label ? ` · ${o.label}` : ''}` : `After your own shoot (${fmtTime(o.start)}–${fmtTime(o.end)})`, clash: false }
  }
  return null
}
