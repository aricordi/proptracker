// Profiles: a small photo + channel name per person (profiles/{email}), shown around the app.
import { createContext, useContext, useEffect, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'

export interface Profile { photoURL?: string; googlePhoto?: string; channel?: string; tourDoneAt?: string; birthday?: string; name?: string }
export type Profiles = Record<string, Profile>

// Everyone's profiles, live (a few dozen small docs). Empty until loaded or if not allowed.
export function useProfilesLive(enabled: boolean): Profiles {
  const [all, setAll] = useState<Profiles>({})
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(collection(db, 'profiles'), snap => setAll(Object.fromEntries(snap.docs.map(d => [d.id, d.data() as Profile]))), () => setAll({}))
  }, [enabled])
  return all
}
export const ProfilesContext = createContext<Profiles>({})
export const useProfiles = () => useContext(ProfilesContext)
export const photoOf = (p?: Profile) => p?.photoURL || p?.googlePhoto || ''

export async function saveProfile(email: string, patch: Profile) {
  await setDoc(doc(db, 'profiles', email), { ...patch, updatedAt: new Date().toISOString() }, { merge: true })
}

// Square-crop the middle of a photo and shrink it to 400px, then upload it as your profile photo.
export async function uploadProfilePhoto(email: string, file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
  URL.revokeObjectURL(url)
  const side = Math.min(img.naturalWidth, img.naturalHeight), out = 400
  const canvas = document.createElement('canvas')
  canvas.width = out; canvas.height = out
  canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error("That photo couldn't be read. Try another one.")
  const r = ref(storage, `avatars/${email}/${Date.now()}.jpg`)
  await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' })
  const photoURL = await getDownloadURL(r)
  await saveProfile(email, { photoURL })
  return photoURL
}
