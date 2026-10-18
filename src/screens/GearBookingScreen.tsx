import ChangeGear from '../components/ChangeGear'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import {
  subscribeToGearBooking, cancelGearBooking, declineGearBooking, pickUpGear, returnGear, checkInGear,
  fmtHours, fmtTime, nowStamp, pickupWindow, pickupOpensAt, isGearLate, gearDueBy, checkLines, type GearBooking,
} from '../services/gear'
import { GearArt, Pill, PieceChecklist, STATUS_LABEL } from '../components/GearUi'
import ProofPhotos, { PhotoStamp } from '../components/ProofPhotos'
import ImageLightbox from '../components/ImageLightbox'
import ShootLink from '../components/ShootLink'
import { formatDay } from '../lib/dates'

const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."
const ACTIONS: Record<string, string> = { edited: 'Changed', held: 'Held', cancelled: 'Cancelled', declined: 'Declined', picked_up: 'Picked up', returned: 'Returned', checked_in: 'Checked in' }
const STEPS = ['Held', 'Picked up', 'Returned', 'Checked in']
const STEP_OF: Record<string, number> = { held: 0, out: 1, returned: 2, checked_in: 3 }
const stampMin = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16))

// One gear booking: what, when, and the next step — pickup check, return photo, check-in.
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
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [zoom, setZoom] = useState<string | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => id ? subscribeToGearBooking(id, setB) : undefined, [id])
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 30_000); return () => clearInterval(t) }, [])   // keep "now" fresh
  // A new step starts with a clean checklist.
  useEffect(() => { setTicked(new Set()); setMissing(new Set()) }, [b?.status])
  const lines = useMemo(() => b ? checkLines(b.lines) : [], [b])

  if (b === undefined) return <div className="p-6 pt-safe text-pt-muted">Loading…</div>
  if (b === null) return <div className="p-6 pt-safe text-pt-muted">Booking not found.</div>

  const now = nowStamp()
  const mine = b.creatorEmail === profile.email
  const late = isGearLate(b, now)
  const win = pickupWindow(b, now)
  const canCancel = b.status === 'held' && (mine || isGearStaff)
  const allDone = lines.every(l => ticked.has(l.key) || missing.has(l.key))
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, key: string, other: Set<string>, otherSetter: (s: Set<string>) => void) => {
    const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); setter(n)
    if (other.has(key)) { const o = new Set(other); o.delete(key); otherSetter(o) }
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn(); setConfirmCancel(false); setDeclining(false) } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }
  const checklist = (
    <PieceChecklist lines={lines} ticked={ticked} missing={missing}
      onTick={k => flip(ticked, setTicked, k, missing, setMissing)} onMissing={k => flip(missing, setMissing, k, ticked, setTicked)} />
  )
  const step = STEP_OF[b.status]

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-2 py-2 flex items-center">
        <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] px-2 py-1">‹ Back</button>
      </div>
      <div className="px-4 space-y-4">
        <div className="space-y-1">
          <div className="flex gap-2">
            <Pill tone={STATUS_LABEL[b.status]?.tone ?? 'muted'}>{STATUS_LABEL[b.status]?.text ?? b.status}</Pill>
            {late && <Pill tone="taken">Late</Pill>}
            {b.returnedLate && <Pill tone="warn">Returned late</Pill>}
          </div>
          <h1 className="font-display text-3xl text-pt-text leading-tight">{b.title}</h1>
          <p className="text-pt-muted">{formatDay(b.date, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtHours(b.start, b.end)}</p>
          {isGearStaff && <p className="text-pt-muted text-sm">Booked by {b.creatorName || b.creatorEmail}</p>}
        </div>

        {step !== undefined && (
          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-1">{STEPS.map((_, i) => <div key={i} className={`h-1.5 rounded-full ${i <= step ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
            <div className="grid grid-cols-4 gap-1 text-[11px] text-center">{STEPS.map((s, i) => <span key={s} className={i === step ? 'text-pt-accent' : 'text-pt-muted'}>{s}</span>)}</div>
          </div>
        )}

        {b.status === 'declined' && b.declineReason && (
          <div className="bg-red-500/10 rounded-2xl px-4 py-3 text-red-200 text-[15px]">Declined by the equipment team: {b.declineReason}</div>
        )}
        {late && (
          <div className="bg-red-500/10 rounded-2xl px-4 py-3 text-red-200 text-[15px]">
            This gear was due back {b.closedDay ? `${formatDay(b.to.slice(0, 10))} at 10 AM` : `at ${fmtTime(b.end)}`} and is late.
            {mine ? ' Bring it back as soon as you can. You can\'t book more gear until it\'s returned.' : ''}
          </div>
        )}

        <ShootLink shootId={b.shootId} creatorEmail={b.creatorEmail} other="props" />

        <div className="bg-pt-surface rounded-2xl divide-y divide-pt-border">
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Pick up</span>
            <span className="text-pt-text">{formatDay(b.pickupDay)} · {fmtTime(b.start)}</span></div>
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Back by</span>
            <span className="text-pt-text">{b.closedDay ? `${formatDay(b.to.slice(0, 10))} · 10 AM` : fmtTime(b.end)}</span></div>
          <div className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">Where</span><span className="text-pt-text">Equipment cage</span></div>
        </div>

        {/* ── Pickup check (creator, in the pickup window) ── */}
        {b.status === 'held' && (mine || isGearStaff) && (win === 'early' ? (
          <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-4 py-3">
            🕓 At pickup you'll open the case and tick every piece. It opens at {fmtTime(stampMin(pickupOpensAt(b.from)))} on {formatDay(b.pickupDay)}.
          </p>
        ) : win === 'open' ? (
          <section className="space-y-3">
            <div>
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Pick up</h2>
              <p className="text-pt-muted text-sm">Open the case and tick what's there. Tap "Missing?" for anything that isn't.</p>
            </div>
            {checklist}
            {missing.size > 0 && <p className="text-red-200 text-sm bg-red-500/10 rounded-xl px-4 py-3">{missing.size} piece{missing.size > 1 ? 's' : ''} reported missing <b>before you took it</b>. The equipment team will see it, and it goes on the record of whoever had it last.</p>}
            <p className="text-amber-200 text-sm">Report anything missing now. Once you sign, the gear is your responsibility until it's back.</p>
            <button disabled={!allDone || busy} onClick={() => run(() => pickUpGear({ id: b.id, missing: [...missing], signed: true }))}
              className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy ? 'Signing…' : "Sign: I've got it"}</button>
            {!allDone && <p className="text-pt-muted text-xs text-center">Tick every piece, or mark it missing, to sign.</p>}
          </section>
        ) : (
          <p className="text-pt-muted text-sm bg-pt-surface rounded-2xl px-4 py-3">The booked time is over without a pickup. Ask the equipment team.</p>
        ))}

        {/* ── Return (creator) ── */}
        {b.status === 'out' && (mine || isGearStaff) && (
          <section className="space-y-3">
            <div>
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Return gear</h2>
              <p className="text-pt-muted text-sm">Due back {b.closedDay ? `${formatDay(b.to.slice(0, 10))} by 10 AM` : `by ${fmtTime(b.end)}`} (late from {fmtTime(stampMin(gearDueBy(b.to)))}).</p>
            </div>
            <ol className="bg-pt-surface rounded-2xl px-4 py-3 space-y-1 text-[15px] text-pt-text list-decimal list-inside">
              <li>Put every piece back in its case.</li>
              <li>Plug the batteries into the chargers on the shelf.</li>
              <li>Take one photo that shows both.</li>
            </ol>
            <ProofPhotos folder={`gear-returns/${b.id}`} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Return photo" hint="Required: case packed, batteries charging" max={4} />
            <button disabled={!photos.length || uploading || busy} onClick={() => run(() => returnGear({ id: b.id, photos }))}
              className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy ? 'Sending…' : 'Send return'}</button>
          </section>
        )}

        {/* ── Check-in (equipment team) ── */}
        {b.status === 'returned' && isGearStaff && (
          <section className="space-y-3">
            <div>
              <h2 className="text-pt-text text-xl font-semibold tracking-tight">Check in</h2>
              <p className="text-pt-muted text-sm">Check the batteries are charging, then tick each piece. If you can't get to it before the next pickup, that creator's pickup check covers it.</p>
            </div>
            {checklist}
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional), e.g. lens cap scratched"
              className="w-full bg-pt-surface rounded-xl px-4 py-3 text-pt-text text-[15px] placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent" />
            <button disabled={!allDone || busy} onClick={() => run(() => checkInGear({ id: b.id, missing: [...missing], note }))}
              className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Checked in'}</button>
          </section>
        )}

        {b.return?.photos?.length ? (
          <div className="space-y-1.5">
            <p className="text-pt-muted text-xs uppercase tracking-wider px-1">Return photo{b.return.photos.length > 1 ? 's' : ''}</p>
            <div className="flex gap-2">{b.return.photos.map(u => (
              <div key={u} className="w-24 space-y-1"><button onClick={() => setZoom(u)}><img src={u} alt="" className="w-24 h-24 rounded-xl object-cover" /></button><PhotoStamp url={u} /></div>
            ))}</div>
          </div>
        ) : null}

        {(b.pickup?.missing?.length || b.problems?.length || b.checkIn?.missing?.length) ? (
          <div className="bg-amber-500/10 rounded-2xl px-4 py-3 space-y-1 text-[15px]">
            <p className="text-amber-200 font-medium">Problems</p>
            {b.pickup?.missing?.map((m, i) => <p key={`p${i}`} className="text-pt-text">{m.qty}× {m.name} missing at pickup</p>)}
            {b.problems?.map((m, i) => <p key={`q${i}`} className="text-pt-text">{m.qty}× {m.name} {m.kind === 'missing_after' ? 'reported missing by the next person who picked it up' : 'missing at check-in'}</p>)}
          </div>
        ) : null}

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

        {b.status === 'held' && mine && <ChangeGear b={b} />}

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
      {zoom && <ImageLightbox src={zoom} alt="Return photo" onClose={() => setZoom(null)} />}
    </div>
  )
}
