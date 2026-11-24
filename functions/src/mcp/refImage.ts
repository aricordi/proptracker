// A reference picture for a custom prop (owner, Nov 24: "they can use ChatGPT to generate an image of what they want… sent to
// the arts department"). ChatGPT hands the picture over as a file link; we fetch it, check it's really an image, shrink it and save
// it in the creator's own request-photos folder, so the arts department sees it on the request like a photo taken in the app.
// Safety: only ChatGPT's own file servers (or our own storage) are fetched (never an arbitrary web address), https only, ≤ 12 MB,
// must decode as an image. Anything else: the person attaches the picture in the app instead (app_link).
import { randomUUID } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { isStorageLink } from '../storageLinks.js'
import { loadSharp, storageUrl } from '../thumbs.js'

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

/** Fetch + save. Returns our own storage link, or a plain reason it couldn't be used. */
export async function saveRefImage(v: unknown, email: string): Promise<{ url: string } | { problem: string }> {
  const link = refImageLink(v)
  if (!link) return { problem: 'no picture link' }
  if (isStorageLink(link, `request-photos/${email}/`)) return { url: link }   // already one of theirs
  if (!refImageHostOk(link)) return { problem: 'the picture has to come from ChatGPT itself (or be attached in the app)' }
  try {
    const res = await fetch(link, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (!res.ok || !refImageHostOk(res.url || link)) return { problem: 'the picture link has expired or moved' }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return { problem: 'the picture is too big' }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES || buf.length < 100) return { problem: 'the picture is too big or empty' }
    const sharp = await loadSharp()
    const jpeg = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    const bucket = getStorage().bucket()
    const token = randomUUID()
    const path = `request-photos/${email}/ai-${token.slice(0, 12)}.jpg`
    await bucket.file(path).save(jpeg, { contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: token, source: 'ai-assistant' } } })
    return { url: storageUrl(path, token, bucket.name) }
  } catch {
    return { problem: 'the picture could not be read' }
  }
}
