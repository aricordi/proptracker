// Admin tasks (owner, Nov 8: "I'd prefer you do the import through here"). A GitHub button (".github/workflows/admin-task.yml",
// run with the deploy account) writes admin_tasks/{id}; this trigger then does the work AS THE OWNER with exactly the same
// code the Import screen uses (startImport / processImport / approveImports via .run), so every rule and safety net applies
// (one record per Drive photo, exact-copy skip, $ cap). Clients can't read or write admin_tasks (no rule = denied).
//   kind 'import'       {steps:[{link, place?}], dryRun?}  → queue + analyse each step in order (nothing becomes a prop)
//   kind 'approve'      {approvals:[Approval], merges:[{ids, item: Approval}], skips:[id]} → approve / merge analysed photos
//   kind 'binShortcuts' {folder} → read only: the crew's Drive shortcuts per "Bin N" folder vs the bin each prop has in the app
// Long imports continue in a fresh task (continues: <id>, round n) so no run hits the 9-minute limit.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { db, OWNER_EMAIL } from './auth.js'
import { GEMINI_API_KEY } from './gemini.js'
import { startImport, processImport, approveImports, mergeImports, skipImports } from './importer.js'
import { folderIdFrom, listSubfolders, listShortcuts } from './drive.js'

const BUDGET_MS = 470_000
const MAX_ROUNDS = 40
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function asOwner<T>(data: T): CallableRequest<T> {
  return { data, auth: { uid: 'admin-task', token: { email: OWNER_EMAIL, email_verified: true, name: 'Import helper' } }, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<T>
}

interface Step { link: string; place?: string; useLists?: boolean; jobId?: string | null; note?: string; done?: boolean }

export const runAdminTask = onDocumentCreated({ document: 'admin_tasks/{id}', secrets: [GEMINI_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async event => {
  const ref = db.doc(`admin_tasks/${event.params.id}`)
  // Claim it once (a trigger can fire twice).
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(ref)
    if (!s.exists || s.get('status')) return false
    tx.update(ref, { status: 'running', startedAt: new Date().toISOString() })
    return true
  })
  if (!claimed) return
  const task = (await ref.get()).data()!
  const log: string[] = []
  const say = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); logger.info('admin task', s) }
  const started = Date.now()
  try {
    if (task.kind === 'import') {
      const steps: Step[] = (task.steps ?? []).slice(0, 20)
      let more = false
      for (const st of steps) {
        if (st.done) continue
        if (st.jobId === undefined) {
          const r = await startImport.run(asOwner({ links: [st.link], place: st.place ?? '', dryRun: task.dryRun === true, useLists: st.useLists !== false })) as Record<string, unknown>
          st.jobId = (r.jobId as string | null) ?? null
          st.note = `found ${r.found}, already imported ${r.alreadyImported ?? (Number(r.found) - Number(r.queued))}, queued ${r.queued}, lists: ${(r.listNames as string[] ?? []).join(', ') || 'none'}`
          say(`${st.place || 'bins'} · ${st.note}`)
          if (!st.jobId) { st.done = true; continue }
        }
        let stalls = 0
        while (true) {
          if (Date.now() - started > BUDGET_MS) { more = true; break }
          const r = await processImport.run(asOwner({ jobId: st.jobId })) as { processed: number; capped: boolean; slowDown: boolean; counts: Record<string, number> }
          if (r.capped) { say('Import budget cap reached: stopped'); throw new Error('cap reached') }
          if (r.slowDown) { if (++stalls > 6) throw new Error('Google kept asking to slow down'); await sleep(30_000); continue }
          stalls = 0
          if (!r.processed) {
            const c = r.counts ?? {}
            st.done = true
            say(`${st.place || 'bins'} · done: ${JSON.stringify(c)}`)
            break
          }
        }
        if (more) break
      }
      if (more) {
        const round = Number(task.round ?? 0) + 1
        if (round > MAX_ROUNDS) throw new Error('too many rounds')
        const next = db.collection('admin_tasks').doc()
        await next.set({ kind: 'import', steps, dryRun: task.dryRun === true, round, continues: ref.id, createdAt: new Date().toISOString() })
        await ref.update({ status: 'continued', next: next.id, steps, log, finishedAt: new Date().toISOString() })
        return
      }
      await ref.update({ status: 'done', steps, log, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'approve') {
      const out: Record<string, unknown> = {}
      if (Array.isArray(task.approvals) && task.approvals.length) {
        for (let i = 0; i < task.approvals.length; i += 50) {
          const r = await approveImports.run(asOwner({ items: task.approvals.slice(i, i + 50) })) as { results?: unknown[] }
          out[`approve${i}`] = r
        }
      }
      for (const [i, m] of (Array.isArray(task.merges) ? task.merges : []).entries()) {
        try { out[`merge${i}`] = await mergeImports.run(asOwner(m)) } catch (e) { out[`merge${i}`] = { error: String(e) } }
      }
      if (Array.isArray(task.skips) && task.skips.length) out.skip = await skipImports.run(asOwner({ ids: task.skips, reason: task.skipReason ?? '' }))
      await ref.update({ status: 'done', result: JSON.parse(JSON.stringify(out)), finishedAt: new Date().toISOString() })
    } else if (task.kind === 'binShortcuts') {
      const root = folderIdFrom(String(task.folder ?? ''))
      if (!root) throw new Error('no folder')
      const subs = (await listSubfolders(root)).filter(f => /^bin\s*\d+$/i.test(f.name.trim()))
      const bins = new Map((await db.collection('bins').get()).docs.map(d => [d.id, String(d.get('label') ?? '')]))
      const rows: Record<string, unknown>[] = []
      for (const f of subs) {
        const cuts = await listShortcuts(f.id)
        for (const c of cuts) {
          const imp = await db.doc(`import_items/${c.targetId}`).get()
          let itemId = imp.get('itemId') as string | undefined
          let item = itemId ? (await db.doc(`items/${itemId}`).get()).data() : undefined
          for (let hops = 0; item?.mergedInto && hops < 5; hops++) { itemId = String(item.mergedInto); item = (await db.doc(`items/${itemId}`).get()).data() }
          rows.push({ driveBin: f.name.trim(), file: c.name, fileId: c.targetId, status: imp.get('status') ?? 'not imported',
            itemId: itemId ?? null, itemName: item?.name ?? null, appBin: item?.binId ? bins.get(item.binId) ?? item.binId : null,
            archived: item?.archived === true })
        }
      }
      await ref.update({ status: 'done', result: { rows, bins: subs.length }, finishedAt: new Date().toISOString() })
    } else {
      throw new Error(`unknown kind ${task.kind}`)
    }
  } catch (err) {
    say(`failed: ${err instanceof Error ? err.message : String(err)}`)
    await ref.update({ status: 'failed', error: String(err).slice(0, 500), log, steps: task.steps ?? FieldValue.delete(), finishedAt: new Date().toISOString() })
  }
})
