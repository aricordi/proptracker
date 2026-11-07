// THE CHAT REMEMBERS YOU (owner, Nov 7): the visible conversation is kept on the phone, per person, so the chat picks up
// where you left off. Only words are kept (never photos, never live cards): old turns come back as plain text under a
// faint "Earlier" divider. "New chat" clears it, and it forgets by itself after 7 days.
// Pure (storage is passed in): unit-tested in tests/unit/chatMemory.test.ts.

export type Remembered = { who: 'me' | 'bot'; text: string; mode?: 'props' | 'time' | 'help' }

export const CHAT_MEMORY_TURNS = 30
export const CHAT_MEMORY_DAYS = 7
export const CHAT_MEMORY_TEXT = 600
/** How many earlier things they said go to the chat's AI as context. */
export const CHAT_MEMORY_ASKS = 6

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const DAY_MS = 86_400_000

export const chatKey = (email: string) => `pc.chat.${email.trim().toLowerCase()}`

const clean = (list: unknown): Remembered[] => (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
  const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const text = typeof t.text === 'string' ? t.text.trim().slice(0, CHAT_MEMORY_TEXT) : ''
  if (!text || (t.who !== 'me' && t.who !== 'bot')) return []
  const mode = t.mode === 'props' || t.mode === 'time' || t.mode === 'help' ? t.mode : undefined
  return [{ who: t.who, text, ...(mode && t.who === 'me' ? { mode } : {}) } as Remembered]
}).slice(-CHAT_MEMORY_TURNS)

/** The kept conversation for this person ([] when none, broken, or older than 7 days; an old one is removed). */
export function loadChat(store: Store | null | undefined, email: string, now = Date.now()): Remembered[] {
  if (!store || !email) return []
  try {
    const raw = store.getItem(chatKey(email))
    if (!raw) return []
    const o = JSON.parse(raw) as { at?: unknown; turns?: unknown }
    const at = Number(o?.at)
    if (!Number.isFinite(at) || now - at > CHAT_MEMORY_DAYS * DAY_MS || at > now + DAY_MS) { store.removeItem(chatKey(email)); return [] }
    return clean(o.turns)
  } catch { return [] }
}

/** Keeps the last 30 turns (an empty list forgets). Never throws (private mode, full storage). */
export function saveChat(store: Store | null | undefined, email: string, turns: Remembered[], now = Date.now()): void {
  if (!store || !email) return
  try {
    const kept = clean(turns)
    if (!kept.length) { store.removeItem(chatKey(email)); return }
    store.setItem(chatKey(email), JSON.stringify({ at: now, turns: kept }))
  } catch { /* the phone wouldn't keep it: the chat still works */ }
}

export function clearChat(store: Store | null | undefined, email: string): void {
  if (!store || !email) return
  try { store.removeItem(chatKey(email)) } catch { /* ignore */ }
}

/** "Props I suggested: Cop hat, Badge, Diner booth (+4 more)" — a result card kept as one line of text. */
export function summaryLine(label: string, items: string[], max = 5): string {
  const list = [...new Set(items.map(s => s.trim()).filter(Boolean))]
  if (!list.length) return ''
  const more = list.length - max
  return `${label}: ${list.slice(0, max).join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
}

/** The last earlier things they said (newest last), for the chat's AI. */
export function earlierAsks(turns: Remembered[], n = CHAT_MEMORY_ASKS): string[] {
  return turns.filter(t => t.who === 'me').map(t => t.text.slice(0, 300)).slice(-n)
}

/** Their last 3 video names, newest first, from their own props requests (one each, ignoring case). */
export function lastVideoNames(list: { title?: unknown; startDate?: unknown; createdAt?: unknown }[], n = 3): string[] {
  const when = (r: { startDate?: unknown; createdAt?: unknown }) => typeof r.startDate === 'string' ? r.startDate : ''
  const seen = new Set<string>(), out: string[] = []
  for (const r of [...list].sort((a, b) => when(b).localeCompare(when(a)))) {
    const t = typeof r.title === 'string' ? r.title.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase()); out.push(t)
    if (out.length >= n) break
  }
  return out
}
