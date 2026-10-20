// Browse: which shoot you're adding to, with its cutoff. Tap to pick another shoot or just browse.
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BottomSheet from './BottomSheet'
import { useActiveShoot, useShootLabel, useCutoffs } from '../activeShoot'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import { fmtSlot } from '../services/schedule'
import { Icon } from './Icon'

export function BrowseTabs() {
  const navigate = useNavigate()
  const loc = useLocation()
  const gear = loc.pathname.startsWith('/gear')
  return (
    <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
      {([['Props & costumes', '/browse', !gear], ['Gear', '/gear', gear]] as const).map(([label, to, on]) => (
        <button key={to} onClick={() => !on && navigate(to + loc.search, { replace: true })} className={`flex-1 py-1.5 rounded-lg text-sm ${on ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{label}</button>
      ))}
    </div>
  )
}

// Browse (owner, Oct 20: "compress the stuff"): the shoot you're adding to as one small chip in the filter row.
export function AddingToChip({ kind }: { kind: 'props' | 'gear' }) {
  const { shoot } = useActiveShoot()
  const cutoffs = useCutoffs()
  const [open, setOpen] = useState(false)
  const late = !!shoot && todayInStudio() > cutoffs(shoot)[kind]
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={shoot ? 'Change which shoot you are adding to' : 'Pick a shoot'}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-sm ${shoot ? (late ? 'bg-red-500/15 text-red-300' : 'bg-pt-accent/15 text-pt-accent font-medium shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.5)]') : 'bg-pt-surface shadow-hairline text-pt-accent'}`}>
        <Icon name="calendar" className="w-4 h-4" />{shoot ? `${formatDay(shoot.date)} · ${fmtSlot(shoot.start, shoot.end - shoot.start)}` : 'Pick a shoot'}<span aria-hidden className="text-xs">▾</span>
      </button>
      <ShootPicker open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// One line under the filters: how many, and the cutoff for the shoot you're adding to.
export function useAddingNote(kind: 'props' | 'gear') {
  const { shoot } = useActiveShoot()
  const cutoffs = useCutoffs()
  if (!shoot) return { text: `Just browsing. Pick a shoot to see what's free and add ${kind}.`, late: false }
  const by = cutoffs(shoot)[kind], late = todayInStudio() > by
  return { text: late ? `Too late to add ${kind} to this shoot (cutoff was ${formatDay(by)})` : `Add ${kind} by ${formatDay(by)}`, late }
}

function ShootPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { shoot, upcoming, choose } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  return (
      <BottomSheet open={open} onClose={onClose} title="Which shoot?">
        <div className="space-y-2">
          {upcoming.length === 0 && <p className="text-pt-muted text-sm">You have no shoots booked. Book a time first, then add props and gear to it.</p>}
          {upcoming.map(sh => (
            <button key={sh.id} onClick={() => { choose(sh.id); onClose() }}
              className={`w-full text-left rounded-xl px-3 py-3 ${shoot?.id === sh.id ? 'bg-pt-accent/15 border border-pt-accent/50' : 'bg-pt-bg'}`}>
              <span className="block text-pt-text text-[15px]">{label(sh)}</span>
              <span className="block text-pt-muted text-xs">Props by {formatDay(cutoffs(sh).props)} · Gear by {formatDay(cutoffs(sh).gear)}</span>
            </button>
          ))}
          <button onClick={() => { choose(null); onClose() }} className={`w-full text-left rounded-xl px-3 py-3 ${!shoot ? 'bg-pt-accent/15 border border-pt-accent/50' : 'bg-pt-bg'}`}>
            <span className="block text-pt-text text-[15px]">Just browsing</span>
          </button>
          <button onClick={() => { onClose(); navigate('/schedule') }} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 mt-2 shadow-gold">Book a shoot</button>
        </div>
      </BottomSheet>
  )
}

export default function AddingToBar({ kind }: { kind: 'props' | 'gear' | 'shoot' }) {
  const { shoot } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  const [open, setOpen] = useState(false)
  const today = todayInStudio()
  const c = shoot ? cutoffs(shoot) : null
  const by = c && kind !== 'shoot' ? c[kind] : null
  const late = !!by && today > by
  return (
    <>
      <button onClick={() => setOpen(true)} className={`w-full min-h-[52px] flex items-center gap-3 py-3 px-4 rounded-2xl text-left text-sm ${shoot ? 'bg-pt-accent/10 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.45)]' : 'bg-pt-surface shadow-hairline'}`}>
        <span className="flex-1 min-w-0">
          {shoot ? <>
            <span className="block text-pt-muted text-xs">Adding to</span>
            <span className="block text-pt-text truncate">{label(shoot)}</span>
            <span className={`block text-xs ${late ? 'text-red-300' : 'text-pt-muted'}`}>
              {kind === 'shoot' ? `Props by ${formatDay(c!.props)} · new props by ${formatDay(c!.builds)} · gear by ${formatDay(c!.gear)}`
                : late ? `Too late to add ${kind} (cutoff was ${formatDay(by!)})` : `Add ${kind} by ${formatDay(by!)}`}
            </span>
          </> : <>
            <span className="block text-pt-text">Just browsing</span>
            <span className="block text-pt-muted text-xs">Pick one of your shoots to see what's free and add {kind === 'shoot' ? 'props and gear' : kind}.</span>
          </>}
        </span>
        <span className="text-pt-accent text-xs shrink-0 tap">{shoot ? 'Change' : 'Pick a shoot'}</span>
      </button>
      <ShootPicker open={open} onClose={() => setOpen(false)} />
    </>
  )
}
