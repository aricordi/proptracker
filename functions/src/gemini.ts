// All Gemini calls live here, on the server, so the API key never reaches phones.
// Model names are in one place: when Google retires a model, change it here.
import { createHash } from 'node:crypto'
import { defineSecret } from 'firebase-functions/params'

// The Gemini key, kept in Google Secret Manager (declared once, shared by all functions).
export const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')

export const TAGGING_MODEL   = 'gemini-3.5-flash-lite'
export const EMBEDDING_MODEL = 'gemini-embedding-2'
export const EMBEDDING_DIMENSIONS = 768

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

// The key goes in a header, not the URL: newer Google keys (starting "AQ.")
// only work this way, and it keeps the key out of server logs too.
function keyHeaders(apiKey: string) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
}

// In the local emulator with no real key, return fake-but-stable answers so
// the app and tests work offline and cost nothing.
export function isFakeMode(apiKey: string | undefined) {
  return !apiKey && process.env.FUNCTIONS_EMULATOR === 'true'
}

export interface PhotoAnalysis {
  name: string
  categoryId: string | null
  tags: string[]
  description: string
}

export interface CategoryOption { id: string; label: string }

export async function analyzePhoto(
  apiKey: string | undefined,
  image: { base64: string; mimeType: string },
  categories: CategoryOption[],
  existingTags: string[],
): Promise<PhotoAnalysis> {
  if (isFakeMode(apiKey)) {
    return { name: 'Test prop', categoryId: categories[0]?.id ?? null, tags: ['test', 'sample'], description: 'A sample prop from test mode.' }
  }
  if (!apiKey) throw new Error('Gemini API key is not configured')

  const prompt = `You are cataloguing a film production's prop and costume inventory from a photo.
Return ONLY a JSON object with exactly these fields:
- "name": a short, plain name someone would search for (2-5 words, Title Case), e.g. "Rotary Telephone".
- "category": the single best fit, copied exactly from this list: ${JSON.stringify(categories.map(c => c.label))}
- "tags": 5-8 lowercase single-word or hyphenated search tags: what it is, what it's used for, era/style, colour, material.
  Prefer reusing these existing tags when they fit: ${JSON.stringify(existingTags.slice(0, 300))}
- "description": one sentence (max 20 words) describing what it looks like.
If there is a handwritten or printed card/label in the photo, ignore it when naming the item.`

  const res = await fetch(`${BASE_URL}/models/${TAGGING_MODEL}:generateContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const match = text.replace(/```json\n?|```\n?/g, '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Unexpected AI response: ${text.slice(0, 80)}`)
  const parsed = JSON.parse(match[0]) as Record<string, unknown>

  const label = typeof parsed.category === 'string' ? parsed.category.trim().toLowerCase() : ''
  const category = categories.find(c => c.label.toLowerCase() === label)
  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 120) : '',
    categoryId: category?.id ?? null,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [],
    description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 300) : '',
  }
}

// ─── Batch import: also read the bin sign and the quantity sign ─────────────

// Listed prices for TAGGING_MODEL (US$ per million tokens; "out" includes thinking).
// Used to count spend against the import's hard cost cap. Update if Google changes them.
export const PRICE_PER_M = { in: 0.30, out: 2.50 }

export interface ImportAnalysis extends PhotoAnalysis {
  binLabel: string | null   // text of the bin sign in the photo, e.g. "C7"
  quantity: number          // from an "x2"/"x3" sign; 1 if none
}

export async function analyzeImportPhoto(
  apiKey: string | undefined,
  image: { base64: string; mimeType: string },
  categories: CategoryOption[],
  existingTags: string[],
  existingBins: string[],
): Promise<{ analysis: ImportAnalysis; costUsd: number }> {
  if (isFakeMode(apiKey)) {
    // Stable fake answers for the emulator: "bin" and quantity come from the photo's size.
    const n = image.base64.length % 3
    return {
      analysis: { name: `Test prop ${image.base64.length % 1000}`, categoryId: categories[0]?.id ?? null, tags: ['test', 'imported'],
        description: 'A sample prop from test mode.', binLabel: ['A1', 'Z9', null][n], quantity: n + 1 },
      costUsd: 0.002,
    }
  }
  if (!apiKey) throw new Error('Gemini API key is not configured')

  const prompt = `You are cataloguing a film production's prop and costume inventory from a photo.
Each photo shows ONE prop, usually with a handwritten or printed sign next to it saying which storage bin it lives in,
and sometimes a sign like "x2" or "x3" meaning there are that many identical units.
Return ONLY a JSON object with exactly these fields:
- "name": a short, plain name someone would search for (2-5 words, Title Case), e.g. "Rotary Telephone". Don't name the sign.
- "category": the single best fit, copied exactly from this list: ${JSON.stringify(categories.map(c => c.label))}
- "tags": 5-8 lowercase single-word or hyphenated search tags: what it is, what it's used for, era/style, colour, material.
  Prefer reusing these existing tags when they fit: ${JSON.stringify(existingTags.slice(0, 300))}
- "description": one sentence (max 20 words) describing what the prop looks like.
- "bin": the bin name/number written on the sign, exactly as written (e.g. "C7", "Bin 12"), or null if there is no bin sign.
  Known bins (use the exact spelling if the sign matches one): ${JSON.stringify(existingBins.slice(0, 300))}
- "quantity": the number from a quantity sign like "x2" or "x 3", or 1 if there is none.`

  const res = await fetch(`${BASE_URL}/models/${TAGGING_MODEL}:generateContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const usage = json.usageMetadata ?? {}
  const costUsd = ((usage.promptTokenCount ?? 0) * PRICE_PER_M.in
    + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * PRICE_PER_M.out) / 1_000_000
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const match = text.replace(/```json\n?|```\n?/g, '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Unexpected AI response: ${text.slice(0, 80)}`)
  const parsed = JSON.parse(match[0]) as Record<string, unknown>

  const label = typeof parsed.category === 'string' ? parsed.category.trim().toLowerCase() : ''
  const category = categories.find(c => c.label.toLowerCase() === label)
  const qty = Number(parsed.quantity)
  return {
    analysis: {
      name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 120) : '',
      categoryId: category?.id ?? null,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8)
        : [],
      description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 300) : '',
      binLabel: typeof parsed.bin === 'string' && parsed.bin.trim() ? parsed.bin.trim().slice(0, 40) : null,
      quantity: Number.isInteger(qty) && qty >= 1 && qty <= 999 ? qty : 1,
    },
    costUsd,
  }
}

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

export async function embedText(apiKey: string | undefined, text: string, taskType: EmbedTask): Promise<number[]> {
  if (isFakeMode(apiKey)) return fakeEmbedding(text)
  if (!apiKey) throw new Error('Gemini API key is not configured')

  const res = await fetch(`${BASE_URL}/models/${EMBEDDING_MODEL}:embedContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const values = json.embedding?.values as number[] | undefined
  if (!values?.length) throw new Error('Empty embedding')
  return normalize(values)
}

// Shortened embeddings aren't guaranteed to be unit length; normalize so
// cosine distance behaves consistently.
function normalize(v: number[]) {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map(x => x / mag)
}

// Test-mode embedding: words hashed into buckets, so texts sharing words are "similar".
export function fakeEmbedding(text: string): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0)
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)) {
    const h = createHash('md5').update(word).digest()
    v[h.readUInt16BE(0) % EMBEDDING_DIMENSIONS] += 1
  }
  if (v.every(x => x === 0)) v[0] = 1
  return normalize(v)
}

export function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}
