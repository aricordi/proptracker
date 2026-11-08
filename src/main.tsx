import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { installBugLog } from './lib/bugLog'

installBugLog()   // remembers recent errors for "Report a problem" (memory only)

// Get new versions quickly: check when the app comes back to the screen (iPhones usually wake the app instead of
// restarting it, so it could keep an old version for days) and every 30 minutes. A new version reloads the app.
// Nov 8 (older phones / weak signal): the offline copy of every screen (~700 KB the first time) used to start downloading
// the moment the page opened, competing with the app's own first load. Now it waits until the page has loaded plus a few
// seconds. Later visits only fetch what changed.
const startOffline = () => registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}) }
    setInterval(check, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  },
})
if (document.readyState === 'complete') setTimeout(startOffline, 4000)
else window.addEventListener('load', () => setTimeout(startOffline, 4000), { once: true })

// A new version went live while this page was open and a screen it hadn't opened yet is gone from the server: load the new
// version (once a minute at most, so a real outage can't loop).
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('pc.reloadedForUpdate') || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('pc.reloadedForUpdate', String(Date.now()))
  } catch { /* private mode: still reload */ }
  e.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
