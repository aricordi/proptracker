// Small photos for lists (owner report Oct 13: "pictures are loading too slow").
// Lists showed the full photo (up to several MB straight from a phone) in a tile
// the size of a stamp. Each prop photo now gets a ~480px JPEG (~30 KB) saved in
// Storage under thumbs/, and the prop records { photoUrl: thumbUrl } in `thumbs`.
// The app shows the thumbnail in lists and the full photo on the prop page.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { getStorage } from 'firebase-admin/storage'
import type { DocumentData } from 'firebase-admin/firestore'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { db, requireRole, CALLABLE } from './auth.js'

const THUMB_PX = 480
const PER_CALL = 25   // props per "Speed up photos" call; the screen keeps calling

function storageUrl(path: string, token: string, bucket: string) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const base = host ? `http://${host}` : 'https://firebasestorage.googleapis.com'
  return `${base}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

export function photosOf(item: DocumentData): string[] {
  const photos = Array.isArray(item.photos) ? item.photos.filter((u: unknown) => typeof u === 'string' && u) as string[] : []
  return photos.length ? photos : (typeof item.photoUrl === 'string' && item.photoUrl ? [item.photoUrl] : [])
}

// Photos of this prop that don't have a thumbnail yet.
export function missingThumbs(item: DocumentData): string[] {
  const have = (item.thumbs ?? {}) as Record<string, string>
  return photosOf(item).filter(u => !have[u])
}

async function makeThumb(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`photo download failed (${res.status})`)
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate()
    .resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true }).toBuffer()
  const bucket = getStorage().bucket()
  const token = randomUUID()
  // Unique name per run, so two runs for the same photo can't break each other's link.
  const path = `thumbs/${createHash('sha1').update(url).digest('hex').slice(0, 16)}-${token.slice(0, 8)}.jpg`
  await bucket.file(path).save(jpeg, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  })
  return storageUrl(path, token, bucket.name)
}

// Makes the missing thumbnails and saves them on the prop (only for its current photos).
// Returns how many were made. A photo that fails is skipped; the full photo still shows.
export async function addThumbs(id: string, item: DocumentData): Promise<number> {
  const missing = missingThumbs(item)
  if (!missing.length) return 0
  const made: Record<string, string> = {}
  for (const url of missing) {
    try { made[url] = await makeThumb(url) } catch (err) { console.warn(`Thumbnail for ${id} failed`, String(err)) }
  }
  if (!Object.keys(made).length) return 0
  await db.runTransaction(async tx => {
    const ref = db.doc(`items/${id}`)
    const now = (await tx.get(ref)).data()
    if (!now) return
    const current = new Set(photosOf(now))
    const all = { ...(now.thumbs ?? {}), ...made } as Record<string, string>
    tx.update(ref, { thumbs: Object.fromEntries(Object.entries(all).filter(([u]) => current.has(u))) })
  })
  return Object.keys(made).length
}

// New or changed photos get a thumbnail automatically. Writing `thumbs` triggers this
// again, but then nothing is missing, so it stops.
export const makeItemThumbs = onDocumentWritten({ document: 'items/{id}', memory: '512MiB' }, async event => {
  const item = event.data?.after.data()
  if (!item) return
  await addThumbs(event.params.id, item)
})

// Owner button (Health → Speed up photos): thumbnails for props added before this existed.
export const makeMissingThumbs = onCall({ ...CALLABLE, timeoutSeconds: 300, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner'])
  const items = await db.collection('items').get()
  const todo = items.docs.filter(d => missingThumbs(d.data()).length > 0)
  if (req.data?.countOnly === true) return { total: items.size, remaining: todo.length, processed: 0 }
  const queue = todo.slice(0, PER_CALL)
  let processed = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      await addThumbs(d.id, d.data()).catch(err => console.warn(`Thumbnails for ${d.id} failed`, String(err)))
      processed++
    }
  }))
  // Props whose photos can't be loaded at all stay "remaining"; the screen stops when nothing moves.
  const remaining = (await db.collection('items').get()).docs.filter(d => missingThumbs(d.data()).length > 0).length
  return { total: items.size, remaining, processed }
})
