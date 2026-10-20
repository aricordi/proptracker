// "My requests" (owner, Oct 20): every props request and gear booking you've made, lumped by shoot.
// Each shoot shows its props and gear with where they are; tap one to open it, or add more before the cutoff.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useMyShoots, type Shoot } from '../services/schedule'
import { useActiveShoot, useCutoffs, useShootLabel } from '../activeShoot'
import { useBookingSettings } from '../hooks/useBookings'
import { todayInStudio, addDays, isLate } from '../../functions/src/booking'
import { fmtTime, isGearLate, nowStamp } from '../../functions/src/gearBooking'
import { formatDay } from '../lib/dates'
import { groupByShoot, type RequestGroup } from '../lib/requestGroups'
import { RequestRow } from '../components/ShootNeeds'
import { returnCount } from '../hooks/useReturnables'

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export default function MyRequestsScreen() {
  const navigate = useNavigate()
  const { profile } = useSession()
  const { choose } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const settings = useBookingSettings()
  const today = todayInStudio()
  const shoots = useMyShoots(profile.email, addDays(today, -365))
  const [props, setProps] = useState<Reservation[] | null>(null)
  const [gear, setGear] = useState<GearBooking[] | null>(null)
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, setProps), [profile.email])
  useEffect(() => subscribeToGearBookings(profile.email, setGear), [profile.email])
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const groups = useMemo(() => groupByShoot(props ?? [], gear ?? [], shoots ?? [], today), [props, gear, shoots, today])
  const loading = props === null || gear === null || shoots === null
  const shown = groups[tab]
  const now = nowStamp()

  const card = (g: RequestGroup<Reservation, GearBooking, Shoot>) => {
    const d = new Date(g.date + 'T12:00:00')
    const names = [...new Set([...g.props.map(p => p.title), ...g.gear.map(x => x.title)].filter(Boolean))]
    const sh = g.shoot
    const cut = sh ? cutoffs(sh) : null
    const canAdd = !!sh && sh.status === 'booked' && !!cut && today <= cut.gear
    return (
      <div key={g.key} className="bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
        <button onClick={() => sh && navigate(`/schedule?shoot=${sh.id}`)} disabled={!sh} className="w-full flex items-center gap-3 text-left px-1">
          <span className="w-12 shrink-0 text-center">
            <span className="block text-xs font-semibold text-pt-accent">{WEEKDAY[d.getDay()]}</span>
            <span className="block text-[22px] font-bold leading-none text-pt-text">{d.getDate()}</span>
          </span>
          <span className="flex-1 min-w-0">
            <b className="block text-pt-text text-[15px] truncate">{sh ? label(sh) : `${formatDay(g.date)} · shoot day`}</b>
            <span className="block text-pt-muted text-xs truncate">{names.join(' · ') || 'Your shoot'}</span>
          </span>
          {sh && <span className="text-pt-muted">›</span>}
        </button>
        {g.props.map(r => (
          <RequestRow key={r.id} className="bg-pt-bg" label="Props & costumes" late={isLate(r.status, r.endDate, settings)}
            l={{ id: r.id, kind: 'props', title: r.title, status: r.status, count: r.lines.length + (r.builds ?? []).length }} />
        ))}
        {g.gear.map(b => (
          <RequestRow key={b.id} className="bg-pt-bg" label={`Gear · ${fmtTime(b.start)}–${fmtTime(b.end)}`} late={isGearLate(b, now)}
            l={{ id: b.id, kind: 'gear', title: b.title, status: b.status, count: b.lines.length }} />
        ))}
        {returnCount(g) > 0 && (
          <button onClick={() => navigate(`/return?ref=${encodeURIComponent(g.key)}`)} className="w-full rounded-lg py-3 text-sm font-semibold text-stone-900 bg-pt-accent shadow-gold">
            {returnCount(g) > 1 ? 'Return everything' : 'Return it'}
          </button>
        )}
        {canAdd && (
          <button onClick={() => { choose(sh!.id); navigate('/browse') }} className="w-full rounded-lg py-3 text-sm font-semibold text-pt-accent bg-pt-accent/10">
            + Add props or gear <span className="font-normal text-pt-muted">· {cut!.props === cut!.gear ? `by ${formatDay(cut!.gear)}` : `${today <= cut!.props ? `props by ${formatDay(cut!.props)}, ` : ''}gear by ${formatDay(cut!.gear)}`}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] py-1">‹ Back</button>
        <h1 className="font-display text-[34px] text-pt-text py-1">My requests</h1>
        <div className="flex gap-2">
          {(['upcoming', 'past'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-sm ${tab === t ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
              {t === 'upcoming' ? `Upcoming${groups.upcoming.length ? ` (${groups.upcoming.length})` : ''}` : 'Past'}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 space-y-3">
        {loading && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {!loading && shown.length === 0 && (
          <div className="text-center mt-12 space-y-3">
            <p className="text-pt-muted text-sm">{tab === 'upcoming' ? 'No props or gear requested for an upcoming shoot.' : 'Nothing here yet.'}</p>
            {tab === 'upcoming' && <button onClick={() => navigate('/browse')} className="text-pt-accent text-sm font-medium tap">Browse props &amp; gear</button>}
          </div>
        )}
        {!loading && shown.map(card)}
      </div>
    </div>
  )
}
