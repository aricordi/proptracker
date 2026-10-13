// Bin names, shared by the server and the app (no server-only imports here).

// Bin signs are written many ways: "Bin C7", "c 7", "C-7", "B.31", "B:31",
// "B: 31", "B031" — same bin. Compare by letters and numbers only (no leading zeros).
export const binKey = (s: string) => s.toUpperCase().trim()
  .replace(/^BIN(?![A-Z])/, '')
  .replace(/[^A-Z0-9]/g, '')
  .replace(/(^|[A-Z])0+(?=\d)/g, '$1')

// How a new bin from a sign is named: "bin 1", "BIN 1" and "Bin  1" all become "Bin 1".
export const tidyBinLabel = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/^bin\b\s*/i, 'Bin ').trim()

// Groups of existing bins that are really the same bin (2 or more with the same key).
export function lookAlikeBins<B extends { id: string; label: string }>(bins: B[]): B[][] {
  const groups = new Map<string, B[]>()
  for (const b of bins) {
    const k = binKey(b.label)
    if (!k) continue
    groups.set(k, [...(groups.get(k) ?? []), b])
  }
  return [...groups.values()].filter(g => g.length > 1)
}
