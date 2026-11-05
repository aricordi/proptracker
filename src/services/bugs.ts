// "Report a problem" (owner, Nov 5). Reports are written by the server; only the owner reads them (/bugs).
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'

export type BugKind = 'broken' | 'wrong' | 'missing'
export type BugStatus = 'open' | 'fixed' | 'wontfix'
export const BUG_KIND_LABEL: Record<BugKind, string> = { broken: 'Something broke', wrong: 'Looks wrong', missing: 'Something missing' }

export interface BugReport {
  id: string; kind: BugKind; what: string; expected: string; screenshots: string[]
  page: string; trail: string[]; errors: string[]
  device: { agent: string; width: number | null; height: number | null; dpr: number | null; standalone: boolean; online: boolean; lang: string; tz: string }
  app: { build: string; role: string; viewAs: string; desk: boolean; practice: boolean }
  email: string; name: string; role: string; status: BugStatus; note?: string; at: string; decidedAt?: string
}

export function subscribeBugReports(cb: (list: BugReport[]) => void) {
  return onSnapshot(query(collection(db, 'bug_reports'), orderBy('at', 'desc'), limit(200)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as BugReport))), () => cb([]))
}

export const reportBug = httpsCallable<{ kind: BugKind; what: string; expected: string; screenshots: string[]; context: Record<string, unknown> }, { id: string }>(functions, 'reportBug')
export const updateBugReport = httpsCallable<{ id: string; status: BugStatus; note?: string }, { ok: boolean }>(functions, 'updateBugReport')

/** A short phone description from the browser's long one ("iPhone · Safari · Home Screen app"). */
export function phoneLabel(d: BugReport['device'] | undefined): string {
  const a = d?.agent ?? ''
  const os = /iPhone/.test(a) ? 'iPhone' : /iPad/.test(a) ? 'iPad' : /Android/.test(a) ? 'Android' : /Mac OS X/.test(a) ? 'Mac' : /Windows/.test(a) ? 'Windows' : 'Other'
  const ver = a.match(/OS (\d+)[_.](\d+)/)
  const browser = /CriOS|Chrome/.test(a) ? 'Chrome' : /FxiOS|Firefox/.test(a) ? 'Firefox' : /Safari/.test(a) ? 'Safari' : 'Browser'
  return [`${os}${ver && (os === 'iPhone' || os === 'iPad') ? ` ${ver[1]}.${ver[2]}` : ''}`, browser, d?.standalone ? 'Home Screen app' : 'in the browser',
    d?.width ? `${d.width}×${d.height}` : ''].filter(Boolean).join(' · ')
}
