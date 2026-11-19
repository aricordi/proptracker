// Links people send for photos and guideline PDFs must be download links of the app's own file storage (or the
// emulator's), never an outside site: staff open them, and the photo-date stamp only works on our own files (audit, Nov 7).
// Security check (Nov 19): the link must point at OUR bucket, not just any Firebase project's storage, and a folder must
// sit right after "/o/" (a free Firebase project could otherwise host a fake page at a look-alike path).
// Pure (no Firebase imports) so tests can use it directly.

const LIVE = 'https://firebasestorage.googleapis.com/v0/b/'
const EMULATOR = 'http://127.0.0.1:9199/v0/b/'

function projectBuckets(): string[] {
  const names = new Set(['proptracker-9732e.appspot.com', 'proptracker-9732e.firebasestorage.app'])
  try {
    const cfg = JSON.parse(process.env.FIREBASE_CONFIG || '{}') as { storageBucket?: string; projectId?: string }
    if (cfg.storageBucket) names.add(cfg.storageBucket)
    const pid = cfg.projectId || process.env.GCLOUD_PROJECT
    if (pid) { names.add(`${pid}.appspot.com`); names.add(`${pid}.firebasestorage.app`) }
  } catch { /* no config: the live names above still apply */ }
  return [...names]
}
const BUCKETS = projectBuckets()

// The object path ("folder/file") of one of our download links, or null for anything else.
function objectOf(u: string): string | null {
  let rest: string
  if (u.startsWith(LIVE)) {
    rest = u.slice(LIVE.length)
    const bucket = BUCKETS.find(b => rest.startsWith(`${b}/o/`))
    if (!bucket) return null
    rest = rest.slice(bucket.length + 3)
  } else if (u.startsWith(EMULATOR)) {
    rest = u.slice(EMULATOR.length)   // the emulator only runs on this machine; any test bucket is fine
    const i = rest.indexOf('/o/')
    if (i < 0) return null
    rest = rest.slice(i + 3)
  } else return null
  return rest
}

// `folder` (optional) = the file must sit in that folder, e.g. `guidelines/ana@example.com/`.
export function isStorageLink(u: unknown, folder?: string): u is string {
  if (typeof u !== 'string' || u.length >= 2000 || /\s/.test(u)) return false
  const obj = objectOf(u)
  if (obj === null || obj.length === 0) return false
  if (!folder) return true
  return obj.startsWith(encodeURIComponent(folder))
}

// Keeps only our own storage links, at most `max`.
export const storageLinks = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter(u => isStorageLink(u)).slice(0, max) : []
