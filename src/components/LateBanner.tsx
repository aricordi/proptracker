import { useNavigate } from 'react-router-dom'
import type { Reservation } from '../services/reservations'
import { formatDay } from '../lib/dates'

// Shown to a creator who has props out late: they can't book more until they're back.
export default function LateBanner({ late }: { late: Reservation[] }) {
  const navigate = useNavigate()
  if (late.length === 0) return null
  return (
    <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 space-y-2">
      <p className="text-red-300 font-semibold">Props are late</p>
      <p className="text-pt-text text-sm">
        You can't book more props until these are back with the arts department.
      </p>
      {late.map(r => (
        <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
          className="w-full text-left flex items-center justify-between gap-2 bg-pt-bg/60 rounded-xl px-3 py-2">
          <span className="text-pt-text text-sm truncate">{r.title} · {formatDay(r.endDate, { month: 'short', day: 'numeric' })}</span>
          <span className="text-pt-accent text-sm shrink-0 tap">Return ›</span>
        </button>
      ))}
    </div>
  )
}
