// "Report a problem" (owner, Nov 5: "a bug reporting feature that takes screenshots and data… when people encounter bugs,
// see something unexpected, or miss something they should see"). Anyone signed in (Props-only creators too) sends one:
// what happened + screenshots (uploaded by the app to bug-reports/<email>/) + what the app knew at that moment (page,
// last pages, phone, app version, recent errors). Stored in bug_reports/{id} (server-only writes; the owner reads),
// the owner gets a push, and "Read server logs" lists the open ones so Claude can read them.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, requireRole, CALLABLE, OWNER_EMAIL } from './auth.js'
import { getStorage } from 'firebase-admin/storage'
import { sendPush } from './push.js'

export const BUG_KINDS = ['broken', 'wrong', 'missing'] as const
export type BugKind = typeof BUG_KINDS[number]
export const BUG_KIND_LABEL: Record<BugKind, string> = { broken: 'Something broke', wrong: 'Something looks wrong', missing: 'Something is missing' }
export const BUG_STATUSES = ['open', 'fixed', 'wontfix'] as const
export const BUG_DAILY = 20

const str = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : ''

/** The report as the server keeps it: every field checked and capped. Pure, tested. */
export function cleanBugReport(d: Record<string, unknown> | undefined, email: string, bucketHost: string[]) {
  const x = d ?? {}
  const kind = (BUG_KINDS as readonly string[]).includes(String(x.kind)) ? x.kind as BugKind : 'broken'
  const what = str(x.what, 1500)
  if (what.length < 3) throw new Error('Say what happened in a few words.')
  // Only screenshots this person uploaded to their own folder in the app's storage.
  const folder = encodeURIComponent(`bug-reports/${email}/`)
  const shots = (Array.isArray(x.screenshots) ? x.screenshots : []).map(u => String(u ?? ''))
    .filter(u => bucketHost.some(h => u.startsWith(h)) && u.includes(folder)).slice(0, 4)
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map(s => str(s, max)).filter(Boolean).slice(-n)
  const ctx = (x.context ?? {}) as Record<string, unknown>
  const num = (v: unknown) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : null
  return {
    kind, what, expected: str(x.expected, 800), screenshots: shots,
    page: str(ctx.page, 300), trail: list(ctx.trail, 12, 200), errors: list(ctx.errors, 20, 400),
    device: {
      agent: str(ctx.agent, 300), width: num(ctx.width), height: num(ctx.height), dpr: num(ctx.dpr),
      standalone: ctx.standalone === true, online: ctx.online !== false, lang: str(ctx.lang, 20), tz: str(ctx.tz, 60),
    },
    app: { build: str(ctx.build, 60), role: str(ctx.role, 20), viewAs: str(ctx.viewAs, 20), desk: ctx.desk === true, practice: ctx.practice === true },
  }
}

// Download links of the app's own storage (the emulator's in tests).
const BUCKET_HOSTS = () => {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const base = host ? `http://${host}` : 'https://firebasestorage.googleapis.com'
  return [`${base}/v0/b/${getStorage().bucket().name}/o/`]
}

export const reportBug = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment', 'admin'], { demoOk: true })
  let clean
  try { clean = cleanBugReport(req.data, caller.email, BUCKET_HOSTS()) }
  catch (e) { throw new HttpsError('invalid-argument', (e as Error).message) }
  // A few a day per person is plenty; this stops a stuck button from flooding the inbox.
  const today = new Date().toISOString().slice(0, 10)
  const mine = await db.collection('bug_reports').where('email', '==', caller.email).where('day', '==', today).count().get()
  if (mine.data().count >= BUG_DAILY) throw new HttpsError('resource-exhausted', "You've sent a lot of reports today. Thanks! Tell the owner directly if it's urgent.")
  const at = new Date().toISOString()
  const ref = db.collection('bug_reports').doc()
  await ref.set({ ...clean, email: caller.email, name: caller.name, role: caller.role, status: 'open', at, day: today })
  if (caller.email !== OWNER_EMAIL) {
    await sendPush({ to: [OWNER_EMAIL], title: `Problem report · ${BUG_KIND_LABEL[clean.kind]}`, url: `/bugs?id=${ref.id}`, tag: 'bug',
      body: `${caller.name}: ${clean.what.slice(0, 120)}` }).catch(() => 0)
  }
  return { id: ref.id }
})

// The owner marks a report fixed / won't fix (or open again), with an optional note. "Fixed" thanks the person who sent it.
export const updateBugReport = onCall(CALLABLE, async req => {
  const caller = await requireRole(req, ['owner'])
  const id = str(req.data?.id, 60)
  const status = String(req.data?.status ?? '')
  if (!(BUG_STATUSES as readonly string[]).includes(status)) throw new HttpsError('invalid-argument', 'Pick open, fixed or won\'t fix.')
  const ref = db.doc(`bug_reports/${id}`)
  const r = id ? (await ref.get()).data() : undefined
  if (!r) throw new HttpsError('not-found', 'That report is gone.')
  const note = str(req.data?.note, 400)
  const at = new Date().toISOString()
  await ref.update({ status, note, decidedAt: at, decidedBy: caller.email })
  if (status === 'fixed' && r.status !== 'fixed' && r.email !== caller.email) {
    await sendPush({ to: [String(r.email)], title: 'Thanks for the report', url: '/account', tag: 'bug-fixed',
      body: `The problem you reported is fixed${note ? `: ${note}` : '.'}` }).catch(() => 0)
  }
  return { ok: true }
})
