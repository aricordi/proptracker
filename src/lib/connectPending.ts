// The ChatGPT / Claude sign-in request waiting on this browser (see App): from the /connect link, kept 15 minutes.
const CONNECT_KEY = 'pc.connectReq'
export function connectPending(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('req') ?? ''
    if (window.location.pathname === '/connect' && q) { localStorage.setItem(CONNECT_KEY, JSON.stringify({ req: q, at: Date.now() })); return q }
    const saved = JSON.parse(localStorage.getItem(CONNECT_KEY) || 'null') as { req: string; at: number } | null
    if (saved && Date.now() - saved.at < 15 * 60_000) return saved.req
    if (saved) localStorage.removeItem(CONNECT_KEY)
  } catch { /* private mode */ }
  return window.location.pathname === '/connect' ? 'none' : ''
}
export function clearConnectPending() { try { localStorage.removeItem(CONNECT_KEY) } catch { /* ignore */ } }

// The request id for the Allow page: from the link, else the one remembered on this browser.
export function connectReq(): string {
  const q = new URLSearchParams(window.location.search).get('req')
  if (q) return q
  const r = connectPending()
  return r === 'none' ? '' : r
}
