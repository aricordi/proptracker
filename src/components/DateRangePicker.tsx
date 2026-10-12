import { formatDay } from '../lib/dates'

interface Props {
  start: string | null
  end: string | null
  min: string
  onChange: (start: string | null, end: string | null) => void
  leadTimeNote?: string
  compact?: boolean
}

// Shoot dates: native date pickers work well on phones.
export default function DateRangePicker({ start, end, min, onChange, leadTimeNote, compact }: Props) {
  const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-3 py-2.5 text-pt-text focus:outline-none focus:border-pt-accent [color-scheme:dark]'
  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-pt-muted text-xs uppercase tracking-wider">First shoot day</span>
          <input type="date" value={start ?? ''} min={min}
            onChange={e => {
              const s = e.target.value || null
              onChange(s, !end || (s && end < s) ? s : end)
            }}
            className={input} />
        </label>
        <label className="block">
          <span className="text-pt-muted text-xs uppercase tracking-wider">Last shoot day</span>
          <input type="date" value={end ?? ''} min={start ?? min}
            onChange={e => onChange(start ?? (e.target.value || null), e.target.value || null)}
            className={input} />
        </label>
      </div>
      {leadTimeNote && <p className="text-pt-muted text-xs">{leadTimeNote}</p>}
      {start && start < min && (
        <p className="text-amber-400 text-xs">The earliest you can book is {formatDay(min)}.</p>
      )}
    </div>
  )
}
