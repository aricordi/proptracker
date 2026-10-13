import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToUser } from '../services/users'
import { useItems } from '../hooks/useItems'
import { useBookingSettings } from '../hooks/useBookings'
import { summarizeCreator, money } from '../lib/history'
import { formatDay } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { ROLE_LABELS } from './AccountScreen'
import type { AppUser } from '../types'

// One person's borrowing history: bookings, late returns, and anything that came
// back damaged or missing, with replacement costs (for the records, not billing).
export default function PersonHistoryScreen() {
  const { email = '' } = useParams()
  const navigate = useNavigate()
  const items = useItems()
  const settings = useBookingSettings()
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)
  const [list, setList] = useState<Reservation[] | null>(null)

  useEffect(() => subscribeToUser(email, setUser, () => setUser(null)), [email])
  useEffect(() => subscribeToReservations({ email, all: false }, setList), [email])

  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const summary = useMemo(() => summarizeCreator(list ?? [], itemsById, settings), [list, itemsById, settings])
  const lateReturnIds = new Set(summary.lateReturns.map(r => r.id))
  const lateNowIds = new Set(summary.lateNow.map(r => r.id))
  const newestFirst = [...(list ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate))

  const tile = 'bg-pt-surface border border-pt-border rounded-2xl p-3'
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text truncate">{user?.name || email}</h1>
      </div>

      <div className="p-4 space-y-5">
        <div>
          <p className="text-pt-muted text-sm break-all">{email}</p>
          {user && <p className="text-pt-accent text-sm">{ROLE_LABELS[user.role]}{!user.active && ' · access off'}</p>}
        </div>

        {list === null ? <p className="text-pt-muted text-sm text-center">Loading…</p> : (
          <>
            {summary.lateNow.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3">
                <p className="text-red-300 font-medium">Has props out late right now</p>
                <p className="text-pt-text/80 text-sm">{summary.lateNow.map(r => r.title).join(', ')}. They can't book until these are back.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{summary.total}</p><p className="text-pt-muted text-xs">bookings ({summary.completed} done{summary.cancelled ? `, ${summary.cancelled} cancelled/declined` : ''})</p></div>
              <div className={tile}><p className={`text-2xl font-semibold ${summary.lateReturns.length ? 'text-amber-300' : 'text-pt-text'}`}>{summary.lateReturns.length}</p><p className="text-pt-muted text-xs">brought back late</p></div>
              <div className={tile}><p className={`text-2xl font-semibold ${summary.incidents.length ? 'text-red-300' : 'text-pt-text'}`}>{summary.incidents.length}</p><p className="text-pt-muted text-xs">damaged or missing</p></div>
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{money(summary.incidentCost)}</p><p className="text-pt-muted text-xs">replacement cost{summary.unknownCosts ? ` (+${summary.unknownCosts} with no cost set)` : ''}</p></div>
            </div>

            {summary.incidents.length > 0 && (
              <div className="space-y-2">
                <p className="text-pt-muted text-xs uppercase tracking-wider">Damaged or missing</p>
                {summary.incidents.map((i, n) => (
                  <button key={n} onClick={() => navigate(`/item/${i.line.itemId}`)}
                    className="w-full text-left bg-pt-surface border border-pt-border rounded-xl px-3 py-2 active:opacity-75">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-pt-text text-sm">
                        <b className="font-medium">{i.line.itemName}</b>{' '}
                        <span className={i.result === 'missing' ? 'text-red-300' : 'text-amber-300'}>
                          {i.result === 'missing' ? `missing${i.units > 1 ? ` ×${i.units}` : ''}` : 'damaged'}
                        </span>
                      </p>
                      <span className="text-pt-text text-sm shrink-0">{i.unitCost === null ? 'no cost set' : money(i.cost)}</span>
                    </div>
                    <p className="text-pt-muted text-xs">{i.reservation.title} · {formatDay(i.reservation.endDate)}{i.line.checkIn?.note ? ` · ${i.line.checkIn.note}` : ''}</p>
                  </button>
                ))}
                <p className="text-pt-muted text-xs">Costs use each prop's current replacement cost. For your records only. Nothing is billed.</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-pt-muted text-xs uppercase tracking-wider">Bookings</p>
              {newestFirst.length === 0 && <p className="text-pt-muted text-sm">No bookings yet.</p>}
              {newestFirst.map(r => (
                <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
                  className="w-full text-left bg-pt-surface border border-pt-border rounded-xl px-3 py-2 active:opacity-75">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-pt-text text-sm font-medium truncate">{r.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${lateNowIds.has(r.id) ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[r.status]}`}>
                      {lateNowIds.has(r.id) ? 'Late' : statusLabel(r)}
                    </span>
                  </div>
                  <p className="text-pt-muted text-xs">
                    {formatDay(r.startDate)} · {r.lines.length} prop{r.lines.length === 1 ? '' : 's'}
                    {lateReturnIds.has(r.id) && <span className="text-amber-300"> · brought back late</span>}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
