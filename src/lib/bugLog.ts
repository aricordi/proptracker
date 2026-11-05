// What the app remembers for "Report a problem" (owner, Nov 5): the last errors and the last pages visited, kept only in
// memory on this phone (nothing is sent until the person sends a report). Errors come from the browser itself (crashes,
// failed promises, console errors) and from every message friendlyError() turns into plain words.
const MAX_ERRORS = 20, MAX_TRAIL = 12
const errors: string[] = []
const trail: string[] = []
const stamp = () => new Date().toTimeString().slice(0, 8)

export function noteError(e: unknown, where = '') {
  const err = e as { code?: string; message?: string; stack?: string } | null
  const text = [where, err?.code, err?.message ?? (typeof e === 'string' ? e : '')].filter(Boolean).join(' · ').slice(0, 380)
  if (!text) return
  if (errors[errors.length - 1]?.endsWith(text)) return   // the same error twice in a row = once
  errors.push(`${stamp()} ${text}`)
  if (errors.length > MAX_ERRORS) errors.shift()
}

export function notePage(path: string) {
  if (trail[trail.length - 1]?.endsWith(` ${path}`)) return
  trail.push(`${stamp()} ${path}`)
  if (trail.length > MAX_TRAIL) trail.shift()
}

export const recentErrors = () => [...errors]
export const recentPages = () => [...trail]

let installed = false
export function installBugLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', ev => noteError(ev.error ?? ev.message, 'crash'))
  window.addEventListener('unhandledrejection', ev => noteError(ev.reason, 'failed'))
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try { noteError(args.map(a => a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 380), 'console') } catch { /* never break logging */ }
    orig(...args)
  }
}
