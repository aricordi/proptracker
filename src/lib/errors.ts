// One place that turns any error into words a person can act on (owner, Oct 27: "easy for anyone"). Our server
// functions already write friendly messages; this keeps those, and replaces the technical ones (no signal, server
// asleep, "internal", "Missing or insufficient permissions") with plain language.
const NO_SIGNAL = "Couldn't reach Prime Capitol. Check your signal and try again."

export function friendlyError(e: unknown, fallback = "That didn't work. Try again."): string {
  const err = e as { code?: string; message?: string } | null
  const code = String(err?.code ?? '').replace(/^(functions|firestore|storage|auth)\//, '')
  const raw = String(err?.message ?? (typeof e === 'string' ? e : ''))
  // Strip "FirebaseError: " / "Firebase: " prefixes and "(functions/xyz)." suffixes.
  const msg = raw.replace(/^(Firebase(Error)?:\s*)+/i, '').replace(/\s*\((functions|firestore|storage|auth)\/[a-z-]+\)\.?$/i, '').trim()

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return NO_SIGNAL
  if (['unavailable', 'deadline-exceeded', 'network-request-failed', 'retry-limit-exceeded'].includes(code)) return NO_SIGNAL
  if (/failed to fetch|network ?error|load failed|timed? ?out/i.test(msg)) return NO_SIGNAL
  if (code === 'internal' && (!msg || /^internal$/i.test(msg))) return 'Something went wrong on our side. Try again in a minute.'
  if (code === 'unauthenticated' && (!msg || /^unauthenticated$/i.test(msg))) return 'You were signed out. Sign in again and retry.'
  if (/missing or insufficient permissions/i.test(msg) || code === 'unauthorized' || (code === 'permission-denied' && !msg))
    return "You're not allowed to do that. If you think you should be, ask the team."
  if (code === 'quota-exceeded') return 'Too many people at once. Try again in a minute.'
  if (code === 'canceled' || code === 'cancelled') return 'Stopped.'
  return msg || fallback
}
