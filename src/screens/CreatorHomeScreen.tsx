// Creators' home: the next shoot and what it still needs (check in from here), search,
// your usual props and gear, monthly slots + filming streak, things to do, what's coming up.
import { NotificationsNudge } from '../components/Notifications'
import RoundIcon from '../components/RoundIcon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import LateBanner from '../components/LateBanner'
import AiButton from '../components/AiButton'
import { useAssistant } from '../assistant'
import { GearArt } from '../components/GearUi'
import { useMyLateBookings } from '../hooks/useLateBookings'
import { useItems } from '../hooks/useItems'
import { useActiveShoot, useShootLabel, useCutoffs } from '../activeShoot'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, subscribeToGearBundles, type GearBooking, type GearBundle } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import { todayInStudio, addDays, daysBetween } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { formatDay } from '../lib/dates'
import {
  useScheduleSettings, useMyShoots, useMySwaps, useMyStatus, useMyInvites, checkinWindow, isMissed, explainUntil, fmtSlot, monthOf, type Shoot,
  MONTHLY_SLOTS_ON,
} from '../services/schedule'

const TODO_DAYS = 21   // remind about props/gear for shoots in the next 3 weeks
const DONE = ['cancelled', 'declined']

// Shoots filmed in a row, newest first (a no-show or late cancel ends the streak; free cancels don't count).
export function filmedStreak(shoots: Shoot[], now: string) {
  let n = 0
  for (const x of [...shoots].filter(x => x.to <= now).sort((a, b) => b.from.localeCompare(a.from))) {
    if (x.noShow || x.outcome === 'noshow') break
    if (x.status !== 'booked') continue
    if (x.checkin || x.outcome === 'filmed') n++
    else break
  }
  return n
}

export default function CreatorHomeScreen() {
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const s = useScheduleSettings()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const { upcoming } = useActiveShoot()
  const today = todayInStudio()
  const ai = useAssistant()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const history = useMyShoots(profile.email, addDays(today, -120))
  const swaps = useMySwaps(profile.email)
  const invites = useMyInvites(profile.email)
  const status = useMyStatus(profile.email)
  const late = useMyLateBookings()
  const items = useItems()
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, setProps), [profile.email])
  useEffect(() => subscribeToGearBookings(profile.email, setGear), [profile.email])
  useEffect(() => subscribeToGearBundles(setBundles), [])

  // How many props / gear requests (not cancelled) each shoot has.
  const linked = useMemo(() => {
    const m: Record<string, { props: number; gear: number }> = {}
    for (const r of props) if (r.shootId && !DONE.includes(r.status)) (m[r.shootId] ??= { props: 0, gear: 0 }).props++
    for (const g of gear) if (g.shootId && !DONE.includes(g.status)) (m[g.shootId] ??= { props: 0, gear: 0 }).gear++
    return m
  }, [props, gear])

  // Your usuals: the props and gear you've booked most.
  const usuals = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of props) if (!DONE.includes(r.status)) for (const l of r.lines) count.set('p:' + l.itemId, (count.get('p:' + l.itemId) ?? 0) + 1)
    for (const g of gear) if (!DONE.includes(g.status)) for (const l of g.lines) count.set('g:' + l.offerId, (count.get('g:' + l.offerId) ?? 0) + 1)
    const itemById = new Map(items.map(i => [i.id, i])), bundleById = new Map(bundles.map(b => [b.id, b]))
    return [...count].sort((a, b) => b[1] - a[1]).map(([key]) => {
      const id = key.slice(2)
      if (key[0] === 'p') { const i = itemById.get(id); return i && !i.archived ? { key, name: i.name, to: `/item/${id}`, photo: i.photos[0] ? thumbOf(i, i.photos[0]) : null, gear: null } : null }
      const b = bundleById.get(id); return b && !b.archived ? { key, name: b.name, to: `/gear/b/${id}`, photo: null, gear: b } : null
    }).filter(Boolean).slice(0, 10) as { key: string; name: string; to: string; photo: string | null; gear: GearBundle | null }[]
  }, [props, gear, items, bundles])

  const next = upcoming[0] as Shoot | undefined
  const win = next ? checkinWindow(next, now, s) : 'early'
  const toExplain = (history ?? []).filter(x => isMissed(x, now) && now < explainUntil(x, s))
  const needsStuff = upcoming.filter(x => x !== next && x.date <= addDays(today, TODO_DAYS) && !linked[x.id] && today <= cutoffs(x).gear)
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const monthlyUsed = (history ?? []).filter(x => x.kind === 'monthly' && x.status === 'booked' && monthOf(x.date) === monthOf(today)).length
  const monthlyLeft = Math.max(0, s.monthlySlots - monthlyUsed)
  const monthShoots = (history ?? []).filter(x => x.status === 'booked' && monthOf(x.date) === monthOf(today)).length
  const streak = filmedStreak(history ?? [], now)
  const open = (id: string) => navigate(`/schedule?shoot=${id}`)
  const first = (profile.name || user.displayName || '').split(' ')[0]

  const todo: { key: string; text: string; action: string; go: () => void }[] = [
    ...invites.incoming.filter(i => i.status === 'pending' && i.until > now).map(i => ({ key: i.id, text: `${i.fromName} invited you to film right after them: ${formatDay(i.date)} · ${fmtSlot(i.start, i.end - i.start)}. Held for you for a few minutes.`, action: 'Answer', go: () => navigate('/schedule') })),
    ...swaps.incoming.map(r => ({ key: r.id, text: `${r.fromName} asks to swap shoots with you`, action: 'Answer', go: () => navigate('/schedule') })),
    ...toExplain.map(x => ({ key: x.id, text: `You didn't check in for ${label(x)}. Say what happened.`, action: 'Explain', go: () => open(x.id) })),
    ...needsStuff.map(x => ({ key: x.id, text: `Props or gear for ${label(x)}? Add by ${formatDay(cutoffs(x).props)}.`, action: '✦ Plan it', go: () => ai.open('plan', x.id) })),
  ]

  // A step on the next-shoot card: done (✓) or still to add (+, with the cutoff).
  const step = (title: string, done: boolean, doneText: string, by: string) => (
    <div className="bg-black/35 rounded-2xl p-3 flex flex-col gap-1 min-w-0">
      <span className={`w-[26px] h-[26px] rounded-full grid place-items-center text-sm font-extrabold ${done ? 'bg-pt-accent text-stone-900' : 'border-2 border-dashed border-pt-accent text-pt-accent'}`}>{done ? '✓' : '+'}</span>
      <b className="text-sm">{title}</b>
      <span className="text-xs text-pt-muted truncate">{done ? doneText : today > by ? 'Too late' : by === today ? 'By today' : `By ${formatDay(by)}`}</span>
    </div>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="pt-safe px-5">
        <div className="flex items-center justify-between py-3">
          <span className="flex items-center gap-2 text-pt-text"><BrandMark className="w-9" title="Prime Capitol" /><b className="text-xs font-extrabold tracking-[0.28em]">PRIME CAPITOL</b></span>
          <span className="flex items-center gap-3">
            <AiButton />
            <RoundIcon icon="help" label="Help" to="/help" />
            <button onClick={() => navigate('/account')} aria-label="Me"><Avatar email={profile.email} name={profile.name || profile.email} size={34} /></button>
          </span>
        </div>
        <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider mt-1">{formatDay(today, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">{first ? `Hey ${first}` : 'Home'}</h1>
      </div>

      <div className="px-5 mt-4 space-y-4">
        {paused && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-sm text-pt-text">
            <p className="text-red-300 font-semibold mb-1">Props and gear are paused until {formatDay(status!.pausedUntil!)}</p>
            Because of {status!.strikes} strikes (no-shows or reports). You can still book house time. Ask the schedule team if you think this is wrong.
          </div>
        )}
        <LateBanner late={late} />

        {/* Next shoot */}
        {next ? (
          <button onClick={() => open(next.id)} className="relative overflow-hidden w-full text-left rounded-[28px] p-5 border border-pt-accent/35 active:scale-[0.98] transition-transform"
            style={{ background: 'radial-gradient(120% 90% at 100% 0%, rgba(235,211,153,.28), transparent 55%), linear-gradient(160deg, #2b2416, #141210 70%)' }}>
            <BrandMark className="absolute -right-10 top-4 w-56 text-white/[0.06] pointer-events-none" title="" />
            <span className="relative flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#EBD399]">Next shoot</span>
              <span className="text-xs font-semibold rounded-full px-3 py-2 bg-pt-accent/20 text-[#EBD399]">{inDays(next.date, today)}</span>
            </span>
            <span className="relative block font-display text-[44px] leading-[0.95] font-extrabold tracking-tighter mt-2">{formatDay(next.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span className="relative block text-[17px] font-semibold mt-1">{next.place === 'offsite' ? (next.where || 'Offsite') : s.houses[next.place].name} · {fmtSlot(next.start, next.end - next.start)}</span>
            <span className="relative grid grid-cols-3 gap-2 my-4">
              {step('Time', true, 'Booked', today)}
              {step('Props', !!linked[next.id]?.props, 'Requested', cutoffs(next).props)}
              {step('Gear', !!linked[next.id]?.gear, 'Held', cutoffs(next).gear)}
            </span>
            <span className="relative block w-full text-center rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">
              {next.checkin ? 'Checked in ✓' : win === 'open' ? 'Check in' : 'Open this shoot'}
            </span>
          </button>
        ) : (
          <div className="bg-pt-surface rounded-[28px] p-5 text-center space-y-3">
            <p className="text-pt-text text-lg font-semibold">No shoots booked</p>
            <p className="text-pt-muted text-sm">Book a time at Cliff 1, Cliff 2 or somewhere else, then add props and gear to it.</p>
            <button onClick={() => navigate('/schedule?book=1')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book a shoot</button>
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-2 bg-pt-surface rounded-[14px] pl-4 pr-2 py-2">
          <button onClick={() => navigate('/browse?focus=1')} className="flex-1 flex items-center gap-3 py-2 text-pt-muted text-left min-w-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span className="truncate">Search props, costumes, gear</span>
          </button>
        </div>
        {/* Small on purpose (owner, Oct 19): the ✦ AI button at the top is the main way in. */}
        <button onClick={() => ai.open()} className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF] active:scale-[0.98] transition-transform">
          <span className="text-[#BF9DFF]">✦</span><span className="flex-1 min-w-0 truncate">Ask AI: props for an idea, or a time to film</span><span className="text-pt-muted">›</span>
        </button>
        <NotificationsNudge />
      </div>

      {/* Your usuals */}
      {usuals.length > 0 && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between px-5 mb-3"><h2 className="text-xl font-bold tracking-tight">Your usuals</h2><span className="text-pt-muted text-[13px]">What you book most</span></div>
          <div className="flex gap-3 overflow-x-auto px-5 no-scrollbar">
            {usuals.map(u => (
              <button key={u.key} onClick={() => navigate(u.to)} className="shrink-0 w-32 bg-pt-surface rounded-[18px] overflow-hidden text-left active:opacity-80">
                {u.gear ? <GearArt photo={u.gear.photos?.[0]} category={u.gear.category} className="w-full aspect-square" />
                  : u.photo ? <img src={u.photo} alt="" className="w-full aspect-square object-cover" loading="lazy" /> : <span className="block w-full aspect-square bg-pt-border" />}
                <span className="block px-3 py-2 text-sm font-semibold leading-tight line-clamp-2">{u.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="px-5 mt-6 space-y-6">
        {/* Monthly slots + streak */}
        <div className="grid grid-cols-2 gap-3">
          {!MONTHLY_SLOTS_ON ? (
          <button onClick={() => navigate('/schedule')} className="bg-pt-surface rounded-[20px] p-4 flex flex-col gap-2 text-left">
            <span className="text-xs font-semibold uppercase tracking-wider text-pt-muted">This month</span>
            <span className="font-display text-[30px] leading-none font-extrabold tracking-tight">{monthShoots} 🎬</span>
            <span className="text-pt-muted text-[13px]">{monthShoots === 1 ? 'shoot' : 'shoots'} booked</span>
          </button>
          ) : (
          <button onClick={() => navigate('/schedule')} className="bg-pt-surface rounded-[20px] p-4 flex flex-col gap-2 text-left">
            <span className="text-xs font-semibold uppercase tracking-wider text-pt-muted">Monthly slots</span>
            <span className="font-display text-[30px] leading-none font-extrabold tracking-tight">{monthlyLeft} left</span>
            <span className="flex gap-2">{Array.from({ length: s.monthlySlots }, (_, i) => <i key={i} className={`flex-1 h-2 rounded ${i < monthlyUsed ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</span>
            <span className="text-pt-muted text-[13px]">at {s.houses.cliff1.name} this month</span>
          </button>
          )}
          <div className="bg-pt-surface rounded-[20px] p-4 flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-pt-muted">Streak</span>
            <span className="font-display text-[30px] leading-none font-extrabold tracking-tight">{streak} 🔥</span>
            <span className="text-pt-muted text-[13px]">{streak === 1 ? 'shoot' : 'shoots'} filmed in a row{status?.strikes ? ` · ${status.strikes} strike${status.strikes > 1 ? 's' : ''}` : '. No strikes.'}</span>
          </div>
        </div>

        {/* To do */}
        {todo.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">To do</h2>
            <div className="bg-pt-surface rounded-[20px] divide-y divide-white/[0.06]">
              {todo.map(t => (
                <button key={t.key + t.action} onClick={t.go} className="w-full flex items-center gap-3 px-4 py-4 text-left">
                  <span className="flex-1 text-[15px] leading-snug">{t.text}</span>
                  <span className="shrink-0 text-pt-accent text-sm font-semibold tap">{t.action} ›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Coming up */}
        {upcoming.length > 1 && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">Coming up</h2>
            <div className="bg-pt-surface rounded-[20px] divide-y divide-white/[0.06]">
              {upcoming.slice(1, 12).map(x => (
                <button key={x.id} onClick={() => open(x.id)} className="w-full flex items-center gap-3 px-4 py-4 text-left">
                  <span className="w-12 text-center shrink-0">
                    <span className="block text-[11px] uppercase tracking-wider text-pt-muted">{formatDay(x.date, { weekday: 'short' })}</span>
                    <b className="block font-display text-xl leading-none font-extrabold">{Number(x.date.slice(8))}</b>
                  </span>
                  <span className="flex-1 min-w-0">
                    <b className="block truncate">{x.place === 'offsite' ? (x.where || 'Offsite') : s.houses[x.place].name} · {fmtSlot(x.start, x.end - x.start)}</b>
                    <span className="block text-pt-muted text-[13px]">{[x.kind === 'offsite' ? 'Offsite' : !MONTHLY_SLOTS_ON ? '' : x.kind === 'monthly' ? 'Monthly slot' : 'Extra slot',
                      linked[x.id]?.props ? 'props requested' : '', linked[x.id]?.gear ? 'gear held' : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-pt-muted">›</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {upcoming.length > 0 && (
          <button onClick={() => navigate('/schedule?book=1')} className="w-full rounded-2xl py-4 font-semibold bg-pt-surface text-pt-text">Book another shoot</button>
        )}
      </div>
    </div>
  )
}

function inDays(date: string, today: string) {
  const n = daysBetween(today, date)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}
