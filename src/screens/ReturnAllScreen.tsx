// "Return everything" (owner, Oct 20: props and gear usually come back together, but you can still return them
// separately). One screen for a shoot: tick what you're bringing back (all ticked to start), one photo of everything
// together, then each props request goes through startReturn and each gear booking through returnGear (no new server code).
// /return?ref=props:<id> | gear:<id> | <group key>
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import ReturnFlow, { returnParts } from '../components/ReturnFlow'
import { useShootLabel } from '../activeShoot'
import { formatDay } from '../lib/dates'
import { useReturnGroups, findReturnGroup } from '../hooks/useReturnables'

export default function ReturnAllScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useSession()
  const label = useShootLabel()
  const groups = useReturnGroups(profile.email)
  const ref = params.get('ref') ?? ''
  const group = useMemo(() => groups && (findReturnGroup(groups, ref) ?? (groups.length === 1 ? groups[0] : undefined)), [groups, ref])

  const [done, setDone] = useState<number | null>(null)
  const nothing = groups !== null && returnParts(group ?? undefined).length === 0

  const header = (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
      <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] min-h-[44px] pr-3 inline-flex items-center">‹ Back</button>
    </div>
  )

  if (done !== null) return (
    <div className="min-h-full bg-pt-bg">
      {header}
      <div className="px-4 pt-10 text-center space-y-4">
        <span className="mx-auto w-16 h-16 rounded-full bg-green-600 text-white grid place-items-center text-3xl">✓</span>
        <h1 className="font-display text-[28px] text-pt-text">All returned</h1>
        <p className="text-pt-muted text-[15px]">Thanks! {done > 1 ? 'Each team' : 'The team'} will check everything in. You'll see it on My requests.</p>
        <button onClick={() => navigate('/requests', { replace: true })} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">See my requests</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      {header}
      <div className="px-4 space-y-6">
        <div>
          <h1 className="font-display text-[34px] text-pt-text">Return everything</h1>
          {group && <p className="text-pt-muted text-[15px]">{group.shoot ? label(group.shoot) : `${formatDay(group.date)} shoot`}</p>}
        </div>

        {groups === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {nothing && (
          <div className="text-center space-y-3 pt-6">
            <p className="text-pt-muted text-[15px]">Nothing to bring back here. It may already be returned.</p>
            <button onClick={() => navigate('/requests')} className="text-pt-accent text-sm font-medium tap">My requests</button>
          </div>
        )}
        {group && !nothing && <div className="bg-pt-surface rounded-2xl p-4"><ReturnFlow group={group} onDone={n => setDone(n)} /></div>}
      </div>
    </div>
  )
}
