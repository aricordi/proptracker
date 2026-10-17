import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '../firebase'

// Email sending settings (owner only). The password is NOT here: it lives in
// Google Secret Manager as SMTP_PASSWORD.
export interface EmailSettings {
  enabled: boolean
  host: string
  port: number
  user: string
  fromName: string
  fromAddress: string
  appUrl: string
}

export interface OutboxEmail {
  id: string
  to: string
  subject: string
  createdAt: string
  status?: 'sent' | 'skipped' | 'failed'
  note?: string
  error?: string
  sentTo?: string[]
}

export const EMPTY_EMAIL_SETTINGS: EmailSettings = {
  enabled: false, host: 'smtp.gmail.com', port: 465, user: '', fromName: 'Prime Capitol', fromAddress: '', appUrl: '',
}

export function subscribeToEmailSettings(cb: (s: EmailSettings) => void) {
  return onSnapshot(doc(db, 'app_settings', 'email'),
    snap => cb({ ...EMPTY_EMAIL_SETTINGS, ...(snap.data() ?? {}) } as EmailSettings),
    () => cb(EMPTY_EMAIL_SETTINGS))
}

export function saveEmailSettings(s: EmailSettings) {
  return setDoc(doc(db, 'app_settings', 'email'), {
    ...s, updatedAt: new Date().toISOString(), updatedBy: auth.currentUser?.email ?? 'unknown',
  })
}

export function subscribeToOutbox(cb: (list: OutboxEmail[]) => void) {
  return onSnapshot(query(collection(db, 'outbox'), orderBy('createdAt', 'desc'), limit(25)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as OutboxEmail))),
    () => cb([]))
}

export const sendTestEmail = httpsCallable<void, { id: string }>(functions, 'sendTestEmail')
