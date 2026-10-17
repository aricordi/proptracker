// On a shoot: the props and gear booked for it, each team's cutoff, and "Add" buttons
// that open Browse with this shoot picked.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import type { Shoot } from '../services/schedule'

interface Linked { id: string; title: string; status: string; count: number; kind: 'props' | 'gear' }

const PROP_WORDS: Record<string, string> = {
  requested: 'Requested', preparing: 'Being prepared', packed: 'Packed & ready', collected: 'Picked up',
  return_pending: 'Returned, being checked', returned: 'Returned', declined: 'Declined', cancelled: 'Cancelled',
}
const GEAR_WORDS: Record<string, string> = {
  held: 'Held', out: 'Picked up', returned: 'Returned', checked_in: 'Checked in', declined: 'Declined', cancelled: 'Cancelled',
}

const PROP_STEPS = ['requested', 'preparing', 'packed', 'collected', 'returned']
const GEAR_STEPS = ['held', 'out', 'returned', 'checked_in']

// Live list of this shoot's props and gear bookings (yours; the team sees gear).
function useLinked(shoot: Shoot, props: boolean, gear: boolean) {
  const [p, setP] = useState<Linked[]>([])
  const [g, setG] = useState<Linked[]>([])
  useEffect(() => {
    if (!props) return
    return onSnapshot(query(collection(db, 'reservations'), where('shootId', '==', shoot.id), where('creatorEmail', '==', shoot.creatorEmail)),
      snap => setP(snap.docs.map(d => ({ id: d.id, kind: 'props', title: d.get('title'), status: d.get('status'),
        count: (d.get('lines') ?? []).length + (d.get('builds') ?? []).length }))), () => setP([]))
  }, [shoot.id, shoot.creatorEmail, props])
  useEffect(() => {
    if (!gear) return
    return onSnapshot(query(collection(db, 'gear_bookings'), where('shootId', '==', shoot.id), where('creatorEmail', '==', shoot.creatorEmail)),
      snap => setG(snap.docs.map(d => ({ id: d.id, kind: 'gear', title: d.get('title'), status: d.get('status'), count: (d.get('lines') ?? []).length }))), () => setG([]))
  }, [shoot.id, shoot.creatorEmail, gear])
  return { props: p, gear: g }
}

export default function ShootNeeds({ shoot, mine, team }: { shoot: Shoot; mine: boolean; team: boolean }) {
  const navigate = useNavigate()
  const { choose } = useActiveShoot()
  const cut = useCutoffs()(shoot)
  const today = todayInStudio()
  const linked = useLinked(shoot, mine, mine || team)
  const open = shoot.status === 'booked'
  function add(to: string) { choose(shoot.id); navigate(to) }

  const section = (kind: 'props' | 'gear', title: string, by: string, list: Linked[], to: string, extra?: string) => (
    <div className="bg-pt-bg rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-pt-text font-semibold">{title}</p>
          <p className="text-pt-muted text-xs">
            {today > by ? `Cutoff passed (${formatDay(by)})` : `Add by ${formatDay(by)}`}{extra ? ` · ${extra}` : ''}
          </p>
        </div>
        {mine && open && today <= by && (
          <button onClick={() => add(to)} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-1.5 text-sm">+ Add</button>
        )}
      </div>
      {list.map(l => {
        const steps = kind === 'props' ? PROP_STEPS : GEAR_STEPS
        const at = steps.indexOf(l.status === 'return_pending' ? 'returned' : l.status)
        const over = ['cancelled', 'declined'].includes(l.status)
        return (
          <button key={l.id} onClick={() => navigate(kind === 'props' ? `/reservations/${l.id}` : `/gear/bookings/${l.id}`)}
            className="w-full bg-pt-surface rounded-lg px-3 py-2.5 text-left space-y-2">
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-pt-text text-sm">{l.title} · {l.count} {kind === 'props' ? (l.count === 1 ? 'prop' : 'props') : 'item' + (l.count === 1 ? '' : 's')}</span>
              <span className={`shrink-0 text-xs ${over ? 'text-pt-muted' : 'text-pt-accent'}`}>{(kind === 'props' ? PROP_WORDS : GEAR_WORDS)[l.status] ?? l.status} ›</span>
            </span>
            {!over && <span className="flex gap-1">{steps.map((_, i) => <i key={i} className={`flex-1 h-1.5 rounded-full ${i <= at ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</span>}
            {!over && (l.status === 'requested' || l.status === 'held') && <span className="block text-pt-muted text-xs">{kind === 'props' ? 'Tap to change it, until the arts team starts.' : 'Tap to change it, until you pick it up.'}</span>}
          </button>
        )
      })}
      {list.length === 0 && <p className="text-pt-muted text-xs">Nothing yet.</p>}
    </div>
  )

  if (!mine && !team) return null
  return (
    <div className="space-y-2">
      <p className="text-pt-muted text-xs uppercase tracking-wider">For this shoot</p>
      {mine && section('props', 'Props & costumes', cut.props, linked.props, '/browse', `new props by ${formatDay(cut.builds)}`)}
      {section('gear', 'Gear', cut.gear, linked.gear, '/gear')}
      <p className="text-pt-muted text-xs px-1">Casting, locations and makeup come later.</p>
    </div>
  )
}
