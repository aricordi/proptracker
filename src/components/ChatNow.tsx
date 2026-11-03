// What's going on, at the top of the chat (owner, Nov 2: the chat "infers what stage they're in and prompts them").
// Live cards, most urgent first: an invite or swap to answer, a shoot happening now (check in → wrap, right here in the
// chat), a missed check-in to explain, things to bring back, a request that wasn't approved, then the next shoots with
// their status (waiting for approval / approved) and a nudge to add props. Nothing here needs the AI.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useSession } from '../auth'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { useReturnGroups, returnCount } from '../hooks/useReturnables'
import ProofPhotos from './ProofPhotos'
import UnsentBasket from './UnsentBasket'
import { SwapAsk, InviteAsk } from './ScheduleAsks'
import { formatDay, whenLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useMySwaps, useMyInvites, useMyStatus, checkInShoot, wrapShoot,
  checkinWindow, isMissed, explainUntil, slotKey, fmtSlot, type Shoot,
} from '../services/schedule'

const card = 'rise-in rounded-[20px] bg-pt-surface shadow-hairline p-4 space-y-3'
const gold = 'w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40'
const grey = 'rounded-xl px-4 min-h-[44px] font-semibold bg-pt-border text-pt-text disabled:opacity-40'
const SEEN_KEY = 'pc.chatSeenEnded'
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') } catch { return [] } }

export default function ChatNow({ onAsk, onProps }: { onAsk: (text: string) => void; onProps: (shootId: string) => void }) {
  const navigate = useNavigate()
  const { profile } = useSession()
  const email = profile.email
  const s = useScheduleSettings()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 30_000); return () => clearInterval(t) }, [])
  const today = todayInStudio()
  const { upcoming } = useActiveShoot()
  const cutoffs = useCutoffs()
  const recent = useMyShoots(email, addDays(today, -2))
  const swaps = useMySwaps(email)
  const invites = useMyInvites(email)
  const status = useMyStatus(email)
  const returns = useReturnGroups(email)
  const [params] = useSearchParams()
  const focus = params.get('shoot')

  // Requests that weren't approved or ran out (last few days), until you tap "Got it".
  const [ended, setEnded] = useState<Shoot[]>([])
  const [seen, setSeen] = useState<string[]>(readSeen)
  useEffect(() => onSnapshot(query(collection(db, 'shoots'), where('creatorEmail', '==', email), where('date', '>=', addDays(today, -3))),
    snap => setEnded(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shoot)).filter(x => (x.status === 'denied' || x.status === 'expired' || !!x.bumped)
      && (x.updatedAt ?? '') >= new Date(Date.now() - 4 * 86400000).toISOString())), () => setEnded([])), [email, today])
  const dismiss = (id: string) => { const n = [...seen, id].slice(-50); setSeen(n); try { localStorage.setItem(SEEN_KEY, JSON.stringify(n)) } catch { /* private mode */ } }

  // A shoot happening now (check-in open, or checked in and not wrapped yet today), and missed check-ins to explain.
  const live = useMemo(() => (recent ?? []).filter(x => x.status === 'booked' && x.place !== 'offsite'), [recent])
  const onNow = live.filter(x => !x.wrap && x.date >= addDays(today, -1) && ((!x.checkin && checkinWindow(x, now, s) === 'open') || (x.checkin && x.from <= now && x.date === today)))
  const missed = live.filter(x => isMissed(x, now) && !x.explanation && now < explainUntil(x, s))
  const next = upcoming.filter(x => !onNow.some(y => y.id === x.id)).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 3)
  const backCount = (returns ?? []).reduce((n, g) => n + returnCount(g), 0)
  const paused = !!status?.pausedUntil && status.pausedUntil > today

  const place = (x: Shoot) => x.place === 'offsite' ? (x.where || 'Offsite') : s.houses[x.place].name
  const label = (x: Shoot) => `${formatDay(x.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${place(x)} · ${fmtSlot(x.start, x.end - x.start)}`

  // 15 seconds of "how this works", once (owner, Nov 2: the chat explains itself instead of a long tour).
  const [intro, setIntro] = useState(() => { try { return !localStorage.getItem('pc.chatIntro') } catch { return true } })
  const closeIntro = () => { setIntro(false); try { localStorage.setItem('pc.chatIntro', '1') } catch { /* private mode */ } }

  return (
    <div className="space-y-3">
      {intro && (
        <div className="rise-in rounded-[20px] p-4 space-y-2 bg-[#BF9DFF]/10 shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.4)]">
          <b className="block text-[16px]">How this works</b>
          <p className="text-[15px]"><b>1.</b> Type what you need below, like a text: a time to film, props, a question.</p>
          <p className="text-[15px]"><b>2.</b> Your shoots and anything to do show up right here.</p>
          <p className="text-[15px]"><b>3.</b> <b>Calendar</b> shows free spots. <b>Props</b> is the whole closet.</p>
          <button onClick={closeIntro} className="w-full rounded-xl py-3 font-bold text-[#140f22] bg-[#BF9DFF]">Got it</button>
        </div>
      )}
      {paused && <div className="rise-in rounded-[20px] p-4 bg-red-400/10 shadow-[inset_0_0_0_0.5px_rgba(248,113,113,0.5)] text-[15px]">
        <b>Props and gear are paused until {formatDay(status!.pausedUntil!)}.</b> You can still book filming time. Ask the schedule team if this looks wrong.</div>}
      {invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => <InviteAsk key={i.id} inv={i} now={now} />)}
      {swaps.incoming.map(r => <SwapAsk key={r.id} r={r} incoming />)}
      {onNow.map(x => <ShootNow key={x.id} shoot={x} label={label(x)} />)}
      {missed.map(x => (
        <div key={x.id} className={card}>
          <p className="text-[15px]"><b>No check-in for {label(x)}.</b> Did you film? Tell the team before {fmtTime(Number(explainUntil(x, s).slice(11, 13)) * 60 + Number(explainUntil(x, s).slice(14, 16)))} or it may count as a no-show.</p>
          <button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className={gold}>Explain what happened</button>
        </div>
      ))}
      {backCount > 0 && (
        <div className={card}>
          <p className="text-[15px]"><b>You have {backCount === 1 ? 'something' : `${backCount} things`} to bring back.</b> One photo for everything.</p>
          <button onClick={() => navigate('/return')} className={gold}>Return everything</button>
        </div>
      )}
      {ended.filter(x => x.bumped && !seen.includes(`b${x.id}${x.bumped.at}`)).map(x => (
        <div key={`b${x.id}`} className={card}>
          <p className="text-[15px]"><b>Sorry, {x.bumped!.forName.split(' ')[0]} needed your slot.</b> {x.status === 'cancelled'
            ? <>{label(x)} had to be cancelled (no strike). Your next request goes first.</>
            : <>You're now at <b>{label(x)}</b>. Your props and gear moved with you.</>}</p>
          <div className="flex gap-2">
            {x.status === 'cancelled' && <button onClick={() => { dismiss(`b${x.id}${x.bumped!.at}`); onAsk(`Find me another time near ${formatDay(x.date, { weekday: 'long' })} ${fmtTime(x.bumped!.movedFrom?.start ?? x.start)}`) }} className={`${gold} flex-1`}>Find another time</button>}
            <button onClick={() => dismiss(`b${x.id}${x.bumped!.at}`)} className={x.status === 'cancelled' ? grey : `${gold} flex-1`}>Got it</button>
          </div>
        </div>
      ))}
      {ended.filter(x => !x.bumped && x.status !== 'booked' && x.status !== 'cancelled' && !seen.includes(x.id)).map(x => (
        <div key={x.id} className={card}>
          <p className="text-[15px]"><b>{x.status === 'denied' ? 'Not approved' : 'Nobody approved it in time'}:</b> {label(x)}.{x.deniedReason ? ` "${x.deniedReason}"` : ''}</p>
          <div className="flex gap-2">
            <button onClick={() => { dismiss(x.id); onAsk(`Find me another time near ${formatDay(x.date, { weekday: 'long' })} ${fmtTime(x.start)}`) }} className={`${gold} flex-1`}>Find another time</button>
            <button onClick={() => dismiss(x.id)} className={grey}>Got it</button>
          </div>
        </div>
      ))}
      <UnsentBasket />
      {next.map(x => {
        const c = cutoffs(x), waiting = x.status === 'requested'
        const propsOpen = today <= c.props
        return (
          <div key={x.id} className={`${card} ${focus === x.id ? 'shadow-[inset_0_0_0_1.5px_rgba(201,169,97,0.8)]' : ''}`}>
            <button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className="w-full text-left flex items-start gap-3">
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-pt-accent">{whenLabel(x.date, today)}</span>
                <b className="block text-[16px] leading-snug">{label(x)}</b>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${waiting ? 'bg-amber-400/15 text-amber-300' : 'bg-green-500/15 text-green-400'}`}>
                {waiting ? 'Waiting for OK' : x.wrap ? 'Filmed ✓' : x.checkin ? 'Checked in' : x.moveRequest ? 'Move asked' : 'Approved ✓'}</span>
            </button>
            {waiting && <p className="text-pt-muted text-[13px]">Held for you while the schedule team looks at it. You'll get a notification.</p>}
            <div className="flex gap-2">
              {propsOpen && !x.checkin && <button onClick={() => onProps(x.id)} className="flex-1 rounded-xl min-h-[44px] text-[14px] font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ Props for it · by {c.props === today ? 'today' : formatDay(c.props)}</button>}
              <button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className={grey}>Open</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Check in and wrap, right here (owner, Nov 2: "at the shoot time… was the house clean? did they run over?").
// Step by step: a photo of the set → the slot before you (only when someone filmed right before) → check in → later,
// one line: what did you film? Same server calls as the shoot page.
function ShootNow({ shoot, label }: { shoot: Shoot; label: string }) {
  const s = useScheduleSettings()
  const days = useScheduleDays(shoot.date, shoot.date)
  const prev = shoot.place !== 'offsite' ? days?.[shoot.date]?.[shoot.place]?.[slotKey(shoot.start - s.slotMinutes)] : undefined
  const before = prev && prev.shootId && prev.shootId !== shoot.id ? prev : undefined
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [clean, setClean] = useState<boolean | null>(null)
  const [messPhotos, setMessPhotos] = useState<string[]>([])
  const [over, setOver] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run(f: () => Promise<unknown>) { setBusy(true); setErr(''); try { await f() } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) } }
  const askedBefore = !before || (clean !== null && over !== null)
  const ready = photos.length > 0 && askedBefore && (clean !== false || messPhotos.length > 0) && !uploading

  if (shoot.checkin) return (
    <div className={card}>
      <p className="text-[15px]"><b>You're filming: {label}.</b> When you're done, tell me what you filmed.</p>
      <div className="flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 100))} placeholder="What did you film?" aria-label="What did you film?"
          className="flex-1 min-w-0 bg-pt-bg rounded-xl px-3 min-h-[44px] text-base" />
        <button disabled={busy || title.trim().length < 2} onClick={() => run(() => wrapShoot({ id: shoot.id, title: title.trim() }))} className="shrink-0 rounded-xl px-4 font-bold text-stone-900 bg-pt-accent disabled:opacity-40">Wrap</button>
      </div>
      {err && <p className="text-red-300 text-sm">{err}</p>}
    </div>
  )

  return (
    <div className="rise-in rounded-[20px] p-4 space-y-3 bg-pt-accent/[0.12] shadow-[inset_0_0_0_1px_rgba(201,169,97,0.55)]">
      <p className="text-[16px]"><b>You're up: {label}.</b> Check in with a photo of the set.</p>
      <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo of the set" hint="Opens your camera" max={3} />
      {before && photos.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-[15px]">Was the house clean when you got there? <span className="text-pt-muted">({before.name} was in before you)</span></p>
            <div className="flex gap-2">
              <button onClick={() => setClean(true)} className={`flex-1 rounded-xl min-h-[44px] ${clean === true ? 'bg-pt-accent text-stone-900 font-bold' : 'bg-pt-border'}`}>Yes, clean</button>
              <button onClick={() => setClean(false)} className={`flex-1 rounded-xl min-h-[44px] ${clean === false ? 'bg-amber-400 text-stone-900 font-bold' : 'bg-pt-border'}`}>No, a mess</button>
            </div>
            {clean === false && <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={messPhotos} onChange={setMessPhotos} onUploading={setUploading} label="Photos of the mess" max={5} />}
          </div>
          {clean !== null && (
            <div className="space-y-2">
              <p className="text-[15px]">Did they finish on time?</p>
              <div className="flex flex-wrap gap-2">
                {[0, 15, 30, 45, 60].map(m => <button key={m} onClick={() => setOver(m)} className={`rounded-full px-3 min-h-[40px] text-[14px] ${over === m ? 'bg-pt-accent text-stone-900 font-bold' : 'bg-pt-border'}`}>{m === 0 ? 'On time' : `${m} min late`}</button>)}
              </div>
            </div>
          )}
          {(clean === false || (over ?? 0) > 0) && <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Anything to add? (optional)" className="w-full bg-pt-bg rounded-xl px-3 py-2 text-base" />}
        </div>
      )}
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <button disabled={busy || !ready} className={gold}
        onClick={() => run(() => checkInShoot({ id: shoot.id, photos, ...((over || clean === false) ? { report: { overMinutes: over || undefined, mess: clean === false, photos: messPhotos, ...(note.trim() ? { note: note.trim() } : {}) } } : {}) }))}>
        {busy ? 'Checking in…' : !photos.length ? 'Take the photo first' : !askedBefore ? 'Answer the questions above' : (over || clean === false) ? 'Check in and tell the team' : 'Check in'}
      </button>
    </div>
  )
}
