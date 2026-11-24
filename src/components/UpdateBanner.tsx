import { useEffect, useState } from 'react'
import { APP_VERSION, compareVersions, liveVersion } from '../lib/version'

// "A newer version is ready" (owner, Nov 23). Phones normally update by themselves (main.tsx), but an iPhone home-screen app
// can sit on an old version for days. Checks the server's version when the app opens, when it comes back to the screen and
// every 30 minutes; if the server is newer, a slim bar under the clock offers Update (reloads onto the new version).
export default function UpdateBanner() {
  const [newer, setNewer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!navigator.onLine) return
      const v = await liveVersion()
      if (alive && v && compareVersions(v, APP_VERSION) > 0) setNewer(v)
    }
    const t = setTimeout(check, 6000)
    const i = setInterval(check, 30 * 60 * 1000)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    return () => { alive = false; clearTimeout(t); clearInterval(i); document.removeEventListener('visibilitychange', vis) }
  }, [])
  if (!newer) return null

  // Owner (Nov 24): "a lot of times I tap Update and it does nothing". The old version reloaded straight away, before the
  // new version had finished downloading, so the phone just showed the old copy again. Now: show "Updating…", wait for the
  // new version to take over (up to ~13 s), and if it doesn't, clear the saved copy so the reload always gets the new one.
  async function update() {
    if (busy) return
    setBusy(true)
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    try {
      const sw = navigator.serviceWorker
      const reg = await sw?.getRegistration()
      if (sw && reg) {
        const changed = new Promise<boolean>(r => sw.addEventListener('controllerchange', () => r(true), { once: true }))
        await Promise.race([reg.update().catch(() => {}), wait(5000)])
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
        const ok = await Promise.race([changed, wait(8000).then(() => false)])
        if (!ok) {
          await reg.unregister().catch(() => false)
          const keys = await caches.keys().catch(() => [] as string[])
          await Promise.all(keys.map(k => caches.delete(k).catch(() => false)))
        }
      }
    } catch { /* reload anyway */ }
    window.location.reload()
  }

  return (
    <div className="fixed inset-x-0 z-[90] flex justify-center px-4 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-full bg-pt-surface shadow-float pl-4 pr-1.5 py-1.5 max-w-full">
        <span className="text-pt-text text-sm truncate">{busy ? `Getting version ${newer}…` : `Version ${newer} is ready`}</span>
        <button onClick={update} disabled={busy} className="shrink-0 min-h-[44px] px-5 rounded-full bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-70 touch-manipulation">{busy ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
  )
}
