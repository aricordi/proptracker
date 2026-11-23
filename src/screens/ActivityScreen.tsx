import { useState } from 'react'
import ActivityList from '../components/ActivityList'
import { useSession } from '../auth'
import { PageHeader } from '../components/PageHeader'

// Everything that happened, newest first: booking steps and prop changes.
export default function ActivityScreen() {
  const { isOwner } = useSession()
  const [kind, setKind] = useState<'all' | 'booking' | 'prop' | 'personal'>('all')
  const tabs = [['all', 'Everything'], ['booking', 'Bookings'], ['prop', 'Prop changes'], ...(isOwner ? [['personal', 'Personal'] as const] : [])] as const
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <PageHeader title="Activity" sub="Booking steps and prop changes, newest first">
        {/* One scrolling row: four tabs wrapped onto two lines on phones. */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`shrink-0 whitespace-nowrap min-h-[40px] inline-flex items-center gap-1 rounded-full px-4 text-[15px] ${kind === k ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="px-4 pb-4">
        {kind === 'personal'
          ? <ActivityList personal kind="prop" />
          : <ActivityList kind={kind === 'all' ? undefined : kind} />}
      </div>
    </div>
  )
}
