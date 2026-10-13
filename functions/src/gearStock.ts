// Gear stock rules, shared by the server and the app (no server-only imports here).
// Staff keep a list of every piece of gear (gear_items, with how many they have)
// and build bundles from it (gear_bundles). Creators can only book whole bundles.
// A piece can only be in one bundle at a time, so bundles can never share a battery.
// The team offers two kinds of thing to creators (nothing else is visible to them):
//   'bundle' — a case of pieces, booked whole, never split
//   'extra'  — an add-on of ONE kind of piece (e.g. sandbags); the team sets how many
//              are offered, creators pick how many they need

export const GEAR_CATEGORIES = ['Camera', 'Lens', 'Lighting', 'Audio', 'Drones', 'Power', 'Grip', 'Monitors', 'Other'] as const
export type GearCategory = typeof GEAR_CATEGORIES[number]

export interface BundlePiece { itemId: string; qty: number }
export interface StockItem { id: string; name: string; have: number; archived?: boolean }
export type OfferKind = 'bundle' | 'extra'
export interface StockBundle { id: string; pieces: BundlePiece[]; archived?: boolean; kind?: OfferKind }

export const MAX_PIECES = 60   // different kinds of piece in one bundle

// How many of each item are tied up in (non-archived) bundles, optionally ignoring one bundle.
export function bundledCounts(bundles: StockBundle[], exceptBundleId?: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const b of bundles) {
    if (b.archived || b.id === exceptBundleId) continue
    for (const p of b.pieces ?? []) m.set(p.itemId, (m.get(p.itemId) ?? 0) + p.qty)
  }
  return m
}

// Pieces of an item that aren't in any bundle (creators can't book these).
export function looseCount(item: StockItem, bundled: Map<string, number>): number {
  return item.archived ? 0 : Math.max(0, item.have - (bundled.get(item.id) ?? 0))
}

// Same item listed twice → one line; zero or bad quantities dropped.
export function tidyPieces(pieces: unknown): BundlePiece[] {
  const m = new Map<string, number>()
  if (!Array.isArray(pieces)) return []
  for (const p of pieces) {
    const itemId = typeof p?.itemId === 'string' ? p.itemId : ''
    const qty = Number(p?.qty)
    if (!itemId || !Number.isInteger(qty) || qty < 1) continue
    m.set(itemId, (m.get(itemId) ?? 0) + qty)
  }
  return [...m].map(([itemId, qty]) => ({ itemId, qty }))
}

// Why a bundle can't be saved, in plain words (empty list = fine).
export function bundleProblems(pieces: BundlePiece[], items: StockItem[], bundles: StockBundle[], bundleId?: string, kind: OfferKind = 'bundle'): string[] {
  const problems: string[] = []
  if (!pieces.length) problems.push(kind === 'extra' ? 'Pick the piece to offer.' : 'Add at least one piece.')
  if (kind === 'extra' && pieces.length > 1) problems.push('An add-on extra is one kind of piece. Make a bundle for a set of pieces.')
  if (pieces.length > MAX_PIECES) problems.push(`A bundle can have at most ${MAX_PIECES} different pieces.`)
  const byId = new Map(items.map(i => [i.id, i]))
  const bundled = bundledCounts(bundles, bundleId)
  for (const p of pieces) {
    const item = byId.get(p.itemId)
    if (!item || item.archived) { problems.push('One of the pieces no longer exists.'); continue }
    const free = looseCount(item, bundled)
    if (p.qty > free) problems.push(`Only ${free} "${item.name}" ${free === 1 ? 'is' : 'are'} not already in another bundle (you asked for ${p.qty}).`)
  }
  return problems
}

// Lowering how many of an item you have can't go below what's in bundles.
export function haveProblem(item: StockItem, newHave: number, bundles: StockBundle[]): string | null {
  const inBundles = bundledCounts(bundles).get(item.id) ?? 0
  return newHave < inBundles
    ? `${inBundles} "${item.name}" ${inBundles === 1 ? 'is' : 'are'} in bundles. Take ${inBundles === 1 ? 'it' : 'them'} out of the bundles first.`
    : null
}

export const pieceTotal = (pieces: BundlePiece[]) => pieces.reduce((n, p) => n + p.qty, 0)
