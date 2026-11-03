// What's going on, at the top of the chat (owner, Nov 2: the chat "infers what stage they're in and prompts them").
// Live cards, most urgent first: an invite or swap to answer, a shoot happening now (check in → wrap, right here in the
// chat), a missed check-in to explain, things to bring back, a request that wasn't approved, then the next shoots with
// their status (waiting for approval / approved) and a nudge to add props. Nothing here needs the AI.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useSession } from '../auth'
import { useActiveShoot, useCutoffs, useGearWindow } from '../activeShoot'
import { useReturnGroups, returnCount } from '../hooks/useReturnables'
import ProofPhotos from './ProofPhotos'
import UnsentBasket from './UnsentBasket'
import ReturnFlow from './ReturnFlow'
import { subscribeToReservations, confirmPickup, type Reservation } from '../services/reservations'
import { reportProblem } from '../services/problems'
import type { ReturnGroup } from '../hooks/useReturnables'
import { SwapAsk, InviteAsk } from './ScheduleAsks'
import { formatDay, whenLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useMySwaps, useMyInvites, useMyStatus, checkInShoot, wrapShoot,
  checkinWindow, isMissed, explainUntil, slotKey, fmtSlot, houseFreeFrom, type Shoot,
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
  const { upcoming, choose } = useActiveShoot()
  const soonDays = useScheduleDays(todayInStudio(), addDays(todayInStudio(), 30))
  const gw = useGearWindow()
  const cutoffs = useCutoffs()
  const recent = useMyShoots(email, addDays(today, -2))
  const swaps = useMySwaps(email)
  const invites = useMyInvites(email)
  const status = useMyStatus(email)
  const returns = useReturnGroups(email)
  // Props packed and waiting for you: sign for them right here (owner, Nov 3: report missing props at pickup in the chat).
  const [packed, setPacked] = useState<Reservation[]>([])
  useEffect(() => subscribeToReservations({ email, all: false }, list => setPacked(list.filter(r => r.status === 'packed' && r.startDate <= addDays(todayInStudio(), 1)))), [email])
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
      {intro && <ChatIntro onAsk={onAsk} onDone={closeIntro} />}
      {s.appOnlyFrom && today < addDays(s.appOnlyFrom, 14) && (
        <div className="rise-in rounded-[20px] p-4 bg-sky-400/10 shadow-[inset_0_0_0_0.5px_rgba(125,211,252,0.45)] text-[15px]">
          <b>{today < s.appOnlyFrom ? `From ${formatDay(s.appOnlyFrom, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'From now on'}, bookings and requests only count when they're made in the app.</b> Just type them here.
        </div>
      )}
      {paused && <div className="rise-in rounded-[20px] p-4 bg-red-400/10 shadow-[inset_0_0_0_0.5px_rgba(248,113,113,0.5)] text-[15px]">
        <b>Props are paused until {formatDay(status!.pausedUntil!)}.</b> You can still book filming time. Ask the schedule team if this looks wrong.</div>}
      {invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => <InviteAsk key={i.id} inv={i} now={now} />)}
      {swaps.incoming.map(r => <SwapAsk key={r.id} r={r} incoming />)}
      {onNow.map(x => <ShootNow key={x.id} shoot={x} label={label(x)} />)}
      {/* Grab-and-go gear (Nov 2): from an hour before the shoot, take what's free. */}
      {[...upcoming, ...live].filter((x, i, all) => all.findIndex(y => y.id === x.id) === i && x.status === 'booked' && gw(x, now).state === 'take').slice(0, 1).map(x => (
        <div key={`g${x.id}`} className={card}>
          <p className="text-[15px]"><b>Need gear for {label(x)}?</b> Take what's free now: pick it, tick every piece, one photo.</p>
          <button onClick={() => { choose(x.id); navigate('/gear') }} className={gold}>Take gear</button>
        </div>
      ))}
      {missed.map(x => (
        <div key={x.id} className={card}>
          <p className="text-[15px]"><b>No check-in for {label(x)}.</b> Did you film? Tell the team before {fmtTime(Number(explainUntil(x, s).slice(11, 13)) * 60 + Number(explainUntil(x, s).slice(14, 16)))} or it may count as a no-show.</p>
          <button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className={gold}>Explain what happened</button>
        </div>
      ))}
      {(returns ?? []).length > 0 && <ReturnCard groups={returns!} count={backCount} label={label} />}
      {packed.map(r => <PickupCard key={r.id} r={r} />)}
      {ended.filter(x => x.bumped && !seen.includes(`b${x.id}${x.bumped.at}`)).map(x => (
        <div key={`b${x.id}`} className={card}>
          <p className="text-[15px]"><b>Schedule change.</b> {x.status === 'cancelled'
            ? <>{label(x)} is needed for a priority booking, so it was cancelled (no strike). Your next request is first in line.</>
            : <>Your shoot moved to <b>{label(x)}</b> for a priority booking. Props and gear moved with it.</>}</p>
          {x.status === 'cancelled' ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { dismiss(`b${x.id}${x.bumped!.at}`); onAsk(`Find me another time near ${formatDay(x.date, { weekday: 'long' })} ${fmtTime(x.bumped!.movedFrom?.start ?? x.start)}`) }} className={gold}>Find another time</button>
              <button onClick={() => { dismiss(`b${x.id}${x.bumped!.at}`); navigate(`/schedule?offsite=${x.date}`) }} className={grey}>Shoot offsite</button>
              <button onClick={() => dismiss(`b${x.id}${x.bumped!.at}`)} className={`${grey} col-span-2`}>OK</button>
            </div>
          ) : <button onClick={() => dismiss(`b${x.id}${x.bumped!.at}`)} className={grey}>OK</button>}
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
            {x.place !== 'offsite' && (() => { const e = houseFreeFrom(soonDays?.[x.date], x.place, x.start, s); return e ? <p className="text-sky-300 text-[13px]">The house is free from {fmtTime(e.at)} ({e.what.toLowerCase()} until then), if you want to start early.</p> : null })()}
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

// Bringing things back, right in the chat: one question at a time (ReturnFlow).
export function ReturnCard({ groups, count, label }: { groups: ReturnGroup[]; count: number; label: (x: Shoot) => string }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(0)
  const [done, setDone] = useState(0)
  const g = groups[Math.min(pick, groups.length - 1)]
  if (done) return <div className={card}><p className="text-[15px] text-green-400 font-semibold">Returned ✓ The team will check it in. Thanks!</p></div>
  return (
    <div className={card}>
      <p className="text-[15px]"><b>You have {count === 1 ? 'something' : `${count} things`} to bring back.</b> A few taps and one photo.</p>
      {!open ? <button onClick={() => setOpen(true)} className={gold}>Return it now</button> : <>
        {groups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">{groups.map((x, i) => (
            <button key={x.key} onClick={() => setPick(i)} className={`shrink-0 px-3 min-h-[36px] rounded-full text-[13px] ${i === pick ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-border'}`}>{x.shoot ? label(x.shoot) : formatDay(x.date)}</button>))}
          </div>
        )}
        <ReturnFlow key={g.key} group={g} compact onDone={setDone} />
      </>}
    </div>
  )
}

// Props are packed: pick them up and say if anything is missing (tap the props), no screen to find.
export function PickupCard({ r }: { r: Reservation }) {
  const [missing, setMissing] = useState<Record<string, number> | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  async function sign(all: boolean) {
    setBusy(true); setErr('')
    try {
      const list = Object.entries(missing ?? {}).map(([itemId, qty]) => ({ itemId, qty }))
      await confirmPickup({ id: r.id, allReceived: all, ...(all ? {} : { missing: list }) })
      setDone(all ? 'Picked up ✓ Enjoy the shoot.' : 'Picked up ✓ The props team knows what was missing.')
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  if (done) return <div className={card}><p className="text-[15px] text-green-400 font-semibold">{done}</p></div>
  return (
    <div className={card}>
      <p className="text-[15px]"><b>Your props for "{r.title}" are packed.</b> Picking them up? Check everything is there, then sign.</p>
      {missing === null ? (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={() => sign(true)} className={gold}>Got everything</button>
          <button disabled={busy} onClick={() => setMissing({})} className={grey}>Something's missing</button>
        </div>
      ) : <>
        <p className="text-pt-muted text-[13px]">Tap what's missing.</p>
        <div className="flex flex-wrap gap-2">{r.lines.map(l => {
          const on = l.itemId in missing
          return <button key={l.itemId} onClick={() => setMissing(m => { const n = { ...(m ?? {}) }; if (on) delete n[l.itemId]; else n[l.itemId] = l.qty; return n })}
            className={`px-3 min-h-[40px] rounded-full text-[14px] ${on ? 'bg-amber-400 text-stone-900 font-semibold' : 'bg-pt-border'}`}>{l.itemName}{l.qty > 1 ? ` ×${l.qty}` : ''}</button>
        })}</div>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy || !Object.keys(missing).length} onClick={() => sign(false)} className={gold}>{busy ? 'Signing…' : 'Sign without them'}</button>
          <button disabled={busy} onClick={() => setMissing(null)} className={grey}>Back</button>
        </div>
      </>}
      {err && <p className="text-red-300 text-sm">{err}</p>}
    </div>
  )
}

// "The tripod is broken": report a problem on gear or props you have out right now (owner, Nov 3).
export function ReportCard({ groups, first }: { groups: ReturnGroup[]; first: string }) {
  const things = groups.flatMap(g => [
    ...g.gear.filter(b => b.status === 'out').flatMap(b => b.lines.flatMap(l => (l.pieces?.length ? l.pieces : [{ itemId: l.offerId, name: l.name }]).map(p => ({ key: `g|${b.id}|${p.itemId}`, kind: 'gear' as const, id: b.id, name: p.name || l.name })))),
    ...g.props.filter(r => r.status === 'collected').flatMap(r => r.lines.map(l => ({ key: `p|${r.id}|${l.itemId}`, kind: 'props' as const, id: r.id, name: l.itemName }))),
  ])
  const [pick, setPick] = useState<string | null>(things.length === 1 ? things[0].key : null)
  const [note, setNote] = useState(first)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const t = things.find(x => x.key === pick)
  async function send() {
    if (!t) return
    setBusy(true); setErr('')
    try { await reportProblem({ kind: t.kind, id: t.id, name: t.name, note: note.trim() }); setDone(true) }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  if (done) return <div className={card}><p className="text-[15px] text-green-400 font-semibold">Reported ✓ The team knows. Keep it safe and bring it back as usual.</p></div>
  return (
    <div className={card}>
      <p className="text-[15px] font-semibold">Which piece?</p>
      <div className="flex flex-wrap gap-2">{things.map(x => (
        <button key={x.key} onClick={() => setPick(x.key)} className={`px-3 min-h-[40px] rounded-full text-[14px] ${pick === x.key ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-border'}`}>{x.name}</button>))}</div>
      <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="What happened?" className="w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-base" />
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <button disabled={busy || !t || note.trim().length < 3} onClick={send} className={gold}>{busy ? 'Sending…' : !t ? 'Pick the piece first' : 'Tell the team'}</button>
    </div>
  )
}

// Packed props waiting for you, or where your props requests are.
export function PickupList() {
  const { profile } = useSession()
  const navigate = useNavigate()
  const [list, setList] = useState<Reservation[] | null>(null)
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, setList), [profile.email])
  if (!list) return null
  const packed = list.filter(r => r.status === 'packed')
  const going = list.filter(r => ['requested', 'preparing'].includes(r.status))
  if (packed.length) return <div className="space-y-3">{packed.map(r => <PickupCard key={r.id} r={r} />)}</div>
  return (
    <div className={card}>
      <p className="text-[15px]">{going.length ? `Nothing packed yet. ${going.length === 1 ? `"${going[0].title}" is` : `${going.length} requests are`} still with the props team.` : 'No props waiting for you right now.'}</p>
      <button onClick={() => navigate('/requests')} className={grey}>My requests</button>
    </div>
  )
}

// 60 seconds, hands-on (owner, Nov 3: creators get a short interactive intro instead of a tour). Step 1 really sends a
// message (a time search: nothing is booked until they tap Request).
function ChatIntro({ onAsk, onDone }: { onAsk: (t: string) => void; onDone: () => void }) {
  const [n, setN] = useState(0)
  const steps = [
    { t: 'Type what you need, like a text', b: 'Try it: tap the button and see what I answer. Nothing is booked until you tap Request.', go: 'Try "Thursday at Cliff 1 at 5pm"' },
    { t: 'You can say anything', b: '"Props for a séance video", "cancel my next shoot", "returning the camera", "the tripod is broken", "how do I…?". I\'ll take you to the right place.', go: 'Next' },
    { t: 'Your to-dos show up here', b: 'Check in on shoot day, gear to take, things to bring back, invites. Notifications bring you straight here.', go: 'Next' },
    { t: 'The other tabs', b: 'Calendar: the free spots. Props: the whole closet. More: your requests, shoots and help.', go: 'Got it' },
  ]
  const st = steps[n]
  return (
    <div className="rise-in rounded-[20px] p-4 space-y-2 bg-[#BF9DFF]/10 shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.4)]">
      <div className="flex items-center gap-2"><span className="text-xs text-[#CDB8FF] font-semibold">Quick intro · {n + 1} of {steps.length}</span>
        <button onClick={onDone} className="ml-auto text-pt-muted text-xs tap">Skip</button></div>
      <b className="block text-[16px]">{st.t}</b>
      <p className="text-[15px]">{st.b}</p>
      <button onClick={() => { if (n === 0) onAsk('Thursday at Cliff 1 at 5pm'); if (n === steps.length - 1) onDone(); else setN(n + 1) }}
        className="w-full rounded-xl py-3 font-bold text-[#140f22] bg-[#BF9DFF]">{st.go}</button>
    </div>
  )
}
