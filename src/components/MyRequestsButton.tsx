// "My requests" where creators actually look (owner, Oct 20: "shouldn't live buried in the Me tab"): a round button
// right of the ✦ AI button on Schedule and Browse, and a row on Home. The gold dot counts requests still in progress.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToReservations } from '../services/reservations'
import { subscribeToGearBookings } from '../services/gear'
import { Icon } from './Icon'

const DONE = ['returned', 'checked_in', 'cancelled', 'declined']

export function useOpenRequestCount() {
  const { profile } = useSession()
  const [props, setProps] = useState(0), [gear, setGear] = useState(0)
  useEffect(() => subscribeToReservations({ email: profile.email, all: false }, l => setProps(l.filter(r => !DONE.includes(r.status)).length)), [profile.email])
  useEffect(() => subscribeToGearBookings(profile.email, l => setGear(l.filter(b => !DONE.includes(b.status)).length)), [profile.email])
  return props + gear
}

export default function MyRequestsButton({ target }: { target?: Record<string, string> }) {
  const navigate = useNavigate()
  const { canBook } = useSession()
  const n = useOpenRequestCount()
  if (!canBook) return null
  return (
    <button {...target} onClick={() => navigate('/requests')} aria-label={`My requests${n ? ` (${n} in progress)` : ''}`} title="My requests"
      className="relative shrink-0 w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-text">
      <Icon name="box" className="w-5 h-5" />
      {n > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-pt-accent text-stone-900 text-xs font-bold grid place-items-center tabular-nums">{n}</span>}
    </button>
  )
}

// Home: the same, as a full-width row.
export function MyRequestsRow() {
  const navigate = useNavigate()
  const n = useOpenRequestCount()
  return (
    <button onClick={() => navigate('/requests')} className="w-full flex items-center gap-3 bg-pt-surface shadow-hairline rounded-2xl px-4 py-3 text-left">
      <span className="w-10 h-10 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent shrink-0"><Icon name="box" className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0"><b className="block text-pt-text text-[15px]">My requests</b>
        <span className="block text-pt-muted text-xs">{n ? `${n} in progress · props and gear for each shoot` : 'Props and gear for each shoot, and where they are'}</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )
}
