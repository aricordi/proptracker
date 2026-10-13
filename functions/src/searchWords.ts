// "Improve search words": a one-off top-up for props that already exist.
// The AI looks at each prop's photo + details and writes hidden extra search
// words (a Lincoln mask → "president", "civil war"…). New props get these
// automatically when they're added or imported. Counted in the import's cost cap.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { suggestSearchWords, GEMINI_API_KEY } from './gemini.js'
import { reserveBudget, BUDGET, RESERVE_USD } from './importer.js'
import { photoOf } from './dedupe.js'
import { isRateLimit } from './limits.js'

const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }
const PER_CALL = 12   // props per call; the screen keeps calling until none are left

const needsWords = (d: QueryDocumentSnapshot) => d.get('archived') !== true && !d.get('searchWordsAt')

export const improveSearchWords = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: '1GiB' }, async req => {
  await requireRole(req, ['owner'])
  const items = await db.collection('items').get()
  const todo = items.docs.filter(needsWords)
  const total = items.docs.filter(d => d.get('archived') !== true).length
  if (req.data?.countOnly === true) return { total, remaining: todo.length, processed: 0, failed: 0, capped: false, slowDown: false }

  const batch = todo.slice(0, PER_CALL)
  const categories = new Map((await db.collection('categories').get()).docs.map(d => [d.id, String(d.get('label') ?? '')]))
  const tagIds = [...new Set(batch.flatMap(d => (d.get('tags') as string[] | undefined) ?? []))]
  const tagSnaps = tagIds.length ? await db.getAll(...tagIds.map(id => db.doc(`tags/${id}`))) : []
  const tagLabel = new Map(tagSnaps.map(t => [t.id, t.exists ? String(t.get('label') ?? t.id) : t.id]))

  let processed = 0, failed = 0, capped = false, slowDown = false
  const queue = [...batch]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let d = queue.shift(); d && !capped && !slowDown; d = queue.shift()) {
      const budget = await reserveBudget()
      if (!budget.ok) { capped = true; break }
      const item = d.data()
      try {
        const image = await photoOf(item).catch(() => null)
        const { searchWords, costUsd } = await suggestSearchWords(apiKey(), {
          name: String(item.name ?? ''),
          category: categories.get(item.categoryId ?? item.itemType) ?? '',
          tags: ((item.tags as string[] | undefined) ?? []).map(id => tagLabel.get(id) ?? id),
          description: String(item.description ?? ''),
        }, image)
        await BUDGET().set({ spentUsd: FieldValue.increment(costUsd - RESERVE_USD) }, { merge: true })
        const existing = Array.isArray(item.searchWords) ? item.searchWords as string[] : []
        await d.ref.update({ searchWords: [...new Set([...existing, ...searchWords])].slice(0, 40), searchWordsAt: new Date().toISOString() })
        processed++
      } catch (err) {
        await BUDGET().set({ spentUsd: FieldValue.increment(-RESERVE_USD) }, { merge: true })
        const message = err instanceof Error ? err.message : String(err)
        if (isRateLimit(message)) { slowDown = true; break }
        console.error(`Search words for ${d.id} failed`, message)
        // Don't retry this one forever; it keeps its current search words.
        await d.ref.update({ searchWordsAt: new Date().toISOString(), searchWordsError: message.slice(0, 200) })
        failed++
      }
    }
  }))
  if (capped && processed === 0) {
    const b = (await BUDGET().get()).data() ?? {}
    throw new HttpsError('resource-exhausted', `The AI spending cap ($${b.capUsd ?? '?'}) has been reached. Raise it on the Import screen to continue.`)
  }
  return { total, remaining: todo.length - processed - failed, processed, failed, capped, slowDown }
})
