// Find duplicates: joining look-alike pairs into groups, and the "put these in one
// bin" list for the arts department.

export interface Pair { a: string; b: string; score: number }
export interface Group { ids: string[]; keys: string[]; score: number }

export const pairKey = (a: string, b: string) => [a, b].sort().join('|')

// A~B and B~C → one group {A, B, C}, however many there are (4 copies in 4 bins = one group).
export function groupPairs(pairs: Pair[]): Group[] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const p of pairs) { const a = find(p.a), b = find(p.b); if (a !== b) parent.set(a, b) }
  const groups = new Map<string, Group>()
  for (const p of pairs) {
    const root = find(p.a)
    const g = groups.get(root) ?? { ids: [], keys: [], score: 0 }
    for (const id of [p.a, p.b]) if (!g.ids.includes(id)) g.ids.push(id)
    const k = pairKey(p.a, p.b)
    if (!g.keys.includes(k)) g.keys.push(k)
    g.score = Math.max(g.score, p.score)
    groups.set(root, g)
  }
  return [...groups.values()].sort((x, y) => y.score - x.score)
}

interface Placed { id: string; name: string; quantity: number; binId?: string }

// Where a group's copies are: one entry per bin (props with no bin count as their own spot).
export function spreadOf(props: Placed[]): { binId: string | null; qty: number; count: number }[] {
  const m = new Map<string | null, { qty: number; count: number }>()
  for (const p of props) {
    const k = p.binId || null
    const e = m.get(k) ?? { qty: 0, count: 0 }
    e.qty += p.quantity; e.count++
    m.set(k, e)
  }
  return [...m].map(([binId, e]) => ({ binId, ...e }))
}

export const isSpread = (props: Placed[]) => spreadOf(props).length > 1

// Plain-text list to send the arts team: what to gather into one bin.
export function shelfList(groups: Placed[][], binName: (id: string) => string): string {
  const lines = groups.filter(isSpread).map(props => {
    const where = spreadOf(props).map(s => `${s.binId ? binName(s.binId) : 'no bin'} ×${s.qty}`).join(', ')
    return `• ${props[0].name}: ${where}`
  })
  return lines.length ? `Put each of these in ONE bin (then tell the app which):\n${lines.join('\n')}` : ''
}

// Every pair between two sets of props (e.g. the ticked ones × the released ones).
export function crossKeys(a: string[], b: string[]): string[] {
  return [...new Set(a.flatMap(x => b.filter(y => y !== x).map(y => pairKey(x, y))))]
}

// Every pair inside one set of props.
export function insideKeys(ids: string[]): string[] {
  return [...new Set(ids.flatMap((x, i) => ids.slice(i + 1).filter(y => y !== x).map(y => pairKey(x, y))))]
}
