// Attack matrix (Nov 19, before the creator launch): every kind of person tries to read, list, create, change and delete
// every collection directly (skipping the app). Runs only against the local emulator ("demo-" project), never live.
// What must hold:
//   - people who aren't in (signed out, never invited, turned off, an unverified copy of the owner's email) get nothing
//   - nobody can delete anything from the app, except the few staff lists noted below
//   - server-only collections can't be written by anyone from the app
//   - private records (money, secrets, other people's shoots/strikes/requests) stay private
//   - nobody can make themselves more powerful (role, access, active)
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, limit, type Firestore } from 'firebase/firestore'

const PROJECT_ID = 'demo-proptracker'
const OWNER = 'alexisricordi@gmail.com'
const P = {
  creator: 'creator@example.com', demo: 'demo@example.com', other: 'other@example.com', arts: 'arts@example.com',
  gear: 'gear@example.com', admin: 'admin@example.com', gone: 'gone@example.com', stranger: 'stranger@example.com',
}
let env: RulesTestEnvironment
const uid = (e: string) => e.replace(/\W/g, '_')
type Who = 'anon' | 'stranger' | 'gone' | 'fakeOwner' | 'demo' | 'creator' | 'arts' | 'gear' | 'admin' | 'owner'
function db(who: Who): Firestore {
  if (who === 'anon') return env.unauthenticatedContext().firestore()
  if (who === 'fakeOwner') return env.authenticatedContext('x', { email: OWNER, email_verified: false }).firestore()
  const email = who === 'owner' ? OWNER : P[who as keyof typeof P]
  return env.authenticatedContext(uid(email), { email, email_verified: true }).firestore()
}
const OUTSIDERS: Who[] = ['anon', 'stranger', 'gone', 'fakeOwner']
const INSIDERS: Who[] = ['demo', 'creator', 'arts', 'gear', 'admin']

// One document per collection, belonging to ANOTHER creator where it has an owner.
const mine = { creatorEmail: P.other, email: P.other, fromEmail: P.other, toEmail: P.other, byEmail: P.other, by: P.other, crewEmails: [P.other] }
const SEED: Record<string, Record<string, unknown>> = {
  items: { name: 'Lamp', quantity: 1, condition: 'good', collection: 'company', photos: [] },
  personalitem: { name: 'Grandma lamp', quantity: 1, collection: 'personal' },
  suggestions: { ...mine, itemId: 'items', status: 'open', message: 'hi' },
  bug_reports: { ...mine, what: 'x' }, import_jobs: {}, import_items: {}, activity_personal: {}, activity: {},
  categories: { label: 'Prop', order: 0, active: true }, tags: { label: 'red' }, bins: { label: 'B1' }, locations: { label: 'Room' },
  characters: { label: 'Cop' }, checkouts: {}, item_private: { notes: 'secret' }, health: {}, gear_items: { value: 5000 },
  gear_bundles: {}, gear_holds: { entries: [] }, schedule_days: {}, shoots: { ...mine, status: 'booked' }, swap_requests: mine,
  schedule_invites: mine, cast_invites: { ...mine, hostEmail: P.other }, waitlist: mine, monthly_wishes: mine, monthly_draws: {}, profiles: { channel: 'x' },
  schedule_reports: mine, strikes: mine, flag_reviews: mine, user_status: { strikes: 1 }, gear_bookings: mine,
  item_vectors: { v: [1] }, prop_wants: {}, ai_usage: { spentUsd: 3 }, cleanup_runs: {}, outbox: { to: P.other },
  calendar_queue: {}, reservations: mine, item_bookings: { entries: [] }, video_checklists: {},
  // server-only stores the rules don't list (default deny)
  private_google: { refreshToken: 'secret' }, private_google_states: {}, push_tokens: { token: 't', email: P.other },
  calendar_tokens: { email: P.other }, push_log: {}, calendar_sent: {}, calendar_mirror: {}, dup_verdicts: {},
  import_lists: {}, admin_tasks: {}, email_moves: {}, calendar_imports: {}, calendar_removed: {}, push_sent: {}, cleanup: {},
  import_hashes: {}, users_extra: {},
}
const docPath = (col: string) => col === 'personalitem' ? ['items', 'personal1']
  : col === 'profiles' || col === 'user_status' ? [col, P.other] : [col, 'd1']
const SERVER_ONLY = ['bug_reports', 'import_jobs', 'import_items', 'activity_personal', 'activity', 'checkouts', 'gear_items',
  'gear_bundles', 'gear_holds', 'schedule_days', 'shoots', 'swap_requests', 'schedule_invites', 'cast_invites', 'waitlist', 'monthly_wishes',
  'monthly_draws', 'schedule_reports', 'strikes', 'flag_reviews', 'user_status', 'gear_bookings', 'item_vectors', 'prop_wants',
  'ai_usage', 'cleanup_runs', 'outbox', 'calendar_queue', 'reservations', 'item_bookings', 'private_google',
  'private_google_states', 'push_tokens', 'calendar_tokens', 'push_log', 'calendar_sent', 'calendar_mirror', 'dup_verdicts',
  'import_lists', 'admin_tasks', 'email_moves', 'calendar_imports', 'calendar_removed', 'push_sent', 'import_hashes', 'users_extra']
// Readable by nobody but the owner (money, secrets, private logs).
const OWNER_ONLY = ['bug_reports', 'import_jobs', 'import_items', 'activity_personal', 'ai_usage', 'cleanup_runs',
  'outbox', 'video_checklists', 'personalitem']
const NOBODY = ['item_vectors', 'private_google', 'private_google_states', 'push_tokens', 'calendar_tokens', 'push_log',
  'calendar_sent', 'calendar_mirror', 'dup_verdicts', 'import_lists', 'admin_tasks', 'email_moves', 'push_sent', 'import_hashes']
// Another creator's own records: a creator (or demo creator) must not read them.
const OTHERS_PRIVATE = ['shoots', 'swap_requests', 'schedule_invites', 'cast_invites', 'waitlist', 'monthly_wishes', 'schedule_reports', 'strikes',
  'flag_reviews', 'user_status', 'gear_bookings', 'reservations', 'suggestions', 'outbox', 'bug_reports']

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } })
})
afterAll(async () => { await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore()
    const u = (email: string, role: string, extra: Record<string, unknown> = {}) => setDoc(doc(d, 'users', email), { email, role, active: true, ...extra })
    await u(P.creator, 'creator', { access: 'full' }); await u(P.demo, 'creator', { access: 'props' }); await u(P.other, 'creator', { access: 'full' })
    await u(P.arts, 'arts'); await u(P.gear, 'equipment'); await u(P.admin, 'admin'); await u(P.gone, 'arts', { active: false })
    for (const [col, data] of Object.entries(SEED)) { const [c, id] = docPath(col); await setDoc(doc(d, c, id), data) }
    await setDoc(doc(d, 'app_settings', 'ai'), { monthlyCapUsd: 50 }); await setDoc(doc(d, 'app_settings', 'email'), { login: 'x' })
    await setDoc(doc(d, 'app_settings', 'booking'), { leadTimeHours: 48 }); await setDoc(doc(d, 'app_settings', 'schedule'), {})
  })
})

async function can(p: Promise<unknown>) { try { await p; return true } catch { return false } }

describe('attack matrix', () => {
  it('builds the matrix (printed) and every rule below holds', async () => {
    const rows: string[] = []
    const problems: string[] = []
    const who: Who[] = [...OUTSIDERS, ...INSIDERS, 'owner']
    for (const col of Object.keys(SEED)) {
      const [c, id] = docPath(col)
      const cells: string[] = []
      for (const w of who) {
        const f = db(w)
        const read = await can(getDoc(doc(f, c, id)))
        const list = await can(getDocs(query(collection(f, c), limit(5))))
        const create = await can(setDoc(doc(f, c, 'new-' + w), { probe: true, ...(c === 'items' ? { name: 'x', collection: 'company', updatedBy: uid(w) } : {}) }))
        const update = await can(updateDoc(doc(f, c, id), { probe: 1 }))
        const del = await can(deleteDoc(doc(f, c, id)))
        if (del) await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), c, id), SEED[col]))
        cells.push(`${w}:${read ? 'R' : '-'}${list ? 'L' : '-'}${create ? 'C' : '-'}${update ? 'U' : '-'}${del ? 'D' : '-'}`)
        if (OUTSIDERS.includes(w) && (read || list || create || update || del)) problems.push(`${w} got into ${col}`)
        if (SERVER_ONLY.includes(col) && (create || update || del)) problems.push(`${w} wrote server-only ${col}`)
        if (NOBODY.includes(col) && (read || list)) problems.push(`${w} read secret ${col}`)
        if (OWNER_ONLY.includes(col) && w !== 'owner' && (read || list)) problems.push(`${w} read owner-only ${col}`)
        if (OTHERS_PRIVATE.includes(col) && ['demo', 'creator'].includes(w) && (read || list)) problems.push(`${w} read another creator's ${col}`)
        // Staff working lists (and internal prop notes) can be cleared by the arts team; nothing else can be deleted.
        if (del && !['tags', 'bins', 'locations', 'characters', 'health', 'item_private'].includes(col)) problems.push(`${w} deleted ${col}`)
        if (col === 'item_private' && ['demo', 'creator', 'gear'].includes(w) && (read || list)) problems.push(`${w} read internal notes`)
        if (del && !['arts', 'owner'].includes(w)) problems.push(`${w} deleted staff list ${col}`)
      }
      rows.push(`${col.padEnd(22)} ${cells.join(' ')}`)
    }
    console.log('R=read L=list C=create U=update D=delete\n' + rows.join('\n'))
    expect(problems).toEqual([])
  }, 300_000)
})

describe('suggestion photos (Nov 19)', () => {
  const sug = (photos: string[]) => setDoc(doc(db('creator'), 'suggestions', 's-' + photos.length + photos[0]?.length), {
    itemId: 'd1', itemName: 'Lamp', by: P.creator, byName: 'C', at: 'now', status: 'open', message: 'wrong name', photos })
  it('only the app\'s own uploads, never outside or javascript: links', async () => {
    await assertSucceeds(sug(['https://firebasestorage.googleapis.com/v0/b/proptracker-9732e.appspot.com/o/request-photos%2Fcreator%40example.com%2Fa.jpg?alt=media&token=t']))
    await assertFails(sug(['javascript:alert(1)']))
    await assertFails(sug(['https://evil.example/login']))
    await assertFails(sug(['https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fa.jpg']))
  })
})

describe('nobody can make themselves more powerful', () => {
  const tryUser = (w: Who, email: string, data: Record<string, unknown>) => setDoc(doc(db(w), 'users', email), { email, active: true, ...data })
  it('a creator cannot promote themselves, switch to the full app, or invite people', async () => {
    await assertFails(tryUser('creator', P.creator, { role: 'owner', access: 'full' }))
    await assertFails(tryUser('demo', P.demo, { role: 'creator', access: 'full' }))
    await assertFails(tryUser('creator', 'friend@example.com', { role: 'creator' }))
    await assertFails(updateDoc(doc(db('creator'), 'users', P.creator), { role: 'admin' }))
  })
  it('a stranger cannot create their own account record', async () => {
    await assertFails(tryUser('stranger', P.stranger, { role: 'creator', access: 'props' }))
  })
  it('a turned-off person cannot turn themselves back on', async () => {
    await assertFails(updateDoc(doc(db('gone'), 'users', P.gone), { active: true }))
  })
  it('an admin can only invite creators on Props only, never staff, never change access', async () => {
    await assertSucceeds(tryUser('admin', 'new@example.com', { role: 'creator', access: 'props' }))
    await assertFails(tryUser('admin', 'new2@example.com', { role: 'creator', access: 'full' }))
    await assertFails(tryUser('admin', 'new3@example.com', { role: 'admin' }))
    await assertFails(tryUser('admin', 'new4@example.com', { role: 'owner' }))
    await assertFails(updateDoc(doc(db('admin'), 'users', P.demo), { access: 'full' }))
    await assertFails(updateDoc(doc(db('admin'), 'users', P.arts), { active: false }))
    await assertFails(updateDoc(doc(db('admin'), 'users', P.admin), { role: 'owner' }))
  })
  it('arts and equipment cannot invite or change anyone', async () => {
    await assertFails(tryUser('arts', 'x1@example.com', { role: 'creator' }))
    await assertFails(tryUser('gear', 'x2@example.com', { role: 'creator' }))
    await assertFails(updateDoc(doc(db('arts'), 'users', P.creator), { access: 'full' }))
  })
  it('arts cannot turn a company prop into the owner\'s personal one, read personal props, or sign as someone else', async () => {
    await assertFails(updateDoc(doc(db('arts'), 'items', 'd1'), { collection: 'personal', updatedBy: uid(P.arts) }))
    await assertFails(getDoc(doc(db('arts'), 'items', 'personal1')))
    await assertFails(updateDoc(doc(db('arts'), 'items', 'd1'), { name: 'x', updatedBy: uid(P.creator) }))
  })
  it('creators cannot change props, settings or someone else\'s profile', async () => {
    await assertFails(updateDoc(doc(db('creator'), 'items', 'd1'), { name: 'Hacked', updatedBy: uid(P.creator) }))
    await assertFails(setDoc(doc(db('creator'), 'app_settings', 'booking'), { leadTimeHours: 0 }))
    await assertFails(setDoc(doc(db('creator'), 'app_settings', 'schedule'), { instantBookers: [{ email: P.creator, name: 'me' }] }))
    await assertFails(setDoc(doc(db('creator'), 'profiles', P.other), { channel: 'pwned' }))
  })
  it('settings with money or secrets are owner-only to read', async () => {
    for (const w of ['creator', 'demo', 'arts', 'gear', 'admin'] as Who[]) {
      await assertFails(getDoc(doc(db(w), 'app_settings', 'ai')))
      await assertFails(getDoc(doc(db(w), 'app_settings', 'email')))
    }
    await assertSucceeds(getDoc(doc(db('owner'), 'app_settings', 'ai')))
  })
})
