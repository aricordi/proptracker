// "Snap a photo, find it in the closet" (Nov 7): checking what the phone sent, boxing in the AI's answer, joining hits.
import { describe, it, expect } from 'vitest'
import { sniffImage, checkPhoto, cleanPhotoAnswer, mergeHits, PHOTO_MAX_BYTES } from '../../functions/src/photoSearchRules'

const b64 = (bytes: number[], pad = 30) => Buffer.from([...bytes, ...new Array(pad).fill(0)]).toString('base64')
const JPEG = [0xff, 0xd8, 0xff, 0xe0]

describe('photo check', () => {
  it('knows real photos by their first bytes', () => {
    expect(sniffImage(Uint8Array.from(JPEG))).toBe('image/jpeg')
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png')
    expect(sniffImage(Uint8Array.from(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')))).toBe('image/webp')
    expect(sniffImage(Uint8Array.from(Buffer.from('\0\0\0\x18ftypheic')))).toBe('image/heic')
    expect(sniffImage(Uint8Array.from(Buffer.from('%PDF-1.7')))).toBeNull()
  })
  it('accepts a photo, refuses missing, too big, and non-images (whatever the label says)', () => {
    expect(checkPhoto(b64(JPEG), 'image/jpeg')).toMatchObject({ ok: true, mimeType: 'image/jpeg' })
    expect(checkPhoto(`data:image/jpeg;base64,${b64(JPEG)}`, 'image/jpeg').ok).toBe(true)
    expect(checkPhoto('', 'image/jpeg')).toEqual({ ok: false, problem: 'missing' })
    expect(checkPhoto(undefined, 'image/jpeg')).toEqual({ ok: false, problem: 'missing' })
    expect(checkPhoto('A'.repeat(Math.ceil(PHOTO_MAX_BYTES * 4 / 3) + 8), 'image/jpeg')).toEqual({ ok: false, problem: 'too-big' })
    expect(checkPhoto(Buffer.from('%PDF-1.7 hello there').toString('base64'), 'image/jpeg')).toEqual({ ok: false, problem: 'not-image' })
    expect(checkPhoto(b64(JPEG), 'application/pdf')).toEqual({ ok: false, problem: 'not-image' })
    expect(checkPhoto('not base64!!', 'image/jpeg')).toEqual({ ok: false, problem: 'not-image' })
  })
})

describe('AI answer', () => {
  it('keeps a short description and 1–3 clean phrases', () => {
    expect(cleanPhotoAnswer({ description: 'A red rotary phone', phrases: ['Red rotary phone', 'vintage telephone', 'red rotary phone', 'old phone', 'extra'] }))
      .toEqual({ description: 'A red rotary phone', phrases: ['red rotary phone', 'vintage telephone', 'old phone'] })
    expect(cleanPhotoAnswer({ description: 'See https://evil.example <b>now</b>', phrases: [] }).description).not.toMatch(/https|</)
    expect(cleanPhotoAnswer({ description: 'A black peacoat' })).toEqual({ description: 'A black peacoat', phrases: ['black peacoat'] })
    expect(cleanPhotoAnswer({})).toEqual({ description: '', phrases: [] })
    expect(cleanPhotoAnswer({ description: 42, phrases: 'phone' })).toEqual({ description: '', phrases: [] })
  })
})

describe('joining hits', () => {
  it('best score per prop, close enough only, closest first', () => {
    expect(mergeHits([[{ id: 'a', score: 0.7 }, { id: 'b', score: 0.4 }], [{ id: 'a', score: 0.9 }, { id: 'c', score: 0.6 }]]))
      .toEqual([{ id: 'a', score: 0.9 }, { id: 'c', score: 0.6 }])
    expect(mergeHits([])).toEqual([])
  })
})
