// Small list photos (owner: "pictures are loading too slow"): every prop photo gets a
// ~480px thumbnail, recorded on the prop as thumbs[photoUrl].
import { beforeEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { put, call, getDoc, clearDatabase, waitFor } from './helpers'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'thumb-arts@example.com'
const BUCKET = 'demo-proptracker.appspot.com'
const BIG = readFileSync('public/icons/icon-512.png')   // a real 512px image

async function upload(path: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'image/png' }, body: BIG,
  })
  const meta = await res.json() as { downloadTokens: string }
  return `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${meta.downloadTokens}`
}
const prop = (photos: string[]) => ({ collection: 'company', name: 'Lamp', quantity: 1, condition: 'good', tags: [], photos })

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true })
})

describe('thumbnails', () => {
  it('a new prop photo gets a small JPEG version automatically', async () => {
    const url = await upload(`items/t/${Math.random()}.png`)
    await put('items/lamp', prop([url]))
    expect(await waitFor(async () => !!(await getDoc('items/lamp'))?.thumbs?.[url])).toBe(true)
    const thumb = (await getDoc('items/lamp'))!.thumbs[url] as string
    const res = await fetch(thumb)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('image/jpeg')
    const bytes = (await res.arrayBuffer()).byteLength
    expect(bytes).toBeGreaterThan(500)
    expect(bytes).toBeLessThan(BIG.length)
  })

  it('only the current photos keep a thumbnail; a broken photo is skipped (full photo still shows)', async () => {
    const a = await upload(`items/t/${Math.random()}.png`)
    await put('items/lamp', prop([a, 'http://127.0.0.1:9199/nope.jpg']))
    expect(await waitFor(async () => !!(await getDoc('items/lamp'))?.thumbs?.[a])).toBe(true)
    const t = (await getDoc('items/lamp'))!.thumbs
    expect(Object.keys(t)).toEqual([a])
  })

  it('"Speed up photos" is owner-only and fills in props that have none', async () => {
    expect((await call('makeMissingThumbs', { countOnly: true }, ARTS)).error).toBe('PERMISSION_DENIED')
    const r = await call('makeMissingThumbs', {}, OWNER)
    expect(r.result).toMatchObject({ remaining: 0 })
  })
})
