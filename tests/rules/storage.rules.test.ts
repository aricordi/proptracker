import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'

const PROJECT_ID = 'demo-proptracker'
let env: RulesTestEnvironment

function storageAs(email: string) {
  return env.authenticatedContext(email.replace(/\W/g, '_'), { email, email_verified: true }).storage()
}
const png = new Uint8Array([137, 80, 78, 71])

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage:   { rules: readFileSync('storage.rules', 'utf8'),   host: '127.0.0.1', port: 9199 },
  })
})
afterAll(async () => { await env?.cleanup() })

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'arts@example.com'), { email: 'arts@example.com', role: 'arts', active: true })
    await setDoc(doc(db, 'users', 'creator@example.com'), { email: 'creator@example.com', role: 'creator', active: true })
    await setDoc(doc(db, 'reservations', 'res1'), { creatorEmail: 'creator@example.com', status: 'packed' })
    await uploadBytes(ref(ctx.storage(), 'items/x/photo.png'), png, { contentType: 'image/png' })
    await uploadBytes(ref(ctx.storage(), 'reservation-photos/res1/pack/p.png'), png, { contentType: 'image/png' })
  })
})

describe('prop photos', () => {
  it('arts department can upload photos', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('arts@example.com'), 'items/a/new.png'), png, { contentType: 'image/png' }))
  })
  it('only images can be uploaded', async () => {
    await assertFails(uploadBytes(ref(storageAs('arts@example.com'), 'items/a/new.txt'), png, { contentType: 'text/plain' }))
  })
  it('creators can view but not upload photos', async () => {
    await assertSucceeds(getBytes(ref(storageAs('creator@example.com'), 'items/x/photo.png')))
    await assertFails(uploadBytes(ref(storageAs('creator@example.com'), 'items/c/new.png'), png, { contentType: 'image/png' }))
  })
  it('uninvited people cannot view photos', async () => {
    await assertFails(getBytes(ref(storageAs('stranger@example.com'), 'items/x/photo.png')))
  })
  it('nobody can delete photos', async () => {
    await assertFails(deleteObject(ref(storageAs('arts@example.com'), 'items/x/photo.png')))
  })
})

describe('booking proof photos', () => {
  const img = { contentType: 'image/png' }
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', 'other@example.com'), { email: 'other@example.com', role: 'creator', active: true })
    })
  })
  it('only the arts department can upload pack photos', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('arts@example.com'), 'reservation-photos/res1/pack/a.png'), png, img))
    await assertFails(uploadBytes(ref(storageAs('creator@example.com'), 'reservation-photos/res1/pack/a.png'), png, img))
  })
  it('the creator who booked can upload return photos; other creators cannot', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('creator@example.com'), 'reservation-photos/res1/return/r.png'), png, img))
    await assertFails(uploadBytes(ref(storageAs('other@example.com'), 'reservation-photos/res1/return/r.png'), png, img))
  })
  it('the creator who booked can see the pack photos; other creators cannot', async () => {
    await assertSucceeds(getBytes(ref(storageAs('creator@example.com'), 'reservation-photos/res1/pack/p.png')))
    await assertFails(getBytes(ref(storageAs('other@example.com'), 'reservation-photos/res1/pack/p.png')))
  })
  it('proof photos can never be replaced or deleted', async () => {
    await assertFails(uploadBytes(ref(storageAs('arts@example.com'), 'reservation-photos/res1/pack/p.png'), png, img))
    await assertFails(deleteObject(ref(storageAs('arts@example.com'), 'reservation-photos/res1/pack/p.png')))
  })
  it('creators can attach reference photos only under their own email', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('creator@example.com'), 'request-photos/creator@example.com/x.png'), png, img))
    await assertFails(uploadBytes(ref(storageAs('creator@example.com'), 'request-photos/other@example.com/x.png'), png, img))
  })
})
