import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useReturnGroups, findReturnGroup, returnCount } from '../hooks/useReturnables'

// On a props request or gear booking that's out: if the same shoot has more to bring back, offer to return it all at once.
export default function ReturnTogether({ kind, id }: { kind: 'props' | 'gear'; id: string }) {
  const navigate = useNavigate()
  const { profile } = useSession()
  const groups = useReturnGroups(profile.email)
  const g = groups && findReturnGroup(groups, `${kind}:${id}`)
  if (!g || returnCount(g) < 2) return null
  const other = kind === 'props' ? 'gear' : 'props'
  return (
    <button onClick={() => navigate(`/return?ref=${kind}:${id}`)} className="w-full flex items-center gap-3 bg-pt-accent/10 rounded-2xl px-4 py-3 text-left">
      <span className="flex-1 min-w-0">
        <b className="block text-pt-text text-[15px]">Bringing the {other} back too?</b>
        <span className="block text-pt-muted text-sm">Return everything for this shoot in one go, with one photo.</span>
      </span>
      <span className="text-pt-accent font-semibold text-sm shrink-0">Return all ›</span>
    </button>
  )
}
