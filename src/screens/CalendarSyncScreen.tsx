// Shared Google Calendar (owner, Oct 19): bookings, moves, cancels and blocked time made in the app go to the calendar
// right away. This screen lists what the app has put there (each can be taken back out) and anything Google refused
// (retry or drop). Old imported events never appear here: the app can't touch them.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { errorText } from '../services/schedule'

interface PendingRow { eventId: string; label: string; error?: string; at: string }
interface SentRow { eventId: string; label: string; at: string }
const pendingCall = httpsCallable<Record<string, never>, { pending: PendingRow[]; sent: SentRow[] }>(functions, 'calendarPending')
const applyCall = httpsCallable<{ ids: string[]; action: 'send' | 'discard' | 'remove' }, { results: { eventId: string; ok: boolean; message?: string }[] }>(functions, 'applyCalendarChanges')


export default function CalendarSyncScreen() {
  const navigate = useNavigate()
  const [data, setData] = useState<{ pending: PendingRow[]; sent: SentRow[] } | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => pendingCall({}).then(r => { setData(r.data); setSel(s => s.filter(id => r.data.pending.some(p => p.eventId === id))) }).catch(e => setMsg(errorText(e)))
  useEffect(() => { load() }, [])

  async function run(action: 'send' | 'discard' | 'remove', ids: string[]) {
    if (!ids.length) return
    if (action === 'remove' && !confirm('Take this out of the Google Calendar? (The booking in the app stays.)')) return
    setBusy(true); setMsg('')
    try {
      const r = (await applyCall({ ids, action })).data.results
      const bad = r.filter(x => !x.ok)
      setMsg(bad.length ? `${r.length - bad.length} done, ${bad.length} didn't work: ${bad[0].message}` : action === 'send' ? `Sent ${r.length} ✓` : action === 'remove' ? 'Removed from the calendar ✓' : `Dropped ${r.length} ✓`)
      await load()
    } catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const all = data?.pending ?? []

  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate('/schedule/settings')} className="tap w-8 -ml-2 text-pt-accent text-[32px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">Google Calendar</h1>
      </div>
      <div className="px-4 space-y-6">
        <p className="text-pt-muted text-sm">Bookings, moves, cancels and blocked time made in the app go to the shared calendar right away. The app never moves anything by itself, and old events you imported are never changed.</p>
        {msg && <p className="text-pt-accent text-sm">{msg}</p>}
        {!data && !msg && <p className="text-pt-muted text-sm">Loading…</p>}

        {data && all.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-pt-text text-[19px] font-semibold">Couldn't send · {all.length}</h2>
              {all.length > 1 && <button onClick={() => setSel(sel.length === all.length ? [] : all.map(p => p.eventId))} className="tap text-pt-accent text-sm">{sel.length === all.length ? 'Untick all' : 'Tick all'}</button>}
            </div>
            {all.map(p => (
              <button key={p.eventId} onClick={() => toggle(p.eventId)} className={`w-full flex items-center gap-3 rounded-2xl p-3 text-left ${sel.includes(p.eventId) ? 'bg-pt-accent/10 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.5)]' : 'bg-pt-surface'}`}>
                <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0 ${sel.includes(p.eventId) ? 'bg-pt-accent text-stone-900' : 'bg-pt-border'}`}>{sel.includes(p.eventId) ? '✓' : ''}</span>
                <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm">{p.label}</span>{p.error && <span className="block text-amber-300 text-xs truncate">{p.error}</span>}</span>
              </button>
            ))}
          </section>
        )}

        {data && data.sent.length === 0 && all.length === 0 && <p className="text-pt-muted text-sm">Nothing from the app in the calendar yet.</p>}
        {data && data.sent.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-pt-text text-[19px] font-semibold">In the calendar from the app</h2>
            {data.sent.map(x => (
              <div key={x.eventId} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                <span className="flex-1 min-w-0 text-pt-text text-sm">{x.label}</span>
                <button disabled={busy} onClick={() => run('remove', [x.eventId])} className="shrink-0 text-red-300 text-sm tap disabled:opacity-40">Remove</button>
              </div>
            ))}
          </section>
        )}
      </div>

      {sel.length > 0 && (
        <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20 flex gap-2">
          <button disabled={busy} onClick={() => run('discard', sel)} className="flex-1 bg-pt-raised text-pt-text font-semibold rounded-2xl py-4 shadow-hairline disabled:opacity-40">Drop</button>
          <button disabled={busy} onClick={() => run('send', sel)} className="flex-[2] bg-pt-accent text-stone-900 font-semibold rounded-2xl py-4 shadow-gold disabled:opacity-40">{busy ? 'Sending…' : `Try ${sel.length} again`}</button>
        </div>
      )}
    </div>
  )
}
