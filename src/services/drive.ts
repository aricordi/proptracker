import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '../firebase'
import type { DriveFolderMeta } from '../types'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_API   = 'https://www.googleapis.com/drive/v3'

// Module-level token — persists for the page session (~1 hour before expiry).
// UI shows a "Reconnect Drive" button when this is null or a 401 is returned.
let _accessToken: string | null = null

export function getDriveToken(): string | null { return _accessToken }
export function clearDriveToken() { _accessToken = null }

export async function requestDriveAccess(): Promise<string> {
  const provider = new GoogleAuthProvider()
  provider.addScope(DRIVE_SCOPE)
  provider.setCustomParameters({ prompt: 'consent' })
  const result = await signInWithPopup(auth, provider)
  const cred   = GoogleAuthProvider.credentialFromResult(result)
  const token  = cred?.accessToken
  if (!token) throw new Error('No access token returned from Google')
  _accessToken = token
  return token
}

export class DriveAuthError extends Error {}

async function driveGet(path: string, token: string): Promise<Response> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    _accessToken = null
    throw new DriveAuthError('Drive token expired')
  }
  return res
}

// List immediate subfolders of any Drive folder by ID.
// Pass 'root' for My Drive top-level folders.
// Used for both the pipeline folder picker and listing video project folders.
export async function listFoldersIn(token: string, parentId: string): Promise<DriveFolderMeta[]> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res = await driveGet(
    `/files?q=${q}&orderBy=name&fields=files(id,name,modifiedTime)&pageSize=200`,
    token,
  )
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`)
  const json = await res.json() as { files?: DriveFolderMeta[] }
  return json.files ?? []
}

// Read the content of prop-manifest.txt inside a video folder.
// Returns null if the file doesn't exist (caller shows a friendly message).
// Throws DriveAuthError if the token has expired.
export async function readPropManifest(token: string, videoFolderId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `'${videoFolderId}' in parents and name='prop-manifest.txt' and trashed=false`
  )
  const listRes  = await driveGet(`/files?q=${q}&fields=files(id)&pageSize=1`, token)
  if (!listRes.ok) throw new Error(`Drive API error: ${listRes.status}`)
  const listJson = await listRes.json() as { files?: { id: string }[] }
  const fileId   = listJson.files?.[0]?.id
  if (!fileId) return null

  const contentRes = await driveGet(`/files/${fileId}?alt=media`, token)
  if (!contentRes.ok) throw new Error(`Could not read manifest: ${contentRes.status}`)
  return contentRes.text()
}
