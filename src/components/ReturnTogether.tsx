import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useReturnGroups, findReturnGroup, returnCount, canReturnGear, canReturnProps } from '../hooks/useReturnables'

// On a props request or gear booking that's out: if the same shoot has more to bring back, offer to return it all at once.
export default function ReturnTogether({ kind, id }: { kind: 'props' | 'gear'; id: string }) {
  const navigate = useNavigate()
  const { profile } = useSession()
  const groups = useReturnGroups(profile.email)
  const g = groups && findReturnGroup(groups, `${kind}:${id}`)
  if (!g || returnCount(g) < 2) return null
  // Word it from what else is out for this shoot (a second props request is common: "+ Add more" makes a new one).
  const gearOut = g.gear.filter(canReturnGear).filter(b => !(kind === 'gear' && b.id === id)).length
  const propsOut = g.props.filter(canReturnProps).filter(r => !(kind === 'props' && r.id === id)).length
  const ask = gearOut && propsOut ? 'Bringing the rest back too?' : gearOut ? 'Bringing the gear back too?'
    : kind === 'gear' ? 'Bringing the props back too?' : `You have ${propsOut + 1} props requests for this shoot. Return them together?`
  return (
    <button onClick={() => navigate(`/return?ref=${encodeURIComponent(g.key)}`)} className="w-full flex items-center gap-3 bg-pt-accent/10 rounded-2xl px-4 py-3 text-left">
      <span className="flex-1 min-w-0">
        <b className="block text-pt-text text-[15px]">{ask}</b>
        <span className="block text-pt-muted text-sm">Return everything for this shoot in one go, with one photo.</span>
      </span>
      <span className="text-pt-accent font-semibold text-sm shrink-0">Return all ›</span>
    </button>
  )
}
