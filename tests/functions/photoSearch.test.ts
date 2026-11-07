// "Snap a photo, find it in the closet" (Nov 7). Test mode: the AI always "sees" a red rotary phone.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, exists, waitFor, getDoc, clearDatabase } from './helpers'
import { todayInStudio } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'farrell@example.com', ANA = 'ana@example.com', DEE = 'dee@example.com', ADMIN = 'admin@example.com', GEAR = 'gear@example.com'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]).toString('base64')
const photo = { imageBase64: JPEG, mimeType: 'image/jpeg' }
const prop = (name: string, x: Record<string, unknown> = {}) => ({ name, collection: 'company', quantity: 1, condition: 'good', tags: [], photos: [], ...x })
const ids = (r: any) => (r.result.results as { id: string }[]).map(x => x.id)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Farrell' })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana', access: 'full' })
  await put(`users/${DEE}`, { email: DEE, role: 'creator', active: true, name: 'Dee', access: 'props' })
  await put(`users/${ADMIN}`, { email: ADMIN, role: 'admin', active: true, name: 'Sam' })
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true, name: 'Maanik' })
})

describe('photo search', () => {
  it('finds Prime Capitol props that look like the photo; never personal, archived or merged ones', async () => {
    await put('items/phone', prop('Red rotary phone'))
    await put('items/tel', prop('Old telephone'))
    await put('items/lamp', prop('Brass desk lamp'))
    await put('items/mine', prop('Red rotary phone', { collection: 'personal' }))
    await put('items/gone', prop('Red rotary phone', { archived: true }))
    await put('items/merged', prop('Red rotary phone', { mergedInto: 'phone' }))
    for (const id of ['phone', 'tel', 'lamp', 'mine', 'gone', 'merged']) expect(await waitFor(() => exists(`item_vectors/${id}`))).toBe(true)

    const r = await call('photoSearch', photo, ANA)
    expect(r.ok, r.message).toBe(true)
    expect(r.result.description).toBe('A red rotary phone')
    expect(ids(r)[0]).toBe('phone')
    expect(ids(r)).toContain('tel')
    for (const no of ['lamp', 'mine', 'gone', 'merged']) expect(ids(r)).not.toContain(no)
    expect(ids(await call('photoSearch', photo, OWNER))).not.toContain('mine')   // Browse only shows Prime Capitol's props

    const m = (await getDoc(`ai_usage/${todayInStudio().slice(0, 7)}`))!
    expect(m.by.photo).toBe(2)
  })

  it('owner, arts, creators and admins may; Props-only creators too (own budget slice); strangers and the gear team may not', async () => {
    for (const who of [OWNER, ARTS, ADMIN]) expect((await call('photoSearch', photo, who)).ok).toBe(true)
    expect((await call('photoSearch', photo, DEE)).ok).toBe(true)
    expect((await getDoc(`ai_usage/${todayInStudio().slice(0, 7)}`))!.demoSpentUsd).toBeGreaterThan(0)
    expect((await call('photoSearch', photo, 'stranger@example.com')).error).toBe('PERMISSION_DENIED')
    expect((await call('photoSearch', photo, GEAR)).error).toBe('PERMISSION_DENIED')
    expect((await call('photoSearch', photo)).ok).toBe(false)
  })

  it('refuses things that are not photos, or too big, before any AI is used', async () => {
    expect((await call('photoSearch', { imageBase64: Buffer.from('%PDF-1.7 not a photo').toString('base64'), mimeType: 'image/jpeg' }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('photoSearch', { imageBase64: JPEG, mimeType: 'text/plain' }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('photoSearch', { imageBase64: 'A'.repeat(5_700_000), mimeType: 'image/jpeg' }, ANA)).error).toBe('INVALID_ARGUMENT')
    expect((await call('photoSearch', {}, ANA)).error).toBe('INVALID_ARGUMENT')
    expect(await getDoc(`ai_usage/${todayInStudio().slice(0, 7)}`)).toBeNull()
  })

  it('rests when the month\'s AI budget is used up', async () => {
    await put('app_settings/ai', { monthlyCapUsd: 0 })
    expect((await call('photoSearch', photo, ANA)).message).toMatch(/resting until the 1st/)
  })
})
