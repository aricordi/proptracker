import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

// The AI runs on the server (functions/src). These are thin wrappers.

export interface PhotoAnalysis {
  name: string
  categoryId: string | null
  tags: string[]
  description: string
  searchWords?: string[]
}

export interface SimilarResult {
  id: string
  score: number   // 0–1, higher = closer in meaning
}

// Shrink to ≤1024px JPEG before sending — keeps the request small and fast.
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

const analyzeCall = httpsCallable<{ imageBase64: string; mimeType: string }, PhotoAnalysis>(functions, 'analyzePropPhoto')
const similarCall = httpsCallable<{ query: string }, { results: SimilarResult[] }>(functions, 'searchSimilar')
const rebuildCall = httpsCallable<void, { total: number; updated: number; unchanged: number; failed: number }>(
  functions, 'rebuildSearchIndex', { timeout: 540_000 })

// Throws on failure so the add screen can show "Retry".
export async function analyzeItemPhoto(file: File): Promise<PhotoAnalysis> {
  const imageBase64 = await resizeToBase64(file)
  const res = await analyzeCall({ imageBase64, mimeType: 'image/jpeg' })
  return res.data
}

// Never throws: if the smart search is unavailable, search still works without it.
export async function searchSimilar(query: string): Promise<SimilarResult[]> {
  try {
    return (await similarCall({ query })).data.results
  } catch {
    return []
  }
}

export async function rebuildSearchIndex() {
  return (await rebuildCall()).data
}

// Owner: one-off AI top-up of hidden search words for props that already exist.
export interface SearchWordsRun { total: number; remaining: number; processed: number; failed: number; capped: boolean; slowDown: boolean }
export const improveSearchWords = httpsCallable<{ countOnly?: boolean }, SearchWordsRun>(functions, 'improveSearchWords')

// Owner: one-off "Speed up photos" — small list versions for props added before thumbnails existed.
export interface ThumbsRun { total: number; remaining: number; processed: number }
export const makeMissingThumbs = httpsCallable<{ countOnly?: boolean }, ThumbsRun>(functions, 'makeMissingThumbs', { timeout: 300_000 })

// ─── Creator AI helpers ──────────────────────────────────────────────────────

export interface IdeaPick { kind: 'prop' | 'gear'; id: string; why: string }
export interface IdeaResult { groups: { title: string; picks: IdeaPick[] }[]; missing: { name: string; why: string }[]; note?: string; searched?: string[] }
// A video idea → props and gear from the inventory, grouped by scene (each with why it fits).
export const ideaToProps = httpsCallable<{ idea: string; shootId?: string; exclude?: string[]; searched?: string[] }, IdeaResult>(functions, 'ideaToProps')
