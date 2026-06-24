import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '../firebase'
import type { DriveFolderMeta } from '../types'
import { VIDEO_PIPELINE_FOLDER_NAME } from '../config'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_API   = 'https://www.googleapis.com/drive/v3'

// Module-level token store — persists for the lifetime of the page session.
// Token expires in ~1 hour; the UI shows a "Reconnect Drive" button on 401.
let _accessToken: string | null = null

export function getDriveToken(): string | null {
  return _accessToken
}

export function clearDriveToken() {
  _accessToken = null
}

// Triggers a Google popup to request Drive read-only access.
// Returns the access token on success, throws on cancellation or error.
export async function requestDriveAccess(): Promise<string> {
  const provider = new GoogleAuthProvider()
  provider.addScope(DRIVE_SCOPE)
  // Force the consent screen so the user explicitly approves Drive access.
  // On subsequent calls this is a fast popup that closes itself if already granted.
  provider.setCustomParameters({ prompt: 'consent' })
  const result   = await signInWithPopup(auth, provider)
  const cred     = GoogleAuthProvider.credentialFromResult(result)
  const token    = cred?.accessToken
  if (!token) throw new Error('No access token returned from Google')
  _accessToken = token
  return token
}

// ─── Drive REST helpers ──────────────────────────────────────────────────────

async function driveGet(path: string, token: string): Promise<Response> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    _accessToken = null   // token expired — let UI show reconnect
    throw new DriveAuthError('Drive token expired')
  }
  return res
}

export class DriveAuthError extends Error {}

// Find the "video pipeline" top-level folder in the owner's Drive.
// Returns its Drive folder ID, or null if not found.
async function findVideoPipelineFolder(token: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${VIDEO_PIPELINE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res  = await driveGet(`/files?q=${q}&fields=files(id,name)&pageSize=5`, token)
  if (!res.ok) return null
  const json = await res.json() as { files?: { id: string; name: string }[] }
  return json.files?.[0]?.id ?? null
}

// List immediate subfolders of the video pipeline folder.
// These represent individual video projects.
export async function listVideoFolders(token: string): Promise<DriveFolderMeta[]> {
  const pipelineId = await findVideoPipelineFolder(token)
  if (!pipelineId) throw new Error(`Folder "${VIDEO_PIPELINE_FOLDER_NAME}" not found in your Drive`)

  const q = encodeURIComponent(
    `'${pipelineId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const res  = await driveGet(
    `/files?q=${q}&orderBy=name desc&fields=files(id,name,modifiedTime)&pageSize=100`,
    token,
  )
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`)
  const json = await res.json() as { files?: DriveFolderMeta[] }
  return json.files ?? []
}

// Read the content of prop-manifest.txt inside a video folder.
// Returns null if the file doesn't exist (caller should show friendly message).
// Throws DriveAuthError if token expired.
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
