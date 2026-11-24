// A reference picture for a custom prop (owner, Nov 24: "they can use ChatGPT to generate an image of what they want… sent to
// the arts department"). ChatGPT hands the picture over as a file link; we fetch it, check it's really an image, shrink it and save
// it in the creator's own request-photos folder, so the arts department sees it on the request like a photo taken in the app.
// Safety: only ChatGPT's own file servers (or our own storage) are fetched (never an arbitrary web address), https only, ≤ 12 MB,
// must decode as an image. Anything else: the person attaches the picture in the app instead (app_link).
import { randomUUID } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { isStorageLink } from '../storageLinks.js'
import { loadSharp, storageUrl } from '../thumbs.js'
import { exifDate } from '../photoDate.js'

const MAX_BYTES = 12 * 1024 * 1024
/** Where a picture may come from (pure, unit-tested). */
export function refImageHostOk(u: unknown): boolean {
  if (typeof u !== 'string' || u.length > 3000) return false
  let url: URL
  try { url = new URL(u) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const h = url.hostname.toLowerCase()
  return h === 'oaiusercontent.com' || h.endsWith('.oaiusercontent.com') || h === 'files.openai.com' || h.endsWith('.openai.com') || h === 'chatgpt.com' || h.endsWith('.chatgpt.com')
}
/** The link out of what the assistant sent: a plain link, or ChatGPT's file object {download_url, file_id}. */
export function refImageLink(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; return String(o.download_url ?? o.url ?? '').trim() }
  return ''
}

/** Camera time (written as Toronto wall-clock, read here as UTC because the server runs in UTC) → the real moment. */
export function studioWallToIso(utcReading: string): string {
  const d = new Date(utcReading)
  if (isNaN(d.getTime())) return utcReading
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
  const g = (k: string) => Number(parts.find(x => x.type === k)?.value)
  const asToronto = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return new Date(d.getTime() + (d.getTime() - asToronto)).toISOString()
}

/** Fetch a picture ChatGPT handed over and save it at folder/ai-<id>.jpg in our storage. keepDate: read the camera's
 *  taken-date first (shrinking drops it) and store it like the app does, so the photo-date stamp works on proof photos. */
export async function savePhoto(v: unknown, folder: string, opts: { allowOwn?: string; keepDate?: boolean } = {}): Promise<{ url: string; takenAt?: string | null } | { problem: string }> {
  const link = refImageLink(v)
  if (!link) return { problem: 'no picture link' }
  if (opts.allowOwn && isStorageLink(link, opts.allowOwn)) return { url: link }   // already one of theirs
  if (!refImageHostOk(link)) return { problem: 'the picture has to come from ChatGPT itself (or be attached in the app)' }
  try {
    const res = await fetch(link, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (!res.ok || !refImageHostOk(res.url || link)) return { problem: 'the picture link has expired or moved' }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return { problem: 'the picture is too big' }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES || buf.length < 100) return { problem: 'the picture is too big or empty' }
    let takenAt: string | null = null
    if (opts.keepDate) {
      try { const raw = exifDate(new DataView(buf.buffer, buf.byteOffset, Math.min(buf.length, 256 * 1024))); takenAt = raw ? studioWallToIso(raw) : null } catch { takenAt = null }
    }
    const sharp = await loadSharp()
    const jpeg = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    const bucket = getStorage().bucket()
    const token = randomUUID()
    const path = `${folder.replace(/\/+$/, '')}/ai-${token.slice(0, 12)}.jpg`
    const meta: Record<string, string> = { firebaseStorageDownloadTokens: token, source: opts.keepDate ? 'chatgpt' : 'ai-assistant' }
    if (takenAt) meta.takenAt = takenAt
    await bucket.file(path).save(jpeg, { contentType: 'image/jpeg', metadata: { metadata: meta } })
    return { url: storageUrl(path, token, bucket.name), ...(opts.keepDate ? { takenAt } : {}) }
  } catch {
    return { problem: 'the picture could not be read' }
  }
}

/** Reference picture for a custom prop, saved in the creator's own request-photos folder. */
export async function saveRefImage(v: unknown, email: string): Promise<{ url: string } | { problem: string }> {
  return savePhoto(v, `request-photos/${email}`, { allowOwn: `request-photos/${email}/` })
}
