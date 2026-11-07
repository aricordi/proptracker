// Chat answers "type out" word by word (owner, Nov 7: "feel like a modern AI assistant"). The server sends the whole reply
// at once (no streaming in the Firebase SDK), so this is only a quick reveal of the finished text on the phone.
export const WORD_MS = 25          // one word every 25 ms…
export const MAX_REVEAL_MS = 1200  // …but a whole reply never takes longer than 1.2 s

// The text cut into pieces that each end after a word (spaces and line breaks stay with the word before them),
// so joining the first n pieces gives the reply up to its n-th word.
export function wordPieces(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? []
}

// How long the whole reveal takes: 25 ms a word, capped at 1.2 s (long replies just go faster).
export function revealMs(words: number): number {
  return Math.min(Math.max(words, 0) * WORD_MS, MAX_REVEAL_MS)
}

// Words shown `ms` milliseconds after it starts (the first one straight away, all of them when the time is up).
export function wordsShown(words: number, ms: number): number {
  if (words <= 0) return 0
  const total = revealMs(words)
  if (ms >= total) return words
  return Math.min(words, Math.max(1, Math.floor((ms / total) * words) + 1))
}
