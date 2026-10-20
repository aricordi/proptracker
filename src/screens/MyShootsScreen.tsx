// "My shoots" (owner, Oct 20): just your own shoots, soonest first, so you can glance at when you're filming
// and what each one still needs (props, gear), without digging through the schedule.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useMyShoots, useScheduleSettings, checkinWindow, fmtSlot, type Shoot } from '../services/schedule'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { useAssistant } from '../assistant'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { formatDay, whenLabel } from '../lib/dates'
import { PROP_WORDS, GEAR_WORDS } from '../components/ShootNeeds'

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const GONE = ['cancelled', 'declined']

export default function MyShootsScreen() {
  const navigate = useNavigate()
  const { profile } = useSession()
  const s = useScheduleSettings()
  const cutoffs = useCutoffs()
  const { choose } = useActiveShoot()
  const ai = useAssistant()
  const today = todayInStudio()
  const [now, setNow] = useState(nowStamp())
  useEffect(() => { const t = setInterval(() => setNow(nowStamp()), 60_000); return () => clearInterval(t) }, [])
  const shoots = useMyShoots(profile.email, addDays(today, -120))
  const [props, setProps] = useState<Reservation[] | null>(null)
  const [gear, setGear] = useState<GearBooking[] | null>(null)
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, setProps), [profile.email])
  useEffect(() => subscribeToGearBookings(profile.email, setGear), [profile.email])
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  const upcoming = useMemo(() => (shoots ?? []).filter(x => x.to > now), [shoots, now])
  const past = useMemo(() => (shoots ?? []).filter(x => x.to <= now).reverse(), [shoots, now])
  // Upcoming in three groups so the next few days stand out.
  const groups = useMemo(() => {
    const week = addDays(today, 7)
    return [
      { title: 'Today', list: upcoming.filter(x => x.date <= today) },
      { title: 'This week', list: upcoming.filter(x => x.date > today && x.date < week) },
      { title: 'Later', list: upcoming.filter(x => x.date >= week) },
    ].filter(g => g.list.length)
  }, [upcoming, today])

  // What's on each shoot: its props request(s) and gear (yours, or shared with you by a friend).
  const propsFor = (x: Shoot) => (props ?? []).filter(r => !GONE.includes(r.status) && (r.scheduleShootId === x.id || r.shootId === x.id))
  const gearFor = (x: Shoot) => (gear ?? []).filter(g => !GONE.includes(g.status) && (g.scheduleShootId === x.id || g.shootId === x.id || (g.crewShootIds ?? []).includes(x.id)))
  const place = (x: Shoot) => x.place === 'offsite' ? (x.where || 'Offsite') : s.houses[x.place].name
  const open = (x: Shoot) => navigate(`/schedule?shoot=${x.id}`)
  const add = (x: Shoot, to: string) => { choose(x.id); navigate(to) }

  // One prep chip: done (gold ✓ + where it is), still to add (dashed + with the cutoff), or too late.
  const chip = (key: string, label: string, state: string | null, by: string, onAdd: () => void) => {
    if (state) return <span key={key} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs bg-pt-accent/15 text-[#EBD399]"><b>✓</b> {label}: {state}</span>
    if (today > by) return <span key={key} className="inline-flex items-center rounded-full px-3 py-2 text-xs bg-pt-bg text-pt-muted">No {label.toLowerCase()} · too late to add</span>
    return (
      <button key={key} onClick={e => { e.stopPropagation(); onAdd() }}
        className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs text-pt-accent border border-dashed border-pt-accent/60">
        + {label} <span className="text-pt-muted">by {by === today ? 'today' : formatDay(by)}</span>
      </button>
    )
  }

  const card = (x: Shoot, isPast: boolean) => {
    const d = new Date(x.date + 'T12:00:00')
    const p = propsFor(x), g = gearFor(x)
    const cut = cutoffs(x)
    const win = checkinWindow(x, now, s)
    const filmed = x.outcome === 'filmed' || !!x.checkin
    const pastState = x.noShow || x.outcome === 'noshow' ? { text: 'No-show', cls: 'text-red-300' } : filmed ? { text: 'Filmed ✓', cls: 'text-green-300' } : { text: 'Not checked in', cls: 'text-pt-muted' }
    const shared = g.find(b => b.creatorEmail !== profile.email)
    return (
      <div key={x.id} className="bg-pt-surface shadow-card rounded-[20px] p-3 space-y-3">
        <button onClick={() => open(x)} className="w-full flex items-center gap-3 text-left px-1">
          <span className="w-12 shrink-0 text-center">
            <span className="block text-xs font-semibold text-pt-accent">{WEEKDAY[d.getDay()]}</span>
            <span className="block text-[22px] font-bold leading-none text-pt-text">{d.getDate()}</span>
            <span className="block text-xs text-pt-muted">{formatDay(x.date, { month: 'short' })}</span>
          </span>
          <span className="flex-1 min-w-0">
            <b className="block text-pt-text text-[16px] truncate">{place(x)} · {fmtSlot(x.start, x.end - x.start)}</b>
            <span className={`block text-[13px] ${isPast ? pastState.cls : x.date === today ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>
              {isPast ? pastState.text : x.checkin ? 'Checked in ✓' : whenLabel(x.date, today)}
              {!isPast && p[0]?.title ? <span className="text-pt-muted font-normal"> · {p[0].title}</span> : !isPast && g[0]?.title ? <span className="text-pt-muted font-normal"> · {g[0].title}</span> : null}
            </span>
          </span>
          <span className="text-pt-muted">›</span>
        </button>
        {!isPast && !p.length && !g.length && today > cut.props && today > cut.gear ? (
          <p className="px-1 text-pt-muted text-xs">No props or gear · too late to add now</p>
        ) : !isPast && (
          <div className="flex flex-wrap gap-2 px-1">
            {chip('p', 'Props', p.length ? (PROP_WORDS[p[0].status] ?? p[0].status) : null, cut.props, () => add(x, '/browse'))}
            {chip('g', 'Gear', g.length ? (GEAR_WORDS[g[0].status] ?? g[0].status) + (shared ? ` · ${(shared.creatorName ?? '').split(' ')[0]}'s` : '') : null, cut.gear, () => add(x, '/gear'))}
          </div>
        )}
        {!isPast && x.date === today && !x.checkin && win === 'open' && (
          <button onClick={() => open(x)} className="w-full rounded-xl py-3 font-semibold text-stone-900 bg-pt-accent shadow-gold">Check in</button>
        )}
        {!isPast && x.date !== today && !p.length && !g.length && ai.available && today <= cut.gear && (
          <button onClick={() => ai.open('plan', x.id)} className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF]">
            <span className="text-[#BF9DFF]">✦</span><span className="flex-1">Plan props and gear with AI</span><span className="text-pt-muted">›</span>
          </button>
        )}
      </div>
    )
  }

  const loading = shoots === null
  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] py-1">‹ Back</button>
        <h1 className="font-display text-[34px] text-pt-text py-1">My shoots</h1>
        <div className="flex gap-2">
          {(['upcoming', 'past'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-sm ${tab === t ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
              {t === 'upcoming' ? `Coming up${upcoming.length ? ` (${upcoming.length})` : ''}` : 'Past'}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 space-y-6">
        {loading && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {!loading && tab === 'upcoming' && (upcoming.length === 0 ? (
          <div className="text-center mt-12 space-y-3">
            <p className="text-pt-muted text-sm">No shoots coming up.</p>
            <button onClick={() => navigate('/schedule?book=1')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book a shoot</button>
          </div>
        ) : (
          <>
            {groups.map(gr => (
              <section key={gr.title} className="space-y-2">
                <h2 className="text-pt-text text-lg font-semibold">{gr.title}</h2>
                {gr.list.map(x => card(x, false))}
              </section>
            ))}
            <button onClick={() => navigate('/schedule?book=1')} className="w-full rounded-2xl py-4 font-semibold bg-pt-surface text-pt-text">Book another shoot</button>
          </>
        ))}
        {!loading && tab === 'past' && (past.length === 0
          ? <p className="text-pt-muted text-sm text-center mt-12">No past shoots in the last 4 months.</p>
          : <section className="space-y-2">{past.map(x => card(x, true))}</section>)}
      </div>
    </div>
  )
}
