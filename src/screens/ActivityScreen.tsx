import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ActivityList from '../components/ActivityList'

// Everything that happened, newest first: booking steps and prop changes.
export default function ActivityScreen() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<'all' | 'booking' | 'prop'>('all')
  const tabs = [['all', 'Everything'], ['booking', 'Bookings'], ['prop', 'Prop changes']] as const
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
          <h1 className="font-display text-xl text-pt-text">Activity</h1>
        </div>
        <div className="flex gap-2">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-full text-sm ${kind === k ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <ActivityList kind={kind === 'all' ? undefined : kind}  />
      </div>
    </div>
  )
}
