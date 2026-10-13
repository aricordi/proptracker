import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { subscribeToGearBooking, cancelGearBooking, declineGearBooking, fmtHours, fmtTime, type GearBooking } from '../services/gear'
import { GearArt, Pill, STATUS_LABEL } from '../components/GearUi'
import { formatDay } from '../lib/dates'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."
const ACTIONS: Record<string, string> = { held: 'Held', cancelled: 'Cancelled', declined: 'Declined' }

// One gear booking: what, when, pickup/return, and cancel (creator or team) / decline (team).
export default function GearBookingScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isGearStaff, profile } = useSession()
  const [b, setB] = useState<GearBooking | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => id ? subscribeToGearBooking(id, setB) : undefined, [id])

  if (b === undefined) return <div className="p-6 pt-safe text-pt-muted">Loading…</div>
  if (b === null) return <div className="p-6 pt-safe text-pt-muted">Booking not found.</div>

  const mine = b.creatorEmail === profile.email
  const canCancel = b.status === 'held' && (mine || isGearStaff)
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn(); setConfirmCancel(false); setDeclining(false) } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-2 py-2 flex items-center">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] px-2 py-1">‹ Back</button>
      </div>
      <div className="px-4 space-y-4">
        <div className="space-y-1">
          <Pill tone={STATUS_LABEL[b.status]?.tone ?? 'muted'}>{STATUS_LABEL[b.status]?.text ?? b.status}</Pill>
          <h1 className="font-display text-3xl text-pt-text leading-tight">{b.title}</h1>
          <p className="text-pt-muted">{formatDay(b.date, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtHours(b.start, b.end)}</p>
          {isGearStaff && <p className="text-pt-muted text-sm">Booked by {b.creatorName || b.creatorEmail}</p>}
        </div>

        {b.status === 'declined' && b.declineReason && (
          <div className="bg-red-500/10 rounded-2xl px-4 py-3 text-red-200 text-[15px]">Declined by the equipment team: {b.declineReason}</div>
        )}

        <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Pick up</span>
            <span className="text-pt-text">{formatDay(b.pickupDay)} · {fmtTime(b.start)}</span></div>
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Back by</span>
            <span className="text-pt-text">{b.closedDay ? `${formatDay(b.to.slice(0, 10))} · 10 AM` : fmtTime(b.end)}</span></div>
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Where</span><span className="text-pt-text">Equipment cage</span></div>
        </div>

        <div className="space-y-2">
          {b.lines.map(l => (
            <div key={l.offerId} className="bg-pt-surface rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-3">
                <GearArt photo={l.photo} className="w-12 h-12 rounded-xl shrink-0" />
                <div className="min-w-0">
                  <p className="text-pt-text text-[15px] font-medium truncate">{l.kind === 'extra' ? `${l.qty}× ` : ''}{l.name}</p>
                  <p className="text-pt-muted text-xs">{l.kind === 'extra' ? 'Add-on extra' : `Bundle · ${l.pieces.reduce((n, p) => n + p.qty, 0)} pieces`}</p>
                </div>
              </div>
              {l.kind === 'bundle' && l.pieces.length > 0 && (
                <p className="text-pt-muted text-xs leading-relaxed">{l.pieces.map(p => `${p.qty}× ${p.name}`).join(' · ')}</p>
              )}
            </div>
          ))}
        </div>

        {b.notes && <div className="bg-pt-surface rounded-2xl px-4 py-3"><p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Notes</p><p className="text-pt-text text-[15px] whitespace-pre-wrap">{b.notes}</p></div>}

        {error && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{error}</p>}

        {canCancel && (confirmCancel ? (
          <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
            <p className="text-pt-text text-[15px]">Cancel this gear booking? The gear becomes free for others.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmCancel(false)} className="py-3 rounded-xl bg-pt-border text-pt-text font-medium">Keep it</button>
              <button onClick={() => run(() => cancelGearBooking({ id: b.id }))} disabled={busy} className="py-3 rounded-xl bg-red-500 text-white font-semibold disabled:opacity-40">{busy ? 'Cancelling…' : 'Cancel booking'}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmCancel(true)} className="w-full py-3 rounded-2xl bg-pt-surface text-red-300 font-medium">Cancel booking</button>
        ))}

        {isGearStaff && b.status === 'held' && (declining ? (
          <div className="bg-pt-surface rounded-2xl p-3 space-y-2">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} autoFocus placeholder="Why? e.g. the drone is in for repair; try the Mini 3 bundle"
              className="w-full bg-pt-bg rounded-xl px-3 py-2 text-pt-text text-[15px] placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent resize-none" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeclining(false)} className="py-3 rounded-xl bg-pt-border text-pt-text font-medium">Back</button>
              <button onClick={() => run(() => declineGearBooking({ id: b.id, reason }))} disabled={busy || !reason.trim()} className="py-3 rounded-xl bg-red-500 text-white font-semibold disabled:opacity-40">Decline</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDeclining(true)} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-text font-medium">Decline (equipment team)</button>
        ))}

        <div className="space-y-1 pt-2">
          <p className="text-pt-muted text-xs uppercase tracking-wider px-1">History</p>
          {b.history.map((h, i) => (
            <p key={i} className="text-pt-muted text-sm px-1">{new Date(h.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {ACTIONS[h.action] ?? h.action}{h.note && h.action !== 'held' ? ` · ${h.note}` : ''}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
