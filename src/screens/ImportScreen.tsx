import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useSession } from '../auth'
import {
  subscribeToImportJobs, subscribeToImportBudget, setImportCap, importInfo, startImport, processImport, undoImport,
  DEFAULT_CAP_USD, type ImportJob, type ImportBudget,
} from '../services/importer'
import { formatDay } from '../lib/dates'

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const errText = (err: unknown) => err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server. Check your connection."

// Admin → Import: bring the existing photo library in from Google Drive.
export default function ImportScreen() {
  const navigate = useNavigate()
  const { isOwner } = useSession()
  const [jobs, setJobs] = useState<ImportJob[] | null>(null)
  const [budget, setBudget] = useState<ImportBudget>({ capUsd: DEFAULT_CAP_USD, spentUsd: 0 })
  const [account, setAccount] = useState<string | null>(null)
  const [links, setLinks] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [running, setRunning] = useState<string | null>(null)   // job being processed on this screen
  const stopRef = useRef(false)

  useEffect(() => subscribeToImportJobs(setJobs), [])
  useEffect(() => subscribeToImportBudget(setBudget), [])
  useEffect(() => { importInfo().then(r => setAccount(r.data.serviceAccount)).catch(() => setAccount(null)) }, [])
  // Leaving the screen stops the run (it can be resumed any time).
  useEffect(() => () => { stopRef.current = true }, [])

  async function start(dryRun: boolean) {
    setBusy(true); setMessage(null)
    try {
      const list = links.split(/\s+/).filter(Boolean)
      const r = (await startImport({ links: list, dryRun })).data
      if (!r.jobId) {
        setMessage({ tone: 'ok', text: `Found ${r.found} photos; all of them were already imported. Nothing new to do.` })
      } else {
        setMessage({ tone: 'ok', text: `Found ${r.found} photos. Queued ${r.queued}${r.alreadyImported ? ` (${r.alreadyImported} were already imported)` : ''}.` })
        setLinks('')
        run(r.jobId)
      }
    } catch (err) {
      setMessage({ tone: 'error', text: errText(err) })
    } finally { setBusy(false) }
  }

  async function run(jobId: string, retryFailed = false) {
    stopRef.current = false
    setRunning(jobId); setMessage(null)
    try {
      let first = true
      let stalls = 0   // pauses in a row without a single photo getting through
      let lastPending: number | undefined
      while (!stopRef.current) {
        const r = (await processImport({ jobId, retryFailed: first && retryFailed })).data
        first = false
        if (r.capped) {
          setMessage({ tone: 'error', text: `Stopped: the AI spending cap (${usd(r.capUsd)}) was reached. Raise the cap below to continue.` })
          break
        }
        if (r.slowDown) {
          stalls = r.processed > 0 && r.counts.pending < (lastPending ?? Infinity) ? 0 : stalls + 1
          lastPending = r.counts.pending
          if (stalls >= 6) {
            setMessage({ tone: 'error', text: "Google keeps saying \"too many requests\", so the AI's limit may be used up for now (some keys have an hourly or daily limit). Nothing is lost: tap \"Continue\" later, or tell Claude to check the AI key's plan." })
            break
          }
          // Google asked us to slow down; those photos went back in the queue.
          setMessage({ tone: 'ok', text: 'Google asked us to slow down. Waiting 30 seconds, then carrying on by itself…' })
          for (let s = 0; s < 30 && !stopRef.current; s++) await new Promise(res => setTimeout(res, 1000))
          setMessage(null)
          continue
        }
        lastPending = r.counts.pending
        stalls = 0
        if (r.counts.pending === 0 || r.processed === 0) break
      }
    } catch (err) {
      setMessage({ tone: 'error', text: `${errText(err)} Tap "Continue" to pick up where it stopped.` })
    } finally { setRunning(null) }
  }

  async function undo(j: ImportJob) {
    const props = j.counts.approved
    if (!window.confirm(`Undo this import?\n\nThis deletes the ${props} prop${props === 1 ? '' : 's'} it created and clears its history, so the same photos can be imported again. It can't be undone. Money already spent on the AI stays spent.`)) return
    setMessage(null)
    try {
      const r = (await undoImport({ jobId: j.id })).data
      setMessage({ tone: 'ok', text: `Import undone: ${r.deletedProps} prop${r.deletedProps === 1 ? '' : 's'} deleted, ${r.clearedPhotos} photos cleared.` })
    } catch (err) {
      setMessage({ tone: 'error', text: errText(err) })
    }
  }

  async function changeCap() {
    const v = window.prompt('New spending cap for imports, in US dollars:', String(budget.capUsd))
    const n = Number(v)
    if (v !== null && Number.isFinite(n) && n >= 0 && n <= 500) await setImportCap(n)
  }

  const pct = Math.min(100, (budget.spentUsd / Math.max(budget.capUsd, 0.0001)) * 100)
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Import props</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-pt-text font-medium">AI spending</p>
            {isOwner && <button onClick={changeCap} className="text-pt-accent text-sm tap">Change cap</button>}
          </div>
          <div className="h-2 rounded-full bg-pt-bg overflow-hidden"><div className="h-full bg-pt-accent" style={{ width: `${pct}%` }} /></div>
          <p className="text-pt-muted text-sm">{usd(budget.spentUsd)} of {usd(budget.capUsd)} cap. About $0.002 a photo; the import stops by itself at the cap.</p>
        </div>

        {isOwner && (
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
            <p className="text-pt-text font-medium">Add photos from Google Drive</p>
            <ol className="text-pt-muted text-sm list-decimal pl-5 space-y-1">
              <li>In Google Drive, share each folder (or one folder that holds them all) with this address as <b>Viewer</b>:</li>
            </ol>
            {account ? (
              <button onClick={() => navigator.clipboard?.writeText(account)} className="w-full text-left bg-pt-bg shadow-hairline rounded-xl px-3 py-2 text-pt-text text-sm break-all">
                {account} <span className="text-pt-accent">· copy</span>
              </button>
            ) : <p className="text-pt-muted text-sm">Loading the address…</p>}
            <ol start={2} className="text-pt-muted text-sm list-decimal pl-5 space-y-1">
              <li>Paste the folder links below, one per line. Folders inside them are included.</li>
              <li>Start with a <b>dry run</b> of 10 photos and check the suggestions.</li>
            </ol>
            <textarea value={links} onChange={e => setLinks(e.target.value)} rows={4} placeholder="https://drive.google.com/drive/folders/…"
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => start(true)} disabled={busy || !!running || !links.trim()}
                className="py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Dry run (10)</button>
              <button onClick={() => window.confirm('Import every photo in these folders? Photos already imported are skipped.') && start(false)}
                disabled={busy || !!running || !links.trim()}
                className="py-3 rounded-xl bg-pt-bg border border-pt-accent text-pt-accent font-semibold disabled:opacity-40">Import all</button>
            </div>
            {busy && <p className="text-pt-muted text-sm">Looking through the folders… (big folders take a minute)</p>}
          </div>
        )}

        {message && <p className={`text-sm rounded-xl px-4 py-3 ${message.tone === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-300'}`}>{message.text}</p>}
        {running && (
          <div className="flex items-center justify-between gap-3 bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-3">
            <p className="text-sky-200 text-sm">Working… keep this screen open. You can stop and continue later.</p>
            <button onClick={() => { stopRef.current = true }} className="text-sky-200 text-sm font-medium shrink-0">Stop</button>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-pt-muted text-xs">Imports</p>
          {jobs === null && <p className="text-pt-muted text-sm">Loading…</p>}
          {jobs?.length === 0 && <p className="text-pt-muted text-sm">None yet.</p>}
          {jobs?.map(j => {
            const c = j.counts
            const done = c.analyzed + c.approved + c.skipped + c.failed
            return (
              <div key={j.id} className="bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-pt-text text-sm font-medium truncate">{j.folders.map(f => f.name).join(', ')}</p>
                    <p className="text-pt-muted text-xs">{formatDay(j.createdAt.slice(0, 10))} · {j.total} {j.total === 1 ? 'photo' : 'photos'} · {usd(j.spentUsd)}{j.dryRun ? ' · dry run' : ''}</p>
                  </div>
                  {running === j.id && <span className="text-sky-300 text-xs shrink-0">working…</span>}
                </div>
                <div className="h-2 rounded-full bg-pt-bg overflow-hidden flex">
                  <div className="h-full bg-green-500" style={{ width: `${(c.approved / j.total) * 100}%` }} />
                  <div className="h-full bg-pt-accent" style={{ width: `${(c.analyzed / j.total) * 100}%` }} />
                  <div className="h-full bg-pt-muted" style={{ width: `${(c.skipped / j.total) * 100}%` }} />
                  <div className="h-full bg-red-500" style={{ width: `${(c.failed / j.total) * 100}%` }} />
                </div>
                <p className="text-pt-muted text-xs">
                  {done} of {j.total} analyzed · <span className="text-pt-accent">{c.analyzed} to review</span> · {c.approved} approved · {c.skipped} skipped
                  {c.failed > 0 && <span className="text-red-300"> · {c.failed} failed</span>}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => navigate(`/import/${j.id}`)} className="px-3 py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-medium">Review ({c.analyzed})</button>
                  {isOwner && c.pending > 0 && running !== j.id && (
                    <button onClick={() => run(j.id)} disabled={!!running} className="px-3 py-2 rounded-lg shadow-hairline text-pt-text text-sm disabled:opacity-40">Continue ({c.pending} left)</button>
                  )}
                  {isOwner && c.failed > 0 && !running && (
                    <button onClick={() => run(j.id, true)} className="px-3 py-2 rounded-lg shadow-hairline text-pt-text text-sm">Try failed again</button>
                  )}
                  {isOwner && !running && (
                    <button onClick={() => undo(j)} className="px-3 py-2 rounded-lg text-red-400 text-sm ml-auto">Undo this import</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
