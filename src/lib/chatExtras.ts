// Two small chat helpers (owner, Nov 7): a photo sent in the chat, and answers read aloud after a spoken message.
import type { IdeaResult } from '../services/ai'

// What the person's bubble says when they send a photo (also what the chat remembers on the phone).
export const PHOTO_TEXT = 'Find props like this photo'

// "A red rotary phone" → "red rotary phone" (for the "Search the closet for …" button).
export function photoWords(description: string): string {
  return description.trim().replace(/^(an?|the)\s+/i, '').replace(/[.!]+$/, '').slice(0, 80)
}

// The photo search answer as a props answer, so the chat shows it with the same ticks and "Add N to a shoot".
export function photoAnswer(description: string, ids: string[]): { text: string; result?: IdeaResult; search?: string } {
  const what = description.trim().replace(/[.!]+$/, '')
  const looks = what ? `Looks like ${what.charAt(0).toLowerCase()}${what.slice(1)}.` : ''
  if (!what) return { text: "I couldn't tell what's in that photo. Try a closer, brighter one, or type what you're looking for." }
  if (!ids.length) return { text: `${looks} Nothing in the closet looks close to it.`, search: photoWords(what) }
  return {
    text: `${looks} Here's what we have that's closest.`,
    result: { groups: [{ title: 'Closest in the closet', picks: ids.map(id => ({ kind: 'prop' as const, id, why: '' })) }], missing: [] },
  }
}

// What is read aloud: the answer's words only, without the **bold** marks, list dashes or symbols.
export function speakable(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[✦✓›→↑]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// The "read answers aloud" switch: on unless the person turned it off on this phone.
export const SPEAK_KEY = 'pc.chatSpeak'
export function speakOn(store: Pick<Storage, 'getItem'> | null): boolean {
  try { return store?.getItem(SPEAK_KEY) !== 'off' } catch { return true }
}
