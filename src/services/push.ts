// Phone notifications on this device: can it get them, turning them on/off, and a test.
// iPhone only allows them in the app added to the Home Screen (iOS 16.4+). In the emulator no real push
// service exists, so a stand-in token is used (the server logs messages instead of sending them).
import { httpsCallable } from 'firebase/functions'
import { app, functions, USING_EMULATORS } from '../firebase'

const registerPush = httpsCallable<{ token: string; platform: string }, { ok: boolean }>(functions, 'registerPush')
const unregisterPush = httpsCallable<{ token: string }, { ok: boolean }>(functions, 'unregisterPush')
export const testPush = httpsCallable<void, { sent: number }>(functions, 'testPush')

const KEY = 'pc-push-token'
const store = {
  get: () => { try { return localStorage.getItem(KEY) } catch { return null } },
  set: (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY) } catch { /* private mode */ } },
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const platform = () => `${isIOS() ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop'}${isInstalled() ? '-app' : ''}`

// 'needs-install' = iPhone in Safari (add to Home Screen first); 'unsupported' = this browser can't.
export type PushState = 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked'
export function pushState(): PushState {
  const hasApi = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  if (!hasApi) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'granted' && store.get()) return 'on'
  return 'off'
}

async function getDeviceToken(): Promise<string> {
  if (USING_EMULATORS) return store.get() ?? `emulator-${crypto.randomUUID()}-test-device`
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
  if (!(await isSupported())) throw new Error('This browser can’t get notifications.')
  const reg = await navigator.serviceWorker.ready
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined
  return getToken(getMessaging(app), { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) })
}

// Must be called from a tap (phones only show the "Allow notifications?" question after one).
export async function turnOnPush(): Promise<PushState> {
  const answer = USING_EMULATORS ? 'granted' : await Notification.requestPermission()
  if (answer !== 'granted') return answer === 'denied' ? 'blocked' : 'off'
  const token = await getDeviceToken()
  await registerPush({ token, platform: platform() })
  store.set(token)
  return 'on'
}

export async function turnOffPush() {
  const token = store.get()
  store.set(null)
  if (!token) return
  await unregisterPush({ token }).catch(() => {})
  if (!USING_EMULATORS) {
    const { getMessaging, deleteToken } = await import('firebase/messaging')
    await deleteToken(getMessaging(app)).catch(() => {})
  }
}

// On each app start: keep this phone's token fresh (tokens can change); quietly does nothing if it's off.
export async function refreshPush() {
  try {
    if (pushState() !== 'on') return
    const token = await getDeviceToken()
    await registerPush({ token, platform: platform() })
    store.set(token)
  } catch { /* try again next time */ }
}
