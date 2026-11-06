// What's going on, at the top of the chat (owner, Nov 2: the chat "infers what stage they're in and prompts them").
// Live cards, most urgent first: an invite or swap to answer, a shoot happening now (check in → wrap, right here in the
// chat), a missed check-in to explain, things to bring back, a request that wasn't approved, then the next shoots with
// their status (waiting for approval / approved) and a nudge to add props. Nothing here needs the AI.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useSession } from '../auth'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { useReturnGroups, returnCount } from '../hooks/useReturnables'
import ProofPhotos from './ProofPhotos'
import UnsentBasket from './UnsentBasket'
import ReturnFlow from './ReturnFlow'
import { subscribeToReservations, confirmPickup, type Reservation } from '../services/reservations'
import { reportProblem } from '../services/problems'
import type { ReturnGroup } from '../hooks/useReturnables'
import { SwapAsk, InviteAsk } from './ScheduleAsks'
import { ChatCard, HeroCard, AlertCard, ReadyCard, NoticeRow, CountdownRing, LiveDot, primaryBtn, secondaryBtn, alertBtn, noticeLink } from './ChatCard'
import { formatDay, whenLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp, fmtTime, addMinutes } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useScheduleDays, useMyShoots, useMySwaps, useMyInvites, useMyStatus, checkInShoot, wrapShoot,
  checkinWindow, isMissed, explainUntil, slotKey, fmtSlot, houseFreeFrom, type Shoot,
} from '../services/schedule'

const card = 'rise-in rounded-[20px] bg-pt-surface p-4 space-y-3'
const gold = 'w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40'
const grey = 'rounded-xl px-4 min-h-[44px] font-semibold bg-pt-border text-pt-text disabled:opacity-40'
const SEEN_KEY = 'pc.chatSeenEnded'
// Minutes from one studio stamp ('YYYY-MM-DDTHH:MM') to another (both in the same time zone, so plain maths works).
const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 60000)
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') } catch { return [] } }

export default function ChatNow({ onAsk, onProps, chatting = false }: { onAsk: (text: string) => void; onProps: (shootId: string) => void; chatting?: boolean }) {
  const navigate = useNavigate()
  const { profile } = useSession()
  const email = profile.email
  // Coming up folds away (owner, Nov 4), remembered on this phone.
  const [listOpen, setListOpen] = useState(() => { try { return localStorage.getItem('pc.comingUpOpen') !== '0' } catch { return true } })
  const toggleList = () => setListOpen(v => { try { localStorage.setItem('pc.comingUpOpen', v ? '0' : '1') } catch { /* private mode */ } return !v })
  const s = useScheduleSettings()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 30_000); return () => clearInterval(t) }, [])
  const today = todayInStudio()
  const { upcoming } = useActiveShoot()
  const soonDays = useScheduleDays(todayInStudio(), addDays(todayInStudio(), 30))
  const cutoffs = useCutoffs()
  const recent = useMyShoots(email, addDays(today, -2))
  const swaps = useMySwaps(email)
  const invites = useMyInvites(email)
  const status = useMyStatus(email)
  const returns = useReturnGroups(email)
  // Props packed and waiting for you: sign for them right here (owner, Nov 3: report missing props at pickup in the chat).
  const [packed, setPacked] = useState<Reservation[]>([])
  useEffect(() => subscribeToReservations({ email, all: false }, list => setPacked(list.filter(r => r.status === 'packed' && r.startDate <= addDays(todayInStudio(), 1) && r.startDate >= todayInStudio()))), [email])
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
  const onNow = live.filter(x => !x.wrap && x.date >= addDays(today, -1) && ((!x.checkin && checkinWindow(x, now, s) === 'open') || (x.checkin && x.from <= now && now < addMinutes(x.to, 180))))
  const missed = live.filter(x => isMissed(x, now) && !x.explanation && now < explainUntil(x, s))
  const ahead = upcoming.filter(x => !onNow.some(y => y.id === x.id)).sort((a, b) => a.from.localeCompare(b.from))
  // Only the next 3 here (owner, Nov 5: say so, so nobody thinks it's everything they're booked for); the rest on My shoots.
  const next = ahead.slice(0, 3)
  const backCount = (returns ?? []).reduce((n, g) => n + returnCount(g), 0)
  const paused = !!status?.pausedUntil && status.pausedUntil > today

  const place = (x: Shoot) => x.place === 'offsite' ? (x.where || 'Offsite') : s.houses[x.place].name
  const label = (x: Shoot) => `${formatDay(x.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${place(x)} · ${fmtSlot(x.start, x.end - x.start)}`

  // 15 seconds of "how this works", once (owner, Nov 2: the chat explains itself instead of a long tour).
  const [intro, setIntro] = useState(() => { try { return !localStorage.getItem('pc.chatIntro') } catch { return true } })
  const closeIntro = () => { setIntro(false); try { localStorage.setItem('pc.chatIntro', '1') } catch { /* private mode */ } }

  return (
    <div className="space-y-3">
      {intro && !chatting && <ChatIntro onDone={closeIntro} />}
      {s.appOnlyFrom && today < addDays(s.appOnlyFrom, 14) && (
        <div className="rise-in rounded-2xl px-4 py-3 bg-sky-400/10 text-[14px] text-sky-100">
          <b>{today < s.appOnlyFrom ? `From ${formatDay(s.appOnlyFrom, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'From now on'}, bookings and requests only count when they're made in the app.</b> Just type them here.
        </div>
      )}
      {paused && <NoticeRow tone="bad" icon="pause" title={`Prop requests paused until ${formatDay(status!.pausedUntil!)}`} sub="You can still book filming time." />}
      {invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => <InviteAsk key={i.id} inv={i} now={now} urgent />)}
      {swaps.incoming.map(r => <SwapAsk key={r.id} r={r} incoming urgent />)}
      {onNow.map(x => <ShootNow key={x.id} shoot={x} label={label(x)} />)}
      {missed.map(x => {
        const until = explainUntil(x, s), left = minutesBetween(now, until), total = s.explainHours * 60
        return (
          <AlertCard key={x.id} label="Missed check-in" title={`Did you film ${formatDay(x.date, { weekday: 'short' })} ${fmtTime(x.start)}?`}
            sub={`Tell the team by ${fmtTime(Number(until.slice(11, 13)) * 60 + Number(until.slice(14, 16)))}, or it may count as a no-show.`}
            side={<CountdownRing left={left} total={total} label={left >= 60 ? `${Math.floor(left / 60)}h` : `${Math.max(0, left)}m`} />}
            actions={<button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className={alertBtn}>Explain what happened</button>} />
        )
      })}
      {(returns ?? []).length > 0 && <ReturnCard groups={returns!} count={backCount} label={label} />}
      {packed.map(r => <PickupCard key={r.id} r={r} />)}
      {ended.filter(x => x.bumped && !seen.includes(`b${x.id}${x.bumped.at}`)).map(x => {
        const k = `b${x.id}${x.bumped!.at}`, gone = x.status === 'cancelled'
        return (
          <NoticeRow key={k} tone="info" icon="calendar" onClose={() => dismiss(k)}
            title={gone ? 'Schedule change: your shoot was cancelled' : `Schedule change: moved to ${formatDay(x.date, { weekday: 'short' })} ${fmtTime(x.start)}`}
            sub={gone ? 'A priority booking needed the slot. No strike, and you go first next time.' : 'For a priority booking. Your props moved with it.'}
            action={gone ? <>
              <button onClick={() => { dismiss(k); onAsk(`Find me another time near ${formatDay(x.date, { weekday: 'long' })} ${fmtTime(x.bumped!.movedFrom?.start ?? x.start)}`) }} className={noticeLink}>Find a new time</button>
              <button onClick={() => { dismiss(k); navigate(`/schedule?offsite=${x.date}`) }} className="text-[14px] font-semibold text-pt-muted tap">Film offsite</button>
            </> : undefined} />
        )
      })}
      {ended.filter(x => !x.bumped && x.status !== 'booked' && x.status !== 'cancelled' && !seen.includes(x.id)).map(x => (
        <NoticeRow key={x.id} tone="bad" icon="x" onClose={() => dismiss(x.id)}
          title={`${x.status === 'denied' ? 'Not approved' : 'Request ran out'}: ${label(x)}`}
          sub={x.deniedReason ? `"${x.deniedReason}"` : x.status === 'denied' ? undefined : 'Nobody approved it in time.'}
          action={<button onClick={() => { dismiss(x.id); onAsk(`Find me another time near ${formatDay(x.date, { weekday: 'long' })} ${fmtTime(x.start)}`) }} className={noticeLink}>Find a new time</button>} />
      ))}
      <UnsentBasket />
      {/* Nothing booked yet (first day): turn the empty space into the next step (mobile-app-ui-design: empty states guide). */}
      {!chatting && upcoming.length === 0 && onNow.length === 0 && (
        <ChatCard tone="plain" icon="calendar" label="Your first shoot" title="Nothing booked yet"
          sub="Pick a free 2-hour slot at Cliff 1 or Cliff 2, or just type when you want to film."
          actions={<button onClick={() => navigate('/schedule')} className={primaryBtn}>See free times</button>} />
      )}
      {/* Coming up (owner, Nov 3: "too busy"): one quiet list, one row per shoot, instead of a card each. */}
      {next.length > 0 && (
        <section className="rise-in">
          <button onClick={toggleList} aria-expanded={listOpen} className="w-full min-h-[40px] flex items-center gap-2 px-1 mb-1 text-left">
            <span className="text-pt-muted text-[14px] font-semibold">{next.length === 1 ? 'Your next shoot' : `Your next ${next.length} shoots`}</span>
            <span className="text-pt-muted/70 text-[14px]">{ahead.length > next.length ? `· of ${ahead.length} booked` : ''}{!listOpen ? ` · ${formatDay(next[0].date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</span>
            <span className={`ml-auto text-pt-muted text-[16px] transition-transform ${listOpen ? 'rotate-90' : ''}`} aria-hidden>›</span>
          </button>
          {listOpen && <div className="rounded-[20px] bg-pt-surface overflow-hidden divide-y divide-white/[0.06]">
            {next.map(x => {
              const c = cutoffs(x), waiting = x.status === 'requested'
              const propsOpen = today <= c.props && !x.checkin
              const early = x.place !== 'offsite' ? houseFreeFrom(soonDays?.[x.date], x.place, x.start, s) : null
              const state = waiting ? 'Waiting for OK' : x.wrap ? 'Filmed' : x.checkin ? 'Checked in' : x.moveRequest ? 'Move asked' : 'Approved'
              return (
                <div key={x.id} className={`flex items-center gap-3 pl-4 pr-3 py-3.5 min-h-[60px] ${focus === x.id ? 'bg-pt-accent/10' : ''}`}>
                  <button onClick={() => navigate(`/schedule?shoot=${x.id}`)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                    <span className="w-11 shrink-0 text-center">
                      <span className="block text-[12px] font-semibold text-pt-muted">{formatDay(x.date, { weekday: 'short' })}</span>
                      <span className="block font-display text-[22px] leading-none font-extrabold">{Number(x.date.slice(8))}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold truncate">{place(x)} · {fmtSlot(x.start, x.end - x.start)}</span>
                      <span className="flex items-center gap-1.5 text-[14px] text-pt-muted">
                        <span className={`w-1.5 h-1.5 rounded-full ${waiting || x.moveRequest ? 'bg-amber-400' : 'bg-green-400'}`} aria-hidden />
                        {state} · {whenLabel(x.date, today)}
                      </span>
                      {early && <span className="block text-[12px] text-sky-300">House free from {fmtTime(early.at)}</span>}
                    </span>
                  </button>
                  {propsOpen && <button onClick={() => onProps(x.id)} aria-label={`Props for this shoot, by ${formatDay(c.props)}`}
                    className="shrink-0 rounded-full h-11 px-3.5 text-[14px] font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15">✦ Props</button>}
                </div>
              )
            })}
            <button onClick={() => navigate('/shoots')} className="w-full min-h-[48px] px-4 flex items-center justify-between text-left text-[14px] font-semibold text-pt-accent">
              {ahead.length > next.length ? `See all ${ahead.length} shoots` : 'See all my shoots'}<span aria-hidden>›</span>
            </button>
          </div>}
        </section>
      )}
    </div>
  )
}

// Check in and wrap, right here (owner, Nov 3: "smaller, just a selfie of them with their camera, nothing crazy").
// One line + a selfie button. The photo is the check-in. Only when someone filmed right before you: one optional
// "All good / Report it" question (mess and/or ran over). Later, one line: what did you film?
function ShootNow({ shoot }: { shoot: Shoot; label: string }) {
  const s = useScheduleSettings()
  const shootPlace = shoot.place === 'offsite' ? (shoot.where || 'Offsite') : s.houses[shoot.place].name
  const days = useScheduleDays(shoot.date, shoot.date)
  const prev = shoot.place !== 'offsite' ? days?.[shoot.date]?.[shoot.place]?.[slotKey(shoot.start - s.slotMinutes)] : undefined
  const before = prev && prev.shootId && prev.shootId !== shoot.id ? prev : undefined
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [report, setReport] = useState(false)
  const [mess, setMess] = useState(false)
  const [messPhotos, setMessPhotos] = useState<string[]>([])
  const [over, setOver] = useState(0)
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tried = useRef(false)
  async function run(f: () => Promise<unknown>) { setBusy(true); setErr(''); try { await f() } catch (e) { setErr(friendlyError(e)); tried.current = false } finally { setBusy(false) } }
  const checkIn = (withReport: boolean) => run(() => checkInShoot({ id: shoot.id, photos,
    ...(withReport && (over || mess) ? { report: { overMinutes: over || undefined, mess, photos: messPhotos, ...(note.trim() ? { note: note.trim() } : {}) } } : {}) }))
  // Nobody filmed right before you: the selfie is all it takes.
  useEffect(() => {
    if (!before && photos.length && !uploading && !shoot.checkin && !tried.current) { tried.current = true; void checkIn(false) }
  }, [before, photos.length, uploading, shoot.checkin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (shoot.checkin) return (
    <div className="rise-in rounded-[22px] p-4 bg-pt-surface ring-1 ring-red-400/30">
      <p className="flex items-center gap-2 text-[14px] font-extrabold text-red-300"><LiveDot className="bg-red-400" />Filming now · {shootPlace} · {fmtTime(shoot.start)}</p>
      <div className="flex items-center gap-2 mt-3">
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 100))} placeholder="Done? What did you film?" aria-label="What did you film?"
          className="flex-1 min-w-0 bg-black/30 rounded-2xl px-4 min-h-[48px] text-base placeholder:text-pt-muted" />
        <button disabled={busy || title.trim().length < 2} onClick={() => run(() => wrapShoot({ id: shoot.id, title: title.trim() }))}
          className="shrink-0 rounded-2xl h-12 px-5 font-bold text-stone-900 bg-pt-accent disabled:opacity-40">Wrap</button>
      </div>
      {err && <p className="text-red-300 text-sm mt-2">{err}</p>}
    </div>
  )

  const shot = photos.length > 0 && !uploading
  return (
    <HeroCard eyebrow={<><LiveDot />{shot ? (busy ? 'Checking in…' : err ? 'Not checked in yet' : 'Got it ✓') : "You're up · check in"}</>} title={`${shootPlace} · ${fmtTime(shoot.start)}`}
      sub={shot ? undefined : 'One selfie with your camera and you\'re checked in.'}
      action={!shot ? <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Check-in selfie" selfie compact="Selfie" hero max={1} /> : undefined}>
      {before && shot && !report ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-[16px] font-semibold">All good with {before.name.split(' ')[0]}'s slot?</p>
          <button disabled={busy} onClick={() => setReport(true)} className="shrink-0 rounded-full h-11 px-4 text-[16px] font-semibold bg-stone-900/10">Report it</button>
          <button disabled={busy} onClick={() => checkIn(false)} className="shrink-0 rounded-full h-11 px-5 text-[16px] font-bold text-pt-accent bg-stone-900">All good</button>
        </div>
      ) : before && shot && report ? (
        <div className="space-y-2 rounded-2xl bg-pt-bg p-3 text-pt-text">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setMess(!mess)} className={`rounded-full px-3 min-h-[40px] text-[14px] ${mess ? 'bg-amber-400 text-stone-900 font-bold' : 'bg-white/[0.08]'}`}>House was a mess</button>
            {[15, 30, 60].map(m => <button key={m} onClick={() => setOver(over === m ? 0 : m)} className={`rounded-full px-3 min-h-[40px] text-[14px] ${over === m ? 'bg-amber-400 text-stone-900 font-bold' : 'bg-white/[0.08]'}`}>Ran over {m} min</button>)}
          </div>
          {mess && <ProofPhotos folder={`shoot-photos/${shoot.id}`} urls={messPhotos} onChange={setMessPhotos} onUploading={setUploading} label="Photo of the mess" compact="Photo of the mess" max={3} />}
          <input value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="Anything to add? (optional)" className="w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-base" />
          <button disabled={busy || uploading || (!mess && !over) || (mess && !messPhotos.length)} onClick={() => checkIn(true)} className={`w-full ${primaryBtn}`}>
            {busy ? 'Checking in…' : mess && !messPhotos.length ? 'Add a photo of the mess' : !mess && !over ? 'Tap what happened' : 'Check in and tell the team'}</button>
        </div>
      ) : null}
      {err && <p className="text-red-900 text-sm font-semibold">{err}</p>}
      {/* The automatic check-in failed (no signal, phone clock off…): try again with the same selfie (audit, Nov 5). */}
      {err && shot && !before && <button disabled={busy} onClick={() => checkIn(false)} className="w-full rounded-full h-12 px-5 text-[16px] font-bold text-pt-accent bg-stone-900 disabled:opacity-40">{busy ? 'Checking in…' : 'Try again'}</button>}
    </HeroCard>
  )
}

// Bringing things back, right in the chat: one question at a time (ReturnFlow).
export function ReturnCard({ groups, count, label, onReturned }: { groups: ReturnGroup[]; count: number; label: (x: Shoot) => string; onReturned?: () => void }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(0)
  const [done, setDone] = useState(0)
  const g = groups[Math.min(pick, groups.length - 1)]
  const thanks = <NoticeRow tone="info" icon="check" title="Returned ✓ Thanks! The team will check it in." />
  // Kept something to bring back later: the reminder stays for what's still out (audit, Nov 5).
  if (done && count === 0) return thanks
  const photos = groups.flatMap(x => [...x.props.filter(r => r.status === 'collected').flatMap(r => r.lines.map(l => l.photo)), ...x.gear.filter(b => b.status === 'out').flatMap(b => b.lines.map(l => l.photo))])
  return (<>
    {done > 0 && thanks}
    <ReadyCard back icon="box" photos={photos} label="To bring back" title={count === 1 ? '1 thing is still with you' : `${count} things are still with you`} sub={open ? undefined : 'A few taps and one photo.'}
      actions={open ? undefined : <button onClick={() => setOpen(true)} className={primaryBtn}>Return it now</button>}>
      {open && <>
        {groups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">{groups.map((x, i) => (
            <button key={x.key} onClick={() => setPick(i)} className={`shrink-0 px-3 min-h-[36px] rounded-full text-[14px] ${i === pick ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-border'}`}>{x.shoot ? label(x.shoot) : formatDay(x.date)}</button>))}
          </div>
        )}
        <ReturnFlow key={g.key} group={g} compact onDone={n => { setDone(n); setOpen(false); setPick(0); onReturned?.() }} />
      </>}
    </ReadyCard>
  </>)
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
  if (done) return <NoticeRow tone="info" icon="check" title={done} />
  return (
    <ReadyCard photos={r.lines.map(l => l.photo)} label="Props ready to pick up" title={`"${r.title}" is packed`} sub={missing === null ? `${r.lines.length} ${r.lines.length === 1 ? 'prop' : 'props'} · check them, then sign` : undefined}
      actions={missing === null ? <>
        <button disabled={busy} onClick={() => setMissing({})} className={secondaryBtn}>Missing one</button>
        <button disabled={busy} onClick={() => sign(true)} className={primaryBtn}>Got everything</button>
      </> : undefined}>
      {missing !== null && <>
        <p className="text-pt-muted text-[14px]">Tap what's missing.</p>
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
    </ReadyCard>
  )
}

// "The tripod is broken": report a problem on gear or props you have out right now (owner, Nov 3).
export function ReportCard({ groups, first, onSent }: { groups: ReturnGroup[]; first: string; onSent?: () => void }) {
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
    try { await reportProblem({ kind: t.kind, id: t.id, name: t.name, note: note.trim() }); setDone(true); onSent?.() }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  if (done) return <div className={card}><p className="text-[16px] text-green-400 font-semibold">Reported ✓ The team knows. Keep it safe and bring it back as usual.</p></div>
  return (
    <div className={card}>
      <p className="text-[16px] font-semibold">Which piece?</p>
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
      <p className="text-[16px]">{going.length ? `Nothing packed yet. ${going.length === 1 ? `"${going[0].title}" is` : `${going.length} requests are`} still with the props team.` : 'No props waiting for you right now.'}</p>
      <button onClick={() => navigate('/requests')} className={grey}>My requests</button>
    </div>
  )
}

// A few quick tips, one line each (owner, Nov 3: creators get a short intro, not a tour; the screen must stay clean).
function ChatIntro({ onDone }: { onAsk?: (t: string) => void; onDone: () => void }) {
  const [n, setN] = useState(0)
  const tips = [
    'Type it like a text. Nothing is booked until you tap Request.',
    'Ask for anything: props for a video, cancel a shoot, returning gear, something broke.',
    'Your to-dos (check-in, returns, invites) show up right here.',
  ]
  const last = n === tips.length - 1
  return (
    <div className="rise-in flex items-center gap-3 rounded-2xl bg-white/[0.04] pl-4 pr-2 py-2.5">
      <span className="text-[#BF9DFF] shrink-0" aria-hidden>✦</span>
      <p className="flex-1 min-w-0 text-[14px] leading-snug"><span className="text-pt-muted">Tip {n + 1} of {tips.length}. </span>{tips[n]}</p>
      <button onClick={() => last ? onDone() : setN(n + 1)} className="shrink-0 rounded-full px-4 h-11 text-[14px] font-semibold text-[#CDB8FF]">{last ? 'Got it' : 'Next'}</button>
    </div>
  )
}
