// Requests → Calendar (owner, Nov 4: "all the imports in a queue for the equipment team, like new bookings, in a separate
// tab so it's easy to confirm and double check"). The live calendar sync (and the 30-minute safety check) puts what it can read on the schedule straight
// away and is confirmed by itself (owner, Nov 16: the calendars are the rule). Only unreadable events and clashes wait here:
// Looks right / Fix / Skip. Google Calendar itself is never changed.
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { formatDay } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { fmtTime } from '../../functions/src/gearBooking'
import { splitHours, queueReady } from '../../functions/src/calendarText'
import BottomSheet from './BottomSheet'
import { useScheduleSettings, reviewCalendarImport, ignoreCalendarEvents, confirmAllCalendar, BLOCK_TYPES, googleDayLink, type QueueItem, type QueueFix, type BlockType, type ScheduleSettings } from '../services/schedule'

type Person = { email: string; name: string }
const checkNow = httpsCallable<Record<string, never>, unknown>(functions, 'checkCalendarNow', { timeout: 310_000 })
const field = 'w-full min-h-[44px] bg-pt-bg rounded-xl px-3 text-pt-text text-[15px]'

const houseName = (h: string | undefined, s: ScheduleSettings) => h === 'cliff1' || h === 'cliff2' ? s.houses[h].name : 'Offsite'
const firstName = (email: string, people: Person[]) => people.find(p => p.email === email)?.name.split(' ')[0] ?? email.split('@')[0]

/** "Bryan 12–1 PM · Eduard 1–3 PM" — the same split the server makes. */
function turns(q: { startMin: number; endMin: number }, emails: string[], _house: string, _s: ScheduleSettings, people: Person[]) {
  const parts = splitHours(q.startMin, q.endMin, emails.length)
  return emails.map((m, i) => `${firstName(m, people)} ${fmtTime(parts[i]?.start ?? q.startMin)}–${fmtTime(parts[i]?.end ?? q.endMin)}`).join(' · ')
}

// Real-time sync status (owner, Nov 24): Google tells the app about changes within seconds; the timer is the safety net.
export function useCalendarLive() {
  const [live, setLive] = useState<{ on?: number; calendars?: number; errors?: string[]; lastPing?: string; lastSynced?: string } | null>(null)
  useEffect(() => onSnapshot(doc(db, 'app_settings/calendarLive'), d => setLive(d.exists() ? d.data() as typeof live : {}), () => setLive({})), [])
  return live
}
export function liveText(live: ReturnType<typeof useCalendarLive>) {
  if (!live) return 'Google Calendar'
  const t = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
  if ((live.on ?? 0) > 0 && (live.on ?? 0) >= (live.calendars ?? 0)) return `Live: changes in Google Calendar show here within seconds${live.lastSynced ? ` (last ${t(live.lastSynced)})` : ''}, plus a safety check every 30 minutes`
  if ((live.on ?? 0) > 0) return `Live for ${live.on} of ${live.calendars} calendars; the others are checked every 30 minutes`
  return 'Google Calendar is checked every 30 minutes (live updates start after the next check)'
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
  const live = useCalendarLive()
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'calendarCheck'), d => setLast(d.data() ?? null), () => {}), [])
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const [fixing, setFixing] = useState<QueueItem | null>(null)
  const [notFilming, setNotFilming] = useState<QueueItem | null>(null)

  async function act(q: QueueItem, action: 'confirm' | 'skip' | 'restore') {
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
        <span className="flex-1 min-w-0 text-pt-muted text-sm">{liveText(live)}{live?.errors?.length ? ` · ⚠ ${live.errors[0]}` : ''}{last?.at ? ` · last ${new Date(last.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}{last?.error ? ` · ⚠ ${last.error}` : ''}</span>
        <button disabled={checking} onClick={runCheck} className="shrink-0 min-h-[40px] px-2 text-pt-accent text-sm font-semibold disabled:opacity-40">{checking ? 'Checking…' : 'Check now'}</button>
      </div>
      {items === null && <p className="text-pt-muted text-sm px-1">Loading…</p>}
      {items?.length === 0 && (
        <div className="bg-pt-surface rounded-2xl p-5 text-center">
          <p className="text-pt-text font-semibold text-[17px]">All checked ✓</p>
          <p className="text-pt-muted text-sm mt-1">The Google calendars are the rule: what the app can read goes on the schedule and is confirmed by itself. Only events it couldn't read, a clash with another booking, or a move in the app calendar onto a taken time wait here for you.</p>
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
        const pill = q.kind === 'app-moved' ? ['Moved in the app calendar', 'bg-amber-400/15 text-amber-300'] : q.kind === 'removed' ? ['Deleted in Google', 'bg-red-400/15 text-red-300'] : q.kind === 'changed' ? ['Changed in Google', 'bg-amber-400/15 text-amber-300'] : ['New', 'bg-sky-400/15 text-sky-300']
        return (
          <div key={q.id} className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center min-h-[28px] px-2.5 rounded-full text-xs font-semibold ${pill[1]}`}>{pill[0]}</span>
              {q.calendar && <span className="text-pt-muted text-xs">{q.calendar}</span>}
            </div>
            <p className="text-pt-text font-semibold text-[18px] leading-snug">{q.title || '(no title)'}</p>
            <p className="text-pt-muted text-sm">{formatDay(q.date)} · {q.allDay ? 'All day' : `${fmtTime(q.startMin)}–${fmtTime(q.endMin)}`}{q.location ? ` · ${q.location}` : ''}</p>
            {q.kind === 'app-moved' && q.was && <p className="text-pt-muted text-sm">The app still has it at {formatDay(q.was.date)} · {fmtTime(q.was.startMin)}–{fmtTime(q.was.endMin)} (booked in the app)</p>}
            {q.kind === 'changed' && q.was && <p className="text-pt-muted text-sm">Was {formatDay(q.was.date)} · {fmtTime(q.was.startMin)}–{fmtTime(q.was.endMin)}{q.was.title && q.was.title !== q.title ? ` · "${q.was.title}"` : ''}</p>}
            {/* What the app did with it */}
            <div className="bg-pt-bg rounded-xl px-3 py-2.5 text-[15px]">
              {!q.placed ? <p className="text-amber-300">{q.message || <>The app couldn't tell who or what this is. Tap <b>Fix</b> to choose, or Skip.</>}</p>
                : q.kind === 'removed' ? <p className="text-pt-text">Taken off the schedule{emails.length ? ` (${emails.map(m => firstName(m, people)).join(' + ')})` : ''}.</p>
                : r.action === 'cancelled' ? <p className="text-pt-text"><span className="text-pt-muted">Stays cancelled: </span>it was cancelled in the app, so the change in Google doesn't bring it back.</p>
                : r.action === 'shoot' ? <p className="text-pt-text"><span className="text-pt-muted">On the schedule · {houseName(r.house, s)}: </span>{turns(q, emails, r.house ?? 'cliff1', s, people)}</p>
                : r.action === 'block' ? <p className="text-pt-text"><span className="text-pt-muted">{r.soft ? 'Heads-up' : 'Blocked'} · {houseName(r.house, s)}: </span>{r.soft ? `${q.title} (people can still film)` : r.type && r.type !== 'other' ? BLOCK_TYPES[r.type] : q.title || BLOCK_TYPES.other}</p>
                : <p className="text-pt-muted">Skipped.</p>}
              {!!r.clashWith?.length && <p className="text-red-300 text-sm font-semibold mt-1">⚠ Clash with {r.clashWith.join(', ')}, same house and time.</p>}
              {q.problem && <p className="text-red-300 text-sm mt-1">{q.problem}</p>}
            </div>
            <GoogleLinks link={q.link} date={q.date} clash={!!r.clashWith?.length} />
            {err[q.id] && <p className="text-red-300 text-sm">{err[q.id]}</p>}
            <div className="flex gap-2 pt-1">
              {q.kind === 'app-moved' && <button disabled={busy === q.id || busy === '*'} onClick={() => act(q, 'restore')} className="flex-1 min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy === q.id ? 'Saving…' : 'Put it back in Google Calendar'}</button>}
              {q.placed && !q.problem && <button disabled={busy === q.id || busy === '*'} onClick={() => act(q, 'confirm')} className="flex-1 min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy === q.id ? 'Saving…' : 'Looks right ✓'}</button>}
              {q.kind !== 'removed' && q.kind !== 'app-moved' && <button disabled={busy === q.id || busy === '*'} onClick={() => setFixing(q)} className={`${q.placed && !q.problem ? 'px-5' : 'flex-1 bg-pt-accent text-stone-900 font-semibold'} min-h-[48px] rounded-xl ${q.placed && !q.problem ? 'bg-pt-raised text-pt-text' : ''} disabled:opacity-40`}>Fix</button>}
              {/* No Skip on a change: it would cancel a booking that's already on the schedule (audit, Nov 7). */}
              {q.kind === 'new' && <button disabled={busy === q.id || busy === '*'} onClick={() => act(q, 'skip')} className="px-4 min-h-[48px] rounded-xl text-pt-muted disabled:opacity-40">Skip</button>}
            </div>
            {q.kind !== 'removed' && q.kind !== 'app-moved' && (
              <button onClick={() => setNotFilming(q)} className="tap inline-flex items-center gap-1 text-pt-muted text-sm underline underline-offset-2">Not filming? Ignore events like this</button>
            )}
          </div>
        )
      })}
      {fixing && <FixSheet q={fixing} people={people} s={s} onClose={() => setFixing(null)} />}
      {notFilming && <NotFilmingSheet title={notFilming.title} onClose={() => setNotFilming(null)} />}
      <IgnoreList list={s.calendarIgnore} />
    </div>
  )
}

function FixSheet({ q, people, s, onClose }: { q: QueueItem; people: Person[]; s: ScheduleSettings; onClose: () => void }) {
  const g = q.placed ? q.result : q.guess
  // The app's unsure guesses aren't shown as decisions (audit, Nov 7): a name two people share opens on "A shoot" with nobody
  // picked, and a house the event doesn't say opens with no house picked.
  const unsure = !q.placed ? q.guess : {}
  const start0: QueueFix['action'] | 'heads' = unsure.ambiguous?.length ? 'shoot' : g.action === 'block' ? (g.soft ? 'heads' : 'block') : 'shoot'
  const [kind, setKind] = useState<QueueFix['action'] | 'heads'>(start0)
  const [emails, setEmails] = useState<string[]>(unsure.ambiguous?.length ? [] : g.emails?.length ? g.emails : g.email ? [g.email] : [])
  const [house, setHouse] = useState<string>(unsure.houseUnsure ? '' : g.house ?? 'cliff1')
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
            {!house && <option value="">Where? Pick a house or offsite</option>}
            <option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option><option value="offsite">Offsite</option>
          </select>
          {emails.length > 0 && house && <p className="text-pt-muted text-sm">On the schedule: <span className="text-pt-text">{turns(q, emails, house, s, people)}</span></p>}
        </>}
        {kind !== 'shoot' && <>
          <select value={house === 'cliff2' || house === 'cliff1' ? house : ''} onChange={x => setHouse(x.target.value)} className={field}>
            {house !== 'cliff1' && house !== 'cliff2' && <option value="">Which house?</option>}
            <option value="cliff1">{s.houses.cliff1.name}</option><option value="cliff2">{s.houses.cliff2.name}</option>
          </select>
          <select value={type} onChange={x => setType(x.target.value as BlockType)} className={field}>{(Object.keys(BLOCK_TYPES) as BlockType[]).map(t => <option key={t} value={t}>{BLOCK_TYPES[t]}</option>)}</select>
          {kind === 'heads' && <p className="text-pt-muted text-sm">Shows on the calendar as a heads-up. Creators can still book around it.</p>}
        </>}
        {err && <p className="text-red-300 text-sm">{err}</p>}
        <button disabled={busy || (kind === 'shoot' && !emails.length) || !house || (kind !== 'shoot' && house === 'offsite')} onClick={save} className="w-full min-h-[52px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {busy ? 'Saving…' : kind === 'shoot' && !emails.length ? 'Pick who\'s filming' : !house || (kind !== 'shoot' && house === 'offsite') ? 'Pick where it is' : 'Save and confirm'}
        </button>
      </div>
    </BottomSheet>
  )
}

// Open the event (or the whole day, to compare a clash) in Google Calendar to check it before confirming (owner, Nov 8).
export function GoogleLinks({ link, date, clash }: { link?: string; date: string; clash?: boolean }) {
  const cls = 'inline-flex items-center gap-1 min-h-[44px] text-[15px] font-semibold text-sky-300'
  return (
    <div className="flex flex-wrap gap-x-5 px-1">
      {link && <a href={link} target="_blank" rel="noopener noreferrer" className={cls}>Open in Google Calendar ↗</a>}
      {(clash || !link) && <a href={googleDayLink(date)} target="_blank" rel="noopener noreferrer" className={cls}>{link ? 'See the whole day ↗' : 'See this day in Google Calendar ↗'}</a>}
    </div>
  )
}

// A short phrase from the event title to ignore: a meeting word if there is one ("team meeting"), else the whole title.
export function suggestPhrase(title: string) {
  const t = title.toLowerCase().replace(/\s+/g, ' ').trim()
  const m = t.match(/\b((?:[a-z]+ )?(?:meeting|mtg|stand-?up|huddle|all[- ]hands|sync|call|check-?in|training|interview|onboarding))\b/)
  return (m ? m[1] : t).slice(0, 60)
}

// "Not filming" (owner, Nov 23): team/admin meetings in the old calendars kept showing as clashes. One tap: events whose title
// contains this phrase are never brought in, and what the app made from them comes off.
export function NotFilmingSheet({ title, onClose }: { title: string; onClose: () => void }) {
  const [phrase, setPhrase] = useState(() => suggestPhrase(title))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = (await ignoreCalendarEvents({ phrase })).data
      setMsg(`Done ✓ Events with "${phrase.trim().toLowerCase()}" are ignored from now on${r.cleared ? ` · ${r.cleared} taken off now` : ''}.`)
    } catch (e) { setMsg(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title="Not filming">
      <p className="text-pt-muted text-sm">"{title || '(no title)'}"</p>
      <label className="block mt-4"><span className="block text-pt-muted text-xs mb-2">Ignore every event whose title has</span>
        <input value={phrase} onChange={e => setPhrase(e.target.value)} className="w-full bg-pt-bg rounded-xl px-3 py-3 text-pt-text shadow-hairline" /></label>
      <p className="text-pt-muted text-xs mt-2">Keep it short, like "team meeting" or "admin". Meetings, stand-ups and interviews are already ignored by themselves. A shoot that mentions it ("… filming") still comes in. Nothing is changed in Google Calendar.</p>
      {msg && <p className="text-pt-text text-sm mt-3">{msg}</p>}
      {msg.startsWith('Done')
        ? <button onClick={onClose} className="mt-5 w-full min-h-[48px] rounded-[14px] bg-pt-raised text-pt-text font-semibold">Close</button>
        : <button disabled={busy || phrase.trim().length < 3} onClick={save} className="mt-5 w-full min-h-[48px] rounded-[14px] bg-pt-accent text-stone-900 font-semibold shadow-gold disabled:opacity-40">{busy ? 'Saving…' : 'Ignore events like this'}</button>}
    </BottomSheet>
  )
}

// The list of "not filming" phrases, at the bottom of the Calendar tab: see them, remove one, add one.
function IgnoreList({ list }: { list: string[] }) {
  const [open, setOpen] = useState(false)
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function run(phrase: string, remove = false) {
    setBusy(phrase); setErr('')
    try { await ignoreCalendarEvents({ phrase, remove }); if (!remove) setAdd('') } catch (e) { setErr(friendlyError(e)) } finally { setBusy('') }
  }
  return (
    <section className="bg-pt-surface rounded-2xl p-4">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center justify-between min-h-[44px] text-left">
        <span><span className="block text-pt-text font-semibold">Not filming</span>
          <span className="block text-pt-muted text-sm">Meetings, stand-ups and interviews are ignored{list.length ? `, plus ${list.length} of your own` : ''}.</span></span>
        <span className="text-pt-muted">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {list.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {list.map(p => (
                <button key={p} disabled={!!busy} onClick={() => run(p, true)} aria-label={`Stop ignoring ${p}`}
                  className="inline-flex items-center gap-2 bg-pt-raised rounded-full px-3 min-h-[40px] text-sm text-pt-text shadow-hairline disabled:opacity-40">{p}<span className="text-pt-muted">×</span></button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={add} onChange={e => setAdd(e.target.value)} placeholder='e.g. "admin meeting"' className="flex-1 bg-pt-bg rounded-xl px-3 min-h-[44px] text-pt-text shadow-hairline" />
            <button disabled={!!busy || add.trim().length < 3} onClick={() => run(add)} className="px-4 min-h-[44px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">Add</button>
          </div>
          {err && <p className="text-red-300 text-sm">{err}</p>}
        </div>
      )}
    </section>
  )
}
