// Shared gear (friends filming back to back): at the return, whoever brings it back ticks who USED it
// (owner, Oct 20). Only those people carry it on their record. Everyone starts ticked.
import type { GearBooking } from '../services/gear'

export const crewPeople = (b: GearBooking) => [{ email: b.creatorEmail, name: b.creatorName || b.creatorEmail }, ...(b.crew ?? []).map(c => ({ email: c.email, name: c.name }))]

export default function UsedByPicker({ b, off, onChange }: { b: GearBooking; off: Set<string>; onChange: (off: Set<string>) => void }) {
  if (!b.crew?.length) return null
  const people = crewPeople(b)
  const none = people.every(p => off.has(p.email))
  return (
    <div className="bg-sky-500/10 rounded-2xl px-4 py-3 space-y-2">
      <p className="text-sky-100 text-[15px] font-semibold">Who used this gear?</p>
      <p className="text-sky-200/90 text-sm">Untick anyone who didn't. Only the people ticked are responsible if it's late or something's missing. Everyone gets told what you picked.</p>
      <div className="flex flex-wrap gap-2">
        {people.map(p => {
          const on = !off.has(p.email)
          return (
            <button key={p.email} aria-pressed={on} onClick={() => { const n = new Set(off); if (on) n.add(p.email); else n.delete(p.email); onChange(n) }}
              className={`rounded-full px-3 py-2 text-sm ${on ? 'bg-sky-300 text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted shadow-hairline'}`}>
              {on ? '✓ ' : ''}{p.name.split(' ')[0]}
            </button>
          )
        })}
      </div>
      {none && <p className="text-red-300 text-xs">Tick at least one person.</p>}
    </div>
  )
}

export const usedByOf = (b: GearBooking, off: Set<string>) => b.crew?.length ? crewPeople(b).map(p => p.email).filter(e => !off.has(e)) : undefined
