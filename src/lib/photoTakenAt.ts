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

export { exifDate } from '../../functions/src/photoDate'
import { exifDate } from '../../functions/src/photoDate'

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
