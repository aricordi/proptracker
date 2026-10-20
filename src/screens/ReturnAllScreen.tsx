// "Return everything" (owner, Oct 20: props and gear usually come back together, but you can still return them
// separately). One screen for a shoot: tick what you're bringing back (all ticked to start), one photo of everything
// together, then each props request goes through startReturn and each gear booking through returnGear (no new server code).
// /return?ref=props:<id> | gear:<id> | <group key>
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import { startReturn } from '../services/reservations'
import { returnGear, type GearBooking } from '../services/gear'
import UsedByPicker, { usedByOf } from '../components/UsedByPicker'
import { useShootLabel } from '../activeShoot'
import { fmtTime } from '../../functions/src/gearBooking'
import { formatDay } from '../lib/dates'
import ProofPhotos from '../components/ProofPhotos'
import { useReturnGroups, findReturnGroup, canReturnProps, canReturnGear } from '../hooks/useReturnables'

interface Part { key: string; kind: 'props' | 'gear'; id: string; title: string; detail: string; booking?: GearBooking }

function errText(err: unknown) {
  return err instanceof FirebaseError ? err.message.replace(/^Firebase: /, '').replace(/ \(functions\/[a-z-]+\)\.?$/, '') : 'Something went wrong. Try again.'
}

export default function ReturnAllScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profile } = useSession()
  const label = useShootLabel()
  const groups = useReturnGroups(profile.email)
  const ref = params.get('ref') ?? ''
  const group = useMemo(() => groups && (findReturnGroup(groups, ref) ?? (groups.length === 1 ? groups[0] : undefined)), [groups, ref])

  const parts: Part[] = useMemo(() => !group ? [] : [
    ...group.props.filter(canReturnProps).map(r => ({
      key: `props:${r.id}`, kind: 'props' as const, id: r.id, title: `Props & costumes · ${r.lines.length + (r.builds ?? []).length}`,
      detail: [...r.lines.map(l => l.qty > 1 ? `${l.itemName} ×${l.qty}` : l.itemName), ...(r.builds ?? []).filter(b => b.state === 'done').map(b => b.description)].join(', '),
    })),
    ...group.gear.filter(canReturnGear).map(b => ({
      key: `gear:${b.id}`, kind: 'gear' as const, id: b.id, booking: b, title: `Gear · ${fmtTime(b.start)}–${fmtTime(b.end)}`,
      detail: b.lines.map(l => l.qty > 1 ? `${l.name} ×${l.qty}` : l.name).join(', '),
    })),
  ], [group])

  // Everything starts ticked; untick what you're keeping for now.
  const [off, setOff] = useState<Set<string>>(new Set())
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string[] | null>(null)
  const [notUsing, setNotUsing] = useState<Record<string, Set<string>>>({})   // shared gear: who didn't use it

  const ticked = parts.filter(p => !off.has(p.key))
  const gearTicked = ticked.some(p => p.kind === 'gear')
  // Photos go in the folder of one of your own requests (the same links are attached to each one).
  const folder = parts[0] ? (parts[0].kind === 'props' ? `reservation-photos/${parts[0].id}/return` : `gear-returns/${parts[0].id}`) : ''

  async function submit() {
    setBusy(true); setErrors({})
    const ok: string[] = [], bad: Record<string, string> = {}
    for (const p of ticked) {
      try {
        if (p.kind === 'props') await startReturn({ id: p.id, photos, ...(note.trim() ? { note: note.trim() } : {}) })
        else await returnGear({ id: p.id, photos, usedBy: p.booking ? usedByOf(p.booking, notUsing[p.id] ?? new Set()) : undefined })
        ok.push(p.key)
      } catch (err) { bad[p.key] = errText(err) }
    }
    setBusy(false)
    if (Object.keys(bad).length) { setErrors(bad); if (ok.length) setOff(new Set([...off, ...ok])) }
    else setDone(ok)
  }

  const header = (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
      <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] py-1">‹ Back</button>
    </div>
  )

  if (done) return (
    <div className="min-h-full bg-pt-bg">
      {header}
      <div className="px-4 pt-10 text-center space-y-4">
        <span className="mx-auto w-16 h-16 rounded-full bg-green-600 text-white grid place-items-center text-3xl">✓</span>
        <h1 className="font-display text-[28px] text-pt-text">All returned</h1>
        <p className="text-pt-muted text-[15px]">Thanks! {done.length > 1 ? 'Each team' : 'The team'} will check everything in. You'll see it on My requests.</p>
        <button onClick={() => navigate('/requests', { replace: true })} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">See my requests</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      {header}
      <div className="px-4 space-y-6">
        <div>
          <h1 className="font-display text-[34px] text-pt-text">Return everything</h1>
          {group && <p className="text-pt-muted text-[15px]">{group.shoot ? label(group.shoot) : `${formatDay(group.date)} shoot`}</p>}
        </div>

        {groups === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {groups !== null && parts.length === 0 && (
          <div className="text-center space-y-3 pt-6">
            <p className="text-pt-muted text-[15px]">Nothing to bring back here. It may already be returned.</p>
            <button onClick={() => navigate('/requests')} className="text-pt-accent text-sm font-medium tap">My requests</button>
          </div>
        )}

        {parts.length > 0 && (
          <>
            <section className="space-y-2">
              <h2 className="text-pt-text text-lg font-semibold">What you're bringing back</h2>
              {parts.map(p => {
                const on = !off.has(p.key)
                return (
                  <button key={p.key} onClick={() => { const n = new Set(off); if (on) n.add(p.key); else n.delete(p.key); setOff(n) }}
                    aria-pressed={on} className="w-full flex items-start gap-3 bg-pt-surface shadow-hairline rounded-2xl px-4 py-3 text-left">
                    <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full grid place-items-center text-sm font-bold ${on ? 'bg-pt-accent text-stone-900' : 'shadow-[inset_0_0_0_2px_#3A3A3C]'}`}>{on ? '✓' : ''}</span>
                    <span className="min-w-0 flex-1">
                      <b className={`block text-[15px] ${on ? 'text-pt-text' : 'text-pt-muted'}`}>{p.title}</b>
                      <span className="block text-pt-muted text-xs line-clamp-2">{p.detail}</span>
                      {!on && <span className="block text-pt-muted text-xs mt-1">Keeping it for now. Return it later from My requests.</span>}
                      {errors[p.key] && <span className="block text-red-300 text-xs mt-1">{errors[p.key]}</span>}
                    </span>
                  </button>
                )
              })}
              {parts.length > 1 && <p className="text-pt-muted text-xs px-1">Bringing something back later? Untick it.</p>}
            </section>

            {ticked.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-pt-text text-lg font-semibold">Before you go</h2>
                <ol className="bg-pt-surface rounded-2xl px-4 py-3 space-y-1 text-[15px] text-pt-text list-decimal list-inside">
                  <li>Put everything together where you're leaving it.</li>
                  {gearTicked && <li>Every piece of gear back in its case.</li>}
                  {gearTicked && <li>Batteries plugged into the chargers on the shelf.</li>}
                  <li>Take one photo that shows it all.</li>
                </ol>
                <ProofPhotos folder={folder} urls={photos} onChange={setPhotos} onUploading={setUploading}
                  label="Photo of everything (required)" hint="It protects you if anything is questioned later." max={6} />
                {ticked.some(p => p.kind === 'props') && (
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
                    placeholder="Where did you leave the props? Anything to flag? (optional)"
                    className="w-full bg-pt-surface rounded-xl px-3 py-2 text-pt-text placeholder-pt-muted focus:outline-none focus:ring-1 focus:ring-pt-accent resize-none" />
                )}
                {ticked.filter(p => p.booking?.crew?.length).map(p => (
                  <UsedByPicker key={p.key} b={p.booking!} off={notUsing[p.id] ?? new Set()} onChange={s => setNotUsing({ ...notUsing, [p.id]: s })} />
                ))}
                <button onClick={submit} disabled={busy || uploading || photos.length === 0 || ticked.some(p => p.booking && usedByOf(p.booking, notUsing[p.id] ?? new Set())?.length === 0)}
                  className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
                  {busy ? 'Returning…' : uploading ? 'Uploading…' : ticked.length === 1 ? 'Confirm return' : `Return all ${ticked.length}`}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
