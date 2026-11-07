// Links people send for photos and guideline PDFs must be download links of the app's own file storage (or the
// emulator's), never an outside site: staff open them, and the photo-date stamp only works on our own files (audit, Nov 7).
// Pure (no Firebase imports) so tests can use it directly.

const HOSTS = ['https://firebasestorage.googleapis.com/', 'http://127.0.0.1:9199/']

// `folder` (optional) = the file must sit in that folder, e.g. `guidelines/ana@example.com/`.
export function isStorageLink(u: unknown, folder?: string): u is string {
  if (typeof u !== 'string' || u.length >= 2000 || /\s/.test(u)) return false
  if (!HOSTS.some(h => u.startsWith(h))) return false
  if (!folder) return true
  return u.includes(`/o/${encodeURIComponent(folder)}`)
}

// Keeps only our own storage links, at most `max`.
export const storageLinks = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter(u => isStorageLink(u)).slice(0, max) : []
