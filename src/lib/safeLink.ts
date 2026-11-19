// Only show links people sent (suggestion photos, guideline PDFs) when they point at the app's OWN photo storage
// (security check, Nov 19): a link typed straight into the database could otherwise send staff to a phishing page
// or run "javascript:" when tapped.
const BUCKET = String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '')
const OK = [
  ...(BUCKET ? [`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`] : []),
  'https://firebasestorage.googleapis.com/v0/b/proptracker-9732e.appspot.com/o/',
  'https://firebasestorage.googleapis.com/v0/b/proptracker-9732e.firebasestorage.app/o/',
  'http://127.0.0.1:9199/v0/b/',
]
export const isOwnFileLink = (u: unknown): u is string =>
  typeof u === 'string' && u.length < 2000 && !/\s/.test(u) && OK.some(p => u.startsWith(p))
