// The app's version number (owner, Nov 23: "make sure everybody's on the latest version, and that the manual aligns with
// the version they're on"). It comes from package.json at build time; /version.json on the server says what's live now.
// MAJOR.MINOR.PATCH: patch = fixes and wording, minor = new or changed features, major = a big redesign. Raised on every
// live website deploy (CHANGELOG.md says what changed in each, in plain words).
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** -1 when a is older than b, 0 when the same, 1 when newer. Anything that isn't a version counts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v : '0.0.0').split('.').map(Number)
  const x = parts(a), y = parts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** True when the version someone is on is older than the live one (for the team's People list). */
export const isBehind = (theirs: string | undefined, live: string) => !!theirs && compareVersions(theirs, live) < 0

/** The version on the server right now, or null (no signal, local dev without a build). */
export async function liveVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json() as { version?: unknown }
    return typeof j.version === 'string' && /^\d+\.\d+\.\d+$/.test(j.version) ? j.version : null
  } catch { return null }
}
