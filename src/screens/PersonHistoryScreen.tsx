import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSession } from '../auth'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsOf, useReportsSince, useStrikesSince, useMyStatus } from '../services/schedule'
import { creatorStats, SERIOUS, FLAG_LABEL } from '../lib/creatorStats'
import { FlagPills, PERIODS, periodStart, type Period } from './CreatorsScreen'
import { useManageCreator } from '../components/ManageCreator'
import { PushCheck } from '../components/PushCheck'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToUser } from '../services/users'
import { useItems } from '../hooks/useItems'
import { useBookingSettings } from '../hooks/useBookings'
import { summarizeCreator, money } from '../lib/history'
import { formatDay } from '../lib/dates'
import { STATUS_STYLES, statusLabel } from '../lib/reservationLabels'
import { ROLE_LABELS } from './AccountScreen'
import type { AppUser } from '../types'

// One person's record. Owner + admins (owner, Oct 20): how much they film and EVERY flag (no-shows, missed
// check-ins, late cancels, late starts, running over, mess, late props + gear, strikes). Arts: their props history.
export default function PersonHistoryScreen() {
  const { email = '' } = useParams()
  const navigate = useNavigate()
  const { canSeeGear, canManagePeople } = useSession()
  const [params] = useSearchParams()
  const [period, setPeriod] = useState<Period>((params.get('period') as Period) || '90')
  const today = todayInStudio(), now = nowStamp()
  const since = addDays(today, -90)
  const shoots = useShootsOf(email, canSeeGear ? since : '9999-12-31')
  const reports = useReportsSince(since, canSeeGear, email)
  const strikes = useStrikesSince(since, canSeeGear, email)
  const status = useMyStatus(email)
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => canSeeGear ? subscribeToGearBookings(email, setGear) : undefined, [email, canSeeGear])
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
  const stats = useMemo(() => canSeeGear
    ? creatorStats({ from: periodStart(period, today), now, closed: settings, shoots: shoots ?? [], props: list ?? [], gear, reports, strikes, people: [{ email, name: user?.name || email }] })
      .find(c => c.email === email) ?? null
    : null, [canSeeGear, period, today, now, settings, shoots, list, gear, reports, strikes, email, user])
  const paused = !!status?.pausedUntil && status.pausedUntil > today
  const manage = useManageCreator(email, user?.name || email, status)

  const tile = 'bg-pt-surface border border-pt-border rounded-2xl p-3'
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] py-1">‹ Back</button>
        <h1 className="font-display text-xl text-pt-text truncate">{user?.name || email}</h1>
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        <div>
          <p className="text-pt-muted text-sm break-all">{email}</p>
          {user && <p className="text-pt-accent text-sm tap">{ROLE_LABELS[user.role]}{!user.active && ' · access off'}</p>}
        </div>

        {stats && (
          <section className="space-y-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {PERIODS.map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`shrink-0 px-3 py-1 rounded-full text-sm ${period === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{l}</button>)}
            </div>
            {paused && <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3 text-sm text-pt-text"><b className="text-red-300">Props and gear paused until {formatDay(status!.pausedUntil!)}</b> · {status!.strikes ?? 0} strike{status!.strikes === 1 ? '' : 's'}{status!.pauseNote ? ` · "${status!.pauseNote}"` : ''}</div>}
            {canManagePeople && manage.buttons}
            {manage.err && <p className="text-red-300 text-sm">{manage.err}</p>}
            <div className="grid grid-cols-3 gap-2">
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{stats.filmed}</p><p className="text-pt-muted text-xs">filmed</p></div>
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{stats.booked}</p><p className="text-pt-muted text-xs">booked</p></div>
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{stats.upcoming}</p><p className="text-pt-muted text-xs">coming up</p></div>
            </div>
            <FlagPills c={stats} max={9} />
            {stats.flags.length > 0 && (
              <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
                {stats.flags.map((f, n) => (
                  <button key={n} disabled={!f.to && !f.strikeId} onClick={() => f.to && navigate(f.to)} className="w-full flex items-start gap-3 px-3 py-3 text-left">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SERIOUS.includes(f.kind) ? 'bg-red-400' : 'bg-amber-300'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-pt-text text-sm">{f.text}</span>
                      <span className="block text-pt-muted text-xs">{FLAG_LABEL[f.kind]} · {formatDay(f.date)}{f.open ? ' · still open' : ''}</span>
                    </span>
                    {canManagePeople && f.strikeId ? <span onClick={e => { e.stopPropagation(); manage.removeStrikeAsk(f.strikeId!, f.text) }} className="shrink-0 text-pt-accent text-xs tap">Remove</span>
                      : f.to && <span className="text-pt-muted">›</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {canManagePeople && manage.sheets}
        {canManagePeople && <PushCheck email={email} name={user?.name || email} />}
        {list === null ? <p className="text-pt-muted text-sm text-center">Loading…</p> : (
          <>
            {summary.lateNow.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3">
                <p className="text-red-300 font-medium">Has props out late right now</p>
                <p className="text-pt-text/80 text-sm">{summary.lateNow.map(r => r.title).join(', ')}. They can't book until these are back.</p>
              </div>
            )}

            <p className="text-pt-muted text-xs">Props, all time</p>
            <div className="grid grid-cols-2 gap-2">
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{summary.total}</p><p className="text-pt-muted text-xs">bookings ({summary.completed} done{summary.cancelled ? `, ${summary.cancelled} cancelled/declined` : ''})</p></div>
              <div className={tile}><p className={`text-2xl font-semibold ${summary.lateReturns.length ? 'text-amber-300' : 'text-pt-text'}`}>{summary.lateReturns.length}</p><p className="text-pt-muted text-xs">brought back late</p></div>
              <div className={tile}><p className={`text-2xl font-semibold ${summary.incidents.length ? 'text-red-300' : 'text-pt-text'}`}>{summary.incidents.length}</p><p className="text-pt-muted text-xs">damaged or missing</p></div>
              <div className={tile}><p className="text-2xl text-pt-text font-semibold">{money(summary.incidentCost)}</p><p className="text-pt-muted text-xs">replacement cost{summary.unknownCosts ? ` (+${summary.unknownCosts} with no cost set)` : ''}</p></div>
            </div>

            {summary.incidents.length > 0 && (
              <div className="space-y-2">
                <p className="text-pt-muted text-xs">Damaged or missing</p>
                {summary.incidents.map((i, n) => (
                  <button key={n} onClick={() => navigate(`/item/${i.line.itemId}`)}
                    className="w-full text-left bg-pt-surface shadow-hairline rounded-xl px-3 py-2 active:opacity-75">
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
                <p className="text-pt-muted text-xs">Costs use each prop's current replacement cost. For the records only. Nothing is billed.</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-pt-muted text-xs">Bookings</p>
              {newestFirst.length === 0 && <p className="text-pt-muted text-sm">No bookings yet.</p>}
              {newestFirst.map(r => (
                <button key={r.id} onClick={() => navigate(`/reservations/${r.id}`)}
                  className="w-full text-left bg-pt-surface shadow-hairline rounded-xl px-3 py-2 active:opacity-75">
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
