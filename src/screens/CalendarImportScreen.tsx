import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions, db } from '../firebase'
import { doc, onSnapshot } from 'firebase/firestore'
import { formatDay } from '../lib/dates'
import { fmtTime } from '../../functions/src/gearBooking'
import { splitHours } from '../../functions/src/calendarText'
import { useScheduleSettings, errorText, BLOCK_TYPES, type BlockType } from '../services/schedule'

// kind: new = not seen before; changed = moved/renamed in Google Calendar since the last import; removed = deleted there.
interface Ev { id: string; title: string; location: string; date: string; startMin: number; endMin: number; kind: 'new' | 'changed' | 'removed' | 'ignored'; why?: string; calendar?: string; feedId?: string; allDay?: boolean
  was?: { date: string; startMin: number; endMin: number; title: string }; guess: { action: string; email: string; emails?: string[]; house: string; start: number; soft?: boolean } }
interface Row { action: 'shoot' | 'block' | 'skip' | 'remove' | 'keep'; emails: string[]; house: string; start: number; type: BlockType; soft: boolean }
const preview = httpsCallable<Record<string, never>, { events: Ev[]; people: { email: string; name: string }[] }>(functions, 'previewCalendarImport')
const apply = httpsCallable<{ items: unknown[] }, { results: { id: string; ok: boolean; message?: string }[] }>(functions, 'applyCalendarImport')
const checkNow = httpsCallable<Record<string, never>, unknown>(functions, 'checkCalendarNow')
const field = 'w-full bg-pt-bg border border-pt-border rounded-lg px-2 py-1.5 text-pt-text text-sm'

// Import from the shared Google Calendar, as often as needed (owner, Oct 19: while testing, the team keeps adding
// events straight in Google Calendar). Each run shows new events, ones changed there since, and ones deleted there.
// The app never changes anything in Google Calendar here; it only updates its own schedule.
export default function CalendarImportScreen() {
  const navigate = useNavigate()
  const s = useScheduleSettings()
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, string>>({})
  // The automatic check (every 15 minutes) already mirrors events changed or deleted in Google Calendar.
  const [last, setLast] = useState<{ at?: string; changed?: number; removed?: number; broughtIn?: number; error?: string } | null>(null)
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'calendarCheck'), d => setLast(d.data() ?? null), () => {}), [])
  const [checking, setChecking] = useState(false)
  const [reload, setReload] = useState(0)
  async function runCheck() { setChecking(true); try { await checkNow({}) } catch (e) { setErr(errorText(e)) } finally { setChecking(false); setReload(n => n + 1) } }
  useEffect(() => {
    setEvents(null)
    preview({}).then(r => {
      setEvents(r.data.events); setPeople(r.data.people)
      setRows(Object.fromEntries(r.data.events.map(e => [e.id, { action: e.guess.action as Row['action'], soft: e.guess.soft === true, emails: e.guess.emails?.length ? e.guess.emails : e.guess.email ? [e.guess.email] : [], house: e.guess.house, start: e.guess.start, type: /clean/i.test(e.title) ? 'cleaners' : /airbnb|rental|guest/i.test(e.title) ? 'rental' : /event|party/i.test(e.title) ? 'event' : /maint|repair|plumb/i.test(e.title) ? 'maintenance' : 'other' }])))
    }).catch(e => setErr(errorText(e)))
  }, [reload])
  const set = (id: string, p: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...r[id], ...p } }))
  // Several calendars (owner, Oct 30): look at one at a time; "Import" only acts on what's showing.
  const [cal, setCal] = useState('')
  const calendars = [...new Set((events ?? []).map(e => e.calendar ?? '').filter(Boolean))]
  // Time off and birthdays (owner, Oct 30: "useless for us") are hidden unless asked for; they're never imported.
  const [showHidden, setShowHidden] = useState(false)
  const hiddenCount = (events ?? []).filter(e => e.kind === 'ignored' && (!cal || e.calendar === cal)).length
  const shown = (events ?? []).filter(e => (!cal || e.calendar === cal) && (showHidden || e.kind !== 'ignored'))
  const todo = shown.filter(e => !done[e.id] && e.kind !== 'ignored')
  async function run() {
    setBusy(true); setErr('')
    try {
      const items = todo.map(e => { const r = rows[e.id]; return { id: e.id, title: e.title, location: e.location, date: e.date, action: r.action, email: r.emails[0] ?? '', emails: r.emails, house: r.house, type: r.type, soft: r.soft,
        start: e.startMin, end: e.endMin, where: e.location || e.title, feedId: e.feedId, allDay: e.allDay } })   // always the real hours (owner, Oct 19)
      const res = await apply({ items })
      const next = { ...done }
      for (const x of res.data.results) next[x.id] = x.ok ? (x.message?.startsWith('Imported · CLASH') ? x.message : 'ok') : (x.message || 'Failed')
      setDone(next)
    } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  // Two old events at the same house at overlapping times: both are imported, marked as a clash.
  const clashOf = (e: Ev) => {
    const r = rows[e.id]
    if (r?.action !== 'shoot' || r.house === 'offsite') return []
    return (events ?? []).filter(o => o.id !== e.id && rows[o.id]?.action === 'shoot' && rows[o.id].house === r.house && o.date === e.date
      && o.startMin < e.endMin && e.startMin < o.endMin).map(o => rows[o.id].emails.map(m => people.find(p => p.email === m)?.name).filter(Boolean).join(' + ') || o.title)
  }
  const counts = todo.reduce((c, e) => ({ ...c, [rows[e.id]?.action ?? 'skip']: (c[rows[e.id]?.action ?? 'skip'] ?? 0) + 1 }), {} as Record<string, number>)
  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate(-1)} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">Import calendar</h1>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">This reads every calendar on the <b>Calendar &amp; email</b> page. Run it whenever someone adds or changes events straight in Google Calendar. It shows <b>new</b> events, ones <b>changed</b> there since the last import, and ones <b>deleted</b> there. For each, choose a shoot (who and which house), blocked time, or skip. Our guesses are filled in.</p>
        <p className="text-pt-muted text-sm">Nothing in Google Calendar is ever changed. Every event keeps its <b>real hours</b> (2:30–5 PM stays 2:30–5 PM and holds the slots it touches). Old events that overlap at the same house are still imported, marked <span className="text-red-300 font-semibold">Clash</span>.</p>
        <div className="flex items-center gap-3 bg-pt-surface rounded-2xl px-4 py-3">
          <span className="flex-1 min-w-0 text-pt-muted text-xs">Checked automatically every 15 minutes{last?.at ? ` · last ${new Date(last.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : ''}{last?.broughtIn ? ` · brought in ${last.broughtIn} clear new event${last.broughtIn === 1 ? '' : 's'}` : ''}{last?.changed || last?.removed ? ` · followed ${last.changed ?? 0} change${last.changed === 1 ? '' : 's'}, ${last.removed ?? 0} deletion${last.removed === 1 ? '' : 's'}` : ''}{last?.error ? ` · ⚠ ${last.error}` : ''}</span>
          <button disabled={checking} onClick={runCheck} className="shrink-0 text-pt-accent text-sm tap disabled:opacity-40">{checking ? 'Checking…' : 'Check now'}</button>
        </div>
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {!events && !err && <p className="text-pt-muted text-sm">Reading the calendar…</p>}
        {events && events.every(e => e.kind === 'ignored') && <p className="text-pt-muted text-sm">Nothing left to import.</p>}
        {calendars.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {['', ...calendars].map(n => (
              <button key={n || 'all'} onClick={() => setCal(n)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${cal === n ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>
                {n || 'All calendars'} · {(events ?? []).filter(e => !done[e.id] && e.kind !== 'ignored' && (!n || e.calendar === n)).length}
              </button>
            ))}
          </div>
        )}
        {todo.some(e => e.kind === 'new') && (
          <button onClick={() => setRows(r => Object.fromEntries(Object.entries(r).map(([id, row]) => [id, todo.some(e => e.id === id && e.kind === 'new') ? { ...row, action: 'skip' as const } : row])))}
            className="tap text-pt-accent text-sm">Set everything showing to Skip ›</button>
        )}
        {hiddenCount > 0 && (
          <button onClick={() => setShowHidden(v => !v)} className="tap text-pt-muted text-sm">
            {showHidden ? 'Hide' : 'Show'} {hiddenCount} hidden event{hiddenCount === 1 ? '' : 's'} (people away, birthdays) ›
          </button>
        )}
        {shown.map(e => {
          const r = rows[e.id]; const d = done[e.id]
          if (!r) return null
          return (
            <div key={e.id} className={`bg-pt-surface rounded-2xl p-3 space-y-2 ${d === 'ok' || e.kind === 'ignored' ? 'opacity-50' : ''}`}>
              <div className="flex justify-between gap-2"><p className="text-pt-text font-semibold min-w-0 truncate">{e.title}</p>{d === 'ok' && <span className="text-green-300 text-xs">Imported ✓</span>}{d?.startsWith('Imported · CLASH') && <span className="text-red-300 text-xs">Imported · Clash</span>}</div>
              <p className="text-pt-muted text-xs">{e.kind === 'ignored' && <span className="mr-1 font-semibold">Hidden ({e.why}) · not brought in ·</span>}{e.kind !== 'new' && e.kind !== 'ignored' && <span className={`mr-1 font-semibold ${e.kind === 'removed' ? 'text-red-300' : 'text-amber-300'}`}>{e.kind === 'removed' ? 'Deleted in Google Calendar ·' : 'Changed ·'}</span>}{e.calendar && <span className="mr-1 text-pt-text">{e.calendar} ·</span>}{formatDay(e.date)} · {e.allDay ? 'All day' : `${fmtTime(e.startMin)}–${fmtTime(e.endMin)}`}{e.location ? ` · ${e.location}` : ''}</p>
              {e.kind === 'changed' && e.was && <p className="text-pt-muted text-xs">Was {formatDay(e.was.date)} · {fmtTime(e.was.startMin)}–{fmtTime(e.was.endMin)}{e.was.title !== e.title ? ` · "${e.was.title}"` : ''}</p>}
              {d && d !== 'ok' && <p className="text-red-300 text-xs">{d}</p>}
              {d !== 'ok' && clashOf(e).length > 0 && <p className="text-red-300 text-xs font-semibold">⚠ Clash: same house and time as {clashOf(e).join(', ')}. Both will be imported.</p>}
              {d !== 'ok' && e.kind === 'removed' && (
                <div className="flex bg-pt-bg rounded-lg p-0.5 gap-0.5">
                  {(['remove', 'keep'] as const).map(a => (
                    <button key={a} onClick={() => set(e.id, { action: a })} className={`flex-1 py-1 rounded-md text-xs ${r.action === a ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{a === 'remove' ? 'Take it off the app\'s schedule' : 'Keep it in the app'}</button>
                  ))}
                </div>
              )}
              {d !== 'ok' && e.kind !== 'removed' && e.kind !== 'ignored' && <>
                <div className="flex bg-pt-bg rounded-lg p-0.5 gap-0.5">
                  {(['shoot', 'block', 'skip'] as const).map(a => (
                    <button key={a} onClick={() => set(e.id, { action: a })} className={`flex-1 py-1 rounded-md text-xs ${r.action === a ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{a === 'shoot' ? 'Shoot' : a === 'block' ? 'Blocked time' : 'Skip'}</button>
                  ))}
                </div>
                {r.action === 'shoot' && (
                  <div className="space-y-2">
                    {/* Owner, Nov 4: one booking can be several creators filming together. Each gets their own turn, back to back. */}
                    {r.emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.emails.map((m, i) => (
                          <span key={m} className="inline-flex items-center gap-1 min-h-[36px] pl-3 pr-1 rounded-full bg-pt-bg text-pt-text text-sm">
                            {r.emails.length > 1 && <span className="text-pt-muted text-xs">{i + 1}.</span>}{people.find(p => p.email === m)?.name ?? m}
                            <button onClick={() => set(e.id, { emails: r.emails.filter(x => x !== m) })} aria-label={`Take ${people.find(p => p.email === m)?.name ?? m} off`} className="w-8 h-8 rounded-full text-pt-muted">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <select value="" onChange={x => x.target.value && set(e.id, { emails: [...r.emails, x.target.value].slice(0, 4) })} className={field} disabled={r.emails.length >= 4}>
                        <option value="">{r.emails.length ? '+ Add another creator' : 'Who?'}</option>
                        {people.filter(p => !r.emails.includes(p.email)).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                      </select>
                      <select value={r.house} onChange={x => set(e.id, { house: x.target.value })} className={field}><option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option><option value="offsite">Offsite</option></select>
                    </div>
                    {r.emails.length > 1 && (
                      <p className="text-pt-muted text-xs">One booking, {r.emails.length} creators: each gets their own turn, back to back:{' '}
                        <span className="text-pt-text">{splitHours(e.startMin, e.endMin, r.emails.length).map((h, i) => `${people.find(p => p.email === r.emails[i])?.name.split(' ')[0] ?? '?'} ${fmtTime(h.start)}–${fmtTime(h.end)}`).join(' · ')}</span></p>
                    )}
                  </div>
                )}
                {r.action === 'block' && (
                  // Owner, Nov 4: some events just HAPPEN at a house (chargers installed) and people can still film around them.
                  <div className="flex bg-pt-bg rounded-lg p-0.5 gap-0.5">
                    {([[false, 'Blocks filming'], [true, 'Heads-up only (can still book)']] as const).map(([v, l]) => (
                      <button key={l} onClick={() => set(e.id, { soft: v })} className={`flex-1 py-1.5 rounded-md text-xs ${r.soft === v ? (v ? 'bg-amber-400 text-stone-900 font-semibold' : 'bg-pt-border text-pt-text font-semibold') : 'text-pt-muted'}`}>{l}</button>
                    ))}
                  </div>
                )}
                {r.action === 'block' && (
                  <div className="grid grid-cols-2 gap-2">
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
          <button disabled={busy} onClick={run} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-lg disabled:opacity-40 shadow-gold">
            {busy ? 'Importing…' : `Import: ${counts.shoot ?? 0} shoots, ${counts.block ?? 0} blocks${counts.remove ? `, ${counts.remove} removed` : ''}, skip ${counts.skip ?? 0}`}
          </button>
        </div>
      )}
    </div>
  )
}
