// TEAM LOG (owner, Nov 23: "a history/log of everything Maanik approves and looks at so we can go back and undo or double
// check"). Every decision the schedule team makes, newest first: who, when, what. Filters by kind and by person. Undo runs the
// opposite action through the usual checks (it can't do anything the app wouldn't allow by hand); undone entries stay listed.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeTeamLog, undoTeamAction, ACTION_GROUP, type TeamLogEntry } from '../services/teamLog'
import { friendlyError } from '../lib/errors'
import { formatDay, studioDayOf } from '../lib/dates'
import { PageHeader, EmptyState } from '../components/PageHeader'

const KINDS = [
  { k: 'all', label: 'Everything' }, { k: 'approvals', label: 'Approvals' }, { k: 'changes', label: 'Moves & changes' },
  { k: 'calendar', label: 'Google Calendar' }, { k: 'checkins', label: 'No-shows & reports' },
] as const
const UNDO_WORDS: Record<string, string> = {
  unapprove: 'Puts it back to "waiting for approval".', rebook: 'Books the same time for them again, if it is still free.',
  move: 'Moves it back to where it was, if that time is still free.', swap: 'Swaps the two back.',
  removeBlocks: 'Removes the blocked time.', addBlock: 'Puts the blocked time back.',
  reopenCard: 'Puts the card back in the Calendar tab, "to check".', unignore: 'Stops ignoring those events.',
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayHead = (iso: string) => formatDay(studioDayOf(iso), { weekday: 'long', month: 'short', day: 'numeric' })
const pill = (on: boolean) => `shrink-0 whitespace-nowrap px-4 min-h-[40px] inline-flex items-center gap-1 rounded-full text-[15px] ${on ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`

export default function TeamLogScreen() {
  const nav = useNavigate()
  const [list, setList] = useState<TeamLogEntry[] | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]['k']>('all')
  const [who, setWho] = useState('')
  const [asking, setAsking] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  useEffect(() => subscribeTeamLog(setList), [])

  const people = useMemo(() => [...new Map((list ?? []).map(e => [e.by, e.byName || e.by])).entries()], [list])
  const shown = useMemo(() => (list ?? []).filter(e => (kind === 'all' || ACTION_GROUP[e.action] === kind) && (!who || e.by === who)), [list, kind, who])
  const groups = useMemo(() => {
    const out: { day: string; items: TeamLogEntry[] }[] = []
    for (const e of shown) { const d = studioDayOf(e.at); if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] }); out[out.length - 1].items.push(e) }
    return out
  }, [shown])

  async function undo(e: TeamLogEntry) {
    setBusy(e.id); setMsg(null)
    try { const r = await undoTeamAction({ id: e.id }); setMsg({ id: e.id, ok: true, text: `Done: ${r.data.what}.` }); setAsking('') }
    catch (err) { setMsg({ id: e.id, ok: false, text: friendlyError(err) }) }
    finally { setBusy('') }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-12">
      <PageHeader title="Team log" sub="Every approval and schedule change the team made. Undo puts it back, if it still can.">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 lg:flex-wrap">
          {KINDS.map(k => <button key={k.k} onClick={() => setKind(k.k)} aria-pressed={kind === k.k} className={pill(kind === k.k)}>{k.label}</button>)}
        </div>
        {people.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 mt-2 lg:flex-wrap">
            <button onClick={() => setWho('')} aria-pressed={!who} className={pill(!who)}>Everyone</button>
            {people.map(([email, name]) => <button key={email} onClick={() => setWho(email)} aria-pressed={who === email} className={pill(who === email)}>{name.split(' ')[0]}</button>)}
          </div>
        )}
      </PageHeader>
      <div className="px-4 space-y-6">
        {list === null && <p className="text-pt-muted text-sm">Loading…</p>}
        {list && shown.length === 0 && <EmptyState icon="note" title="Nothing here yet" line="When someone approves, denies, moves, swaps, cancels or blocks time, or sorts a Google Calendar card, it shows here." />}
        {groups.map(g => (
          <section key={g.day}>
            <h2 className="text-pt-muted text-[14px] font-medium mb-2">{dayHead(g.items[0].at)}</h2>
            <ul className="rounded-[20px] bg-pt-surface shadow-hairline divide-y divide-white/6">
              {g.items.map(e => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-pt-muted text-[13px] shrink-0 w-[64px]">{time(e.at)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] leading-snug ${e.undoneAt ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{e.label}</p>
                      <p className="text-pt-muted text-[13px] mt-0.5">by {e.byName || e.by}{e.undoneAt ? ` · undone by ${e.undoneByName || e.undoneBy} at ${time(e.undoneAt)}` : ''}</p>
                    </div>
                  </div>
                  {(e.shootIds?.length > 0 || (e.undo && !e.undoneAt)) && (
                    <div className="flex flex-wrap gap-2 mt-2 pl-[72px]">
                      {e.shootIds?.[0] && <button onClick={() => nav(`/schedule?shoot=${e.shootIds[0]}`)} className="min-h-[40px] px-4 rounded-full bg-pt-raised shadow-hairline text-[14px] text-pt-text">Open</button>}
                      {e.undo && !e.undoneAt && asking !== e.id && (
                        <button onClick={() => { setAsking(e.id); setMsg(null) }} className="min-h-[40px] px-4 rounded-full bg-pt-raised shadow-hairline text-[14px] text-pt-accent">Undo</button>)}
                    </div>
                  )}
                  {asking === e.id && e.undo && (
                    <div className="mt-3 ml-[72px] rounded-2xl bg-pt-raised p-3 space-y-2">
                      <p className="text-[14px] text-pt-text">{UNDO_WORDS[e.undo.kind] ?? 'Puts it back.'}</p>
                      <div className="flex gap-2">
                        <button disabled={busy === e.id} onClick={() => undo(e)} className="flex-1 min-h-[44px] rounded-full bg-pt-accent text-stone-900 font-semibold text-[15px]">{busy === e.id ? 'Undoing…' : 'Yes, undo it'}</button>
                        <button disabled={busy === e.id} onClick={() => setAsking('')} className="flex-1 min-h-[44px] rounded-full bg-pt-surface shadow-hairline text-[15px] text-pt-text">Keep it</button>
                      </div>
                    </div>
                  )}
                  {msg?.id === e.id && <p className={`mt-2 ml-[72px] text-[14px] ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {list && list.length >= 300 && <p className="text-pt-muted text-[13px] text-center">Showing the latest 300.</p>}
      </div>
    </div>
  )
}
