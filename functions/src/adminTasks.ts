// Admin tasks (owner, Nov 8: "I'd prefer you do the import through here"). A GitHub button (".github/workflows/admin-task.yml",
// run with the deploy account) writes admin_tasks/{id}; this trigger then does the work AS THE OWNER with exactly the same
// code the Import screen uses (startImport / processImport / approveImports via .run), so every rule and safety net applies
// (one record per Drive photo, exact-copy skip, $ cap). Clients can't read or write admin_tasks (no rule = denied).
//   kind 'import'       {steps:[{link, place?}], dryRun?}  → queue + analyse each step in order (nothing becomes a prop)
//   kind 'approve'      {approvals:[Approval], merges:[{ids, item: Approval}], skips:[id]} → approve / merge analysed photos
//   kind 'binShortcuts' {folder} → read only: the crew's Drive shortcuts per "Bin N" folder vs the bin each prop has in the app
//   kind 'driveAudit'   {folder, words?} → read only (owner, Nov 17: "swords and hammers weren't imported"): EVERY photo under the
//                       folder (all sub-folders) vs the app's photo records → never seen / failed / skipped / waiting for review /
//                       became a prop (and whether that prop still exists, was combined, or was removed), plus props whose
//                       name, tags or description match the words (e.g. sword, hammer) with their bin
//   kind 'scheduleLists' {instantBookers?: [email|name], longBookers?: [email|name]} → owner, Nov 19: ADDS people (active users;
//                       a name must match exactly one person) to Schedule settings "Books without approval" / "Can book several
//                       slots in a row". Never removes anyone; only those two fields (+ updatedAt/By) are written.
//   kind 'moveShoots' {moves: [{shootId, start, place?, date?}]} → owner, Nov 23: moves shoots as the schedule team (same checks
//                       as Move in the app; the creator is told; logged in the team log). Each move reported, one failing doesn't stop the rest.
//   kind 'offAppPeople' {names: [string]} → owner, Nov 23: adds people who aren't on the app yet (no access), like People → Add.
//   kind 'mergePerson' {from, to, apply?} → owner, Nov 23: People → Change their email (preview without apply; apply moves everything).
//   kind 'oldCalendars' {on} → owner, Nov 23: checks the app can write to each calendar, then turns "Write app bookings into the
//                       old calendars" on (only when the calendars it writes new bookings to are writable) or off. Only that one setting is written.
// Long imports continue in a fresh task (continues: <id>, round n) so no run hits the 9-minute limit.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { db, OWNER_EMAIL } from './auth.js'
import { GEMINI_API_KEY } from './gemini.js'
import { startImport, processImport, approveImports, mergeImports, skipImports } from './importer.js'
import { folderIdFrom, listSubfolders, listShortcuts, listImages } from './drive.js'
import { moveShoot, addOffAppPerson } from './scheduling.js'
import { changeUserEmail } from './emailMove.js'
import { checkCalendarAccess } from './calendar.js'
import { cleanScheduleSettings, oldCalendarFor } from './schedule.js'

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
    } else if (task.kind === 'setBins') {
      // Owner, Nov 8: move props to the bin the crew's Drive shortcuts say ("Bin 25" = the app's "B: 25"). Only binId/locationId
      // change; archived props and bins that don't exist are skipped and reported.
      const bins = (await db.collection('bins').get()).docs.map(d => ({ id: d.id, label: String(d.get('label') ?? ''), locationId: String(d.get('locationId') ?? '') }))
      const numOf = (label: string) => { const m = label.trim().match(/^(?:bin|bi|b)?[\s.:#-]*0*(\d+)$/i); return m ? m[1] : null }
      const moves: { itemId: string; bin: string }[] = Array.isArray(task.moves) ? task.moves.slice(0, 500) : []
      const done: string[] = [], skipped: string[] = []
      const now = new Date().toISOString()
      for (const mv of moves) {
        const n = numOf(String(mv.bin ?? ''))
        const matches = n ? bins.filter(b => numOf(b.label) === n) : []
        if (matches.length !== 1) { skipped.push(`${mv.itemId}: ${matches.length ? 'more than one' : 'no'} bin ${mv.bin}`); continue }
        const ref = db.doc(`items/${mv.itemId}`)
        const res = await db.runTransaction(async tx => {
          const it = await tx.get(ref)
          if (!it.exists) return 'missing'
          if (it.get('archived') === true) return 'archived'
          if (it.get('binId') === matches[0].id) return 'already'
          tx.update(ref, { binId: matches[0].id, locationId: matches[0].locationId, lostFromBin: FieldValue.delete(), updatedAt: now, updatedBy: OWNER_EMAIL })
          return 'moved'
        })
        if (res === 'moved') done.push(mv.itemId); else skipped.push(`${mv.itemId}: ${res}`)
      }
      await ref.update({ status: 'done', result: { moved: done.length, skipped }, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'scheduleLists') {
      const users = (await db.collection('users').get()).docs
        .filter(d => d.get('active') !== false)
        .map(d => ({ email: d.id.toLowerCase(), name: String(d.get('name') ?? '') }))
      const find = (q: string) => {
        const k = q.trim().toLowerCase()
        if (k.includes('@')) return users.filter(u => u.email === k)
        return users.filter(u => u.name.toLowerCase() === k || u.name.toLowerCase().split(/\s+/)[0] === k)
      }
      const sref = db.doc('app_settings/schedule')
      const result = await db.runTransaction(async tx => {
        const cur = (await tx.get(sref)).data() ?? {}
        const out: Record<string, unknown> = {}
        const notes: string[] = []
        for (const field of ['instantBookers', 'longBookers'] as const) {
          const asks: string[] = Array.isArray(task[field]) ? task[field].map(String).slice(0, 20) : []
          if (!asks.length) continue
          const list: { email: string; name: string }[] = Array.isArray(cur[field]) ? [...cur[field]] : []
          for (const q of asks) {
            const m = find(q)
            if (m.length !== 1) { notes.push(`${field}: "${q}" matches ${m.length} people, skipped`); continue }
            if (list.some(p => String(p.email).toLowerCase() === m[0].email)) { notes.push(`${field}: ${m[0].email} already there`); continue }
            list.push({ email: m[0].email, name: m[0].name || m[0].email })
            notes.push(`${field}: added ${m[0].name} (${m[0].email})`)
          }
          out[field] = list.slice(0, 20)
        }
        if (Object.keys(out).length) tx.set(sref, { ...out, updatedAt: new Date().toISOString(), updatedBy: OWNER_EMAIL }, { merge: true })
        return notes
      })
      result.forEach(say)
      await ref.update({ status: 'done', result: { notes: result }, log, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'moveShoots') {
      const out: Record<string, unknown>[] = []
      for (const m of (Array.isArray(task.moves) ? task.moves : []).slice(0, 60)) {
        const sh = (await db.doc(`shoots/${String(m.shootId)}`).get()).data()
        if (!sh) { out.push({ shootId: m.shootId, ok: false, error: 'not found' }); continue }
        try {
          await moveShoot.run(asOwner({ id: String(m.shootId), place: m.place ?? sh.place, date: m.date ?? sh.date, start: Number(m.start), where: sh.where ?? '' }))
          out.push({ shootId: m.shootId, ok: true, who: sh.creatorName, from: `${sh.date} ${sh.place} ${sh.start}`, to: `${m.date ?? sh.date} ${m.place ?? sh.place} ${m.start}` })
        } catch (e) { out.push({ shootId: m.shootId, ok: false, who: sh.creatorName, error: String((e as Error).message ?? e) }) }
      }
      out.forEach(o => say(JSON.stringify(o)))
      await ref.update({ status: 'done', result: { moves: out }, log, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'offAppPeople') {
      const out: Record<string, unknown>[] = []
      for (const name of (Array.isArray(task.names) ? task.names : []).slice(0, 20)) {
        try { out.push({ name, ...(await addOffAppPerson.run(asOwner({ name: String(name) })) as object) }) } catch (e) { out.push({ name, ok: false, error: String((e as Error).message ?? e) }) }
      }
      out.forEach(o => say(JSON.stringify(o)))
      await ref.update({ status: 'done', result: { people: out }, log, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'mergePerson') {
      const r = await changeUserEmail.run(asOwner({ from: String(task.from ?? ''), to: String(task.to ?? ''), apply: task.apply === true }))
      say(JSON.stringify(r))
      await ref.update({ status: 'done', result: r, log, finishedAt: new Date().toISOString() })
    } else if (task.kind === 'oldCalendars') {
      const acc = await checkCalendarAccess.run(asOwner({})) as { account: string; calendars: { id: string; name: string; role: string; canWrite: boolean; error?: string }[] }
      acc.calendars.forEach(c => say(`${c.name}: ${c.role}${c.canWrite ? ' (can write)' : ' (CANNOT write)'}${c.error ? ' · ' + c.error : ''}`))
      const on = task.on !== false
      // Only the calendars the app writes NEW bookings to must be writable (owner, Nov 24): the app calendar + the old
      // calendar for Cliff 1, Cliff 2 and offsite. Read-only others are reported; edits to shoots from them just stay app-side.
      const ss = cleanScheduleSettings((await db.doc('app_settings/schedule').get()).data() ?? {})
      const needed = new Set([ss.googleCalendarId, ...(['cliff1', 'cliff2', 'offsite'] as const).map(p => oldCalendarFor(ss, p)?.id ?? '')].filter(Boolean))
      const blocked = acc.calendars.filter(c => !c.canWrite && needed.has(c.id))
      acc.calendars.filter(c => !c.canWrite && !needed.has(c.id)).forEach(c => say(`${c.name}: read only, not needed for new bookings (left as is)`))
      if (on && blocked.length) {
        say(`Not turned on: the app can't write to ${blocked.map(c => c.name).join(', ')} (account ${acc.account || '?'})`)
        await ref.update({ status: 'done', result: { turnedOn: false, access: acc }, log, finishedAt: new Date().toISOString() })
      } else {
        await db.doc('app_settings/schedule').set({ writeOldCalendars: on, updatedAt: new Date().toISOString(), updatedBy: OWNER_EMAIL }, { merge: true })
        say(`writeOldCalendars = ${on}`)
        await ref.update({ status: 'done', result: { turnedOn: on, access: acc }, log, finishedAt: new Date().toISOString() })
      }
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
    } else if (task.kind === 'driveAudit') {
      const root = folderIdFrom(String(task.folder ?? ''))
      if (!root) throw new Error('no folder')
      const { images } = await listImages(root, 10000)
      say(`Drive has ${images.length} photos under this folder`)
      const bins = new Map((await db.collection('bins').get()).docs.map(d => [d.id, String(d.get('label') ?? '')]))
      const recs = new Map((await db.collection('import_items').get()).docs.map(d => [d.id, d.data()]))
      const itemsSnap = await db.collection('items').get()
      const items = new Map(itemsSnap.docs.map(d => [d.id, d.data()]))
      const rows: Record<string, unknown>[] = []
      const counts: Record<string, number> = {}
      for (const img of images) {
        const r = recs.get(img.id)
        let state = 'NEVER SEEN BY THE APP'
        let itemId = r?.itemId as string | undefined
        let item = itemId ? items.get(itemId) : undefined
        for (let hops = 0; item?.mergedInto && hops < 5; hops++) { itemId = String(item.mergedInto); item = items.get(itemId) }
        if (r) {
          const st = String(r.status ?? '?')
          if (st === 'approved' || itemId) state = !item ? 'prop deleted' : item.removedAt ? 'prop removed in clean-up' : item.archived ? 'prop archived' : 'in the app'
          else state = st === 'skipped' ? (r.duplicateOf ? 'skipped (exact copy)' : 'skipped by a person') : st === 'failed' ? 'failed' : st === 'analyzed' ? 'analysed, waiting for someone to approve' : st === 'pending' || st === 'working' ? 'queued, never analysed' : st
        }
        counts[state] = (counts[state] ?? 0) + 1
        if (state !== 'in the app') rows.push({ state, folder: img.folder, file: img.name, fileId: img.id, aiName: r?.suggestion?.name ?? null,
          error: r?.error ?? r?.lastError ?? null, duplicateOf: r?.duplicateOf ?? null, job: r?.jobId ?? null,
          itemId: itemId ?? null, itemName: item?.name ?? null, removedNote: item?.removedNote ?? null })
      }
      // Props that match the words, wherever they came from.
      const words = (Array.isArray(task.words) ? task.words : []).map((w: unknown) => String(w).toLowerCase()).filter(Boolean).slice(0, 20)
      const matches: Record<string, unknown>[] = []
      if (words.length) for (const [id, it] of items) {
        const text = [it.name, it.description, ...(Array.isArray(it.searchWords) ? it.searchWords : [String(it.searchWords ?? '')])].join(' ').toLowerCase()
        const hit = words.filter((w: string) => text.includes(w))
        if (hit.length) matches.push({ id, name: it.name, words: hit.join(','), bin: it.binId ? bins.get(it.binId) ?? it.binId : null, qty: it.quantity ?? null,
          archived: it.archived === true, removed: it.removedNote ?? null, collection: it.collection ?? 'personal', from: it.importedFrom?.folder ?? null })
      }
      say(`summary: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
      await ref.update({ status: 'done', result: { total: images.length, counts, rows: rows.slice(0, 1500), matches: matches.slice(0, 400) }, log, finishedAt: new Date().toISOString() })
    } else {
      throw new Error(`unknown kind ${task.kind}`)
    }
  } catch (err) {
    say(`failed: ${err instanceof Error ? err.message : String(err)}`)
    await ref.update({ status: 'failed', error: String(err).slice(0, 500), log, steps: task.steps ?? FieldValue.delete(), finishedAt: new Date().toISOString() })
  }
})
