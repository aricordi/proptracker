// The weekly photo clean-up: what it keeps and what it removes.
import { describe, it, expect } from 'vitest'
import { cleanupReason, pathFromUrl } from '../../functions/src/costs'

describe('photo clean-up rules', () => {
  it('never touches a photo something still uses (unless it is a proof photo over 6 months)', () => {
    expect(cleanupReason('items/u1/chair.jpg', 400, true)).toBeNull()
    expect(cleanupReason('thumbs/abc.jpg', 400, true)).toBeNull()
    expect(cleanupReason('avatars/a@b.com/1.jpg', 400, true)).toBeNull()
  })
  it('removes unused photos only after 14 days', () => {
    expect(cleanupReason('items/u1/old.jpg', 3, false)).toBeNull()
    expect(cleanupReason('items/u1/old.jpg', 15, false)).toBe('unused')
    expect(cleanupReason('request-photos/a@b.com/x.jpg', 20, false)).toBe('unused')
  })
  it('removes proof photos after about 6 months, used or not', () => {
    expect(cleanupReason('reservation-photos/r1/pack/1.jpg', 100, true)).toBeNull()
    expect(cleanupReason('reservation-photos/r1/pack/1.jpg', 190, true)).toBe('old-proof')
    expect(cleanupReason('gear-returns/g1/1.jpg', 190, true)).toBe('old-proof')
    expect(cleanupReason('shoot-photos/s1/1.jpg', 190, true)).toBe('old-proof')
  })
  it('leaves anything outside the photo folders alone', () => {
    expect(cleanupReason('backups/x', 999, false)).toBeNull()
    expect(cleanupReason('something.txt', 999, false)).toBeNull()
    expect(cleanupReason('items/x.jpg', NaN, false)).toBeNull()
  })
  it('reads photo links', () => {
    expect(pathFromUrl('https://firebasestorage.googleapis.com/v0/b/p.appspot.com/o/items%2Fu1%2Fa%20b.jpg?alt=media&token=t')).toBe('items/u1/a b.jpg')
    expect(pathFromUrl('http://127.0.0.1:9199/v0/b/x/o/thumbs%2Fz.jpg?alt=media')).toBe('thumbs/z.jpg')
    expect(pathFromUrl('not a link')).toBeNull()
  })
})
