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
  searchWords: string[]     // hidden extra search words (who/what it depicts, themes, synonyms)
}

// What the AI is asked for in "searchWords" (shared by every prompt that writes them).
const SEARCH_WORDS_RULE = `- "searchWords": 12-25 lowercase words or short phrases people might type to find this, especially ones NOT obvious from the name:
  who or what it depicts or is associated with (a Lincoln mask → "president", "abraham lincoln", "honest abe", "civil war", "american history"),
  characters/roles who would use it, scenes and settings, genres, occasions/holidays, eras, synonyms, slang and British/American spellings.`

export function parseSearchWords(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out = v.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase().slice(0, 40)).filter(Boolean)
  return [...new Set(out)].slice(0, 30)
}

export interface CategoryOption { id: string; label: string }

export async function analyzePhoto(
  apiKey: string | undefined,
  image: { base64: string; mimeType: string },
  categories: CategoryOption[],
  existingTags: string[],
): Promise<PhotoAnalysis> {
  if (isFakeMode(apiKey)) {
    return { name: 'Test prop', categoryId: categories[0]?.id ?? null, tags: ['test', 'sample'], description: 'A sample prop from test mode.', searchWords: ['sample word'] }
  }
  if (!apiKey) throw new Error('Gemini API key is not configured')

  const prompt = `You are cataloguing a film production's prop and costume inventory from a photo.
Return ONLY a JSON object with exactly these fields:
- "name": a short, plain name someone would search for (2-5 words, Title Case), e.g. "Rotary Telephone".
- "category": the single best fit, copied exactly from this list: ${JSON.stringify(categories.map(c => c.label))}
- "tags": 6-10 lowercase single-word or hyphenated search tags: what it is, who/what it depicts, what it's used for, era/style, colour, material.
  If it is a consumable SUPPLY rather than a prop (tape, adhesive squares, glue, batteries, zip ties, cleaning products, packaging…), make "supplies" the FIRST tag.
  Prefer reusing these existing tags when they fit: ${JSON.stringify(existingTags.slice(0, 300))}
- "description": one sentence (max 20 words) describing what it looks like.
${SEARCH_WORDS_RULE}
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
      ? parsed.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 10)
      : [],
    description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 300) : '',
    searchWords: parseSearchWords(parsed.searchWords),
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
        description: 'A sample prop from test mode.', searchWords: ['sample word'], binLabel: ['A1', 'Z9', null][n], quantity: n + 1 },
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
- "tags": 6-10 lowercase single-word or hyphenated search tags: what it is, who/what it depicts, what it's used for, era/style, colour, material.
  If it is a consumable SUPPLY rather than a prop (tape, adhesive squares, glue, batteries, zip ties, cleaning products, packaging…), make "supplies" the FIRST tag.
  Prefer reusing these existing tags when they fit: ${JSON.stringify(existingTags.slice(0, 300))}
- "description": one sentence (max 20 words) describing what the prop looks like.
${SEARCH_WORDS_RULE}
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
        ? parsed.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 10)
        : [],
      description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 300) : '',
      searchWords: parseSearchWords(parsed.searchWords),
      binLabel: typeof parsed.bin === 'string' && parsed.bin.trim() ? parsed.bin.trim().slice(0, 40) : null,
      quantity: Number.isInteger(qty) && qty >= 1 && qty <= 999 ? qty : 1,
    },
    costUsd,
  }
}

// ─── Duplicate check: are these two photos the same prop? ────────────────────

export interface PairVerdict { same: boolean; confidence: 'high' | 'medium' | 'low'; reason: string }

export async function comparePropPhotos(
  apiKey: string | undefined,
  a: { name: string; image: { base64: string; mimeType: string } },
  b: { name: string; image: { base64: string; mimeType: string } },
): Promise<{ verdict: PairVerdict; costUsd: number }> {
  if (isFakeMode(apiKey)) {
    const same = a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
    return { verdict: { same, confidence: 'medium', reason: same ? 'Test mode: same name.' : 'Test mode: different names.' }, costUsd: 0.001 }
  }
  if (!apiKey) throw new Error('Gemini API key is not configured')
  const prompt = `These two photos are from a film production's prop inventory. Photo 1 is catalogued as "${a.name}", photo 2 as "${b.name}".
Decide whether they show the SAME KIND of prop (the same design/model, so they are duplicates or identical copies), ignoring background, angle, lighting and any bin/quantity signs.
Return ONLY JSON: {"same": true|false, "confidence": "high"|"medium"|"low", "reason": "one short sentence"}`
  const res = await fetch(`${BASE_URL}/models/${TAGGING_MODEL}:generateContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inlineData: { mimeType: a.image.mimeType, data: a.image.base64 } },
        { inlineData: { mimeType: b.image.mimeType, data: b.image.base64 } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const usage = json.usageMetadata ?? {}
  const costUsd = ((usage.promptTokenCount ?? 0) * PRICE_PER_M.in
    + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * PRICE_PER_M.out) / 1_000_000
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  const parsed = match ? JSON.parse(match[0]) as Record<string, unknown> : {}
  const confidence = ['high', 'medium', 'low'].includes(String(parsed.confidence)) ? parsed.confidence as PairVerdict['confidence'] : 'low'
  return { verdict: { same: parsed.same === true, confidence, reason: String(parsed.reason ?? '').slice(0, 200) }, costUsd }
}

// ─── Text in, JSON out (the creator AI helpers) ───────────────────────────────

// One request answered as a JSON object, plus what it cost. Callers handle test mode.
// The app's own instructions go in `system` (the model treats them as the rules); anything a
// person typed goes in `user`, wrapped as data. Google's safety filters are on; a blocked or
// broken answer comes back as {} so callers fall back gracefully.
// "Dangerous content" only blocks the worst: this is a comedy/horror studio, and fake blood, a prop knife or a
// zombie make-up idea must not be refused as if it were real (they were, at "medium"; Oct 28).
const SAFETY = [
  ...['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT'].map(category => ({ category, threshold: 'BLOCK_MEDIUM_AND_ABOVE' })),
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
]
export async function askJson(apiKey: string, prompt: string | { system: string; user: string }, maxOutputTokens = 1500, temperature = 0.3): Promise<{ data: Record<string, unknown>; costUsd: number; blocked?: boolean }> {
  const parts = typeof prompt === 'string' ? { system: '', user: prompt } : prompt
  const res = await fetch(`${BASE_URL}/models/${TAGGING_MODEL}:generateContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      ...(parts.system ? { systemInstruction: { parts: [{ text: parts.system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: parts.user }] }],
      safetySettings: SAFETY,
      generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const usage = json.usageMetadata ?? {}
  const costUsd = ((usage.promptTokenCount ?? 0) * PRICE_PER_M.in
    + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * PRICE_PER_M.out) / 1_000_000
  // Refused by the safety filters (the question, or the answer): callers fall back to plain search, not "off topic".
  const blocked = !!json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason === 'SAFETY'
  const text: string = (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
  const match = text.match(/\{[\s\S]*\}/)
  let data: Record<string, unknown> = {}
  try { data = match ? JSON.parse(match[0]) : {} } catch { data = {} }
  return { data, costUsd, ...(blocked ? { blocked } : {}) }
}

// Words from the AI that are shown to people: plain short text only. No links, web addresses,
// email addresses, markup or code, so a trick message can't make the app show a phishing link.
export function safeText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\b[a-z0-9-]+\.(com|net|org|io|co|ca|ly|me|app|xyz|info|link|gg)\b\S*/gi, '')
    .replace(/[<>{}[\]`*_#|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// What a person typed, made safe to put inside a prompt as data: no control characters,
// no way to fake the end of the data block, limited length.
export function asData(v: string, max: number) {
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<\/?\s*creator_text\s*>/gi, '').replace(/"""/g, '"').slice(0, max)
}

// ─── Extra search words for props that already exist (one-off top-up) ────────

export async function suggestSearchWords(
  apiKey: string | undefined,
  info: { name: string; category?: string; tags: string[]; description?: string },
  image: { base64: string; mimeType: string } | null,
): Promise<{ searchWords: string[]; costUsd: number }> {
  if (isFakeMode(apiKey)) return { searchWords: ['sample word', ...info.name.toLowerCase().split(/\s+/)], costUsd: 0.002 }
  if (!apiKey) throw new Error('Gemini API key is not configured')
  const prompt = `This prop from a film production's inventory is catalogued as:
name: ${JSON.stringify(info.name)}; category: ${JSON.stringify(info.category ?? '')}; tags: ${JSON.stringify(info.tags)}; description: ${JSON.stringify(info.description ?? '')}.
${image ? 'Its photo is attached (ignore any bin or quantity sign in it).' : ''}
Return ONLY a JSON object: {"searchWords": [...]}, where
${SEARCH_WORDS_RULE}`
  const res = await fetch(`${BASE_URL}/models/${TAGGING_MODEL}:generateContent`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...(image ? [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }] : [])] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const usage = json.usageMetadata ?? {}
  const costUsd = ((usage.promptTokenCount ?? 0) * PRICE_PER_M.in
    + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * PRICE_PER_M.out) / 1_000_000
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  const parsed = match ? JSON.parse(match[0]) as Record<string, unknown> : {}
  return { searchWords: parseSearchWords(parsed.searchWords), costUsd }
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

// Many texts in ONE request (the idea helper looks up to 24 needs at once; 24 separate calls hit Google's
// rate limit on a busy day). Same vectors as embedText.
export async function embedTexts(apiKey: string | undefined, texts: string[], taskType: EmbedTask): Promise<number[][]> {
  if (!texts.length) return []
  if (isFakeMode(apiKey)) return texts.map(fakeEmbedding)
  if (!apiKey) throw new Error('Gemini API key is not configured')
  const res = await fetch(`${BASE_URL}/models/${EMBEDDING_MODEL}:batchEmbedContents`, {
    method: 'POST',
    headers: keyHeaders(apiKey),
    body: JSON.stringify({ requests: texts.map(text => ({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBEDDING_DIMENSIONS })) }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const out = (json.embeddings ?? []) as { values?: number[] }[]
  if (out.length !== texts.length || out.some(e => !e.values?.length)) throw new Error('Empty embedding')
  return out.map(e => normalize(e.values!))
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
