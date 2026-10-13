// Reading photos from Google Drive for the batch import.
// The server signs in to Drive as the app's own Google account (its "service
// account"); the owner shares the photo folders with that account's email.
import { GoogleAuth } from 'google-auth-library'
import sharp from 'sharp'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] })

export interface DriveImage { id: string; name: string; folder: string; mimeType: string; thumbnailLink?: string }

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'

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

async function driveGet(url: string, tok: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
  if (res.status === 403 && (await res.clone().text()).includes('accessNotConfigured')) {
    throw new Error('The Google Drive API is not turned on for this project yet.')
  }
  if (res.status === 404) throw new Error("Can't see that folder. Is it shared with the app's email?")
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

// Every image in the folder and its subfolders (up to `max`), sorted by folder then name.
export async function listImages(folderId: string, max = 5000): Promise<{ folderName: string; images: DriveImage[] }> {
  if (folderId.startsWith('test:')) {
    const n = Math.min(Number(folderId.slice(5)), max)
    return { folderName: 'Test folder', images: Array.from({ length: n }, (_, i) => ({
      id: `test${String(i + 1).padStart(4, '0')}x${n}`, name: `IMG_${String(i + 1).padStart(4, '0')}.jpg`, folder: 'Test folder', mimeType: 'image/jpeg',
    })) }
  }
  const tok = await token()
  const meta = await (await driveGet(`${DRIVE}/files/${folderId}?fields=name,mimeType&supportsAllDrives=true`, tok)).json() as { name: string; mimeType: string }
  if (meta.mimeType !== FOLDER) throw new Error(`"${meta.name}" is a file, not a folder.`)

  const images: DriveImage[] = []
  const queue: { id: string; path: string }[] = [{ id: folderId, path: meta.name }]
  while (queue.length && images.length < max) {
    const { id, path } = queue.shift()!
    let pageToken = ''
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
      const url = `${DRIVE}/files?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`
        + `&fields=nextPageToken,files(id,name,mimeType,thumbnailLink)${pageToken ? `&pageToken=${pageToken}` : ''}`
      const page = await (await driveGet(url, tok)).json() as { nextPageToken?: string; files: { id: string; name: string; mimeType: string; thumbnailLink?: string }[] }
      for (const f of page.files) {
        if (f.mimeType === FOLDER) queue.push({ id: f.id, path: `${path} / ${f.name}` })
        else if (f.mimeType.startsWith('image/')) images.push({ id: f.id, name: f.name, folder: path, mimeType: f.mimeType, thumbnailLink: f.thumbnailLink })
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
    original = Buffer.from(await (await driveGet(`${DRIVE}/files/${img.id}?alt=media&supportsAllDrives=true`, tok)).arrayBuffer())
    try {
      return await shrink(original)
    } catch {
      if (!img.thumbnailLink) throw new Error('This photo format could not be read.')
      original = Buffer.from(await (await driveGet(img.thumbnailLink.replace(/=s\d+$/, '=s1600'), tok)).arrayBuffer())
    }
  }
  return shrink(original)
}

function shrink(buf: Buffer): Promise<Buffer> {
  return sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
}
