import { addDays } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

interface Props {
  start: string | null
  end: string | null
  min: string
  onChange: (start: string | null, end: string | null) => void
  leadTimeNote?: string
  compact?: boolean
  maxDays?: number        // longest allowed booking; 1 shows a single "Shoot day" field
}

// Shoot dates. Native date pickers work well on phones; each field gets its own
// full-width row because phone date inputs don't shrink to fit side by side.
export default function DateRangePicker({ start, end, min, onChange, leadTimeNote, compact, maxDays }: Props) {
  // min-h keeps the box full-size even while empty (phones shrink empty date fields).
  const input = 'block w-full min-w-0 min-h-[3.25rem] appearance-none bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text text-lg focus:outline-none focus:border-pt-accent [color-scheme:dark]'
  const label = 'text-pt-muted text-xs uppercase tracking-wider'
  const single = maxDays === 1
  const latestEnd = start && maxDays ? addDays(start, maxDays - 1) : undefined

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {single ? (
        <label className="block min-w-0">
          <span className={label}>Shoot day</span>
          <input type="date" value={start ?? ''} min={min}
            onChange={e => { const d = e.target.value || null; onChange(d, d) }}
            className={input} />
          <span className="block text-pt-muted text-xs mt-1">Props are due back the same night.</span>
        </label>
      ) : (
        <div className="space-y-2">
          <label className="block min-w-0">
            <span className={label}>First shoot day</span>
            <input type="date" value={start ?? ''} min={min}
              onChange={e => {
                const s = e.target.value || null
                // Keep the end inside the allowed range when the start moves.
                const tooLate = s && end && latestEnd && end > addDays(s, (maxDays ?? 1) - 1)
                onChange(s, !end || (s && end < s) || tooLate ? s : end)
              }}
              className={input} />
          </label>
          <label className="block min-w-0">
            <span className={label}>Last shoot day</span>
            <input type="date" value={end ?? ''} min={start ?? min} max={latestEnd}
              onChange={e => onChange(start ?? (e.target.value || null), e.target.value || null)}
              className={input} />
          </label>
          {maxDays && maxDays > 1 && <p className="text-pt-muted text-xs">Up to {maxDays} days.</p>}
        </div>
      )}
      {leadTimeNote && <p className="text-pt-muted text-xs">{leadTimeNote}</p>}
      {start && start < min && (
        <p className="text-amber-400 text-xs">The earliest you can book is {formatDay(min)}.</p>
      )}
    </div>
  )
}
