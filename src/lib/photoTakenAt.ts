// When was this photo taken? Reads the date the camera writes inside a JPEG
// (EXIF "DateTimeOriginal", else "DateTime"). Screenshots, photos saved from
// messaging apps and edited photos often have none → null.
// Must run BEFORE shrinkPhoto(): re-drawing the photo drops this information.
export async function photoTakenAt(file: Blob): Promise<string | null> {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    return exifDate(buf)
  } catch {
    return null
  }
}

// Exported for tests. Returns an ISO date (phone's local time) or null.
export function exifDate(v: DataView): string | null {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null   // not a JPEG
  let p = 2
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return null
    const marker = v.getUint8(p + 1), len = v.getUint16(p + 2)
    if (marker === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) {   // "Exif"
      return fromTiff(v, p + 10)
    }
    if (marker === 0xda) return null   // image data starts: no EXIF block
    p += 2 + len
  }
  return null
}

function fromTiff(v: DataView, t: number): string | null {
  const little = v.getUint16(t) === 0x4949
  const u16 = (o: number) => v.getUint16(t + o, little)
  const u32 = (o: number) => v.getUint32(t + o, little)
  const readIfd = (o: number) => {
    const tags = new Map<number, number>()
    if (t + o + 2 > v.byteLength) return tags
    const n = u16(o)
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12
      if (t + e + 12 > v.byteLength) break
      tags.set(u16(e), e)
    }
    return tags
  }
  const text = (entry: number) => {
    const count = u32(entry + 4), at = count > 4 ? u32(entry + 8) : entry + 8
    let s = ''
    for (let i = 0; i < count && t + at + i < v.byteLength; i++) {
      const c = v.getUint8(t + at + i)
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s
  }
  const ifd0 = readIfd(u32(4))
  let raw = ''
  const exifPtr = ifd0.get(0x8769)
  if (exifPtr !== undefined) {
    const exif = readIfd(u32(exifPtr + 8))
    const orig = exif.get(0x9003) ?? exif.get(0x9004)
    if (orig !== undefined) raw = text(orig)
  }
  if (!raw && ifd0.has(0x0132)) raw = text(ifd0.get(0x0132)!)
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// What to show under a proof photo, given when it was taken and when it reached us.
export const OLD_PHOTO_MINUTES = 60   // owner decision Oct 14: more than 1 hour = flagged
export function photoAge(takenAt: string | null | undefined, uploadedAt: string): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const up = new Date(uploadedAt)
  if (!takenAt) return { tone: 'warn', text: 'No date on this photo (screenshot or edited?)' }
  const taken = new Date(takenAt)
  const mins = (up.getTime() - taken.getTime()) / 60000
  const clock = taken.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (mins > OLD_PHOTO_MINUTES) {
    const ago = mins < 120 ? `${Math.round(mins)} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`
    return { tone: 'bad', text: `Taken ${ago} before upload (${clock})` }
  }
  if (mins < -10) return { tone: 'warn', text: `Phone clock looks wrong (photo says ${clock})` }
  return { tone: 'ok', text: `Taken ${clock}` }
}
