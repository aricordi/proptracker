import { describe, it, expect } from 'vitest'
import { isStorageLink, storageLinks } from '../../functions/src/storageLinks'

const OWN = 'https://firebasestorage.googleapis.com/v0/b/proptracker-9732e.appspot.com/o/guidelines%2Fana%40example.com%2Fx.pdf?alt=media&token=t'

describe('storage links', () => {
  it('only the app storage (or the emulator) counts', () => {
    expect(isStorageLink(OWN)).toBe(true)
    expect(isStorageLink('http://127.0.0.1:9199/v0/b/demo/o/shoot-photos%2Fs1%2Fp.jpg?alt=media')).toBe(true)
    expect(isStorageLink('https://evil.example/guidelines/x.pdf')).toBe(false)
    expect(isStorageLink('https://firebasestorage.googleapis.com.evil.example/x')).toBe(false)
    expect(isStorageLink(42)).toBe(false)
  })
  it('a folder must match exactly (encoded email)', () => {
    expect(isStorageLink(OWN, 'guidelines/ana@example.com/')).toBe(true)
    expect(isStorageLink(OWN, 'guidelines/jana@example.com/')).toBe(false)
    expect(isStorageLink(OWN, 'guidelines/a/')).toBe(false)
  })
  it('lists keep only good links, capped', () => {
    expect(storageLinks([OWN, 'https://x/y.jpg', OWN, OWN], 2)).toEqual([OWN, OWN])
    expect(storageLinks('nope', 3)).toEqual([])
  })
})
