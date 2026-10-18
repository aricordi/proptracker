// Owner only: what the app is costing to run this month, where the space goes, and the photo clean-up.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

interface Report {
  month: string; measured: boolean
  storage: { files: number; bytes: number; byFolder: Record<string, { files: number; bytes: number }> }
  usage: { reads: number | null; writes: number | null; downloadedBytes: number | null }
  estimate: { storage: number; reads: number | null; writes: number | null; downloads: number | null; ai: number }
  cleanup: { wouldRemove: number; wouldFreeBytes: number; oldProof: number; unused: number; lastRun: { at: string; removed: number; freedBytes: number; failed: number } | null }
  ai: { spentUsd: number; importSpentUsd: number }
}
const costReport = httpsCallable<Record<string, never>, Report>(functions, 'costReport')
const cleanUpPhotos = httpsCallable<Record<string, never>, { removed: number; freedBytes: number; failed: number; left: number }>(functions, 'cleanUpPhotos')

const FOLDERS: Record<string, string> = {
  items: 'Prop photos', thumbs: 'Small copies for lists', gear: 'Gear photos', avatars: 'Profile photos',
  'request-photos': 'Reference photos (make or find)', 'reservation-photos': 'Prop proof photos (pack, return, check-in)',
  'gear-returns': 'Gear return photos', 'shoot-photos': 'Shoot set photos',
}
const size = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`
const money = (n: number | null) => n === null ? '—' : n < 0.01 ? 'under 1¢' : `$${n.toFixed(2)}`
const errText = (e: unknown) => (e as Error)?.message?.replace(/^.*?:\s*/, '') || 'That didn\'t work. Try again.'

export default function CostsScreen() {
  const navigate = useNavigate()
  const [r, setR] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => { setErr(''); costReport({}).then(x => setR(x.data)).catch(e => setErr(errText(e))) }
  useEffect(load, [])
  async function clean() {
    setBusy(true); setMsg('')
    try {
      const x = (await cleanUpPhotos({})).data
      setMsg(`Removed ${x.removed} photo${x.removed === 1 ? '' : 's'} (${size(x.freedBytes)})${x.left ? `. ${x.left} more next time.` : '.'}${x.failed ? ` ${x.failed} couldn't be removed; they'll be tried again.` : ''}`)
      load()
    } catch (e) { setMsg(errText(e)) } finally { setBusy(false) }
  }
  const e = r?.estimate
  const total = e ? e.storage + (e.reads ?? 0) + (e.writes ?? 0) + (e.downloads ?? 0) + e.ai : 0
  const row = (label: string, value: string, sub?: string) => (
    <div className="flex items-baseline justify-between gap-3 px-4 py-3">
      <span className="min-w-0"><span className="block text-pt-text">{label}</span>{sub && <span className="block text-pt-muted text-xs">{sub}</span>}</span>
      <span className="text-pt-text font-semibold tabular-nums shrink-0">{value}</span>
    </div>
  )
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate('/admin')} className="tap w-8 -ml-2 text-pt-accent text-[32px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">Running costs</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {!r && !err && <p className="text-pt-muted text-sm">Adding it up… (this takes a few seconds)</p>}
        {r && e && <>
          <div className="bg-pt-surface rounded-2xl p-4">
            <p className="text-pt-muted text-xs uppercase tracking-wider">Estimated for this month</p>
            <p className="text-pt-text text-4xl font-bold mt-1">{money(total)}</p>
            <p className="text-pt-muted text-sm mt-1">{r.measured ? 'From Google\'s usage counts so far this month, projected to the end of the month, at list prices after the free amounts.' : 'Storage and AI only; usage counts weren\'t available.'} Your Google bill is the exact number.</p>
          </div>
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {row('Database reads', money(e.reads), r.usage.reads === null ? undefined : `${r.usage.reads.toLocaleString()} so far · first 50,000 a day free`)}
            {row('Database writes', money(e.writes), r.usage.writes === null ? undefined : `${r.usage.writes.toLocaleString()} so far · first 20,000 a day free`)}
            {row('Photos stored', money(e.storage), `${size(r.storage.bytes)} in ${r.storage.files.toLocaleString()} files`)}
            {row('Photo downloads', money(e.downloads), r.usage.downloadedBytes === null ? undefined : `${size(r.usage.downloadedBytes)} so far`)}
            {row('AI helpers', money(e.ai), `$${r.ai.spentUsd.toFixed(2)} so far · cap in Admin → AI helpers`)}
          </div>
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2 px-1">Where the space goes</p>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {Object.entries(r.storage.byFolder).sort((a, b) => b[1].bytes - a[1].bytes).map(([f, v]) => row(FOLDERS[f] ?? f, size(v.bytes), `${v.files.toLocaleString()} files`))}
            </div>
          </div>
          <div className="bg-pt-surface rounded-2xl p-4 space-y-2">
            <p className="text-pt-text font-semibold">Photo clean-up</p>
            <p className="text-pt-muted text-sm">Removes proof photos older than 6 months, and photos nothing in the app uses any more (only after 14 days). Photos any prop, booking, shoot or profile still uses are never touched. Removed files can be recovered for 7 days.</p>
            <p className="text-pt-text text-sm">{r.cleanup.wouldRemove ? `Ready to remove ${r.cleanup.wouldRemove} (${size(r.cleanup.wouldFreeBytes)}): ${r.cleanup.oldProof} old proof, ${r.cleanup.unused} unused.` : 'Nothing to remove right now.'}</p>
            {r.cleanup.lastRun && <p className="text-pt-muted text-xs">Last run {new Date(r.cleanup.lastRun.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: removed {r.cleanup.lastRun.removed} ({size(r.cleanup.lastRun.freedBytes)}).</p>}
            <button disabled={busy || !r.cleanup.wouldRemove} onClick={clean} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40 shadow-gold">{busy ? 'Cleaning up…' : 'Clean up now'}</button>
            {msg && <p className="text-pt-muted text-sm">{msg}</p>}
          </div>
          <p className="text-pt-muted text-xs">Prices are Google's list prices in US dollars; this region may differ a little. Hosting, backups and server functions cost cents and aren't listed.</p>
        </>}
      </div>
    </div>
  )
}
