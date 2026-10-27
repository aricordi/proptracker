// Tapping + on a prop or gear before picking a shoot (owner, Oct 27: "easy for anyone, even lazy users"): instead of
// a dead end, ask which shoot it's for, or book a new shoot for it. A new shoot keeps the pick on the phone until the
// booking is done, then the pick goes straight into it (same path as ✦ AI picks).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from './BottomSheet'
import { useActiveShoot, useShootLabel, useCutoffs, useAddToShoot, savePendingAdds, type ShootAdds } from '../activeShoot'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

type Kind = 'props' | 'gear'

export function useAddWithoutShoot() {
  const navigate = useNavigate()
  const { upcoming } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs(), addToShoot = useAddToShoot()
  const [ask, setAsk] = useState<{ name: string; kind: Kind; adds: ShootAdds } | null>(null)
  const today = todayInStudio()

  const open = (name: string, kind: Kind, id: string) =>
    setAsk({ name, kind, adds: { props: kind === 'props' ? [id] : [], gear: kind === 'gear' ? [id] : [], builds: [] } })

  const sheet = (
    <BottomSheet open={!!ask} onClose={() => setAsk(null)} title={ask ? `Add ${ask.name} to…` : ''}>
      {ask && (
        <div className="space-y-2">
          {upcoming.length > 0 && <p className="text-pt-muted text-sm">Which shoot is it for?</p>}
          {upcoming.map(sh => {
            const by = cutoffs(sh)[ask.kind], late = today > by
            return (
              <button key={sh.id} disabled={late} onClick={() => { addToShoot(sh.id, ask.adds); setAsk(null) }}
                className="w-full text-left rounded-xl px-3 py-3 bg-pt-bg shadow-hairline disabled:opacity-50">
                <span className="block text-pt-text text-[15px]">{label(sh)}</span>
                <span className={`block text-xs ${late ? 'text-red-300' : 'text-pt-muted'}`}>
                  {late ? `Too late for ${ask.kind} (cutoff was ${formatDay(by)})` : `Add ${ask.kind} by ${formatDay(by)}`}
                </span>
              </button>
            )
          })}
          {upcoming.length === 0 && (
            <p className="text-pt-muted text-sm">Everything you ask for belongs to a shoot. Book a time first and {ask.name} goes straight into it.</p>
          )}
          <button onClick={() => { savePendingAdds(ask.adds); setAsk(null); navigate('/schedule?book=1') }}
            className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 mt-2 shadow-gold">
            {upcoming.length ? 'Book a new shoot for it' : 'Book a shoot for it'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
  return { open, sheet }
}
