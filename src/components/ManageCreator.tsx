// Strikes and pauses by hand (owner + admins, owner Oct 20: admins manage the creators' behaviour and punishments).
// Every action needs a short reason, which goes on the record.
import { useState } from 'react'
import BottomSheet from './BottomSheet'
import { giveStrike, removeStrike, pauseCreator, liftPause, errorText, type UserStatus } from '../services/schedule'
import { formatDay } from '../lib/dates'

const ABOUT: [string, string][] = [['props', 'Props'], ['gear', 'Gear'], ['schedule', 'Schedule'], ['behaviour', 'Behaviour'], ['other', 'Other']]
type Sheet = null | { kind: 'strike' } | { kind: 'pause' } | { kind: 'remove'; id: string; text: string }

export function useManageCreator(email: string, name: string, status: UserStatus | null) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [about, setAbout] = useState('props')
  const [note, setNote] = useState('')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const open = (s: Sheet) => { setSheet(s); setNote(''); setErr(''); setDone('') }
  async function run(f: () => Promise<string>) {
    setBusy(true); setErr('')
    try { setDone(await f()) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const first = name.split(' ')[0]
  const paused = !!status?.pausedUntil && status.pausedUntil > new Date().toISOString().slice(0, 10)
  const field = 'w-full bg-pt-bg rounded-xl px-3 py-3 text-pt-text shadow-hairline focus:outline-none focus:ring-1 focus:ring-pt-accent'
  const reason = (placeholder: string) => (
    <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 300))} rows={3} placeholder={placeholder} className={`${field} resize-none`} />
  )

  const buttons = (
    <div className="flex gap-2">
      <button onClick={() => open({ kind: 'strike' })} className="flex-1 py-3 rounded-xl bg-red-500/15 text-red-300 font-semibold text-sm">Give a strike</button>
      {paused
        ? <button disabled={busy} onClick={() => run(async () => { await liftPause({ email }); return `${first}'s pause is lifted.` })} className="flex-1 py-3 rounded-xl bg-pt-surface text-pt-text font-semibold text-sm disabled:opacity-40">Lift the pause</button>
        : <button onClick={() => open({ kind: 'pause' })} className="flex-1 py-3 rounded-xl bg-pt-surface text-pt-text font-semibold text-sm">Pause bookings</button>}
    </div>
  )

  const sheets = (
    <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.kind === 'strike' ? `Strike for ${first}` : sheet?.kind === 'pause' ? `Pause ${first}'s bookings` : 'Remove this strike'}>
      {done ? (
        <div className="space-y-4 text-center py-2">
          <p className="text-pt-text text-[15px]">{done}</p>
          <button onClick={() => setSheet(null)} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
        </div>
      ) : sheet?.kind === 'strike' ? (
        <div className="space-y-4">
          <p className="text-pt-muted text-sm">It goes on {first}'s record, with your reason, and counts toward the automatic pause.</p>
          <div className="flex flex-wrap gap-2">
            {ABOUT.map(([v, l]) => <button key={v} onClick={() => setAbout(v)} className={`px-3 py-2 rounded-full text-sm ${about === v ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-muted shadow-hairline'}`}>{l}</button>)}
          </div>
          {reason('Why? e.g. "Brought the FX3 kit back a day late"')}
          {err && <p className="text-red-300 text-sm">{err}</p>}
          <button disabled={busy || note.trim().length < 3} onClick={() => run(async () => {
            const r = await giveStrike({ email, about, note: note.trim() })
            return r.data.paused ? `Strike given. That's ${r.data.strikes}, so ${first}'s prop and gear bookings are now paused.` : `Strike given. ${first} has ${r.data.strikes} right now.`
          })} className="w-full py-4 rounded-2xl bg-red-500/80 text-white font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Give the strike'}</button>
        </div>
      ) : sheet?.kind === 'pause' ? (
        <div className="space-y-4">
          <p className="text-pt-muted text-sm">{first} can still book house time, but not props or gear, until the pause ends.</p>
          <div className="flex flex-wrap gap-2">
            {[3, 7, 14, 30].map(d => <button key={d} onClick={() => setDays(d)} className={`px-3 py-2 rounded-full text-sm ${days === d ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-muted shadow-hairline'}`}>{d} days</button>)}
          </div>
          {reason('Why?')}
          {err && <p className="text-red-300 text-sm">{err}</p>}
          <button disabled={busy || note.trim().length < 3} onClick={() => run(async () => {
            const r = await pauseCreator({ email, days, note: note.trim() })
            return `Paused until ${formatDay(r.data.pausedUntil)}.`
          })} className="w-full py-4 rounded-2xl bg-red-500/80 text-white font-semibold disabled:opacity-40">{busy ? 'Saving…' : `Pause for ${days} days`}</button>
        </div>
      ) : sheet?.kind === 'remove' ? (
        <div className="space-y-4">
          <p className="text-pt-text text-[15px]">{sheet.text}</p>
          <p className="text-pt-muted text-sm">It stays on the record as removed, with your reason. If {first} drops below the limit, an automatic pause lifts too.</p>
          {reason('Why does it come off?')}
          {err && <p className="text-red-300 text-sm">{err}</p>}
          <button disabled={busy || note.trim().length < 3} onClick={() => run(async () => {
            const r = await removeStrike({ id: sheet.id, note: note.trim() })
            return `Removed. ${first} has ${r.data.strikes} strike${r.data.strikes === 1 ? '' : 's'} now${r.data.lifted ? ', and the pause is lifted' : ''}.`
          })} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">{busy ? 'Saving…' : 'Remove the strike'}</button>
        </div>
      ) : null}
    </BottomSheet>
  )
  return { buttons, sheets, removeStrikeAsk: (id: string, text: string) => open({ kind: 'remove', id, text }), err: !sheet ? err : '' }
}
