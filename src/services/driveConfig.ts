import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

export interface DriveConfig {
  pipelineFolderId: string
  pipelineFolderName: string
}

const CONFIG_REF = doc(db, 'app_settings', 'drive')

export async function loadDriveConfig(): Promise<DriveConfig | null> {
  const snap = await getDoc(CONFIG_REF)
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data.pipelineFolderId) return null
  return { pipelineFolderId: data.pipelineFolderId, pipelineFolderName: data.pipelineFolderName ?? '' }
}

export async function saveDriveConfig(config: DriveConfig): Promise<void> {
  await setDoc(CONFIG_REF, config, { merge: true })
}
