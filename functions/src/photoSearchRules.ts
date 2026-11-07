// "Snap a photo, find it in the closet" (owner, Nov 7): the pure parts, shared by the server and the unit tests.
// The AI only describes what's in the photo; the closet search itself is the smart search the app already has.

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024   // after the phone shrinks it, a photo is ~150 KB; 4 MB is plenty
export const PHOTO_RESULTS_MAX = 24
export const PHOTO_MIN_SCORE = 0.5               // closeness (0–1) a prop needs to show as "looks like your photo"

const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']

/** What the photo really is, from its first bytes (the phone's label alone can't be trusted). null = not a photo. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => bytes[i + k] === x)
  const text = (i: number, s: string) => [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0))
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (text(0, 'RIFF') && text(8, 'WEBP')) return 'image/webp'
  if (text(0, 'GIF8')) return 'image/gif'
  if (text(4, 'ftyp') && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heis'].some(b => text(8, b))) return 'image/heic'
  return null
}

export type PhotoCheck = { ok: true; base64: string; mimeType: string } | { ok: false; problem: 'missing' | 'too-big' | 'not-image' }

/** Checks what the phone sent: a base64 photo of at most 4 MB that really is an image. */
export function checkPhoto(imageBase64: unknown, mimeType: unknown): PhotoCheck {
  if (typeof imageBase64 !== 'string' || !imageBase64) return { ok: false, problem: 'missing' }
  const b64 = imageBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (Math.floor(b64.length * 3 / 4) > PHOTO_MAX_BYTES) return { ok: false, problem: 'too-big' }
  if (typeof mimeType !== 'string' || !MIMES.includes(mimeType.toLowerCase())) return { ok: false, problem: 'not-image' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, problem: 'not-image' }
  const head = Uint8Array.from(atob(b64.slice(0, 24)), c => c.charCodeAt(0))
  const real = sniffImage(head)
  if (!real) return { ok: false, problem: 'not-image' }
  return { ok: true, base64: b64, mimeType: real }
}

const clean = (v: unknown, max: number) => typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/[<>{}[\]`*_#|\\"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
  : ''

/** The AI's answer, boxed in: a short description and 1–3 short search phrases (never more, never long). */
export function cleanPhotoAnswer(data: Record<string, unknown>): { description: string; phrases: string[] } {
  const description = clean(data.description, 80)
  const raw = Array.isArray(data.phrases) ? data.phrases : []
  const phrases = [...new Set(raw.map(p => clean(p, 60).toLowerCase()).filter(p => p.length >= 2))].slice(0, 3)
  if (!phrases.length && description.length >= 3) phrases.push(description.toLowerCase().replace(/^(an?|the)\s+/, ''))
  return { description: phrases.length ? description || phrases[0] : '', phrases }
}

/** Joins the nearest props of each phrase: best score per prop, closest first, only close enough ones. */
export function mergeHits(lists: { id: string; score: number }[][], min = PHOTO_MIN_SCORE, max = PHOTO_RESULTS_MAX * 2): { id: string; score: number }[] {
  const best = new Map<string, number>()
  for (const list of lists) for (const h of list) if (h.score >= min && h.score > (best.get(h.id) ?? -1)) best.set(h.id, h.score)
  return [...best].map(([id, score]) => ({ id, score: Math.round(score * 1000) / 1000 })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, max)
}
