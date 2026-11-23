import { useEffect, useState } from 'react'
import { APP_VERSION, compareVersions, liveVersion } from '../lib/version'

// "A newer version is ready" (owner, Nov 23). Phones normally update by themselves (main.tsx), but an iPhone home-screen app
// can sit on an old version for days. Checks the server's version when the app opens, when it comes back to the screen and
// every 30 minutes; if the server is newer, a slim bar under the clock offers Update (reloads onto the new version).
export default function UpdateBanner() {
  const [newer, setNewer] = useState<string | null>(null)
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

  async function update() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
      reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    } catch { /* reload anyway */ }
    window.location.reload()
  }

  return (
    <div className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-full bg-pt-surface shadow-float pl-4 pr-1.5 py-1.5 max-w-full">
        <span className="text-pt-text text-sm truncate">Version {newer} is ready</span>
        <button onClick={update} className="shrink-0 min-h-[40px] px-4 rounded-full bg-pt-accent text-stone-900 text-sm font-semibold">Update</button>
      </div>
    </div>
  )
}
