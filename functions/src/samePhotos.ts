// "Same photo twice" (owner, Nov 6: the crew finds duplicate pictures after the imports). Pure: no Firebase here, so it
// can be unit-tested. Two props are the same photo when one of their stored photo FILES has exactly the same contents
// (Storage keeps an md5 fingerprint of every file). Imports since Nov 4 already skip exact copies; older ones didn't.

// A storage path from a download link ("…/o/items%2Fabc.jpg?alt=media…" → "items/abc.jpg").
export function storagePath(url: string): string | null {
  const m = String(url ?? '').match(/\/o\/([^?#]+)/)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

const pair = (a: string, b: string) => [a, b].sort().join('|')

/** Groups of prop ids sharing at least one identical photo file (joined into chains), minus groups someone already
 *  said are NOT the same (every pair inside them dismissed). Biggest groups first. */
export function groupSamePhotos(items: { id: string; photos?: string[] }[], md5ByPath: Map<string, string>, dismissed: Set<string> = new Set()): string[][] {
  const byHash = new Map<string, string[]>()
  for (const it of items) {
    for (const url of it.photos ?? []) {
      const path = storagePath(url)
      const h = path ? md5ByPath.get(path) : undefined
      if (!h) continue
      const list = byHash.get(h) ?? []
      if (!list.includes(it.id)) list.push(it.id)
      byHash.set(h, list)
    }
  }
  // Join overlapping sets (A=B by one photo, B=C by another → one group).
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  for (const ids of byHash.values()) {
    if (ids.length < 2) continue
    for (const id of ids) if (!parent.has(id)) parent.set(id, id)
    for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]))
  }
  const groups = new Map<string, string[]>()
  for (const id of parent.keys()) { const r = find(id); groups.set(r, [...(groups.get(r) ?? []), id]) }
  return [...groups.values()]
    .filter(g => g.length > 1)
    .filter(g => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (!dismissed.has(pair(g[i], g[j]))) return true; return false })
    .sort((a, b) => b.length - a.length)
}
