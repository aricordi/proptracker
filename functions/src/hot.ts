// "Hot" order for Browse (owner, Nov 7: "don't want it alphabetical, it shows the same stuff every time… popular stuff to the
// top"). Pure, shared by the server (scores) and the app (order), unit-tested.
//   • score: every request a prop was in (not cancelled) adds 1, fading by half every HALF_LIFE days, so what's asked for
//     NOW rises and last season's favourites sink;
//   • then props added in the last NEW_DAYS (so new stock gets seen);
//   • then everything else in a shuffle that changes once a day (same for everyone that day, so Back keeps your spot).
export const HOT_WINDOW_DAYS = 120
export const HALF_LIFE_DAYS = 21
export const NEW_DAYS = 14

const dayMs = 86_400_000
export function hotScores(requests: { itemIds: string[]; createdAt: string; status?: string }[], now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of requests) {
    if (r.status === 'cancelled') continue
    const age = Math.max(0, (now - Date.parse(r.createdAt)) / dayMs)
    if (!Number.isFinite(age) || age > HOT_WINDOW_DAYS) continue
    const w = Math.pow(0.5, age / HALF_LIFE_DAYS)
    for (const id of new Set(r.itemIds)) out[id] = Math.round(((out[id] ?? 0) + w) * 1000) / 1000
  }
  return out
}

// A small stable hash, so the daily shuffle is the same on every phone that day.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function hotOrder<T extends { id: string; name: string; createdAt?: string }>(items: T[], scores: Record<string, number>, day: string, now = Date.now()): T[] {
  const isNew = (i: T) => !!i.createdAt && now - Date.parse(i.createdAt) < NEW_DAYS * dayMs
  return [...items].sort((a, b) =>
    (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
    || Number(isNew(b)) - Number(isNew(a))
    || hash(`${day}|${a.id}`) - hash(`${day}|${b.id}`)
    || a.name.localeCompare(b.name))
}
