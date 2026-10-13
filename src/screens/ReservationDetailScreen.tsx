import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { useLocations } from '../hooks/useLocations'
import {
  subscribeToReservation, cancelReservation, declineReservation,
  setLinePick, setBuildState, markPacked, confirmPickup, startReturn, checkIn,
  ACTIVE_STATUSES, type Reservation, type ReservationLine, type BuildLine,
} from '../services/reservations'
import ProofPhotos, { PhotoStrip } from '../components/ProofPhotos'
import { pickupDay, isLate, returnDueDay, RETURN_DEADLINE_HOUR } from '../../functions/src/booking'
import { useBookingSettings } from '../hooks/useBookings'
import { formatDay, formatRange } from '../lib/dates'
import { STATUS_LABELS, STATUS_STYLES, JOURNEY, statusLabel } from '../lib/reservationLabels'

function errText(err: unknown) {
  return err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Try again."
}

export default function ReservationDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isStaff, profile } = useSession()
  const [res, setRes] = useState<Reservation | null | undefined>(undefined)
  const settings = useBookingSettings()

  useEffect(() => id ? subscribeToReservation(id, setRes) : undefined, [id])

  if (res === undefined) return <Centered>Loading…</Centered>
  if (res === null) return <Centered>Booking not found.</Centered>

  const active = ACTIVE_STATUSES.includes(res.status)
  const overdue = isLate(res.status, res.endDate, settings)
  const dueBy = `${RETURN_DEADLINE_HOUR}am ${formatDay(returnDueDay(res.endDate, settings))}`
  const mine = res.creatorEmail === profile.email
  const s = res.status
  const pickup = pickupDay(res.startDate, settings)

  return (
    <div className="min-h-screen bg-pt-bg pb-12">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button onClick={() => navigate('/reservations')} className="text-pt-text text-base font-medium py-1">‹ {isStaff ? 'Queue' : 'Bookings'}</button>
        <span className={`text-xs px-2.5 py-1 rounded-full ${overdue ? 'bg-red-500/20 text-red-300' : STATUS_STYLES[s]}`}>
          {overdue ? 'Late' : statusLabel(res)}
        </span>
      </div>

      <div className="p-4 space-y-5">
        {params.get('new') && s === 'requested' && (
          <Banner tone="green" title="You're booked ✓">
            These props are held for your dates. You'll see the status change here as the arts department gets them ready.
          </Banner>
        )}

        <div>
          <h1 className="font-display text-2xl text-pt-text leading-tight">{res.title}</h1>
          <p className="text-pt-text mt-1">📅 {formatRange(res.startDate, res.endDate)}</p>
          {active && pickup !== res.startDate && (
            <p className="text-amber-300 text-sm mt-0.5">Pick up {formatDay(pickup)}: the prop room is closed on the shoot day.</p>
          )}
          {isStaff && <p className="text-pt-muted text-sm mt-0.5">Booked by {res.creatorName} · {res.creatorEmail}</p>}
        </div>

        {active || s === 'returned' ? <Journey res={res} /> : null}

        {res.statusReason && <Banner tone="red" title={s === 'declined' ? 'Declined' : 'Note'}>{res.statusReason}</Banner>}
        {res.notes && <Section title="Notes from the creator"><p className="text-pt-text text-sm whitespace-pre-wrap">{res.notes}</p></Section>}

        {/* ── Arts: picking ── */}
        {isStaff && (s === 'requested' || s === 'preparing') && <PickAndPack res={res} />}

        {/* ── Everyone else before packing: what's in it ── */}
        {!(isStaff && (s === 'requested' || s === 'preparing')) && <ContentsList res={res} />}

        {/* ── Packed: proof + creator sign-off ── */}
        {res.packPhotos && (
          <Section title={`Packed ${res.packedAt ? `· ${formatDay(res.packedAt.slice(0, 10))}` : ''}`}>
            <PhotoStrip urls={res.packPhotos} title="What was packed" />
            {res.packNote && <p className="text-pt-text text-sm mt-2">📝 {res.packNote}</p>}
          </Section>
        )}
        {s === 'packed' && mine && <PickupSignOff res={res} />}
        {s === 'packed' && !mine && <Banner tone="amber" title="Waiting for pickup">The creator signs off on their phone when they collect.</Banner>}

        {res.pickup && (
          <Banner tone={res.pickup.allReceived ? 'green' : 'red'} title={res.pickup.allReceived ? 'Collected: creator confirmed everything ✓' : 'Collected, with an issue'}>
            Signed by {res.pickup.by} on {formatDay(res.pickup.at.slice(0, 10))} at {time(res.pickup.at)}
            {res.pickup.issue && <><br /><strong>Reported:</strong> {res.pickup.issue}</>}
          </Banner>
        )}

        {/* ── Return ── */}
        {s === 'collected' && mine && (
          <Banner tone={overdue ? 'red' : 'amber'} title={overdue ? 'These props are late' : `Bring these back the night of the shoot`}>
            {overdue ? `They were due back by ${dueBy}. You can't book more props until they're returned.` : `They count as late after ${dueBy}.`}
          </Banner>
        )}
        {s === 'collected' && mine && <ReturnForm res={res} />}
        {s === 'collected' && isStaff && !mine && (
          <Banner tone={overdue ? 'red' : 'amber'} title={overdue ? `Late: was due back by ${dueBy}` : 'Out with the creator'}>
            {overdue ? 'They can’t book more props until this is returned.' : `Due back the night of the shoot; late after ${dueBy}.`} The creator photographs everything when returning.
          </Banner>
        )}
        {res.returnInfo && (
          <Section title={`Returned ${formatDay(res.returnInfo.at.slice(0, 10))} at ${time(res.returnInfo.at)}`}>
            <PhotoStrip urls={res.returnInfo.photos} title={res.returnInfo.byStaff ? 'Return photos (taken by arts dept)' : 'How the creator left it'} />
            {res.returnInfo.note && <p className="text-pt-text text-sm mt-2">📝 {res.returnInfo.note}</p>}
          </Section>
        )}
        {s === 'return_pending' && !isStaff && <Banner tone="teal" title="Thanks! Being checked in">The arts department will check everything and let you know.</Banner>}

        {/* ── Arts: check-in ── */}
        {isStaff && (s === 'return_pending' || s === 'collected') && <CheckInForm res={res} />}
        {s === 'returned' && <CheckInSummary res={res} />}

        {/* ── Cancel / decline ── */}
        {['requested', 'preparing', 'packed'].includes(s) && <EndEarly res={res} mine={mine} isStaff={isStaff} />}

        <History res={res} />
      </div>
    </div>
  )
}

// ─── Progress line ───────────────────────────────────────────────────────────

function Journey({ res }: { res: Reservation }) {
  const at = JOURNEY.findIndex(j => j.status === res.status)
  return (
    <div className="flex items-start">
      {JOURNEY.map((j, i) => (
        <div key={j.status} className="flex-1 flex flex-col items-center text-center">
          <div className="flex items-center w-full">
            <div className={`flex-1 h-0.5 ${i === 0 ? 'opacity-0' : i <= at ? 'bg-pt-accent' : 'bg-pt-border'}`} />
            <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${i < at ? 'bg-pt-accent' : i === at ? 'bg-pt-accent ring-4 ring-pt-accent/30' : 'bg-pt-border'}`} />
            <div className={`flex-1 h-0.5 ${i === JOURNEY.length - 1 ? 'opacity-0' : i < at ? 'bg-pt-accent' : 'bg-pt-border'}`} />
          </div>
          <span className={`text-[10px] mt-1 leading-tight ${i === at ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>{j.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Arts: the picking list ──────────────────────────────────────────────────

function PickAndPack({ res }: { res: Reservation }) {
  const items = useItems()
  const bins = useBins()
  const locations = useLocations()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Ticks show instantly; the server copy catches up a moment later.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [unavailableFor, setUnavailableFor] = useState<{ kind: 'line' | 'build'; key: string } | null>(null)
  const [reason, setReason] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [packing, setPacking] = useState(false)

  // Walk the shelves in order: storage area, then bin, then name.
  const groups = useMemo(() => {
    const itemById = new Map(items.map(i => [i.id, i]))
    const binById = new Map(bins.map(b => [b.id, b]))
    const locById = new Map(locations.map(l => [l.id, l]))
    const keyed = res.lines.map(line => {
      const item = itemById.get(line.itemId)
      const bin = item?.binId ? binById.get(item.binId) : undefined
      const loc = locById.get(bin?.locationId ?? item?.locationId ?? '')
      return { line, where: loc ? (bin ? `${loc.name} › ${bin.label}` : loc.name) : bin?.label ?? 'No storage spot set' }
    })
    const map = new Map<string, ReservationLine[]>()
    keyed.sort((a, b) => (a.where === 'No storage spot set' ? 1 : 0) - (b.where === 'No storage spot set' ? 1 : 0)
      || a.where.localeCompare(b.where, 'en', { numeric: true }) || a.line.itemName.localeCompare(b.line.itemName))
    for (const k of keyed) map.set(k.where, [...(map.get(k.where) ?? []), k.line])
    return [...map]
  }, [res.lines, items, bins, locations])

  const builds = res.builds ?? []
  const total = res.lines.length + builds.length
  const resolved = res.lines.filter(l => optimistic[l.itemId] ?? !!l.pick).length
    + builds.filter(b => optimistic[b.id] ?? b.state !== 'todo').length
  const ready = resolved === total && photos.length > 0 && !uploading

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusyKey(key); setError(null)
    try { await fn() } catch (err) { setError(errText(err)) } finally { setBusyKey(null) }
  }

  // Tick/untick with instant feedback. Taps while saving are ignored, so a
  // double-tap can't accidentally untick.
  async function toggle(key: string, ticked: boolean, save: (next: boolean) => Promise<unknown>) {
    if (busyKey) return
    setOptimistic(o => ({ ...o, [key]: !ticked }))
    try { setBusyKey(key); setError(null); await save(!ticked) }
    catch (err) {
      setError(errText(err))
      setOptimistic(o => { const n = { ...o }; delete n[key]; return n })   // undo the instant tick
    } finally { setBusyKey(null) }
  }

  // Drop instant ticks once the server's copy agrees.
  useEffect(() => {
    setOptimistic(o => {
      const n = { ...o }
      for (const l of res.lines) if (n[l.itemId] !== undefined && n[l.itemId] === (l.pick?.state === 'picked')) delete n[l.itemId]
      for (const b of res.builds ?? []) if (n[b.id] !== undefined && n[b.id] === (b.state === 'done')) delete n[b.id]
      return Object.keys(n).length === Object.keys(o).length ? o : n
    })
  }, [res])

  async function confirmUnavailable() {
    if (!unavailableFor) return
    const { kind, key } = unavailableFor
    await act(key, () => kind === 'line'
      ? setLinePick({ id: res.id, itemId: key, state: 'unavailable', reason: reason.trim() })
      : setBuildState({ id: res.id, buildId: key, state: 'unavailable', reason: reason.trim() }))
    setUnavailableFor(null); setReason('')
  }

  async function pack() {
    setPacking(true); setError(null)
    try { await markPacked({ id: res.id, photos, ...(note.trim() ? { note: note.trim() } : {}) }) }
    catch (err) { setError(errText(err)) }
    finally { setPacking(false) }
  }

  const unavailableForm = (key: string) => unavailableFor?.key === key && (
    <div className="mt-2 space-y-2">
      <input value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={300}
        placeholder="Why? (the creator sees this)" className="w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent" />
      <div className="flex gap-2">
        <button onClick={() => { setUnavailableFor(null); setReason('') }} className="flex-1 py-2 rounded-lg border border-pt-border text-pt-muted text-xs">Back</button>
        <button onClick={confirmUnavailable} disabled={!reason.trim() || busyKey === key}
          className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-300 text-xs font-semibold disabled:opacity-40">Mark not available</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-pt-text font-semibold">Picking list</p>
        <span className="text-pt-muted text-sm">{resolved} of {total} done</span>
      </div>
      <div className="h-1.5 bg-pt-border rounded-full overflow-hidden">
        <div className="h-full bg-pt-accent transition-all" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
      </div>

      {groups.map(([where, lines]) => (
        <div key={where}>
          <p className="text-pt-accent text-xs uppercase tracking-wider mb-1.5">📍 {where}</p>
          <div className="space-y-2">
            {lines.map(line => {
              const picked = optimistic[line.itemId] ?? line.pick?.state === 'picked'
              const gone = line.pick?.state === 'unavailable'
              return (
                <div key={line.itemId} className={`rounded-2xl border p-2.5 ${picked ? 'bg-green-500/10 border-green-500/40' : gone ? 'bg-red-500/5 border-red-500/30' : 'bg-pt-surface border-pt-border'}`}>
                  <div className="flex items-center gap-3">
                    <button disabled={gone}
                      onClick={() => toggle(line.itemId, picked, next => setLinePick({ id: res.id, itemId: line.itemId, state: next ? 'picked' : 'todo' }))}
                      aria-label={picked ? 'Untick' : 'Tick as picked'}
                      className={`w-11 h-11 rounded-xl border-2 shrink-0 flex items-center justify-center text-xl ${picked ? 'bg-green-500 border-green-500 text-stone-900' : 'border-pt-muted'} disabled:opacity-50`}>
                      {picked ? '✓' : gone ? '✕' : ''}
                    </button>
                    <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">
                      {line.photo && <img src={line.photo} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${gone ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{line.itemName}</p>
                      {gone && <p className="text-red-300 text-xs">Not available: {line.pick!.reason}</p>}
                    </div>
                    <span className="text-pt-text text-lg font-bold shrink-0">×{line.qty}</span>
                  </div>
                  {!line.pick && !unavailableFor && (
                    <button onClick={() => setUnavailableFor({ kind: 'line', key: line.itemId })} className="mt-1 text-pt-muted text-xs underline">
                      Can't find it / broken?
                    </button>
                  )}
                  {unavailableForm(line.itemId)}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {builds.length > 0 && (
        <div>
          <p className="text-violet-300 text-xs uppercase tracking-wider mb-1.5">🛠️ To build or source</p>
          <div className="space-y-2">
            {builds.map(b => <BuildRow key={b.id} b={b} done={optimistic[b.id] ?? b.state === 'done'}
              onToggle={() => toggle(b.id, optimistic[b.id] ?? b.state === 'done', next => setBuildState({ id: res.id, buildId: b.id, state: next ? 'done' : 'todo' }))}
              onUnavailable={!unavailableFor && b.state === 'todo' ? () => setUnavailableFor({ kind: 'build', key: b.id }) : undefined}
              extra={unavailableForm(b.id)} />)}
          </div>
        </div>
      )}

      <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
        <ProofPhotos folder={`reservation-photos/${res.id}/pack`} urls={photos} onChange={setPhotos} onUploading={setUploading}
          label="📷 Photo of everything packed (required)"
          hint="Show every prop in the bin before it goes out. This is the proof of what was handed over." />
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
          placeholder="Note for the creator (optional), e.g. 'Chairs are stacked by the door'"
          className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
        {error && <p className="text-red-300 text-sm">{error}</p>}
        <button onClick={pack} disabled={!ready || packing}
          className="w-full py-3.5 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {packing ? 'Saving…' : 'Mark packed & ready for pickup'}
        </button>
        {!ready && (
          <p className="text-pt-muted text-xs text-center">
            {resolved < total ? `Tick off or mark not available: ${total - resolved} left.` : uploading ? 'Photo uploading…' : 'Add at least one photo.'}
          </p>
        )}
      </div>
    </div>
  )
}

function BuildRow({ b, done, onToggle, onUnavailable, extra }: {
  b: BuildLine; done: boolean; onToggle: () => void; onUnavailable?: () => void; extra?: ReactNode
}) {
  const gone = b.state === 'unavailable'
  return (
    <div className={`rounded-2xl border p-2.5 ${done ? 'bg-green-500/10 border-green-500/40' : gone ? 'bg-red-500/5 border-red-500/30' : 'bg-pt-surface border-violet-500/40'}`}>
      <div className="flex items-center gap-3">
        <button disabled={gone} onClick={onToggle} aria-label={done ? 'Untick' : 'Tick as made'}
          className={`w-11 h-11 rounded-xl border-2 shrink-0 flex items-center justify-center text-xl ${done ? 'bg-green-500 border-green-500 text-stone-900' : 'border-pt-muted'} disabled:opacity-50`}>
          {done ? '✓' : gone ? '✕' : ''}
        </button>
        {b.refPhoto && <a href={b.refPhoto} target="_blank" rel="noreferrer" className="w-12 h-12 rounded-xl overflow-hidden shrink-0"><img src={b.refPhoto} alt="" className="w-full h-full object-cover" /></a>}
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${gone ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{b.description}</p>
          {gone && <p className="text-red-300 text-xs">Can't be made: {b.reason}</p>}
        </div>
        <span className="text-pt-text text-lg font-bold shrink-0">×{b.qty}</span>
      </div>
      {onUnavailable && <button onClick={onUnavailable} className="mt-1 text-pt-muted text-xs underline">Can't make it?</button>}
      {extra}
    </div>
  )
}

// ─── Read-only contents (creator view, and staff after packing) ─────────────

function ContentsList({ res }: { res: Reservation }) {
  const navigate = useNavigate()
  const builds = res.builds ?? []
  return (
    <Section title="Props">
      <div className="space-y-2">
        {res.lines.map(l => {
          const gone = l.pick?.state === 'unavailable'
          return (
            <button key={l.itemId} onClick={() => navigate(`/item/${l.itemId}`)}
              className={`w-full flex items-center gap-3 bg-pt-surface border rounded-2xl p-2.5 text-left active:opacity-75 ${gone ? 'border-red-500/30' : 'border-pt-border'}`}>
              <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">
                {l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${gone ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{l.itemName}</p>
                {gone && <p className="text-red-300 text-xs">Not available: {l.pick!.reason}</p>}
                {l.pick?.state === 'picked' && <p className="text-green-400 text-xs">✓ Picked</p>}
              </div>
              <span className="text-pt-text font-semibold">×{l.qty}</span>
            </button>
          )
        })}
        {builds.map(b => (
          <div key={b.id} className={`flex items-center gap-3 bg-pt-surface border rounded-2xl p-2.5 ${b.state === 'unavailable' ? 'border-red-500/30' : 'border-violet-500/40'}`}>
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 overflow-hidden shrink-0 flex items-center justify-center text-xl">
              {b.refPhoto ? <img src={b.refPhoto} alt="" className="w-full h-full object-cover" /> : '🛠️'}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${b.state === 'unavailable' ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{b.description}</p>
              <p className={`text-xs ${b.state === 'unavailable' ? 'text-red-300' : b.state === 'done' ? 'text-green-400' : 'text-violet-300'}`}>
                {b.state === 'unavailable' ? `Can't be made: ${b.reason}` : b.state === 'done' ? '✓ Made' : 'Being built or sourced'}
              </p>
            </div>
            <span className="text-pt-text font-semibold">×{b.qty}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Creator: pickup sign-off ────────────────────────────────────────────────

function PickupSignOff({ res }: { res: Reservation }) {
  const [mode, setMode] = useState<'ask' | 'issue'>('ask')
  const [issue, setIssue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const going = res.lines.filter(l => l.pick?.state === 'picked')
  const builds = (res.builds ?? []).filter(b => b.state === 'done')

  async function sign(allReceived: boolean) {
    setBusy(true); setError(null)
    try { await confirmPickup({ id: res.id, allReceived, ...(allReceived ? {} : { issue: issue.trim() }) }) }
    catch (err) { setError(errText(err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="bg-pt-accent/10 border border-pt-accent/50 rounded-2xl p-4 space-y-3">
      <p className="text-pt-accent font-semibold text-lg">Ready for pickup!</p>
      <p className="text-pt-text text-sm">When you collect, check you have everything below, then sign off. This confirms what you took.</p>
      <ul className="space-y-1">
        {going.map(l => <li key={l.itemId} className="text-pt-text text-sm">☐ {l.itemName} <strong>×{l.qty}</strong></li>)}
        {builds.map(b => <li key={b.id} className="text-pt-text text-sm">☐ {b.description} <strong>×{b.qty}</strong></li>)}
      </ul>
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {mode === 'ask' ? (
        <div className="space-y-2">
          <button onClick={() => sign(true)} disabled={busy} className="w-full py-3.5 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
            {busy ? 'Saving…' : "✓ I've got everything"}
          </button>
          <button onClick={() => setMode('issue')} className="w-full py-2.5 rounded-xl border border-pt-border text-pt-text text-sm">Something's missing or wrong</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea value={issue} onChange={e => setIssue(e.target.value)} rows={3} maxLength={1000} autoFocus
            placeholder="What's missing or wrong? e.g. Only 3 chairs in the bin"
            className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
          <div className="flex gap-2">
            <button onClick={() => setMode('ask')} className="flex-1 py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm">Back</button>
            <button onClick={() => sign(false)} disabled={busy || !issue.trim()} className="flex-1 py-2.5 rounded-xl bg-red-500/20 text-red-300 text-sm font-semibold disabled:opacity-40">
              Collect & report it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Creator: return with photos ─────────────────────────────────────────────

function ReturnForm({ res }: { res: Reservation }) {
  const [open, setOpen] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setError(null)
    try { await startReturn({ id: res.id, photos, ...(note.trim() ? { note: note.trim() } : {}) }) }
    catch (err) { setError(errText(err)) }
    finally { setBusy(false) }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold">
      Return these props
    </button>
  )
  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
      <p className="text-pt-text font-semibold">Returning</p>
      <ProofPhotos folder={`reservation-photos/${res.id}/return`} urls={photos} onChange={setPhotos} onUploading={setUploading}
        label="📷 Photo of everything you're returning (required)"
        hint="Show all the props together where you're leaving them. This protects you if anything is questioned later." />
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
        placeholder="Where did you leave them? Anything to flag? (optional)"
        className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 py-3 rounded-xl border border-pt-border text-pt-muted text-sm">Back</button>
        <button onClick={submit} disabled={busy || uploading || photos.length === 0}
          className="flex-[2] py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : uploading ? 'Uploading…' : 'Confirm return'}
        </button>
      </div>
    </div>
  )
}

// ─── Arts: check-in ──────────────────────────────────────────────────────────

type Result = 'ok' | 'damaged' | 'missing'

function CheckInForm({ res }: { res: Reservation }) {
  const lines = res.lines.filter(l => l.pick?.state === 'picked')
  const builds = (res.builds ?? []).filter(b => b.state === 'done')
  const [results, setResults] = useState<Record<string, { result?: Result; note: string; missingQty: number }>>(
    () => Object.fromEntries(lines.map(l => [l.itemId, { note: '', missingQty: l.qty }])))
  const [addBuild, setAddBuild] = useState<Record<string, boolean>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(res.status === 'return_pending')

  const set = (id: string, patch: Partial<{ result: Result; note: string; missingQty: number }>) =>
    setResults(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  const complete = lines.every(l => {
    const r = results[l.itemId]
    return r?.result && (r.result === 'ok' || r.note.trim())
  })

  async function submit() {
    setBusy(true); setError(null)
    try {
      await checkIn({
        id: res.id, photos,
        lines: lines.map(l => {
          const r = results[l.itemId]
          return { itemId: l.itemId, result: r.result!, ...(r.result === 'missing' ? { missingQty: r.missingQty } : {}), ...(r.note.trim() ? { note: r.note.trim() } : {}) }
        }),
        builds: builds.map(b => ({ buildId: b.id, addToInventory: !!addBuild[b.id] })),
      })
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full py-3 rounded-xl border border-pt-border text-pt-muted text-sm">
      Dropped off without the app? Check it in anyway
    </button>
  )

  const btn = (on: boolean, tone: string) => `flex-1 py-2 rounded-lg text-xs font-semibold border ${on ? tone : 'border-pt-border text-pt-muted'}`

  return (
    <div className="space-y-3">
      <p className="text-pt-text font-semibold">Check in</p>
      <p className="text-pt-muted text-xs">Compare against the pack photos above. Damaged props are flagged on their page; missing ones stop being bookable until found.</p>
      {lines.map(l => {
        const r = results[l.itemId]
        return (
          <div key={l.itemId} className="bg-pt-surface border border-pt-border rounded-2xl p-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-pt-border overflow-hidden shrink-0">{l.photo && <img src={l.photo} alt="" className="w-full h-full object-cover" />}</div>
              <p className="flex-1 text-pt-text text-sm font-medium truncate">{l.itemName}</p>
              <span className="text-pt-text font-bold">×{l.qty}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => set(l.itemId, { result: 'ok' })} className={btn(r.result === 'ok', 'bg-green-500/20 border-green-500/50 text-green-400')}>✓ Fine</button>
              <button onClick={() => set(l.itemId, { result: 'damaged' })} className={btn(r.result === 'damaged', 'bg-amber-500/20 border-amber-500/50 text-amber-300')}>Damaged</button>
              <button onClick={() => set(l.itemId, { result: 'missing' })} className={btn(r.result === 'missing', 'bg-red-500/20 border-red-500/50 text-red-300')}>Missing</button>
            </div>
            {r.result === 'missing' && l.qty > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-pt-muted">How many missing?</span>
                <button onClick={() => set(l.itemId, { missingQty: Math.max(1, r.missingQty - 1) })} className="w-8 h-8 rounded-full bg-pt-bg border border-pt-border text-pt-text">−</button>
                <span className="text-pt-text w-6 text-center">{r.missingQty}</span>
                <button onClick={() => set(l.itemId, { missingQty: Math.min(l.qty, r.missingQty + 1) })} className="w-8 h-8 rounded-full bg-pt-bg border border-pt-border text-pt-text">+</button>
              </div>
            )}
            {r.result && r.result !== 'ok' && (
              <input value={r.note} onChange={e => set(l.itemId, { note: e.target.value })} maxLength={500}
                placeholder={r.result === 'damaged' ? 'What happened? (required)' : 'Details (required)'}
                className="w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-sm text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent" />
            )}
          </div>
        )
      })}
      {builds.map(b => (
        <label key={b.id} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-3">
          <input type="checkbox" checked={!!addBuild[b.id]} onChange={e => setAddBuild(a => ({ ...a, [b.id]: e.target.checked }))} className="w-5 h-5 accent-violet-500" />
          <span className="flex-1 text-sm text-pt-text">Add "{b.description}" (×{b.qty}) to the inventory</span>
        </label>
      ))}
      <ProofPhotos folder={`reservation-photos/${res.id}/checkin`} urls={photos} onChange={setPhotos} onUploading={setUploading}
        label="📷 Check-in photos (optional)" hint="Especially of any damage." />
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <button onClick={submit} disabled={!complete || busy || uploading}
        className="w-full py-3.5 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
        {busy ? 'Saving…' : 'Complete check-in'}
      </button>
      {!complete && <p className="text-pt-muted text-xs text-center">Choose Fine, Damaged or Missing for every prop (with a note for problems).</p>}
    </div>
  )
}

function CheckInSummary({ res }: { res: Reservation }) {
  const checked = res.lines.filter(l => l.checkIn)
  const problems = checked.filter(l => l.checkIn!.result !== 'ok')
  return (
    <Section title={`Checked in ${res.checkedInAt ? `· ${formatDay(res.checkedInAt.slice(0, 10))}` : ''}`}>
      {res.returnedWithoutCreatorPhoto && <p className="text-amber-300 text-xs mb-2">Returned without the creator's return photo.</p>}
      {problems.length === 0
        ? <p className="text-green-400 text-sm">✓ Everything came back fine.</p>
        : <ul className="space-y-1.5">
            {problems.map(l => (
              <li key={l.itemId} className={`text-sm ${l.checkIn!.result === 'missing' ? 'text-red-300' : 'text-amber-300'}`}>
                {l.itemName}: {l.checkIn!.result === 'missing' ? `${l.checkIn!.missingQty ?? 1} missing` : 'damaged'}. {l.checkIn!.note}
              </li>
            ))}
          </ul>}
      {(res.builds ?? []).filter(b => b.addedItemId).map(b => (
        <p key={b.id} className="text-violet-300 text-xs mt-1">"{b.description}" was added to the inventory.</p>
      ))}
      <div className="mt-2"><PhotoStrip urls={res.checkInPhotos} title="Check-in photos" /></div>
    </Section>
  )
}

// ─── Cancel / decline ────────────────────────────────────────────────────────

function EndEarly({ res, mine, isStaff }: { res: Reservation; mine: boolean; isStaff: boolean }) {
  const [action, setAction] = useState<'cancel' | 'decline' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try {
      if (action === 'cancel') await cancelReservation({ id: res.id })
      else await declineReservation({ id: res.id, reason: reason.trim() })
      setAction(null)
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  if (action) return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
      <p className="text-pt-text text-sm">{action === 'cancel' ? 'Cancel this booking? The props become available to others.' : 'Decline this booking? The creator will see your reason.'}</p>
      {action === 'decline' && (
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Reason (the creator sees this) *"
          className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent resize-none" />
      )}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => { setAction(null); setError(null) }} className="flex-1 py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm">Back</button>
        <button onClick={run} disabled={busy || (action === 'decline' && !reason.trim())}
          className="flex-1 py-2.5 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Confirm'}</button>
      </div>
    </div>
  )
  return (
    <div className="flex gap-2">
      {(mine || isStaff) && <button onClick={() => setAction('cancel')} className="flex-1 py-3 rounded-xl bg-pt-surface border border-pt-border text-pt-muted text-sm font-medium">Cancel booking</button>}
      {isStaff && !mine && <button onClick={() => setAction('decline')} className="flex-1 py-3 rounded-xl bg-pt-surface border border-pt-border text-red-300 text-sm font-medium">Decline</button>}
    </div>
  )
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function History({ res }: { res: Reservation }) {
  return (
    <Section title="History">
      <ul className="space-y-1">
        {res.history.map((h, i) => (
          <li key={i} className="text-pt-muted text-xs">
            {formatDay(h.at.slice(0, 10), { month: 'short', day: 'numeric' })} {time(h.at)} · {h.status === 'returned' ? 'Checked in' : STATUS_LABELS[h.status]} by {h.by}
            {h.reason ? ` ("${h.reason}")` : ''}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div><p className="text-pt-muted text-xs uppercase tracking-wider mb-2">{title}</p>{children}</div>
}

const BANNER_TONES = {
  green: 'bg-green-500/10 border-green-500/30 text-green-400',
  red:   'bg-red-500/10 border-red-500/30 text-red-300',
  amber: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  teal:  'bg-teal-500/10 border-teal-500/30 text-teal-300',
}

function Banner({ tone, title, children }: { tone: keyof typeof BANNER_TONES; title: string; children: ReactNode }) {
  return (
    <div className={`border rounded-xl px-4 py-3 ${BANNER_TONES[tone]}`}>
      <p className="font-medium">{title}</p>
      <p className="text-pt-text/80 text-sm mt-0.5">{children}</p>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-pt-bg flex items-center justify-center text-pt-muted text-sm">{children}</div>
}
