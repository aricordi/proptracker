import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { formatDay } from '../lib/dates'
import { fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, errorText, fmtSlot, BLOCK_TYPES, type BlockType } from '../services/schedule'

interface Ev { id: string; title: string; location: string; date: string; startMin: number; endMin: number; guess: { action: string; email: string; house: string; start: number } }
interface Row { action: 'shoot' | 'block' | 'skip'; email: string; house: string; start: number; type: BlockType }
const preview = httpsCallable<Record<string, never>, { events: Ev[]; people: { email: string; name: string }[] }>(functions, 'previewCalendarImport')
const apply = httpsCallable<{ items: unknown[] }, { results: { id: string; ok: boolean; message?: string }[] }>(functions, 'applyCalendarImport')
const field = 'w-full bg-pt-bg border border-pt-border rounded-lg px-2 py-1.5 text-pt-text text-sm'

// One-time import: the team checks every future event in the shared Google Calendar.
export default function CalendarImportScreen() {
  const navigate = useNavigate()
  const s = useScheduleSettings()
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, string>>({})
  useEffect(() => {
    preview({}).then(r => {
      setEvents(r.data.events); setPeople(r.data.people)
      setRows(Object.fromEntries(r.data.events.map(e => [e.id, { action: e.guess.action as Row['action'], email: e.guess.email, house: e.guess.house, start: e.guess.start, type: /clean/i.test(e.title) ? 'cleaners' : /airbnb|rental|guest/i.test(e.title) ? 'rental' : /event|party/i.test(e.title) ? 'event' : /maint|repair|plumb/i.test(e.title) ? 'maintenance' : 'other' }])))
    }).catch(e => setErr(errorText(e)))
  }, [])
  const set = (id: string, p: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...r[id], ...p } }))
  const todo = (events ?? []).filter(e => !done[e.id])
  async function run() {
    setBusy(true); setErr('')
    try {
      const items = todo.map(e => { const r = rows[e.id]; return { id: e.id, title: e.title, date: e.date, action: r.action, email: r.email, house: r.house, type: r.type,
        start: r.action === 'block' || r.house === 'offsite' ? e.startMin : r.start, end: e.endMin, where: e.location || e.title } })
      const res = await apply({ items })
      const next = { ...done }
      for (const x of res.data.results) next[x.id] = x.ok ? 'ok' : (x.message || 'Failed')
      setDone(next)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const counts = todo.reduce((c, e) => ({ ...c, [rows[e.id]?.action ?? 'skip']: (c[rows[e.id]?.action ?? 'skip'] ?? 0) + 1 }), {} as Record<string, number>)
  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 py-2 border-b border-pt-border flex items-end gap-2">
        <button onClick={() => navigate('/schedule/settings')} className="text-pt-accent text-[17px] pb-1">‹</button>
        <h1 className="font-display text-3xl text-pt-text">Import calendar</h1>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">Every future event in the shared Google Calendar. For each, choose: a <b>shoot</b> (who, which house and slot), <b>blocked time</b>, or <b>skip</b>. Our guesses are filled in. Imported shoots keep their Google event, so nothing is duplicated.</p>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {!events && !err && <p className="text-pt-muted text-sm">Reading the calendar…</p>}
        {events && events.length === 0 && <p className="text-pt-muted text-sm">Nothing left to import.</p>}
        {(events ?? []).map(e => {
          const r = rows[e.id]; const d = done[e.id]
          if (!r) return null
          return (
            <div key={e.id} className={`bg-pt-surface rounded-2xl p-3 space-y-2 ${d === 'ok' ? 'opacity-50' : ''}`}>
              <div className="flex justify-between gap-2"><p className="text-pt-text font-semibold min-w-0 truncate">{e.title}</p>{d === 'ok' && <span className="text-green-300 text-xs">Imported ✓</span>}</div>
              <p className="text-pt-muted text-xs">{formatDay(e.date)} · {fmtTime(e.startMin)}–{fmtTime(e.endMin)}{e.location ? ` · ${e.location}` : ''}</p>
              {d && d !== 'ok' && <p className="text-red-300 text-xs">{d}</p>}
              {d !== 'ok' && <>
                <div className="flex bg-pt-bg rounded-lg p-0.5 gap-0.5">
                  {(['shoot', 'block', 'skip'] as const).map(a => (
                    <button key={a} onClick={() => set(e.id, { action: a })} className={`flex-1 py-1 rounded-md text-xs ${r.action === a ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{a === 'shoot' ? 'Shoot' : a === 'block' ? 'Blocked time' : 'Skip'}</button>
                  ))}
                </div>
                {r.action === 'shoot' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <select value={r.email} onChange={x => set(e.id, { email: x.target.value })} className={field}><option value="">Who?</option>{people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}</select>
                    <select value={r.house} onChange={x => set(e.id, { house: x.target.value })} className={field}><option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option><option value="offsite">Offsite</option></select>
                    {r.house !== 'offsite'
                      ? <select value={r.start} onChange={x => set(e.id, { start: Number(x.target.value) })} className={field}>{s.slots.map(t => <option key={t} value={t}>{fmtSlot(t, s.slotMinutes)}</option>)}</select>
                      : <span className="text-pt-muted text-xs self-center">Keeps its hours</span>}
                  </div>
                )}
                {r.action === 'block' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <select value={r.house === 'cliff2' ? 'cliff2' : 'cliff1'} onChange={x => set(e.id, { house: x.target.value })} className={field}><option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option></select>
                    <select value={r.type} onChange={x => set(e.id, { type: x.target.value as BlockType })} className={field}>{(Object.keys(BLOCK_TYPES) as BlockType[]).map(t => <option key={t} value={t}>{BLOCK_TYPES[t]}</option>)}</select>
                  </div>
                )}
              </>}
            </div>
          )
        })}
      </div>
      {todo.length > 0 && (
        <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
          <button disabled={busy} onClick={run} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-lg disabled:opacity-40">
            {busy ? 'Importing…' : `Import: ${counts.shoot ?? 0} shoots, ${counts.block ?? 0} blocks, skip ${counts.skip ?? 0}`}
          </button>
        </div>
      )}
    </div>
  )
}
