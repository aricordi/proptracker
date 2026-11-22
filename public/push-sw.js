// Phone notifications (loaded into the app's service worker by vite.config). Shows each push and opens the right
// screen when it's tapped. iPhone requires every push to show a notification, so this always shows one.
self.addEventListener('push', event => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch (e) { p = {} }
  const n = p.notification || {}, d = p.data || {}
  const title = d.title || n.title || 'Prime Capitol'
  const options = {
    body: d.body || n.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || n.tag || undefined,
    renotify: !!(d.tag || n.tag),
    data: { url: d.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

function askAppToOpen(win, url) {
  return new Promise(resolve => {
    const ch = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 1000)
    ch.port1.onmessage = () => { clearTimeout(timer); resolve(true) }
    try { win.postMessage({ type: 'pc-open', url }, [ch.port2]) } catch (e) { clearTimeout(timer); resolve(false) }
  })
}

// The tapped screen is also left in a small cache, so the app opens it itself once it's awake and signed in (Nov 22: on
// iPhone a sleeping or closed app often came up on its home screen instead of the notification's page).
async function savePending(url) {
  try { const c = await caches.open('pc-open'); await c.put('/__pc-open', new Response(JSON.stringify({ url, at: Date.now() }))) } catch (e) { /* no cache: the steps below still try */ }
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    await savePending(url)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        // The app is already open: ask it to switch screens itself, so a chat in progress isn't wiped by a full reload
        // (audit, Nov 7). Only if it doesn't answer within a second (old version, not loaded yet) reload it at that page.
        if (await askAppToOpen(w, url)) return
        if ('navigate' in w) return w.navigate(url).catch(() => {})
        return
      }
    }
    return self.clients.openWindow(url)
  })())
})
