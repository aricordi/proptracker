// Bringing things back, one question at a time (owner, Nov 3: "report damages when returning… all of this can happen
// conversationally in the chat"). Used inline in the Chat and on the Return everything page:
//   1 what's coming back (all ticked)  2 anything broken or missing? (tap the piece + a few words)
//   3 gear: charging case plugged in?  4 shared gear: who used it  5 one photo  → Send
// Each props request goes through startReturn (damaged[]), each gear booking through returnGear (damage[], charging).
import { useMemo, useState } from 'react'
import { startReturn } from '../services/reservations'
import { returnGear, type GearBooking } from '../services/gear'
import UsedByPicker, { usedByOf } from './UsedByPicker'
import ProofPhotos from './ProofPhotos'
import { fmtTime } from '../../functions/src/gearBooking'
import { canReturnProps, canReturnGear, type ReturnGroup } from '../hooks/useReturnables'
import { friendlyError } from '../lib/errors'

interface Part { key: string; kind: 'props' | 'gear'; id: string; title: string; detail: string; booking?: GearBooking; things: { key: string; itemId: string; name: string }[] }

export function returnParts(group: ReturnGroup | undefined): Part[] {
  if (!group) return []
  return [
    ...group.props.filter(canReturnProps).map(r => ({
      key: `props:${r.id}`, kind: 'props' as const, id: r.id, title: `Props & costumes · ${r.lines.length + (r.builds ?? []).length}`,
      detail: [...r.lines.map(l => l.qty > 1 ? `${l.itemName} ×${l.qty}` : l.itemName), ...(r.builds ?? []).filter(b => b.state === 'done').map(b => b.description)].join(', '),
      things: r.lines.map(l => ({ key: `p|${r.id}|${l.itemId}`, itemId: l.itemId, name: l.itemName })),
    })),
    ...group.gear.filter(canReturnGear).map(b => ({
      key: `gear:${b.id}`, kind: 'gear' as const, id: b.id, booking: b, title: `Gear · ${fmtTime(b.start)}–${fmtTime(b.end)}`,
      detail: b.lines.map(l => l.qty > 1 ? `${l.name} ×${l.qty}` : l.name).join(', '),
      things: b.lines.flatMap(l => (l.pieces?.length ? l.pieces : [{ itemId: l.offerId, name: l.name, qty: l.qty }]).map(p => ({ key: `g|${b.id}|${p.itemId}`, itemId: p.itemId, name: p.name || l.name }))),
    })),
  ]
}

const chip = (on: boolean) => `px-3 min-h-[40px] rounded-full text-[14px] ${on ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-border text-pt-text'}`
const q = 'text-[15px] text-pt-text font-semibold'

export default function ReturnFlow({ group, compact = false, onDone }: { group: ReturnGroup; compact?: boolean; onDone: (n: number) => void }) {
  const parts = useMemo(() => returnParts(group), [group])
  const [off, setOff] = useState<Set<string>>(new Set())
  const [broken, setBroken] = useState<boolean | null>(null)
  const [hurt, setHurt] = useState<Record<string, string>>({})   // thing key → what's wrong
  const [charging, setCharging] = useState<boolean | null>(null)
  const [notUsing, setNotUsing] = useState<Record<string, Set<string>>>({})
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const ticked = parts.filter(p => !off.has(p.key))
  const gearTicked = ticked.some(p => p.kind === 'gear')
  const things = ticked.flatMap(p => p.things)
  const folder = parts[0] ? (parts[0].kind === 'props' ? `reservation-photos/${parts[0].id}/return` : `gear-returns/${parts[0].id}`) : ''
  const step2 = ticked.length > 0
  const step3 = step2 && (broken === false || (broken === true && Object.keys(hurt).length > 0))
  const step4 = step3 && (!gearTicked || charging !== null)
  const sharedOk = ticked.every(p => !p.booking?.crew?.length || (usedByOf(p.booking, notUsing[p.id] ?? new Set())?.length ?? 0) > 0)

  async function send() {
    setBusy(true); setErrors({})
    const ok: string[] = [], bad: Record<string, string> = {}
    for (const p of ticked) {
      const mine = p.things.filter(t => t.key in hurt)
      try {
        if (p.kind === 'props') await startReturn({ id: p.id, photos, ...(note.trim() ? { note: note.trim() } : {}), ...(mine.length ? { damaged: mine.map(t => ({ itemId: t.itemId, note: hurt[t.key] })) } : {}) })
        else await returnGear({ id: p.id, photos, charging: charging === true, ...(mine.length ? { damage: mine.map(t => ({ itemId: t.itemId, name: t.name, note: hurt[t.key] })) } : {}),
          usedBy: p.booking ? usedByOf(p.booking, notUsing[p.id] ?? new Set()) : undefined })
        ok.push(p.key)
      } catch (err) { bad[p.key] = friendlyError(err) }
    }
    setBusy(false)
    if (Object.keys(bad).length) { setErrors(bad); if (ok.length) setOff(new Set([...off, ...ok])) }
    else onDone(ok.length)
  }

  if (!parts.length) return <p className="text-pt-muted text-[15px]">Nothing to bring back here. It may already be returned.</p>
  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <section className="space-y-2">
        <p className={q}>What are you bringing back?</p>
        {parts.map(p => {
          const on = !off.has(p.key)
          return (
            <button key={p.key} onClick={() => { const n = new Set(off); if (on) n.add(p.key); else n.delete(p.key); setOff(n) }}
              aria-pressed={on} className="w-full flex items-start gap-3 bg-pt-bg rounded-2xl px-3 py-3 text-left">
              <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full grid place-items-center text-sm font-bold ${on ? 'bg-pt-accent text-stone-900' : 'shadow-[inset_0_0_0_2px_#3A3A3C]'}`}>{on ? '✓' : ''}</span>
              <span className="min-w-0 flex-1">
                <b className={`block text-[15px] ${on ? 'text-pt-text' : 'text-pt-muted'}`}>{p.title}</b>
                <span className="block text-pt-muted text-xs line-clamp-2">{p.detail}</span>
                {!on && <span className="block text-pt-muted text-xs mt-1">Keeping it for now. Return it later.</span>}
                {errors[p.key] && <span className="block text-red-300 text-xs mt-1">{errors[p.key]}</span>}
              </span>
            </button>
          )
        })}
      </section>

      {step2 && (
        <section className="space-y-2">
          <p className={q}>Anything broken, damaged or missing?</p>
          <div className="flex gap-2">
            <button onClick={() => { setBroken(false); setHurt({}) }} className={chip(broken === false)}>No, all good</button>
            <button onClick={() => setBroken(true)} className={chip(broken === true)}>Yes</button>
          </div>
          {broken && (
            <div className="space-y-2">
              <p className="text-pt-muted text-[13px]">Tap what's wrong and say what happened. It goes straight to the team, and it protects you.</p>
              <div className="flex flex-wrap gap-2">
                {things.map(t => <button key={t.key} onClick={() => setHurt(h => { const n = { ...h }; if (t.key in n) delete n[t.key]; else n[t.key] = ''; return n })} className={chip(t.key in hurt)}>{t.name}</button>)}
              </div>
              {things.filter(t => t.key in hurt).map(t => (
                <input key={t.key} value={hurt[t.key]} onChange={e => setHurt(h => ({ ...h, [t.key]: e.target.value.slice(0, 200) }))}
                  placeholder={`${t.name}: what's wrong? (e.g. cracked, missing, not working)`} className="w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-base" />
              ))}
            </div>
          )}
        </section>
      )}

      {step3 && gearTicked && (
        <section className="space-y-2">
          <p className={q}>Is the charging case plugged in?</p>
          <p className="text-pt-muted text-[13px]">Batteries back in the charging case, case plugged in, so the next person has charged batteries.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setCharging(true)} className={chip(charging === true)}>Yes, it's charging</button>
            <button onClick={() => setCharging(false)} className={chip(charging === false)}>No charging case / couldn't</button>
          </div>
        </section>
      )}

      {step4 && (
        <section className="space-y-2">
          {ticked.filter(p => p.booking?.crew?.length).map(p => (
            <UsedByPicker key={p.key} b={p.booking!} off={notUsing[p.id] ?? new Set()} onChange={s => setNotUsing({ ...notUsing, [p.id]: s })} />
          ))}
          <p className={q}>One photo of everything, where you left it</p>
          <ProofPhotos folder={folder} urls={photos} onChange={setPhotos} onUploading={setUploading} label="Photo of everything" hint="Opens your camera" max={6} />
          {ticked.some(p => p.kind === 'props') && (
            <input value={note} onChange={e => setNote(e.target.value.slice(0, 1000))} placeholder="Where did you leave the props? (optional)"
              className="w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-base" />
          )}
          <button onClick={send} disabled={busy || uploading || !photos.length || !sharedOk}
            className="w-full py-3.5 rounded-xl bg-pt-accent text-stone-900 font-bold disabled:opacity-40 shadow-gold">
            {busy ? 'Returning…' : uploading ? 'Uploading…' : !photos.length ? 'Take the photo first' : ticked.length === 1 ? 'Send the return' : `Return all ${ticked.length}`}
          </button>
        </section>
      )}
    </div>
  )
}
