// "Who's in this video?" (owner, Nov 21): the pieces used on the chat, the shoot page, My shoots, the calendar and
// the "Videos you're in" screen. Everyone shows up at the shoot's start time (owner choice).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import BottomSheet from './BottomSheet'
import { Icon } from './Icon'
import { ChatCard, SlotTile, primaryBtn, secondaryBtn } from './ChatCard'
import { formatDay } from '../lib/dates'
import { fmtTime, nowStamp } from '../../functions/src/gearBooking'
import { MAX_CAST } from '../../functions/src/cast'
import { useProfiles } from '../services/profiles'
import { listFilmingFriends, errorText, type Shoot } from '../services/schedule'
import { useShootCast, inviteToVideo, answerVideoInvite, removeFromVideo, isUpcoming, firstName, type CastRow } from '../services/cast'

const day = (d: string) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' })
const slot = (c: Pick<CastRow, 'start' | 'end'>) => `${fmtTime(c.start)}–${fmtTime(c.end)}`

/** Someone wants you in their video: say yes or no. */
export function VideoInviteCard({ row }: { row: CastRow }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function answer(accept: boolean) {
    setBusy(true); setErr('')
    try { await answerVideoInvite({ id: row.id, accept }) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <ChatCard tone="ask" lead={<Avatar email={row.hostEmail} name={row.hostName} size={48} />} label="Needs your answer"
      title={`${firstName(row.hostName)} wants you in their video`}
      sub={row.shootStatus === 'requested' ? 'Their time is still waiting for approval.' : undefined}
      actions={<>
        <button disabled={busy} onClick={() => answer(false)} className={secondaryBtn}>Can't make it</button>
        <button disabled={busy} onClick={() => answer(true)} className={primaryBtn}>I'm in</button>
      </>}>
      <SlotTile tag={`Be there at ${fmtTime(row.start)}`} hot day={day(row.date)} time={slot(row)} place={row.placeName} />
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
    </ChatCard>
  )
}

/** A video you said yes to: one row with who, when and where to be. */
export function VideoRow({ row, onLeave }: { row: CastRow; onLeave?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-3" data-testid="video-row">
      <div className="w-12 shrink-0 rounded-xl bg-sky-400/15 text-sky-200 text-center py-1.5">
        <p className="text-[12px] leading-none">{formatDay(row.date, { weekday: 'short' })}</p>
        <p className="text-[18px] font-bold leading-tight">{Number(row.date.slice(8, 10))}</p>
      </div>
      <Avatar email={row.hostEmail} name={row.hostName} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-pt-text text-[16px] font-semibold truncate">In {firstName(row.hostName)}'s video</p>
        <p className="text-pt-muted text-[14px] truncate">Be there {fmtTime(row.start)} · {row.placeName}{row.shootStatus === 'requested' ? ' · waiting for OK' : ''}</p>
      </div>
      {onLeave && <button onClick={onLeave} className="tap text-pt-muted text-[14px] underline shrink-0">Can't go</button>}
    </div>
  )
}

/** Step out of a video you said yes to, with a confirm. */
export function useLeaveVideo() {
  const [leaving, setLeaving] = useState<CastRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sheet = leaving && (
    <BottomSheet open onClose={() => setLeaving(null)} title={`Not in ${firstName(leaving.hostName)}'s video?`}>
      <p className="text-pt-muted text-sm">{firstName(leaving.hostName)} gets a notification that you can't make it on {day(leaving.date)} at {fmtTime(leaving.start)}.</p>
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
      <div className="flex gap-2 mt-4">
        <button onClick={() => setLeaving(null)} className={secondaryBtn + ' flex-1'}>Keep it</button>
        <button disabled={busy} onClick={async () => {
          setBusy(true); setErr('')
          try { await answerVideoInvite({ id: leaving.id, leave: true }); setLeaving(null) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
        }} className={primaryBtn}>I can't make it</button>
      </div>
    </BottomSheet>
  )
  return { leave: setLeaving, sheet }
}

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: 'Waiting', cls: 'bg-amber-400/15 text-amber-200' },
  accepted: { text: 'In ✓', cls: 'bg-emerald-400/15 text-emerald-200' },
  declined: { text: "Can't make it", cls: 'bg-white/[0.08] text-pt-muted' },
  left: { text: "Can't make it", cls: 'bg-white/[0.08] text-pt-muted' },
}

/** On your shoot's page: who's in the video, + invite people, × take someone out. */
export function ShootCast({ shoot, team }: { shoot: Shoot; team: boolean }) {
  const rows = useShootCast(shoot.id, shoot.creatorEmail, team).filter(r => r.status in STATUS)
    .sort((a, b) => (a.status === 'accepted' ? 0 : a.status === 'pending' ? 1 : 2) - (b.status === 'accepted' ? 0 : b.status === 'pending' ? 1 : 2))
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const started = !!shoot.from && nowStamp() >= shoot.from
  const live = rows.filter(r => r.status === 'pending' || r.status === 'accepted')
  return (
    <section className="rounded-[20px] bg-pt-surface p-4 shadow-hairline" data-testid="shoot-cast">
      <div className="flex items-center gap-2">
        <Icon name="people" className="w-5 h-5 text-sky-300" />
        <h3 className="text-pt-text text-[18px] font-semibold flex-1">Who's in this video?</h3>
        {!started && live.length < MAX_CAST && (
          <button onClick={() => setAdding(true)} className="min-h-[44px] inline-flex items-center gap-1 rounded-full px-4 bg-pt-bg text-pt-text text-sm font-semibold">
            <Icon name="plus" className="w-4 h-4" />Invite</button>
        )}
      </div>
      {rows.length === 0
        ? <p className="text-pt-muted text-sm mt-1">Invite the people who'll be on camera. Once they say yes, your shoot shows in their app with reminders, so they know to be there at {fmtTime(shoot.start)}.</p>
        : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {rows.map(r => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <Avatar email={r.toEmail} name={r.toName} size={36} />
                <span className="flex-1 min-w-0 truncate text-pt-text text-[16px]">{r.toName}</span>
                <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>
                {!started && (r.status === 'pending' || r.status === 'accepted') && (
                  <button aria-label={`Take ${r.toName} out of the video`} onClick={async () => { setErr(''); try { await removeFromVideo({ id: r.id }) } catch (e) { setErr(errorText(e)) } }}
                    className="w-11 h-11 -mr-2 flex items-center justify-center text-pt-muted"><Icon name="x" className="w-4 h-4" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
      {adding && <InviteSheet shoot={shoot} already={live.map(r => r.toEmail)} onClose={() => setAdding(false)} />}
    </section>
  )
}

function InviteSheet({ shoot, already, onClose }: { shoot: Shoot; already: string[]; onClose: () => void }) {
  const profiles = useProfiles()
  const [everyone, setEveryone] = useState<{ email: string; name: string }[] | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ email: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { listFilmingFriends({}).then(r => setEveryone(r.data.people)).catch(() => setEveryone([])) }, [])
  const term = q.trim().toLowerCase()
  const matches = (everyone ?? []).filter(p => p.email !== shoot.creatorEmail && !already.includes(p.email) && !picked.some(x => x.email === p.email)
    && (!term || p.name.toLowerCase().includes(term) || (profiles[p.email]?.channel ?? '').toLowerCase().includes(term))).slice(0, term ? 8 : 0)
  async function send() {
    setBusy(true); setErr('')
    try { await inviteToVideo({ shootId: shoot.id, emails: picked.map(p => p.email) }); onClose() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title="Who's in your video?">
      <p className="text-pt-muted text-sm">They get a notification to say yes or no. Once they're in, it shows in their app with a reminder the night before and an hour before {fmtTime(shoot.start)}.</p>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {picked.map(p => (
            <button key={p.email} onClick={() => setPicked(x => x.filter(y => y.email !== p.email))} className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline">
              <Avatar email={p.email} name={p.name} size={32} />{p.name.split(' ')[0]}<span className="text-pt-muted">×</span>
            </button>
          ))}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name or channel" autoFocus
        className="mt-3 w-full rounded-xl bg-pt-bg px-3 py-3 text-pt-text placeholder:text-pt-muted outline-none" />
      <ul className="mt-2">
        {everyone === null && <li className="text-pt-muted text-sm py-2">Loading people…</li>}
        {term && everyone && matches.length === 0 && <li className="text-pt-muted text-sm py-2">Nobody in the app matches “{q}”.</li>}
        {matches.map(p => (
          <li key={p.email}>
            <button onClick={() => { setPicked(x => [...x, p]); setQ('') }} className="w-full flex items-center gap-3 py-2 text-left min-h-[48px]">
              <Avatar email={p.email} name={p.name} size={36} />
              <span className="flex-1 min-w-0"><span className="block text-pt-text truncate">{p.name}</span>
                {profiles[p.email]?.channel && <span className="block text-pt-muted text-xs truncate">{profiles[p.email]!.channel}</span>}</span>
              <Icon name="plus" className="w-4 h-4 text-pt-muted" />
            </button>
          </li>
        ))}
      </ul>
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
      <button disabled={busy || !picked.length} onClick={send} className={primaryBtn + ' w-full mt-4'}>
        {picked.length ? `Invite ${picked.length === 1 ? picked[0].name.split(' ')[0] : `${picked.length} people`}` : 'Pick someone'}</button>
    </BottomSheet>
  )
}

/** Group booking: one tick per friend, on by default (owner, Nov 21). Guests (not on the app) can't be invited. */
export function CastTicks({ friends, off, setOff }: { friends: { email: string; name: string }[]; off: string[]; setOff: (f: (x: string[]) => string[]) => void }) {
  const people = friends.filter(f => !f.email.startsWith('guest:'))
  if (!people.length) return null
  return (
    <div className="space-y-1" data-testid="cast-ticks">
      {people.map(f => {
        const on = !off.includes(f.email)
        return (
          <button key={f.email} onClick={() => setOff(x => on ? [...x, f.email] : x.filter(e => e !== f.email))}
            className="w-full flex items-center gap-3 min-h-[44px] text-left" aria-pressed={on}>
            <span className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center ${on ? 'bg-sky-400 text-stone-900' : 'bg-pt-bg shadow-hairline'}`}>{on && <Icon name="check" className="w-4 h-4" />}</span>
            <span className="text-pt-text text-sm">In each other's videos <span className="text-pt-muted">· you in {f.name.split(' ')[0]}'s, {f.name.split(' ')[0]} in yours</span></span>
          </button>
        )
      })}
    </div>
  )
}

/** Small strip for screens that list your own shoots: the videos you're in, with a link to all of them. */
export function VideosStrip({ rows, max = 3 }: { rows: CastRow[]; max?: number }) {
  const { leave, sheet } = useLeaveVideo()
  const mine = rows.filter(r => r.status === 'accepted' && isUpcoming(r))
  if (!mine.length) return null
  return (
    <section data-testid="videos-strip">
      <div className="flex items-baseline justify-between">
        <h3 className="text-pt-text text-[18px] font-semibold">Videos you're in</h3>
        <Link to="/videos" className="tap text-pt-accent text-[14px] font-semibold">All ›</Link>
      </div>
      <div className="divide-y divide-white/[0.06]">{mine.slice(0, max).map(r => <VideoRow key={r.id} row={r} onLeave={() => leave(r)} />)}</div>
      {sheet}
    </section>
  )
}

/** Me / More: one row to the videos you're in, with how many wait for an answer. */
export function VideosMeRow({ rows }: { rows: CastRow[] | null }) {
  const live = (rows ?? []).filter(r => isUpcoming(r))
  const waiting = live.filter(r => r.status === 'pending').length
  const yes = live.filter(r => r.status === 'accepted')
  const sub = waiting ? `${waiting} waiting for your answer` : yes.length ? `Next: ${firstName(yes[0].hostName)}'s, ${day(yes[0].date)} at ${fmtTime(yes[0].start)}` : 'When someone invites you into their video'
  return (
    <Link to="/videos" className="w-full flex items-center gap-3 px-4 py-3 text-left bg-pt-surface shadow-hairline rounded-2xl" data-testid="videos-me-row">
      <Icon name="video" className="w-5 h-5 text-sky-300 shrink-0" />
      <span className="flex-1 min-w-0"><span className="block text-pt-text">Videos you're in</span><span className={`block text-xs ${waiting ? 'text-amber-200' : 'text-pt-muted'}`}>{sub}</span></span>
      {waiting > 0 && <span className="min-w-6 h-6 px-1.5 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{waiting}</span>}
      <span className="text-pt-muted">›</span>
    </Link>
  )
}
