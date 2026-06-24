import { doc, setDoc, increment } from 'firebase/firestore'
import { db } from '../firebase'

const API_KEY  = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const TAGGING_MODEL   = 'gemini-2.5-flash-lite'
const EMBEDDING_MODEL = 'text-embedding-004'

export interface PhotoAnalysis {
  tags: string[]
  description: string | null
}

// Resize to ≤1024px and return base64 JPEG — keeps Gemini request small
function resizeToBase64(file: File, maxPx = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx }
        else                 { width  = Math.round(width  * maxPx / height); height = maxPx }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}

function trackUsage(field: 'taggingCalls' | 'embeddingCalls') {
  const month = new Date().toISOString().slice(0, 7)
  setDoc(doc(db, 'ai_usage', month), { month, [field]: increment(1) }, { merge: true })
    .catch(() => {})
}

// Returns tags + description from a single Gemini call. Throws on failure so
// the caller can show an error and offer a retry.
export async function analyzeItemPhoto(file: File): Promise<PhotoAnalysis> {
  if (!API_KEY) throw new Error('No API key configured')
  const base64 = await resizeToBase64(file)
  const res = await fetch(
    `${BASE_URL}/models/${TAGGING_MODEL}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `This item belongs to a prop/costume/set-dressing inventory for a YouTube horror-mystery channel.
Return a JSON object with exactly two fields:
- "tags": array of 4–8 lowercase hyphenated inventory tags that will help find this item later.
  Cover what it IS (e.g. candelabra, hooded-cloak, spell-book, dagger, lantern, potion-bottle),
  visual look (colour, material, condition — e.g. black, wooden, distressed, aged, fake-blood),
  aesthetic (gothic, occult, victorian, vintage, rustic, modern), and
  how it is used (hero-prop, wearable, handheld, background, set-dressing).
  Prefer specific concrete nouns. Skip vague or obvious tags.
- "description": one sentence (max 20 words) describing what this item looks like

Output ONLY the JSON — no markdown, no explanation.
Example: {"tags":["hooded-cloak","full-length","black","fabric","gothic","wearable"],"description":"A full-length hooded black fabric cloak with a front clasp."}`,
            },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 120)}`)
  }
  const json = await res.json()
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  // Strip any markdown fences Gemini might add
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Unexpected response: ${clean.slice(0, 80)}`)
  const parsed = JSON.parse(match[0]) as Record<string, unknown>
  const tags = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8)
    : []
  const description = typeof parsed.description === 'string' ? parsed.description : null
  trackUsage('taggingCalls')
  return { tags, description }
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!API_KEY || !text.trim()) return null
  try {
    const res = await fetch(
      `${BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
        }),
      },
    )
    if (!res.ok) return null
    const json = await res.json()
    const values = json.embedding?.values as number[] | undefined
    if (!values?.length) return null
    trackUsage('embeddingCalls')
    return values
  } catch {
    return null
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
