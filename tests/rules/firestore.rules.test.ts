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

let env: RulesTestEnvironment

const uid = (email: string) => email.replace(/\W/g, '_')
function as(email: string, verified = true) {
  return env.authenticatedContext(uid(email), { email, email_verified: verified }).firestore()
}
const by = (email: string) => ({ updatedBy: uid(email) })

const item = { name: 'Cop costume', quantity: 1, condition: 'good', replacementCost: 250, tags: [], photos: [] }

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
    await assertSucceeds(setDoc(doc(as(ARTS), 'items', 'old'), { name: 'Old prop', tags: [], status: 'available', ...by(ARTS) }))
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
