// Photo/file uploads (Firebase Storage). Loaded only when something is uploaded or a photo's date is read, so the
// ~11 KB it costs isn't part of every app start (Nov 8: older phones / weak signal). Use: const st = await import(…).
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { app, USING_EMULATORS } from '../firebase'

export const storage = getStorage(app)
if (USING_EMULATORS) connectStorageEmulator(storage, '127.0.0.1', 9199)
export { ref, uploadBytes, uploadBytesResumable, uploadString, getDownloadURL, getMetadata } from 'firebase/storage'
