// AI helpers for creators: turn a video idea into props and gear (and, next, find filming times).
// Every use counts against a monthly AI budget (owner's rule: about $50/month) and a daily
// limit per person, so a busy day or a bug can't run up the bill. Search and browse never stop.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db, requireRole, CALLABLE } from './auth.js'
import { todayInStudio, addDays, weekday } from './booking.js'
import { nowStamp } from './gearBooking.js'
import { roughParse, roughAdjust, cleanAsk, findOptions, matchPeople, type TimeAsk } from './timeFinder.js'
import { loadScheduleSettings } from './scheduling.js'
import type { ScheduleDay } from './schedule.js'
import { collectionOf } from './collections.js'
import { GEMINI_API_KEY, askJson, embedText, isFakeMode } from './gemini.js'

const apiKey = () => { try { return GEMINI_API_KEY.value() || undefined } catch { return undefined } }
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''

export const AI_DEFAULTS = { monthlyCapUsd: 50, perPersonDaily: 25 }
const RESERVE_USD = 0.02   // set aside before each call; the real cost is settled after

export async function aiSettings() {
  const d = (await db.doc('app_settings/ai').get()).data() ?? {}
  const num = (v: unknown, min: number, max: number, f: number) => typeof v === 'number' && v >= min && v <= max ? v : f
  return { monthlyCapUsd: num(d.monthlyCapUsd, 0, 10000, AI_DEFAULTS.monthlyCapUsd), perPersonDaily: Math.round(num(d.perPersonDaily, 0, 1000, AI_DEFAULTS.perPersonDaily)) }
}

// Count one AI use for this person; refuses when the month's budget or their daily limit is used up.
// Returns settle(cost) to record what the call really cost.
export async function reserveAi(email: string, helper: string) {
  const s = await aiSettings()
  const today = todayInStudio(), month = today.slice(0, 7)
  const monthRef = db.doc(`ai_usage/${month}`), personRef = db.doc(`ai_usage/${month}/people/${email}`)
  await db.runTransaction(async tx => {
    const [m, p] = await Promise.all([tx.get(monthRef), tx.get(personRef)])
    const spent = Number(m.get('spentUsd') ?? 0)
    if (spent + RESERVE_USD > s.monthlyCapUsd) {
      throw new HttpsError('resource-exhausted', 'The AI helpers are resting until the 1st (this month\'s AI budget is used up). Search and browse still work.', { problem: 'ai-budget' })
    }
    const used = p.get('day') === today ? Number(p.get('count') ?? 0) : 0
    if (used >= s.perPersonDaily) {
      throw new HttpsError('resource-exhausted', `You've used today's AI help (${s.perPersonDaily} times). It's back tomorrow. Search and browse still work.`, { problem: 'ai-daily' })
    }
    tx.set(monthRef, { month, spentUsd: FieldValue.increment(RESERVE_USD), calls: FieldValue.increment(1), [`by.${helper}`]: FieldValue.increment(1), updatedAt: new Date().toISOString() }, { merge: true })
    tx.set(personRef, { email, day: today, count: used + 1, total: FieldValue.increment(1) }, { merge: true })
  })
  return async (costUsd: number) => {
    await monthRef.set({ spentUsd: FieldValue.increment(costUsd - RESERVE_USD) }, { merge: true }).catch(() => {})
  }
}

// ─── Video idea → props and gear ─────────────────────────────────────────────

interface Pick { kind: 'prop' | 'gear'; id: string; why: string }

export const ideaToProps = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY] }, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator'])
  const idea = str(req.data?.idea, 600)
  if (idea.length < 8) throw new HttpsError('invalid-argument', 'Tell us a little more about the video idea.')
  const settle = await reserveAi(caller.email, 'ideas')

  // 1. Narrow the catalogue to the ~60 props closest in meaning (smart search), plus all gear on offer.
  const vector = await embedText(apiKey(), idea, 'RETRIEVAL_QUERY')
  const near = await db.collection('item_vectors').findNearest({ vectorField: 'embedding', queryVector: FieldValue.vector(vector), limit: 60, distanceMeasure: 'COSINE' }).get()
  const itemSnaps = near.docs.length ? await db.getAll(...near.docs.map(d => db.doc(`items/${d.id}`))) : []
  const cats = Object.fromEntries((await db.collection('categories').get()).docs.map(d => [d.id, String(d.get('label') ?? '')]))
  const props = itemSnaps.filter(s => s.exists && s.get('archived') !== true && collectionOf(s.data()) === 'company')
    .map(s => ({ id: s.id, name: String(s.get('name') ?? ''), cat: cats[s.get('categoryId')] ?? '', about: str(s.get('description'), 90) }))
  const gear = (await db.collection('gear_bundles').get()).docs.filter(d => d.get('archived') !== true)
    .map(d => ({ id: d.id, name: String(d.get('name') ?? ''), cat: String(d.get('category') ?? '') }))
  const propIds = new Set(props.map(p => p.id)), gearIds = new Set(gear.map(g => g.id))

  // Test mode (emulator, no key): a simple, stable answer.
  if (isFakeMode(apiKey())) {
    await settle(0)
    return {
      groups: [
        { title: 'For your idea', picks: props.slice(0, 4).map(p => ({ kind: 'prop', id: p.id, why: 'Matches your idea (test mode)' })) },
        ...(gear.length ? [{ title: 'To film it', picks: gear.slice(0, 2).map(g => ({ kind: 'gear', id: g.id, why: 'Main kit (test mode)' })) }] : []),
      ].filter(g => g.picks.length),
      missing: [{ name: 'Something special', why: 'Ask the arts team to make or find it (test mode)' }],
    }
  }
  const key = apiKey()
  if (!key) throw new HttpsError('failed-precondition', 'The AI helper isn\'t set up yet.')

  const prompt = `You help YouTube creators at a film studio plan their video. A creator described a video idea. Suggest props and gear
from the studio's inventory below that would make the video better, grouped by scene, character or purpose.

Video idea: """${idea}"""

PROPS (id | name | category | about):
${props.map(p => `${p.id} | ${p.name} | ${p.cat} | ${p.about}`).join('\n') || '(none)'}

GEAR (id | name | category):
${gear.map(g => `${g.id} | ${g.name} | ${g.cat}`).join('\n') || '(none)'}

Return ONLY JSON:
{"groups":[{"title":"For the cop","picks":[{"kind":"prop","id":"<id from the list>","why":"short reason, max 8 words"}]}],
 "missing":[{"name":"thing the studio does not have","why":"short reason, max 10 words"}]}
Rules: 2-5 groups, titles start with "For " (e.g. "For the diner", "For the reveal") except one gear group titled "To film it";
max 5 picks per group; ONLY ids from the lists above (kind "prop" for PROPS, "gear" for GEAR); each id at most once;
only things that clearly fit the idea; "missing": 0-4 important things not in the lists.`
  let data: Record<string, unknown> = {}, cost = 0
  try { const r = await askJson(key, prompt); data = r.data; cost = r.costUsd } finally { await settle(cost) }

  const seen = new Set<string>()
  const groups = (Array.isArray(data.groups) ? data.groups : []).slice(0, 5).map((g: any) => ({
    title: str(g?.title, 40) || 'Ideas',
    picks: (Array.isArray(g?.picks) ? g.picks : []).map((p: any): Pick | null => {
      const kind = p?.kind === 'gear' ? 'gear' : 'prop', id = str(p?.id, 128)
      if (!(kind === 'prop' ? propIds : gearIds).has(id) || seen.has(id)) return null
      seen.add(id)
      return { kind, id, why: str(p?.why, 80) }
    }).filter(Boolean).slice(0, 5),
  })).filter(g => g.picks.length)
  const missing = (Array.isArray(data.missing) ? data.missing : []).slice(0, 4)
    .map((m: any) => ({ name: str(m?.name, 60), why: str(m?.why, 90) })).filter(m => m.name)
  return { groups, missing }
})

// ─── Ask for a time (type or talk) ───────────────────────────────────────────

export const askForTime = onCall({ ...CALLABLE, secrets: [GEMINI_API_KEY] }, async req => {
  const caller = await requireRole(req, ['owner', 'arts', 'creator', 'equipment'])
  const text = str(req.data?.text, 400)
  if (text.length < 3) throw new HttpsError('invalid-argument', 'Say when you want to film.')
  const settle = await reserveAi(caller.email, 'times')
  const s = await loadScheduleSettings()
  const today = todayInStudio(), now = nowStamp()
  const users = await db.collection('users').where('active', '==', true).get()
  const people = users.docs.map(d => ({ email: d.id, name: String(d.get('name') || d.id) })).filter(p => p.email !== caller.email)
  const previous = req.data?.previous && typeof req.data.previous === 'object' ? req.data.previous as Record<string, unknown> : null
  let ask: TimeAsk = previous ? roughAdjust(cleanAsk(previous, today, roughParse('', today, people)), text, today, people) : roughParse(text, today, people)
  let reply = '', cost = 0
  const key = apiKey()
  if (key && !isFakeMode(key)) {
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(today)]
    const prompt = `You help a creator find filming times at a studio. Today is ${dayName} ${today}, ${now.slice(11)} (Toronto).
Houses: "cliff1" = ${s.houses.cliff1.name}, "cliff2" = ${s.houses.cliff2.name}. Slots are ${s.slotMinutes / 60} hours each. Weeks run Monday to Sunday.
People the creator might film with: ${people.map(p => p.name).join(', ') || '(none)'}.
${previous ? `Their previous search (they may be adjusting it): ${JSON.stringify(previous)}\n` : ''}Creator's message: """${text}"""
Return ONLY JSON: {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","people":["exact names from the list they will film with, right after them"],
"mySlots":1,"houses":["cliff1","cliff2"],"timeOfDay":"any|morning|afternoon|evening|late","reply":"one short friendly sentence saying what you'll look for"}
Rules: from >= today; at most ${'' + 21} days between from and to; "this week" = today to Sunday; "next week" = next Monday to Sunday;
mySlots = how many ${s.slotMinutes / 60}-hour slots the creator needs for themselves (1-3; friends each get their own slot after);
houses = both unless they name one; keep anything from the previous search they didn't change.`
    try { const r = await askJson(key, prompt, 400); cost = r.costUsd; ask = cleanAsk(r.data, today, ask); reply = str(r.data.reply, 160) } catch { /* the simple reading is used */ }
  }
  await settle(cost)

  const friends = matchPeople(ask.people, people, caller.email)
  const unknown = ask.people.filter(n => !friends.some(f => f.name.toLowerCase().split(/\s+/)[0] === n.toLowerCase().split(/\s+/)[0]))
  const dates: string[] = []
  for (let d = ask.from; d <= ask.to; d = addDays(d, 1)) dates.push(d)
  const daySnaps = dates.length ? await db.getAll(...dates.map(d => db.doc(`schedule_days/${d}`))) : []
  const days = Object.fromEntries(daySnaps.map((x, i) => [dates[i], (x.data() ?? { date: dates[i] }) as ScheduleDay]))
  const friendBusy: Record<string, { from: string; to: string }[]> = {}
  for (const f of friends) {
    const q = await db.collection('shoots').where('creatorEmail', '==', f.email).where('date', '>=', addDays(ask.from, -1)).where('date', '<=', ask.to).get()
    friendBusy[f.email] = q.docs.filter(d => d.get('status') === 'booked').map(d => ({ from: d.get('from'), to: d.get('to') }))
  }
  const me = { email: caller.email, name: caller.name }
  const team = caller.role === 'owner' || caller.role === 'equipment'
  const options = findOptions(ask, me, friends, days, friendBusy, s, now, team)
  const who = friends.length ? `you${friends.map(f => `, ${f.name.split(' ')[0]}`).join('')} back to back` : `${ask.mySlots * s.slotMinutes / 60} hours`
  if (!reply) reply = `Looking for ${who}.`
  const note = unknown.length ? ` I couldn't find ${unknown.join(', ')} in the app, so I left them out.` : ''
  return {
    reply: options.length ? `${reply}${note}` : `${reply}${note} Nothing is free for that. Try other days, the other house, or a different time of day.`,
    ask: { ...ask, people: friends.map(f => f.name) },
    friends,
    options,
  }
})
