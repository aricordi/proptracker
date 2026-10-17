// Creators' home: the next shoot (check in from here), things to do, and what's coming up.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import BrandMark from '../components/BrandMark'
import LateBanner from '../components/LateBanner'
import { Pill } from '../components/GearUi'
import { useMyLateBookings } from '../hooks/useLateBookings'
import { useActiveShoot, useShootLabel, useCutoffs } from '../activeShoot'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { formatDay } from '../lib/dates'
import { useScheduleSettings, useMyShoots, useMySwaps, useMyStatus, checkinWindow, isMissed, explainUntil, type Shoot } from '../services/schedule'

const TODO_DAYS = 21   // remind about props/gear for shoots in the next 3 weeks

export default function CreatorHomeScreen() {
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const s = useScheduleSettings()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const { upcoming, choose } = useActiveShoot()
  const today = todayInStudio()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const recent = useMyShoots(profile.email, addDays(today, -1))
  const swaps = useMySwaps(profile.email)
  const status = useMyStatus(profile.email)
  const late = useMyLateBookings()
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, setProps), [profile.email])
  useEffect(() => subscribeToGearBookings(profile.email, setGear), [profile.email])

  // How many props / gear requests (not cancelled) each shoot has.
  const linked = useMemo(() => {
    const m: Record<string, { props: number; gear: number }> = {}
    for (const r of props) if (r.shootId && !['cancelled', 'declined'].includes(r.status)) (m[r.shootId] ??= { props: 0, gear: 0 }).props++
    for (const g of gear) if (g.shootId && !['cancelled', 'declined'].includes(g.status)) (m[g.shootId] ??= { props: 0, gear: 0 }).gear++
    return m
  }, [props, gear])

  const next = upcoming[0] as Shoot | undefined
  const win = next ? checkinWindow(next, now, s) : 'early'
  const toExplain = (recent ?? []).filter(x => isMissed(x, now) && now < explainUntil(x, s))
  const needsStuff = upcoming.filter(x => x.date <= addDays(today, TODO_DAYS) && !linked[x.id] && today <= cutoffs(x).gear)
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const open = (id: string) => navigate(`/schedule?shoot=${id}`)
  const first = (profile.name || user.displayName || '').split(' ')[0]

  const todo: { key: string; text: string; action: string; go: () => void }[] = [
    ...swaps.incoming.map(r => ({ key: r.id, text: `${r.fromName} asks to swap shoots with you`, action: 'Answer', go: () => navigate('/schedule') })),
    ...toExplain.map(x => ({ key: x.id, text: `You didn't check in for ${label(x)}. Say what happened.`, action: 'Explain', go: () => open(x.id) })),
    ...needsStuff.map(x => ({ key: x.id, text: `Props or gear for ${label(x)}? Props by ${formatDay(cutoffs(x).props)}, gear by ${formatDay(cutoffs(x).gear)}.`,
      action: 'Add', go: () => { choose(x.id); navigate('/browse') } })),
  ]

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-3xl text-pt-text py-2 flex items-center gap-2.5"><BrandMark className="w-10 text-pt-text" title="" />{first ? `Hi, ${first}` : 'Home'}</h1>
      </div>
      <div className="p-4 space-y-5">
        {paused && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 text-sm text-pt-text">
            <p className="text-red-300 font-semibold mb-1">Props and gear are paused until {formatDay(status!.pausedUntil!)}</p>
            Because of {status!.strikes} strikes (no-shows or reports). You can still book house time. Ask the schedule team if you think this is wrong.
          </div>
        )}
        <LateBanner late={late} />

        {/* Next shoot */}
        {next ? (
          <button onClick={() => open(next.id)} className="w-full text-left bg-gradient-to-br from-[#2a2416] to-pt-surface border border-pt-accent/40 rounded-2xl p-4 space-y-2 active:opacity-80">
            <p className="text-pt-accent text-xs uppercase tracking-wider">Your next shoot</p>
            <p className="text-pt-text text-xl font-semibold leading-tight">{label(next)}</p>
            <div className="flex gap-1.5 flex-wrap">
              {next.checkin ? <Pill tone="free">Checked in</Pill> : win === 'open' ? <Pill tone="warn">Check in now</Pill> : null}
              {linked[next.id]?.props ? <Pill tone="muted">Props ✓</Pill> : null}
              {linked[next.id]?.gear ? <Pill tone="muted">Gear ✓</Pill> : null}
            </div>
            {win === 'open' && !next.checkin && <span className="block w-full text-center bg-pt-accent text-stone-900 font-semibold rounded-xl py-2.5 mt-1">Check in</span>}
          </button>
        ) : (
          <div className="bg-pt-surface rounded-2xl p-4 text-center space-y-3">
            <p className="text-pt-text font-semibold">No shoots booked</p>
            <p className="text-pt-muted text-sm">Book a time at Cliff 1, Cliff 2 or somewhere else, then add props and gear to it.</p>
          </div>
        )}
        <button onClick={() => navigate('/schedule?book=1')} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3">Book a shoot</button>

        {/* To do */}
        {todo.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-pt-text text-xl font-semibold tracking-tight">To do</h2>
            <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
              {todo.map(t => (
                <button key={t.key + t.action} onClick={t.go} className="w-full flex items-center gap-3 px-3 py-3 text-left">
                  <span className="flex-1 text-pt-text text-[15px] leading-snug">{t.text}</span>
                  <span className="shrink-0 text-pt-accent text-sm font-medium">{t.action} ›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Coming up */}
        {upcoming.length > 1 && (
          <section className="space-y-2">
            <h2 className="text-pt-text text-xl font-semibold tracking-tight">Coming up</h2>
            <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
              {upcoming.slice(1, 12).map(x => (
                <button key={x.id} onClick={() => open(x.id)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
                  <span className="flex-1 min-w-0">
                    <span className="block text-pt-text text-[15px] truncate">{label(x)}</span>
                    <span className="block text-pt-muted text-xs">{[x.kind === 'monthly' ? 'Monthly slot' : x.kind === 'offsite' ? 'Offsite' : 'Extra slot',
                      linked[x.id]?.props && `${linked[x.id].props} props request${linked[x.id].props > 1 ? 's' : ''}`, linked[x.id]?.gear && 'gear'].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-pt-muted">›</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
