import AiButton from '../components/AiButton'
import { useDesk } from '../desk/desk'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useBugReport } from '../components/BugReport'
import CreatorDashboard from '../components/CreatorDashboard'
import { TeamMenu, DailyTiles, FoldableBlock, OWNER_DAILY, teamMenu, type MenuWho } from '../components/TeamMenu'
import { useItems } from '../hooks/useItems'
import { cleanupCounts } from '../lib/cleanup'
import { useMemo } from 'react'

// Team (owner) / Dashboard (admins) / Admin (arts + equipment). Owner, Oct 23: the old single long list was too busy,
// so tools are now grouped (src/components/TeamMenu.tsx). The owner gets big every-day tiles first, the creator
// scoreboard folded under one header, and folding groups; the other roles' lists are short and stay open.
export default function AdminScreen() {
  const navigate = useNavigate()
  const { isOwner, isAdmin, shootFlow, role, canManagePeople } = useSession()
  const who: MenuWho = role === 'equipment' ? 'equipment' : isAdmin ? 'admin' : isOwner ? 'owner' : 'arts'
  const owner = who === 'owner'
  const desk = useDesk().on
  const bug = useBugReport()
  const open = (to: string) => to === '#report' ? bug.start() : navigate(to)

  // Laptop (owner, Nov 3): the scoreboard gets the room, the tools sit in a column on the right.
  if (desk) return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg z-10 px-8 pt-6 pb-3 flex items-center gap-3">
        <h1 className="font-display text-[34px] text-pt-text flex-1">{shootFlow ? 'Team' : isAdmin ? 'Dashboard' : 'Admin'}</h1><AiButton />
      </div>
      <div className="px-8 pb-8 space-y-8">
        {owner && <DailyTiles items={OWNER_DAILY} onOpen={open} />}
        {(who === 'arts' || owner) && <CleanupCard onOpen={() => navigate('/cleanup')} />}
        {canManagePeople && <CreatorDashboard />}
        {/* The tools, in columns underneath. */}
        <div className="columns-3 gap-6 [&_section]:break-inside-avoid [&_section]:mb-4"><TeamMenu groups={teamMenu(who)} onOpen={open} /></div>
      </div>
    </div>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><span className="flex-1">{shootFlow ? 'Team' : isAdmin ? 'Dashboard' : 'Admin'}</span><AiButton /></h1>
      </div>
      <div className="px-4 pb-8 space-y-6">
        {owner && <DailyTiles items={OWNER_DAILY} onOpen={open} />}
        {(who === 'arts' || owner) && <CleanupCard onOpen={() => navigate('/cleanup')} />}
        {/* Admins: the scoreboard IS their home. Owner: folded away under one header, open it when wanted. */}
        {canManagePeople && (owner
          ? <FoldableBlock id="scoreboard" title="Creator scoreboard" icon="chart"><CreatorDashboard /></FoldableBlock>
          : <CreatorDashboard />)}
        <TeamMenu groups={teamMenu(who)} onOpen={open} foldable={owner} />
      </div>
    </div>
  )
}

// The crew's big job after the photo imports (owner, Nov 6): one card at the top of their Admin page, until it's done.
function CleanupCard({ onOpen }: { onOpen: () => void }) {
  const items = useItems()
  const c = useMemo(() => cleanupCounts(items), [items])
  if (!c.total) return null
  const pct = Math.round((c.checked / c.total) * 100)
  return (
    <button onClick={onOpen} className="w-full text-left rounded-[24px] bg-pt-accent text-stone-900 p-4 shadow-gold active:scale-[0.99] transition-transform">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[20px] font-bold">Clean up props</span>
        <span className="text-[14px] font-semibold opacity-80">{c.todo ? `${c.todo.toLocaleString()} to check` : 'All checked ✓'}</span>
      </span>
      <span className="block text-[16px] opacity-90 mt-0.5">Fix names, counts and bins. Remove junk and doubles.</span>
      <span className="block mt-3 h-2 rounded-full bg-stone-900/20 overflow-hidden"><span className="block h-full bg-stone-900" style={{ width: `${pct}%` }} /></span>
    </button>
  )
}
