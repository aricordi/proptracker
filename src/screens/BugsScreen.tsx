// Problem reports (owner, Nov 5): everything people sent with "Report a problem", newest first, with the screenshot,
// what they wrote, where they were and what the app knew. Mark it fixed (thanks them with a notification) or won't fix.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { subscribeBugReports, updateBugReport, phoneLabel, BUG_KIND_LABEL, type BugReport, type BugStatus } from '../services/bugs'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'

const TABS: { k: BugStatus; label: string }[] = [{ k: 'open', label: 'Open' }, { k: 'fixed', label: 'Fixed' }, { k: 'wontfix', label: "Won't fix" }]
const KIND_TONE: Record<string, string> = { broken: 'bg-red-500/15 text-red-200', wrong: 'bg-amber-400/15 text-amber-200', missing: 'bg-sky-400/15 text-sky-200' }
const when = (iso: string) => `${formatDay(iso.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`

export default function BugsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const focus = params.get('id')
  const [list, setList] = useState<BugReport[] | null>(null)
  const [tab, setTab] = useState<BugStatus>('open')
  useEffect(() => subscribeBugReports(setList), [])
  // Opened from a notification: show the tab that report is on.
  useEffect(() => { const r = list?.find(x => x.id === focus); if (r) setTab(r.status) }, [list, focus])
  const shown = useMemo(() => (list ?? []).filter(r => (r.status ?? 'open') === tab), [list, tab])
  const count = (k: BugStatus) => (list ?? []).filter(r => (r.status ?? 'open') === k).length

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(-1)} className="text-pt-text min-w-[44px] min-h-[44px] -ml-2 text-2xl" aria-label="Back">‹</button>
          <h1 className="font-display text-[28px] text-pt-text">Problem reports</h1>
        </div>
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} aria-pressed={tab === t.k}
              className={`shrink-0 px-3.5 min-h-[40px] inline-flex items-center gap-1 rounded-full text-sm ${tab === t.k ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
              {t.label} · {count(t.k)}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 space-y-3">
        {list === null && <p className="text-pt-muted text-sm">Loading…</p>}
        {list && shown.length === 0 && (
          <div className="rounded-2xl bg-pt-surface shadow-hairline p-5">
            <p className="text-pt-text text-[16px] font-semibold">{tab === 'open' ? 'Nothing to look at' : 'None yet'}</p>
            <p className="text-pt-muted text-[14px] mt-1">When someone taps Report a problem (Me, Help, the team menus, the chat, or two fingers held on the screen), it lands here with a screenshot.</p>
          </div>
        )}
        {shown.map(r => <ReportCard key={r.id} r={r} focus={r.id === focus} />)}
      </div>
    </div>
  )
}

function ReportCard({ r, focus }: { r: BugReport; focus: boolean }) {
  const [more, setMore] = useState(focus)
  const [note, setNote] = useState(r.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  async function set(status: BugStatus) {
    setBusy(true); setError(null)
    try { await updateBugReport({ id: r.id, status, note: note.trim() }) }
    catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <div className={`rounded-[20px] bg-pt-surface shadow-hairline overflow-hidden ${focus ? 'ring-2 ring-pt-accent/70' : ''}`}>
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${KIND_TONE[r.kind] ?? KIND_TONE.broken}`}>{BUG_KIND_LABEL[r.kind] ?? r.kind}</span>
            <p className="text-pt-text text-[16px] font-semibold mt-1.5">{r.name} <span className="text-pt-muted font-normal text-[14px]">· {r.role}</span></p>
            <p className="text-pt-muted text-[14px]">{when(r.at)} · on <span className="text-pt-text/80">{r.page || '?'}</span></p>
          </div>
        </div>
        <p className="text-pt-text text-[16px] whitespace-pre-wrap">{r.what}</p>
        {r.expected && <p className="text-pt-muted text-[14px]"><span className="text-pt-text/80">Expected:</span> {r.expected}</p>}
        {r.screenshots?.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {r.screenshots.map(u => (
              <button key={u} onClick={() => setZoom(u)} className="shrink-0">
                <img src={u} alt="Screenshot" loading="lazy" className="w-24 h-44 object-cover object-top rounded-xl shadow-hairline bg-pt-bg" />
              </button>
            ))}
          </div>
        )}
        <p className="text-pt-muted text-[12px]">{phoneLabel(r.device)} · version {r.app?.build || '?'}{r.app?.viewAs ? ` · viewing as ${r.app.viewAs}` : ''}{r.device?.online === false ? ' · NO SIGNAL' : ''}</p>
        <button onClick={() => setMore(m => !m)} className="text-pt-accent text-[14px] tap">{more ? 'Hide details' : `Details${r.errors?.length ? ` · ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}` : ''}`}</button>
        {more && (
          <div className="space-y-2 text-[12px] text-pt-muted">
            <div><p className="text-pt-text/80">Last pages</p><p className="break-words">{r.trail?.length ? r.trail.join(' → ') : '–'}</p></div>
            <div><p className="text-pt-text/80">Recent errors</p>
              {r.errors?.length ? <pre className="whitespace-pre-wrap break-words bg-pt-bg rounded-xl p-2 max-h-48 overflow-y-auto">{r.errors.join('\n')}</pre> : <p>None</p>}</div>
            <div><p className="text-pt-text/80">Phone</p><p className="break-words">{r.device?.agent} · {r.device?.lang} · {r.device?.tz}</p></div>
            <p>{r.email}</p>
          </div>
        )}
      </div>
      <div className="px-4 pb-4 space-y-2">
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={400} placeholder="Note (optional, sent with 'Fixed')"
          className="w-full rounded-xl bg-pt-bg shadow-hairline px-3 py-2.5 text-[16px] text-pt-text placeholder-pt-muted outline-none" />
        {error && <p className="text-red-300 text-[14px]">{error}</p>}
        <div className="flex gap-2">
          {r.status !== 'fixed' && <button disabled={busy} onClick={() => void set('fixed')} className="flex-1 min-h-[44px] rounded-full bg-pt-accent text-stone-900 text-[14px] font-semibold disabled:opacity-40">Fixed</button>}
          {r.status !== 'wontfix' && <button disabled={busy} onClick={() => void set('wontfix')} className="flex-1 min-h-[44px] rounded-full bg-pt-bg shadow-hairline text-pt-text text-[14px] disabled:opacity-40">Won't fix</button>}
          {r.status !== 'open' && <button disabled={busy} onClick={() => void set('open')} className="flex-1 min-h-[44px] rounded-full bg-pt-bg shadow-hairline text-pt-text text-[14px] disabled:opacity-40">Open again</button>}
        </div>
      </div>
      {zoom && (
        <button onClick={() => setZoom(null)} className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" aria-label="Close">
          <img src={zoom} alt="Screenshot" className="max-w-full max-h-full rounded-xl" />
        </button>
      )}
    </div>
  )
}
