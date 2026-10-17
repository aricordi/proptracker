import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

// Runs only against the local emulator ("demo-" projects never touch live Firebase).
const PROJECT_ID = 'demo-proptracker'
const OWNER   = 'alexisricordi@gmail.com'
const ARTS    = 'arts@example.com'
const CREATOR = 'creator@example.com'
const GONE    = 'former@example.com'   // deactivated user
const STRANGER = 'stranger@example.com' // never invited
const GEAR    = 'gear@example.com'     // equipment team

let env: RulesTestEnvironment

const uid = (email: string) => email.replace(/\W/g, '_')
function as(email: string, verified = true) {
  return env.authenticatedContext(uid(email), { email, email_verified: verified }).firestore()
}
const by = (email: string) => ({ updatedBy: uid(email) })

const item = { name: 'Cop costume', quantity: 1, condition: 'good', replacementCost: 250, tags: [], photos: [], collection: 'company' }

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { await env?.cleanup() })

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    const u = (email: string, role: string, active = true) =>
      setDoc(doc(db, 'users', email), { email, role, active })
    await u(ARTS, 'arts')
    await u(CREATOR, 'creator')
    await u(GEAR, 'equipment')
    await u(GONE, 'arts', false)
    await setDoc(doc(db, 'items', 'cop'), item)
    await setDoc(doc(db, 'categories', 'prop'), { label: 'Prop', order: 0, active: true })
    await setDoc(doc(db, 'characters', 'c1'), { label: 'Detective' })
    await setDoc(doc(db, 'video_checklists', 'v1'), { videoTitle: 'Old video' })
  })
})

describe('who can get in', () => {
  it('owner email gets in even without a users record', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'items', 'cop')))
  })
  it('uninvited people are locked out', async () => {
    await assertFails(getDoc(doc(as(STRANGER), 'items', 'cop')))
  })
  it('deactivated people are locked out', async () => {
    await assertFails(getDoc(doc(as(GONE), 'items', 'cop')))
  })
  it('signed-out visitors are locked out', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'items', 'cop')))
  })
  it('unverified emails are locked out (even the owner address)', async () => {
    await assertFails(getDoc(doc(as(OWNER, false), 'items', 'cop')))
  })
  it('email matching ignores capital letters', async () => {
    await assertSucceeds(getDoc(doc(as('Creator@Example.com'), 'items', 'cop')))
  })
})

describe('inventory', () => {
  it('creators can view props', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'items', 'cop')))
    await assertSucceeds(getDoc(doc(as(CREATOR), 'categories', 'prop')))
  })
  it('creators cannot add, edit or archive props', async () => {
    await assertFails(setDoc(doc(as(CREATOR), 'items', 'new'), item))
    await assertFails(updateDoc(doc(as(CREATOR), 'items', 'cop'), { name: 'Hacked' }))
    await assertFails(updateDoc(doc(as(CREATOR), 'items', 'cop'), { archived: true }))
  })
  it('creators cannot edit categories, bins, locations or tags', async () => {
    const db = as(CREATOR)
    await assertFails(setDoc(doc(db, 'categories', 'x'), { label: 'X' }))
    await assertFails(setDoc(doc(db, 'bins', 'x'), { label: 'X' }))
    await assertFails(setDoc(doc(db, 'locations', 'x'), { name: 'X' }))
    await assertFails(setDoc(doc(db, 'tags', 'x'), { label: 'X' }))
  })
  it('arts can set a category turnaround (0–30 whole days); creators cannot', async () => {
    await assertSucceeds(updateDoc(doc(as(ARTS), 'categories', 'prop'), { turnaroundDays: 2 }))
    await assertFails(updateDoc(doc(as(ARTS), 'categories', 'prop'), { turnaroundDays: -1 }))
    await assertFails(updateDoc(doc(as(ARTS), 'categories', 'prop'), { turnaroundDays: 1.5 }))
    await assertFails(updateDoc(doc(as(CREATOR), 'categories', 'prop'), { turnaroundDays: 0 }))
  })
  it('creators cannot see characters (arts-only field)', async () => {
    await assertFails(getDoc(doc(as(CREATOR), 'characters', 'c1')))
  })
  it('arts department can add and edit props', async () => {
    await assertSucceeds(setDoc(doc(as(ARTS), 'items', 'chairs'), { ...item, name: 'Chair', quantity: 10, ...by(ARTS) }))
    await assertSucceeds(updateDoc(doc(as(ARTS), 'items', 'cop'), { archived: true, ...by(ARTS) }))
  })
  it('every prop change must say who made it (for the activity log)', async () => {
    await assertFails(updateDoc(doc(as(ARTS), 'items', 'cop'), { archived: true }))
    await assertFails(updateDoc(doc(as(ARTS), 'items', 'cop'), { archived: true, ...by(OWNER) }))
  })
  it('suggested edits: creators suggest in their own name; only the arts department resolves them', async () => {
    const mine = { itemId: 'cop', itemName: 'Cop costume', by: CREATOR, byName: 'Riley', at: '2026-10-13', status: 'open', message: 'Sleeve is torn', changes: { condition: 'damaged' } }
    await assertSucceeds(setDoc(doc(as(CREATOR), 'suggestions', 's1'), mine))
    await assertFails(setDoc(doc(as(CREATOR), 'suggestions', 's2'), { ...mine, by: ARTS }))            // not in someone else's name
    await assertFails(setDoc(doc(as(CREATOR), 'suggestions', 's3'), { ...mine, status: 'applied' }))   // can't pre-approve
    await assertFails(setDoc(doc(as(CREATOR), 'suggestions', 's4'), { ...mine, message: '' }))
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'items', 'mine'), { name: 'My lamp', tags: [] }) })
    await assertFails(setDoc(doc(as(CREATOR), 'suggestions', 's5'), { ...mine, itemId: 'mine' }))      // personal prop: invisible to them
    await assertSucceeds(getDoc(doc(as(CREATOR), 'suggestions', 's1')))
    await assertSucceeds(getDoc(doc(as(ARTS), 'suggestions', 's1')))
    await assertFails(updateDoc(doc(as(CREATOR), 'suggestions', 's1'), { status: 'applied' }))
    await assertFails(updateDoc(doc(as(ARTS), 'suggestions', 's1'), { message: 'changed' }))
    await assertSucceeds(updateDoc(doc(as(ARTS), 'suggestions', 's1'), { status: 'dismissed', resolvedBy: ARTS, resolvedAt: 'x', reply: 'It was already fixed' }))
    await assertFails(deleteDoc(doc(as(OWNER), 'suggestions', 's1')))
  })
  it('import records are read-only, and only the arts department can see them', async () => {
    await assertSucceeds(getDoc(doc(as(ARTS), 'import_items', 'f1')))
    await assertSucceeds(getDoc(doc(as(ARTS), 'import_jobs', 'j1')))
    await assertFails(getDoc(doc(as(CREATOR), 'import_items', 'f1')))
    await assertFails(setDoc(doc(as(OWNER), 'import_items', 'f1'), { status: 'approved' }))
  })
  it("the owner's personal props: only the owner can see, add or change them", async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'items', 'mine'), { name: 'My lamp', tags: [] })   // no collection = personal
      await setDoc(doc(db, 'item_private', 'mine'), { internalNotes: 'from grandma' })
    })
    await assertSucceeds(getDoc(doc(as(OWNER), 'items', 'mine')))
    await assertFails(getDoc(doc(as(ARTS), 'items', 'mine')))
    await assertFails(getDoc(doc(as(CREATOR), 'items', 'mine')))
    await assertFails(getDoc(doc(as(ARTS), 'item_private', 'mine')))
    await assertSucceeds(getDoc(doc(as(OWNER), 'item_private', 'mine')))
    await assertFails(setDoc(doc(as(ARTS), 'items', 'p2'), { ...item, collection: 'personal', ...by(ARTS) }))
    await assertFails(setDoc(doc(as(ARTS), 'items', 'p3'), { name: 'No collection', tags: [], ...by(ARTS) }))
    await assertFails(updateDoc(doc(as(ARTS), 'items', 'cop'), { collection: 'personal', ...by(ARTS) }))
    await assertSucceeds(setDoc(doc(as(OWNER), 'items', 'p4'), { ...item, collection: 'personal', ...by(OWNER) }))
    await assertSucceeds(updateDoc(doc(as(OWNER), 'items', 'mine'), { collection: 'company', ...by(OWNER) }))
    await assertFails(setDoc(doc(as(OWNER), 'items', 'p5'), { ...item, collection: 'secret', ...by(OWNER) }))
    await assertSucceeds(getDoc(doc(as(OWNER), 'activity_personal', 'x')))
    await assertFails(getDoc(doc(as(ARTS), 'activity_personal', 'x')))
  })
  it('lists of props: everyone else must ask for Prime Capitol props only', async () => {
    const { collection, query, where, getDocs } = await import('firebase/firestore')
    await assertFails(getDocs(collection(as(CREATOR), 'items')))
    await assertSucceeds(getDocs(query(collection(as(CREATOR), 'items'), where('collection', '==', 'company'))))
    await assertSucceeds(getDocs(collection(as(OWNER), 'items')))
  })
  it('the activity log is read-only, and only the arts department can see it', async () => {
    await assertSucceeds(getDoc(doc(as(ARTS), 'activity', 'a1')))
    await assertFails(getDoc(doc(as(CREATOR), 'activity', 'a1')))
    await assertFails(setDoc(doc(as(OWNER), 'activity', 'a1'), { action: 'fake' }))
  })
  it('nobody can permanently delete a prop', async () => {
    await assertFails(deleteDoc(doc(as(ARTS), 'items', 'cop')))
    await assertFails(deleteDoc(doc(as(OWNER), 'items', 'cop')))
  })
  it('rejects bad prop data', async () => {
    const db = as(ARTS)
    await assertFails(setDoc(doc(db, 'items', 'a'), { ...item, name: '' }))
    await assertFails(setDoc(doc(db, 'items', 'b'), { ...item, quantity: 0 }))
    await assertFails(setDoc(doc(db, 'items', 'c'), { ...item, quantity: 1.5 }))
    await assertFails(setDoc(doc(db, 'items', 'd'), { ...item, condition: 'great' }))
    await assertFails(setDoc(doc(db, 'items', 'e'), { ...item, replacementCost: -5 }))
  })
  it('accepts old-style props with no new fields', async () => {
    await assertSucceeds(setDoc(doc(as(ARTS), 'items', 'old'), { name: 'Old prop', tags: [], status: 'available', collection: 'company', ...by(ARTS) }))
  })
})

describe('users and invites', () => {
  const invite = (email: string, role: string) => ({ email, role, active: true })

  it('arts can invite a creator', async () => {
    await assertSucceeds(setDoc(doc(as(ARTS), 'users', 'new@example.com'), invite('new@example.com', 'creator')))
  })
  it('arts cannot invite staff or make themselves owner', async () => {
    await assertFails(setDoc(doc(as(ARTS), 'users', 'new@example.com'), invite('new@example.com', 'arts')))
    await assertFails(updateDoc(doc(as(ARTS), 'users', ARTS), { role: 'owner' }))
  })
  it('arts cannot promote a creator', async () => {
    await assertFails(updateDoc(doc(as(ARTS), 'users', CREATOR), { role: 'arts' }))
  })
  it('arts can deactivate a creator', async () => {
    await assertSucceeds(updateDoc(doc(as(ARTS), 'users', CREATOR), { active: false }))
  })
  it('owner can invite staff and change roles', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'users', 'lead@example.com'), invite('lead@example.com', 'arts')))
    await assertSucceeds(updateDoc(doc(as(OWNER), 'users', CREATOR), { role: 'arts' }))
  })
  it('creators cannot invite anyone or change their own role', async () => {
    await assertFails(setDoc(doc(as(CREATOR), 'users', 'pal@example.com'), invite('pal@example.com', 'creator')))
    await assertFails(updateDoc(doc(as(CREATOR), 'users', CREATOR), { role: 'arts' }))
  })
  it('creators can read only their own record', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'users', CREATOR)))
    await assertFails(getDoc(doc(as(CREATOR), 'users', ARTS)))
  })
  it('the record key must match the email, in lowercase', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'users', 'a@example.com'), invite('b@example.com', 'creator')))
    await assertFails(setDoc(doc(as(OWNER), 'users', 'Caps@example.com'), invite('Caps@example.com', 'creator')))
  })
  it('only the owner can add someone to the equipment team', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'users', 'grip@example.com'), invite('grip@example.com', 'equipment')))
    await assertFails(setDoc(doc(as(ARTS), 'users', 'grip2@example.com'), invite('grip2@example.com', 'equipment')))
    await assertFails(setDoc(doc(as(OWNER), 'users', 'x@example.com'), invite('x@example.com', 'janitor')))
  })
  it('nobody can delete a user record', async () => {
    await assertFails(deleteDoc(doc(as(OWNER), 'users', CREATOR)))
  })
})

describe('internal notes and server-only data', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'item_private', 'cop'), { internalNotes: 'Bought at estate sale' })
      await setDoc(doc(db, 'item_vectors', 'cop'), { textHash: 'x' })
      await setDoc(doc(db, 'ai_usage', '2026-10'), { photoAnalyses: 1 })
    })
  })
  it('creators cannot read internal notes', async () => {
    await assertFails(getDoc(doc(as(CREATOR), 'item_private', 'cop')))
  })
  it('arts department can read and write internal notes', async () => {
    await assertSucceeds(getDoc(doc(as(ARTS), 'item_private', 'cop')))
    await assertSucceeds(setDoc(doc(as(ARTS), 'item_private', 'cop'), { internalNotes: 'Repaired 2026' }))
  })
  it('nobody in the app can read or change search fingerprints', async () => {
    await assertFails(getDoc(doc(as(OWNER), 'item_vectors', 'cop')))
    await assertFails(setDoc(doc(as(OWNER), 'item_vectors', 'cop'), { textHash: 'y' }))
  })
  it('staff can read AI usage but nobody can fake it', async () => {
    await assertSucceeds(getDoc(doc(as(ARTS), 'ai_usage', '2026-10')))
    await assertFails(getDoc(doc(as(CREATOR), 'ai_usage', '2026-10')))
    await assertFails(setDoc(doc(as(OWNER), 'ai_usage', '2026-10'), { photoAnalyses: 0 }))
  })
})

describe('reservations', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'reservations', 'mine'), { creatorEmail: CREATOR, status: 'requested' })
      await setDoc(doc(db, 'reservations', 'theirs'), { creatorEmail: 'other@example.com', status: 'requested' })
      await setDoc(doc(db, 'item_bookings', 'cop'), { entries: [] })
    })
  })
  it('creators can read their own reservations only', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'reservations', 'mine')))
    await assertFails(getDoc(doc(as(CREATOR), 'reservations', 'theirs')))
  })
  it('staff can read every reservation', async () => {
    await assertSucceeds(getDoc(doc(as(ARTS), 'reservations', 'theirs')))
  })
  it('nobody can write reservations or bookings directly (only the server can)', async () => {
    await assertFails(setDoc(doc(as(CREATOR), 'reservations', 'new'), { creatorEmail: CREATOR, status: 'requested' }))
    await assertFails(updateDoc(doc(as(CREATOR), 'reservations', 'mine'), { status: 'cancelled' }))
    await assertFails(setDoc(doc(as(OWNER), 'item_bookings', 'cop'), { entries: [] }))
  })
  it('everyone signed in can see which dates are booked', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'item_bookings', 'cop')))
    await assertFails(getDoc(doc(as(STRANGER), 'item_bookings', 'cop')))
  })
  it('arts can change lead time and turnaround, within limits', async () => {
    await assertSucceeds(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { leadTimeDays: 2, bufferDays: 0 }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { leadTimeDays: -1, bufferDays: 0 }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { leadTimeDays: 2.5, bufferDays: 0 }))
    await assertSucceeds(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { leadTimeDays: 2, bufferDays: 1, maxDays: 3 }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { leadTimeDays: 2, bufferDays: 1, maxDays: 0 }))
    await assertFails(setDoc(doc(as(CREATOR), 'app_settings', 'booking'), { leadTimeDays: 0, bufferDays: 0 }))
  })
  it('arts can set the days the prop room is closed; creators cannot', async () => {
    const base = { leadTimeDays: 3, bufferDays: 1, maxDays: 1 }
    await assertSucceeds(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { ...base, closedWeekdays: [0], closedDates: ['2026-12-25'] }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { ...base, closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'booking'), { ...base, closedWeekdays: 'sunday' }))
    await assertFails(setDoc(doc(as(CREATOR), 'app_settings', 'booking'), { ...base, closedWeekdays: [] }))
  })
})

describe('everything else', () => {
  it('only the owner can see the email log, and nobody can write to it from the app', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'outbox', 'm1')))
    await assertFails(getDoc(doc(as(ARTS), 'outbox', 'm1')))
    await assertFails(getDoc(doc(as(CREATOR), 'outbox', 'm1')))
    await assertFails(setDoc(doc(as(OWNER), 'outbox', 'm1'), { to: 'x@example.com' }))
  })
  it('only the owner can change email settings', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'app_settings', 'email'), { enabled: true, host: 'smtp.gmail.com' }))
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'email'), { enabled: false }))
  })
  it('old Videos data is kept and only the owner can read it', async () => {
    await assertSucceeds(getDoc(doc(as(OWNER), 'video_checklists', 'v1')))
    await assertFails(getDoc(doc(as(ARTS), 'video_checklists', 'v1')))
    await assertFails(setDoc(doc(as(OWNER), 'video_checklists', 'v1'), { videoTitle: 'x' }))
  })
  it('only the owner can change app settings', async () => {
    await assertFails(setDoc(doc(as(ARTS), 'app_settings', 'general'), { leadTimeDays: 2 }))
    await assertSucceeds(setDoc(doc(as(OWNER), 'app_settings', 'general'), { leadTimeDays: 2 }))
  })
})

describe('gear (equipment team)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'gear_items', 'bat'), { name: 'Battery', have: 6, value: 79 })
      await setDoc(doc(db, 'gear_bundles', 'b1'), { name: 'FX3 Bundle', pieces: [{ itemId: 'bat', qty: 2 }] })
    })
  })
  it('the gear list (with values) is for the owner and the equipment team only', async () => {
    await assertSucceeds(getDoc(doc(as(GEAR), 'gear_items', 'bat')))
    await assertSucceeds(getDoc(doc(as(OWNER), 'gear_items', 'bat')))
    await assertFails(getDoc(doc(as(ARTS), 'gear_items', 'bat')))
    await assertFails(getDoc(doc(as(CREATOR), 'gear_items', 'bat')))
  })
  it('everyone signed in can see bundles; strangers cannot', async () => {
    for (const who of [GEAR, OWNER, ARTS, CREATOR]) await assertSucceeds(getDoc(doc(as(who), 'gear_bundles', 'b1')))
    await assertFails(getDoc(doc(as(STRANGER), 'gear_bundles', 'b1')))
  })
  it('nobody writes gear directly (only the server, which keeps pieces in one bundle at a time)', async () => {
    await assertFails(setDoc(doc(as(GEAR), 'gear_items', 'new'), { name: 'X', have: 1 }))
    await assertFails(updateDoc(doc(as(OWNER), 'gear_bundles', 'b1'), { name: 'Hacked' }))
  })
  it('the equipment team cannot see props', async () => {
    await assertFails(getDoc(doc(as(GEAR), 'items', 'cop')))
  })
})

describe('gear bookings', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'gear_bookings', 'g1'), { creatorEmail: CREATOR, status: 'held' })
      await setDoc(doc(db, 'gear_holds', 'b1'), { entries: [] })
    })
  })
  it('creators see their own gear bookings; the equipment team and owner see all; arts only their own', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'gear_bookings', 'g1')))
    await assertSucceeds(getDoc(doc(as(GEAR), 'gear_bookings', 'g1')))
    await assertSucceeds(getDoc(doc(as(OWNER), 'gear_bookings', 'g1')))
    await assertFails(getDoc(doc(as(ARTS), 'gear_bookings', 'g1')))
    await assertFails(getDoc(doc(as(STRANGER), 'gear_bookings', 'g1')))
  })
  it('holds (times only) are visible to members; nobody writes bookings or holds directly', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'gear_holds', 'b1')))
    await assertFails(setDoc(doc(as(CREATOR), 'gear_holds', 'b1'), { entries: [] }))
    await assertFails(setDoc(doc(as(CREATOR), 'gear_bookings', 'new'), { creatorEmail: CREATOR, status: 'held' }))
  })
})

describe('house schedule', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'schedule_days', '2026-11-06'), { date: '2026-11-06', cliff1: { 780: { shootId: 's1', name: 'Ana', kind: 'monthly' } } })
      await setDoc(doc(db, 'shoots', 's1'), { creatorEmail: CREATOR, status: 'booked' })
      await setDoc(doc(db, 'shoots', 's2'), { creatorEmail: 'someone@example.com', status: 'booked' })
      await setDoc(doc(db, 'app_settings', 'schedule'), { monthlySlots: 4 })
    })
  })
  it('everyone in the company sees the schedule; strangers do not; nobody writes it directly', async () => {
    for (const who of [CREATOR, ARTS, GEAR, OWNER]) await assertSucceeds(getDoc(doc(as(who), 'schedule_days', '2026-11-06')))
    await assertFails(getDoc(doc(as(STRANGER), 'schedule_days', '2026-11-06')))
    await assertFails(setDoc(doc(as(GEAR), 'schedule_days', '2026-11-07'), { date: '2026-11-07' }))
    await assertFails(setDoc(doc(as(CREATOR), 'schedule_days', '2026-11-07'), { date: '2026-11-07' }))
  })
  it('creators read only their own shoots; the schedule team and owner read all', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'shoots', 's1')))
    await assertFails(getDoc(doc(as(CREATOR), 'shoots', 's2')))
    await assertSucceeds(getDoc(doc(as(GEAR), 'shoots', 's2')))
    await assertSucceeds(getDoc(doc(as(OWNER), 'shoots', 's2')))
    await assertFails(setDoc(doc(as(CREATOR), 'shoots', 's3'), { creatorEmail: CREATOR, status: 'booked' }))
  })
  it('the equipment team can read the schedule settings (but not other settings)', async () => {
    await assertSucceeds(getDoc(doc(as(GEAR), 'app_settings', 'schedule')))
    await assertFails(getDoc(doc(as(GEAR), 'app_settings', 'booking')))
    await assertFails(setDoc(doc(as(GEAR), 'app_settings', 'schedule'), { monthlySlots: 9 }))
  })
})

describe('swap requests and profiles', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'swap_requests', 'w1'), { fromEmail: CREATOR, toEmail: 'other@example.com', status: 'pending' })
      await setDoc(doc(db, 'swap_requests', 'w2'), { fromEmail: 'a@example.com', toEmail: 'b@example.com', status: 'pending' })
    })
  })
  it('only the two people (and the schedule team) see a swap request; nobody writes them directly', async () => {
    await assertSucceeds(getDoc(doc(as(CREATOR), 'swap_requests', 'w1')))
    await assertFails(getDoc(doc(as(CREATOR), 'swap_requests', 'w2')))
    await assertSucceeds(getDoc(doc(as(GEAR), 'swap_requests', 'w2')))
    await assertFails(setDoc(doc(as(CREATOR), 'swap_requests', 'w3'), { fromEmail: CREATOR, status: 'accepted' }))
  })
  it('you edit your own profile (photo + channel name) and everyone sees it; the team can tidy anyone\'s', async () => {
    await assertSucceeds(setDoc(doc(as(CREATOR), 'profiles', CREATOR), { photoURL: 'https://x/y.jpg', channel: '@riley' }))
    await assertSucceeds(getDoc(doc(as(ARTS), 'profiles', CREATOR)))
    await assertSucceeds(getDoc(doc(as(GEAR), 'profiles', CREATOR)))
    await assertFails(setDoc(doc(as(ARTS), 'profiles', CREATOR), { photoURL: '' }))
    await assertSucceeds(setDoc(doc(as(GEAR), 'profiles', CREATOR), { photoURL: '', channel: '@riley' }))
    await assertFails(setDoc(doc(as(CREATOR), 'profiles', CREATOR), { photoURL: '', role: 'owner' }))
    await assertFails(setDoc(doc(as(CREATOR), 'profiles', CREATOR), { channel: 'x'.repeat(61) }))
    await assertFails(getDoc(doc(as(STRANGER), 'profiles', CREATOR)))
  })
})
