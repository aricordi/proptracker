import AiButton from '../components/AiButton'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import CreatorDashboard from '../components/CreatorDashboard'
import { TeamMenu, DailyTiles, FoldableBlock, OWNER_DAILY, teamMenu, type MenuWho } from '../components/TeamMenu'

// Team (owner) / Dashboard (admins) / Admin (arts + equipment). Owner, Oct 23: the old single long list was too busy,
// so tools are now grouped (src/components/TeamMenu.tsx). The owner gets big every-day tiles first, the creator
// scoreboard folded under one header, and folding groups; the other roles' lists are short and stay open.
export default function AdminScreen() {
  const navigate = useNavigate()
  const { isOwner, isAdmin, shootFlow, role, canManagePeople } = useSession()
  const who: MenuWho = role === 'equipment' ? 'equipment' : isAdmin ? 'admin' : isOwner ? 'owner' : 'arts'
  const owner = who === 'owner'

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><span className="flex-1">{shootFlow ? 'Team' : isAdmin ? 'Dashboard' : 'Admin'}</span><AiButton /></h1>
      </div>
      <div className="px-4 pb-8 space-y-6">
        {owner && <DailyTiles items={OWNER_DAILY} onOpen={to => navigate(to)} />}
        {/* Admins: the scoreboard IS their home. Owner: folded away under one header, open it when wanted. */}
        {canManagePeople && (owner
          ? <FoldableBlock id="scoreboard" title="Creator scoreboard" icon="chart"><CreatorDashboard /></FoldableBlock>
          : <CreatorDashboard />)}
        <TeamMenu groups={teamMenu(who)} onOpen={to => navigate(to)} foldable={owner} />
      </div>
    </div>
  )
}
