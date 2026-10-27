// On a shoot: the props and gear booked for it, each team's cutoff, and "Add" buttons
// that open Browse with this shoot picked.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { useAssistant } from '../assistant'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import type { Shoot } from '../services/schedule'
import UnsentBasket from './UnsentBasket'

export interface Linked { id: string; title: string; status: string; count: number; kind: 'props' | 'gear'; sharedBy?: string; sharedWith?: string }

export const PROP_WORDS: Record<string, string> = {
  requested: 'Requested', preparing: 'Being prepared', packed: 'Packed & ready', collected: 'Picked up',
  return_pending: 'Returned, being checked', returned: 'Returned', declined: 'Declined', cancelled: 'Cancelled',
}
export const GEAR_WORDS: Record<string, string> = {
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
      snap => setG(snap.docs.map(d => ({ id: d.id, kind: 'gear', title: d.get('title'), status: d.get('status'), count: (d.get('lines') ?? []).length,
        sharedWith: firstNames(d.get('crew')) }))), () => setG([]))
  }, [shoot.id, shoot.creatorEmail, gear])
  // Gear a friend booked for your back-to-back shoots (shared: any of you can pick it up and return it).
  const [sg, setSG] = useState<Linked[]>([])
  useEffect(() => {
    if (!gear) return
    return onSnapshot(query(collection(db, 'gear_bookings'), where('crewEmails', 'array-contains', shoot.creatorEmail)),
      snap => setSG(snap.docs.filter(d => ((d.get('crewShootIds') ?? []) as string[]).includes(shoot.id))
        .map(d => ({ id: d.id, kind: 'gear', title: d.get('title'), status: d.get('status'), count: (d.get('lines') ?? []).length,
          sharedBy: String(d.get('creatorName') ?? '').split(' ')[0] }))), () => setSG([]))
  }, [shoot.id, shoot.creatorEmail, gear])
  return { props: p, gear: [...g, ...sg] }
}

const firstNames = (crew: unknown) => Array.isArray(crew) && crew.length ? crew.map((c: { name?: string }) => String(c?.name ?? '').split(' ')[0]).join(', ') : undefined

// One props request or gear booking with its progress bar; tap opens it. Also used by My requests.
export function RequestRow({ l, label, late, className = 'bg-pt-surface', onOpen }: { l: Linked; label?: string; late?: boolean; className?: string; onOpen?: () => void }) {
  const navigate = useNavigate()
  const kind = l.kind
  const steps = kind === 'props' ? PROP_STEPS : GEAR_STEPS
  const at = steps.indexOf(l.status === 'return_pending' ? 'returned' : l.status)
  const over = ['cancelled', 'declined'].includes(l.status)
  return (
    <button onClick={onOpen ?? (() => navigate(kind === 'props' ? `/reservations/${l.id}` : `/gear/bookings/${l.id}`))}
      className={`w-full ${className} rounded-lg px-3 py-3 text-left space-y-2`}>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-pt-text text-sm">{label ?? l.title} · {l.count} {kind === 'props' ? (l.count === 1 ? 'prop' : 'props') : 'item' + (l.count === 1 ? '' : 's')}</span>
        <span className={`shrink-0 text-xs ${late ? 'text-red-300 font-semibold' : over ? 'text-pt-muted' : 'text-pt-accent'} tap`}>{late ? 'Late · bring it back' : (kind === 'props' ? PROP_WORDS : GEAR_WORDS)[l.status] ?? l.status} ›</span>
      </span>
      {!over && <span className="flex gap-1">{steps.map((_, i) => <i key={i} className={`flex-1 h-1.5 rounded-full ${late && i === at ? 'bg-red-400' : i <= at ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</span>}
      {(l.sharedBy || l.sharedWith) && <span className="block text-sky-300 text-xs">{l.sharedBy ? `Shared by ${l.sharedBy} · any of you can pick it up` : `Shared with ${l.sharedWith}`}</span>}
      {!over && !l.sharedBy && (l.status === 'requested' || l.status === 'held') && <span className="block text-pt-muted text-xs">{kind === 'props' ? 'Tap to change it, until the arts team starts.' : 'Tap to change it, until you pick it up.'}</span>}
    </button>
  )
}

export default function ShootNeeds({ shoot, mine, team }: { shoot: Shoot; mine: boolean; team: boolean }) {
  const navigate = useNavigate()
  const { choose } = useActiveShoot()
  const ai = useAssistant()
  const cut = useCutoffs()(shoot)
  const today = todayInStudio()
  const linked = useLinked(shoot, mine, mine || team)
  const open = shoot.status === 'booked'
  function add(to: string) { choose(shoot.id); navigate(to) }

  const section = (_kind: 'props' | 'gear', title: string, by: string, list: Linked[], to: string, extra?: string) => (
    <div className="bg-pt-bg rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-pt-text font-semibold">{title}</p>
          <p className="text-pt-muted text-xs">
            {today > by ? `Cutoff passed (${formatDay(by)})` : `Add by ${formatDay(by)}`}{extra ? ` · ${extra}` : ''}
          </p>
        </div>
        {mine && open && today <= by && (
          <button onClick={() => add(to)} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm">+ Add</button>
        )}
      </div>
      {list.map(l => <RequestRow key={l.id} l={l} />)}
      {list.length === 0 && <p className="text-pt-muted text-xs">Nothing yet.</p>}
    </div>
  )

  if (!mine && !team) return null
  return (
    <div className="space-y-2">
      <p className="text-pt-muted text-xs">For this shoot</p>
      {mine && <UnsentBasket shootId={shoot.id} />}
      {mine && open && ai.available && today <= cut.gear && (
        <button onClick={() => ai.open('plan', shoot.id)} className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left bg-[#BF9DFF]/[0.09] shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)]">
          <span className="w-9 h-9 rounded-xl grid place-items-center bg-[#BF9DFF]/20 text-[#BF9DFF] shrink-0">✦</span>
          <span className="flex-1 min-w-0"><b className="block text-sm text-pt-text">Plan it with AI</b><span className="text-pt-muted text-xs">Props for your idea and the gear that's free, then you check it</span></span>
          <span className="text-pt-muted">›</span>
        </button>
      )}
      {mine && section('props', 'Props & costumes', cut.props, linked.props, '/browse', `new props by ${formatDay(cut.builds)}`)}
      {section('gear', 'Gear', cut.gear, linked.gear, '/gear')}
      <p className="text-pt-muted text-xs px-1">Casting, locations and makeup come later.</p>
    </div>
  )
}
