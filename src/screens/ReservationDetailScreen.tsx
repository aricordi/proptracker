import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import {
  subscribeToReservation, cancelReservation, declineReservation, markReservationReturned,
  ACTIVE_STATUSES, type Reservation,
} from '../services/reservations'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay, formatRange } from '../lib/dates'
import { STATUS_LABELS, STATUS_STYLES } from '../lib/reservationLabels'

type Action = 'cancel' | 'decline' | 'returned' | null

export default function ReservationDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isStaff, profile } = useSession()
  const [res, setRes] = useState<Reservation | null | undefined>(undefined)
  const [action, setAction] = useState<Action>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => id ? subscribeToReservation(id, setRes) : undefined, [id])

  if (res === undefined) return <div className="min-h-screen bg-pt-bg flex items-center justify-center text-pt-muted text-sm">Loading…</div>
  if (res === null) return <div className="min-h-screen bg-pt-bg flex items-center justify-center text-pt-muted text-sm">Booking not found.</div>

  const active = ACTIVE_STATUSES.includes(res.status)
  const overdue = active && res.endDate < todayInStudio()
  const mine = res.creatorEmail === profile.email

  async function run() {
    setBusy(true); setError(null)
    try {
      if (action === 'cancel') await cancelReservation({ id: res!.id })
      if (action === 'decline') await declineReservation({ id: res!.id, reason: reason.trim() })
      if (action === 'returned') await markReservationReturned({ id: res!.id })
      setAction(null)
    } catch (err) {
      setError(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const confirmText: Record<Exclude<Action, null>, string> = {
    cancel:   'Cancel this booking? The props become available to others.',
    decline:  'Decline this booking? The creator will see your reason.',
    returned: 'Mark everything as returned? The props become available again. (Full return checks come in a later update.)',
  }

  return (
    <div className="min-h-screen bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button onClick={() => navigate('/reservations')} className="text-pt-text text-base font-medium py-1">‹ Bookings</button>
        <span className={`text-xs px-2.5 py-1 rounded-full ${overdue ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[res.status]}`}>
          {overdue ? 'Not returned' : STATUS_LABELS[res.status]}
        </span>
      </div>

      <div className="p-4 space-y-5">
        {params.get('new') && active && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
            <p className="text-green-400 font-medium">You're booked ✓</p>
            <p className="text-pt-muted text-sm">These props are held for your dates. The arts department will see this in their list.</p>
          </div>
        )}

        <div>
          <h1 className="font-display text-2xl text-pt-text leading-tight">{res.title}</h1>
          <p className="text-pt-text mt-1">📅 {formatRange(res.startDate, res.endDate)}</p>
          {isStaff && <p className="text-pt-muted text-sm mt-0.5">Booked by {res.creatorName} · {res.creatorEmail}</p>}
        </div>

        {res.statusReason && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-300 text-xs uppercase tracking-wider mb-1">Reason</p>
            <p className="text-pt-text text-sm">{res.statusReason}</p>
          </div>
        )}

        {res.notes && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Notes</p>
            <p className="text-pt-text text-sm whitespace-pre-wrap">{res.notes}</p>
          </div>
        )}

        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Props</p>
          <div className="space-y-2">
            {res.lines.map(l => (
              <button key={l.itemId} onClick={() => navigate(`/item/${l.itemId}`)}
                className="w-full flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-2.5 text-left active:opacity-75">
                <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">
                  {l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}
                </div>
                <p className="flex-1 text-pt-text text-sm font-medium truncate">{l.itemName}</p>
                <span className="text-pt-text font-semibold">×{l.qty}</span>
              </button>
            ))}
          </div>
        </div>

        {active && (
          action ? (
            <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
              <p className="text-pt-text text-sm">{confirmText[action]}</p>
              {action === 'decline' && (
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
                  placeholder="Reason (the creator sees this) *"
                  className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
              )}
              {error && <p className="text-red-300 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setAction(null); setError(null) }} className="flex-1 py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm">Back</button>
                <button onClick={run} disabled={busy || (action === 'decline' && !reason.trim())}
                  className="flex-1 py-2.5 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">
                  {busy ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {isStaff && (
                <button onClick={() => setAction('returned')} className="w-full py-3 rounded-xl bg-green-500/20 text-green-400 font-medium">
                  Mark everything returned
                </button>
              )}
              {isStaff && !mine && (
                <button onClick={() => setAction('decline')} className="w-full py-3 rounded-xl bg-pt-surface border border-pt-border text-red-300 font-medium">
                  Decline booking
                </button>
              )}
              {(mine || isStaff) && (
                <button onClick={() => setAction('cancel')} className="w-full py-3 rounded-xl bg-pt-surface border border-pt-border text-pt-muted font-medium">
                  Cancel booking
                </button>
              )}
            </div>
          )
        )}

        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">History</p>
          <ul className="space-y-1">
            {res.history.map((h, i) => (
              <li key={i} className="text-pt-muted text-xs">
                {formatDay(h.at.slice(0, 10), { month: 'short', day: 'numeric' })}{' '}
                {new Date(h.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })} · {STATUS_LABELS[h.status]} by {h.by}
                {h.reason ? ` ("${h.reason}")` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
