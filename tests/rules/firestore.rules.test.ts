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

function as(email: string, verified = true) {
  return env.authenticatedContext(email.replace(/\W/g, '_'), { email, email_verified: verified }).firestore()
}

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
  it('creators cannot see characters (arts-only field)', async () => {
    await assertFails(getDoc(doc(as(CREATOR), 'characters', 'c1')))
  })
  it('arts department can add and edit props', async () => {
    await assertSucceeds(setDoc(doc(as(ARTS), 'items', 'chairs'), { ...item, name: 'Chair', quantity: 10 }))
    await assertSucceeds(updateDoc(doc(as(ARTS), 'items', 'cop'), { archived: true }))
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
    await assertSucceeds(setDoc(doc(as(ARTS), 'items', 'old'), { name: 'Old prop', tags: [], status: 'available' }))
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

describe('everything else', () => {
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
