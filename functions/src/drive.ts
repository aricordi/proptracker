// Reading photos from Google Drive for the batch import.
// The server signs in to Drive as the app's own Google account (its "service
// account"); the owner shares the photo folders with that account's email.
import { GoogleAuth } from 'google-auth-library'
import sharp from 'sharp'
import { LIST_TYPES, isListType, WORD_TYPES } from './importList.js'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] })

export interface DriveImage { id: string; name: string; folder: string; mimeType: string; thumbnailLink?: string; resourceKey?: string }

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'

// Older "anyone with the link" files carry a security code ("resource key") in
// their link that must be sent with every request for them.
export function resourceKeyFrom(link: string): string | undefined {
  return link.match(/[?&]resourcekey=([A-Za-z0-9_-]+)/i)?.[1]
}

// Accepts a folder link ("https://drive.google.com/drive/folders/<id>?usp=…") or a bare ID.
// In the emulator, "test:12" stands for a pretend folder with 12 photos.
export function folderIdFrom(link: string): string | null {
  const s = link.trim()
  if (isEmulator() && /^test:\d{1,4}$/.test(s)) return s
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? s.match(/^([A-Za-z0-9_-]{20,})$/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  return m ? m[1] : null
}

// The email to share the Drive folders with.
export async function serviceAccountEmail(): Promise<string> {
  if (isEmulator()) return 'test-importer@example.iam.gserviceaccount.com'
  const creds = await auth.getCredentials()
  return creds.client_email ?? 'unknown'
}

async function token(): Promise<string> {
  const t = await (await auth.getClient()).getAccessToken()
  if (!t.token) throw new Error('Could not sign in to Google Drive')
  return t.token
}

async function driveGet(url: string, tok: string, keys: Record<string, string | undefined> = {}): Promise<Response> {
  const pairs = Object.entries(keys).filter(([, k]) => k).map(([id, k]) => `${id}/${k}`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, ...(pairs.length ? { 'X-Goog-Drive-Resource-Keys': pairs.join(',') } : {}) } })
  if (res.status === 403 && (await res.clone().text()).includes('accessNotConfigured')) {
    throw new Error('The Google Drive API is not turned on for this project yet.')
  }
  if (res.status === 404) throw new Error("Can't see that folder. Share it with the app's address shown on this screen (or make sure the link is right).")
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

// Every image in the folder and its subfolders (up to `max`), sorted by folder then name.
export async function listImages(folderId: string, max = 5000, resourceKey?: string): Promise<{ folderName: string; images: DriveImage[] }> {
  if (folderId.startsWith('test:')) {
    const n = Math.min(Number(folderId.slice(5)), max)
    return { folderName: 'Test folder', images: Array.from({ length: n }, (_, i) => ({
      id: `test${String(i + 1).padStart(4, '0')}x${n}`, name: `IMG_${String(i + 1).padStart(4, '0')}.jpg`, folder: 'Test folder', mimeType: 'image/jpeg',
    })) }
  }
  const tok = await token()
  const meta = await (await driveGet(`${DRIVE}/files/${folderId}?fields=name,mimeType&supportsAllDrives=true`, tok, { [folderId]: resourceKey })).json() as { name: string; mimeType: string }
  if (meta.mimeType !== FOLDER) throw new Error(`"${meta.name}" is a file, not a folder.`)

  const images: DriveImage[] = []
  const queue: { id: string; path: string; key?: string }[] = [{ id: folderId, path: meta.name, key: resourceKey }]
  while (queue.length && images.length < max) {
    const { id, path, key } = queue.shift()!
    let pageToken = ''
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
      const url = `${DRIVE}/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`
        + `&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,resourceKey)${pageToken ? `&pageToken=${pageToken}` : ''}`
      const page = await (await driveGet(url, tok, { [id]: key })).json() as { nextPageToken?: string; files: { id: string; name: string; mimeType: string; thumbnailLink?: string; resourceKey?: string }[] }
      for (const f of page.files) {
        if (f.mimeType === FOLDER) queue.push({ id: f.id, path: `${path} / ${f.name}`, key: f.resourceKey })
        else if (f.mimeType.startsWith('image/')) images.push({ id: f.id, name: f.name, folder: path, mimeType: f.mimeType, thumbnailLink: f.thumbnailLink, resourceKey: f.resourceKey })
      }
      pageToken = page.nextPageToken ?? ''
    } while (pageToken && images.length < max)
  }
  images.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { folderName: meta.name, images: images.slice(0, max) }
}

// The photo, shrunk to a phone-friendly JPEG (longest side 1600px). Formats the
// server can't read (e.g. some iPhone HEIC photos) use Drive's own preview instead.
export async function fetchPhoto(img: DriveImage): Promise<Buffer> {
  let original: Buffer
  if (img.id.startsWith('test')) {
    // A plain coloured square, different for each pretend photo.
    const n = Number(img.id.slice(4, 8))
    original = await sharp({ create: { width: 64 + n, height: 64, channels: 3, background: { r: (n * 40) % 255, g: 120, b: 200 } } }).png().toBuffer()
  } else {
    const tok = await token()
    original = Buffer.from(await (await driveGet(`${DRIVE}/files/${img.id}?alt=media&supportsAllDrives=true`, tok, { [img.id]: img.resourceKey })).arrayBuffer())
    try {
      return await shrink(original)
    } catch {
      if (!img.thumbnailLink) throw new Error('This photo format could not be read.')
      original = Buffer.from(await (await driveGet(img.thumbnailLink.replace(/=s\d+$/, '=s1600'), tok, { [img.id]: img.resourceKey })).arrayBuffer())
    }
  }
  return shrink(original)
}

function shrink(buf: Buffer): Promise<Buffer> {
  return sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
}

// ─── Inventory lists (owner, Nov 5: "WR List" next to the wardrobe photos) ────
export interface DriveList { id: string; name: string; mimeType: string; resourceKey?: string }

const TEST_LIST = `8 gas masks\n1 priest robe\n1 black peacoat (xl)\n3 white lab coat (OS)\n1 yellow raincoat (M)`

/** Documents that look like inventory lists in the folder and its subfolders (Docs, Sheets, text). Word files are listed
 *  separately so the screen can say "open it as a Google Doc first". */
export async function listListFiles(folderId: string, resourceKey?: string): Promise<{ lists: DriveList[]; word: string[] }> {
  if (folderId.startsWith('test:')) return { lists: [{ id: 'test-list', name: 'Test inventory list', mimeType: 'text/plain' }], word: [] }
  const tok = await token()
  const lists: DriveList[] = [], word: string[] = []
  const queue: { id: string; key?: string }[] = [{ id: folderId, key: resourceKey }]
  let folders = 0
  while (queue.length && folders++ < 50) {
    const { id, key } = queue.shift()!
    const q = encodeURIComponent(`'${id}' in parents and trashed = false and not mimeType contains 'image/'`)
    const url = `${DRIVE}/files?q=${q}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,resourceKey)`
    const page = await (await driveGet(url, tok, { [id]: key })).json() as { files: DriveList[] }
    for (const f of page.files) {
      if (f.mimeType === FOLDER) queue.push({ id: f.id, key: f.resourceKey })
      else if (isListType(f.mimeType)) lists.push(f)
      else if (WORD_TYPES.includes(f.mimeType) || /\.docx?$/i.test(f.name)) word.push(f.name)
    }
  }
  return { lists: lists.slice(0, 3), word }
}

/** One list file by id (from a pasted link). */
export async function listFileById(id: string): Promise<DriveList> {
  if (id === 'test-list') return { id, name: 'Test inventory list', mimeType: 'text/plain' }
  const tok = await token()
  const f = await (await driveGet(`${DRIVE}/files/${id}?fields=id,name,mimeType,resourceKey&supportsAllDrives=true`, tok)).json() as DriveList
  if (WORD_TYPES.includes(f.mimeType)) throw new Error(`"${f.name}" is a Word file. Open it in Google Drive and choose File → Save as Google Docs, then paste that link.`)
  if (!isListType(f.mimeType)) throw new Error(`"${f.name}" isn't a document the import can read. Use a Google Doc, a Google Sheet or a text file.`)
  return f
}

/** The list's words: Google Docs as plain text, Sheets as CSV, text files as they are. */
export async function readListText(f: DriveList): Promise<string> {
  if (f.id === 'test-list') return TEST_LIST
  const tok = await token()
  const as = LIST_TYPES[f.mimeType]
  const url = as ? `${DRIVE}/files/${f.id}/export?mimeType=${encodeURIComponent(as)}` : `${DRIVE}/files/${f.id}?alt=media&supportsAllDrives=true`
  return (await driveGet(url, tok, { [f.id]: f.resourceKey })).text()
}

// ─── Admin task helpers (owner, Nov 8: Claude runs imports + checks from GitHub) ─────
/** Direct subfolders of a folder (id + name). */
export async function listSubfolders(folderId: string): Promise<{ id: string; name: string }[]> {
  const tok = await token()
  const out: { id: string; name: string }[] = []
  let pageToken = ''
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and mimeType = '${FOLDER}'`)
    const page = await (await driveGet(`${DRIVE}/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name)${pageToken ? `&pageToken=${pageToken}` : ''}`, tok)).json() as { nextPageToken?: string; files: { id: string; name: string }[] }
    out.push(...page.files)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return out
}

/** Shortcuts directly in a folder: shortcut name + the file it points at. */
export async function listShortcuts(folderId: string): Promise<{ name: string; targetId: string }[]> {
  const tok = await token()
  const out: { name: string; targetId: string }[] = []
  let pageToken = ''
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.shortcut'`)
    const page = await (await driveGet(`${DRIVE}/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(name,shortcutDetails(targetId))${pageToken ? `&pageToken=${pageToken}` : ''}`, tok)).json() as { nextPageToken?: string; files: { name: string; shortcutDetails?: { targetId?: string } }[] }
    for (const f of page.files) if (f.shortcutDetails?.targetId) out.push({ name: f.name, targetId: f.shortcutDetails.targetId })
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return out
}
