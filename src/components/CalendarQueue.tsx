// Requests → Calendar (owner, Nov 4: "all the imports in a queue for the equipment team, like new bookings, in a separate
// tab so it's easy to confirm and double check"). The 15-minute check puts what it can read on the schedule straight
// away (so nobody books over it) and every event waits here: Looks right / Fix / Skip. Creators hear about a shoot only
// once it's confirmed here. Google Calendar itself is never changed.
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { formatDay } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { fmtTime } from '../../functions/src/gearBooking'
import { splitHours, splitOnGrid, queueReady } from '../../functions/src/calendarText'
import BottomSheet from './BottomSheet'
import { useScheduleSettings, reviewCalendarImport, confirmAllCalendar, BLOCK_TYPES, type QueueItem, type QueueFix, type BlockType, type ScheduleSettings } from '../services/schedule'

type Person = { email: string; name: string }
const checkNow = httpsCallable<Record<string, never>, unknown>(functions, 'checkCalendarNow')
const field = 'w-full min-h-[44px] bg-pt-bg rounded-xl px-3 text-pt-text text-[15px]'

const houseName = (h: string | undefined, s: ScheduleSettings) => h === 'cliff1' || h === 'cliff2' ? s.houses[h].name : 'Offsite'
const firstName = (email: string, people: Person[]) => people.find(p => p.email === email)?.name.split(' ')[0] ?? email.split('@')[0]

/** "Bryan 12–1 PM · Eduard 1–3 PM" — the same split the server makes. */
function turns(q: { startMin: number; endMin: number }, emails: string[], house: string, s: ScheduleSettings, people: Person[]) {
  const parts = house === 'offsite' ? splitHours(q.startMin, q.endMin, emails.length) : splitOnGrid(q.startMin, q.endMin, emails.length, s.slots, s.slotMinutes)
  return emails.map((m, i) => `${firstName(m, people)} ${fmtTime(parts[i]?.start ?? q.startMin)}–${fmtTime(parts[i]?.end ?? q.endMin)}`).join(' · ')
}

export function useQueuePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'calendarCheck'), d => setPeople((d.data()?.people as Person[]) ?? []), () => {}), [])
  return people
}

export default function CalendarQueue({ items }: { items: QueueItem[] | null }) {
  const s = useScheduleSettings()
  const people = useQueuePeople()
  const [last, setLast] = useState<{ at?: string; error?: string } | null>(null)
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'calendarCheck'), d => setLast(d.data() ?? null), () => {}), [])
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const [fixing, setFixing] = useState<QueueItem | null>(null)

  async function act(q: QueueItem, action: 'confirm' | 'skip') {
    setBusy(q.id); setErr(e => ({ ...e, [q.id]: '' }))
    try { await reviewCalendarImport({ id: q.id, action }) } catch (e) { setErr(x => ({ ...x, [q.id]: friendlyError(e) })) } finally { setBusy('') }
  }
  async function runCheck() { setChecking(true); try { await checkNow({}) } catch { /* shown on the status line */ } finally { setChecking(false) } }
  const ready = (items ?? []).filter(q => q.placed && !q.problem)
  // "Confirm all" (owner, Nov 5): everything the app placed cleanly; clashes and unread ones stay for a person.
  const allOk = (items ?? []).filter(q => queueReady(q))
  const [asking, setAsking] = useState(false)
  const [allMsg, setAllMsg] = useState('')
  async function confirmAll() {
    setBusy('*'); setAllMsg('')
    try {
      const r = (await confirmAllCalendar({ action: 'confirmAll', ids: allOk.map(q => q.id) })).data
      setAllMsg(`Confirmed ${r.confirmed} ✓${r.left ? ` · ${r.left} still need you` : ''}`)
    } catch (e) { setAllMsg(friendlyError(e)) } finally { setBusy(''); setAsking(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 bg-pt-surface rounded-2xl px-4 py-3">
        <span className="flex-1 min-w-0 text-pt-muted text-sm">Google Calendar is checked every 15 minutes{last?.at ? ` · last ${new Date(last.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}` : ''}{last?.error ? ` · ⚠ ${last.error}` : ''}</span>
        <button disabled={checking} onClick={runCheck} className="shrink-0 min-h-[40px] px-2 text-pt-accent text-sm font-semibold disabled:opacity-40">{checking ? 'Checking…' : 'Check now'}</button>
      </div>
      {items === null && <p className="text-pt-muted text-sm px-1">Loading…</p>}
      {items?.length === 0 && (
        <div className="bg-pt-surface rounded-2xl p-5 text-center">
          <p className="text-pt-text font-semibold text-[17px]">All checked ✓</p>
          <p className="text-pt-muted text-sm mt-1">New, changed and deleted events from Google Calendar land here. Each one goes on the schedule right away and waits for you to say it looks right.</p>
        </div>
      )}
      {allOk.length > 1 && (
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
          {!asking ? (
            <>
              <button disabled={!!busy} onClick={() => setAsking(true)} className="w-full min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">Confirm all {allOk.length} that look right</button>
              <p className="text-pt-muted text-sm">{(items?.length ?? 0) - allOk.length > 0 ? `${(items?.length ?? 0) - allOk.length} with a clash or that the app couldn't read stay below for you.` : 'Or check them one by one below.'}</p>
            </>
          ) : (
            <>
              <p className="text-pt-text text-[16px]">Confirm {allOk.length} events? Creators get told about their shoots.</p>
              <div className="flex gap-2">
                <button disabled={busy === '*'} onClick={confirmAll} className="flex-1 min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy === '*' ? 'Confirming…' : `Yes, confirm ${allOk.length}`}</button>
                <button disabled={busy === '*'} onClick={() => setAsking(false)} className="px-5 min-h-[48px] rounded-xl bg-pt-raised text-pt-text disabled:opacity-40">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
      {allMsg && <p className="text-pt-text text-sm px-1">{allMsg}</p>}
      {ready.length > 1 && <p className="text-pt-muted text-sm px-1">{items!.length} to check, soonest first. What the app could read is already on the schedule, holding the time, until you fix or skip it.</p>}
      {(items ?? []).map(q => {
        const r = q.result ?? {}
        const emails = r.emails?.length ? r.emails : []
        const pill = q.kind === 'removed' ? ['Deleted in Google', 'bg-red-400/15 text-red-300'] : q.kind === 'changed' ? ['Changed in Google', 'bg-amber-400/15 text-amber-300'] : ['New', 'bg-sky-400/15 text-sky-300']
        return (
          <div key={q.id} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center min-h-[28px] px-2.5 rounded-full text-xs font-semibold ${pill[1]}`}>{pill[0]}</span>
              {q.calendar && <span className="text-pt-muted text-xs">{q.calendar}</span>}
            </div>
            <p className="text-pt-text font-semibold text-[18px] leading-snug">{q.title || '(no title)'}</p>
            <p className="text-pt-muted text-sm">{formatDay(q.date)} · {q.allDay ? 'All day' : `${fmtTime(q.startMin)}–${fmtTime(q.endMin)}`}{q.location ? ` · ${q.location}` : ''}</p>
            {q.kind === 'changed' && q.was && <p className="text-pt-muted text-sm">Was {formatDay(q.was.date)} · {fmtTime(q.was.startMin)}–{fmtTime(q.was.endMin)}{q.was.title && q.was.title !== q.title ? ` · "${q.was.title}"` : ''}</p>}
            {/* What the app did with it */}
            <div className="bg-pt-bg rounded-xl px-3 py-2.5 text-[15px]">
              {!q.placed ? <p className="text-amber-300">{q.message || <>The app couldn't tell who or what this is. Tap <b>Fix</b> to choose, or Skip.</>}</p>
                : q.kind === 'removed' ? <p className="text-pt-text">Taken off the schedule{emails.length ? ` (${emails.map(m => firstName(m, people)).join(' + ')})` : ''}.</p>
                : r.action === 'shoot' ? <p className="text-pt-text"><span className="text-pt-muted">On the schedule · {houseName(r.house, s)}: </span>{turns(q, emails, r.house ?? 'cliff1', s, people)}</p>
                : r.action === 'block' ? <p className="text-pt-text"><span className="text-pt-muted">{r.soft ? 'Heads-up' : 'Blocked'} · {houseName(r.house, s)}: </span>{r.soft ? `${q.title} (people can still film)` : r.type && r.type !== 'other' ? BLOCK_TYPES[r.type] : q.title || BLOCK_TYPES.other}</p>
                : <p className="text-pt-muted">Skipped.</p>}
              {!!r.clashWith?.length && <p className="text-red-300 text-sm font-semibold mt-1">⚠ Clash with {r.clashWith.join(', ')}, same house and time.</p>}
              {q.problem && <p className="text-red-300 text-sm mt-1">{q.problem}</p>}
            </div>
            {err[q.id] && <p className="text-red-300 text-sm">{err[q.id]}</p>}
            <div className="flex gap-2 pt-1">
              {q.placed && !q.problem && <button disabled={busy === q.id || busy === '*'} onClick={() => act(q, 'confirm')} className="flex-1 min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy === q.id ? 'Saving…' : 'Looks right ✓'}</button>}
              {q.kind !== 'removed' && <button disabled={busy === q.id || busy === '*'} onClick={() => setFixing(q)} className={`${q.placed && !q.problem ? 'px-5' : 'flex-1 bg-pt-accent text-stone-900 font-semibold'} min-h-[48px] rounded-xl ${q.placed && !q.problem ? 'bg-pt-raised text-pt-text' : ''} disabled:opacity-40`}>Fix</button>}
              {q.kind !== 'removed' && <button disabled={busy === q.id || busy === '*'} onClick={() => act(q, 'skip')} className="px-4 min-h-[48px] rounded-xl text-pt-muted disabled:opacity-40">Skip</button>}
            </div>
          </div>
        )
      })}
      {fixing && <FixSheet q={fixing} people={people} s={s} onClose={() => setFixing(null)} />}
    </div>
  )
}

function FixSheet({ q, people, s, onClose }: { q: QueueItem; people: Person[]; s: ScheduleSettings; onClose: () => void }) {
  const g = q.placed ? q.result : q.guess
  const start0: QueueFix['action'] | 'heads' = g.action === 'block' ? (g.soft ? 'heads' : 'block') : 'shoot'
  const [kind, setKind] = useState<QueueFix['action'] | 'heads'>(start0)
  const [emails, setEmails] = useState<string[]>(g.emails?.length ? g.emails : g.email ? [g.email] : [])
  const [house, setHouse] = useState<string>(g.house ?? 'cliff1')
  const [type, setType] = useState<BlockType>(g.type ?? 'other')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setBusy(true); setErr('')
    try {
      await reviewCalendarImport({ id: q.id, action: 'fix', fix: { action: kind === 'shoot' ? 'shoot' : 'block', emails, house: kind === 'shoot' ? house : house === 'cliff2' ? 'cliff2' : 'cliff1', type, soft: kind === 'heads' } })
      onClose()
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  const nameOf = (m: string) => people.find(p => p.email === m)?.name ?? m
  return (
    <BottomSheet open onClose={onClose} title="What is it really?">
      <div className="space-y-4 pb-2">
        <div>
          <p className="text-pt-text font-semibold">{q.title || '(no title)'}</p>
          <p className="text-pt-muted text-sm">{formatDay(q.date)} · {q.allDay ? 'All day' : `${fmtTime(q.startMin)}–${fmtTime(q.endMin)}`}</p>
        </div>
        <div className="flex bg-pt-bg rounded-xl p-1 gap-1">
          {([['shoot', 'A shoot'], ['block', 'Blocked time'], ['heads', 'Heads-up only']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={`flex-1 min-h-[40px] rounded-lg text-sm ${kind === k ? 'bg-pt-raised text-pt-text font-semibold' : 'text-pt-muted'}`}>{l}</button>
          ))}
        </div>
        {kind === 'shoot' && <>
          <div className="space-y-2">
            <p className="text-pt-muted text-sm">Who's filming? In order, if it's a group (each gets their own turn).</p>
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {emails.map((m, i) => (
                  <span key={m} className="inline-flex items-center gap-1 min-h-[40px] pl-3 pr-1 rounded-full bg-pt-bg text-pt-text text-sm">
                    {emails.length > 1 && <span className="text-pt-muted text-xs">{i + 1}.</span>}{nameOf(m)}
                    <button onClick={() => setEmails(emails.filter(x => x !== m))} aria-label={`Take ${nameOf(m)} off`} className="w-9 h-9 rounded-full text-pt-muted">✕</button>
                  </span>
                ))}
              </div>
            )}
            <select value="" disabled={emails.length >= 4} onChange={x => x.target.value && setEmails([...emails, x.target.value].slice(0, 4))} className={field}>
              <option value="">{emails.length ? '+ Add another creator' : 'Pick a creator'}</option>
              {people.filter(p => !emails.includes(p.email)).map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
            </select>
          </div>
          <select value={house} onChange={x => setHouse(x.target.value)} className={field}>
            <option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option><option value="offsite">Offsite</option>
          </select>
          {emails.length > 0 && <p className="text-pt-muted text-sm">On the schedule: <span className="text-pt-text">{turns(q, emails, house, s, people)}</span></p>}
        </>}
        {kind !== 'shoot' && <>
          <select value={house === 'cliff2' ? 'cliff2' : 'cliff1'} onChange={x => setHouse(x.target.value)} className={field}>
            <option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option>
          </select>
          <select value={type} onChange={x => setType(x.target.value as BlockType)} className={field}>{(Object.keys(BLOCK_TYPES) as BlockType[]).map(t => <option key={t} value={t}>{BLOCK_TYPES[t]}</option>)}</select>
          {kind === 'heads' && <p className="text-pt-muted text-sm">Shows on the calendar as a heads-up. Creators can still book around it.</p>}
        </>}
        {err && <p className="text-red-300 text-sm">{err}</p>}
        <button disabled={busy || (kind === 'shoot' && !emails.length)} onClick={save} className="w-full min-h-[52px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : kind === 'shoot' && !emails.length ? 'Pick who\'s filming' : 'Save and confirm'}
        </button>
      </div>
    </BottomSheet>
  )
}
