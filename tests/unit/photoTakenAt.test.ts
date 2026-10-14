// Proof-photo dates (owner, Oct 14): read when a photo was taken; flag photos taken > 1 hour before upload.
import { describe, it, expect } from 'vitest'
import { exifDate, photoAge } from '../../src/lib/photoTakenAt'

// A tiny JPEG with an EXIF block holding DateTimeOriginal (big-endian TIFF).
function jpegWithDate(date: string): DataView {
  const s = date + '\0'                        // 20 bytes
  const tiff: number[] = []
  const u16 = (n: number) => tiff.push(n >> 8, n & 255)
  const u32 = (n: number) => { u16(n >>> 16); u16(n & 0xffff) }
  tiff.push(0x4d, 0x4d); u16(42); u32(8)       // "MM", magic, IFD0 at 8
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0)   // IFD0: pointer to EXIF IFD at 26
  u16(1); u16(0x9003); u16(2); u32(s.length); u32(44); u32(0)  // EXIF IFD: DateTimeOriginal at 44
  for (const c of s) tiff.push(c.charCodeAt(0))
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  const bytes = [0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]
  return new DataView(new Uint8Array(bytes).buffer)
}

describe('reading when a photo was taken', () => {
  it('finds the camera date', () => {
    const iso = exifDate(jpegWithDate('2026:10:14 09:30:05'))!
    const d = new Date(iso)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 14, 9, 30])
  })
  it('no date in screenshots / non-JPEGs', () => {
    expect(exifDate(new DataView(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer))).toBeNull()
    expect(exifDate(new DataView(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer))).toBeNull()
  })
})

describe('the stamp under a proof photo', () => {
  const up = '2026-10-14T15:00:00.000Z'
  it('fresh photo: just the time', () => expect(photoAge('2026-10-14T14:50:00.000Z', up).tone).toBe('ok'))
  it('more than 1 hour before upload: red warning', () => {
    expect(photoAge('2026-10-14T13:30:00.000Z', up)).toMatchObject({ tone: 'bad', text: expect.stringContaining('90 min before upload') })
    expect(photoAge('2026-10-11T15:00:00.000Z', up).text).toContain('3 days before upload')
  })
  it('no date: amber warning', () => expect(photoAge(null, up).tone).toBe('warn'))
})
