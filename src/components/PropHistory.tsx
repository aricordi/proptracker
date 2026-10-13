import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToItemReservations, type Reservation } from '../services/reservations'
import { subscribeToUsers } from '../services/users'
import ActivityList from './ActivityList'
import { formatDay } from '../lib/dates'
import { money, unitCostOf } from '../lib/history'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import type { AppUser, Item } from '../types'

const RESULT_STYLE = { ok: 'text-green-400', damaged: 'text-amber-300', missing: 'text-red-300' } as const

// Staff only: who has had this prop, how it came back, and every change to it.
// Loads only when opened, so the prop page stays quick.
export default function PropHistory({ item }: { item: Item }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'bookings' | 'changes'>('bookings')
  const [list, setList] = useState<Reservation[] | null>(null)
  const [users, setUsers] = useState<AppUser[]>([])

  useEffect(() => open ? subscribeToItemReservations(item.id, setList) : undefined, [open, item.id])
  useEffect(() => open ? subscribeToUsers(setUsers) : undefined, [open])
  const nameOf = useMemo(() => {
    const m = new Map(users.map(u => [u.email, u.name || u.email]))
    return (email: string) => m.get(email) ?? email
  }, [users])

  const rows = (list ?? []).map(r => ({ r, line: r.lines.find(l => l.itemId === item.id) }))
  const problems = rows.filter(x => x.line?.checkIn && x.line.checkIn.result !== 'ok')
  const unitCost = unitCostOf(item)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full py-3 rounded-xl bg-pt-surface border border-pt-border text-pt-text text-sm font-medium active:opacity-75">
        Show history
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-pt-muted text-xs uppercase tracking-wider">History</p>
      <div className="flex gap-2">
        {([['bookings', 'Who had it'], ['changes', 'Changes']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1 rounded-full text-sm ${tab === k ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'changes' ? <ActivityList itemId={item.id} kind="prop" pageSize={30} /> : list === null ? (
        <p className="text-pt-muted text-sm">Loading…</p>
      ) : (
        <>
          <p className="text-pt-text text-sm">
            Booked {rows.length} time{rows.length === 1 ? '' : 's'}
            {problems.length > 0 && <> · <span className="text-amber-300">{problems.length} came back with a problem</span></>}
          </p>
          {rows.length === 0 && <p className="text-pt-muted text-sm">Nobody has booked it yet.</p>}
          {rows.map(({ r, line }) => {
            const ci = line?.checkIn
            return (
              <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
                className="w-full text-left bg-pt-surface border border-pt-border rounded-xl px-3 py-2 active:opacity-75">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-pt-text text-sm min-w-0">
                    <span className="font-medium">{nameOf(r.creatorEmail)}</span>
                    <span className="text-pt-muted"> · {r.title}</span>
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[r.status]}`}>{statusLabel(r)}</span>
                </div>
                <p className="text-pt-muted text-xs">
                  {formatDay(r.startDate)}{line && line.qty > 1 ? ` · ×${line.qty}` : ''}
                  {line?.pick?.state === 'unavailable' && <span className="text-amber-300"> · not available{line.pick.reason ? `: ${line.pick.reason}` : ''}</span>}
                  {ci && (
                    <span className={RESULT_STYLE[ci.result]}>
                      {' · came back '}{ci.result === 'ok' ? 'fine' : ci.result === 'missing' ? `missing${(ci.missingQty ?? 1) > 1 ? ` ×${ci.missingQty}` : ''}` : 'damaged'}
                      {ci.result !== 'ok' && unitCost !== null && ` (${money(unitCost * (ci.result === 'missing' ? ci.missingQty ?? 1 : 1))})`}
                    </span>
                  )}
                </p>
                {ci?.note && ci.result !== 'ok' && <p className="text-pt-muted text-xs">“{ci.note}”</p>}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
