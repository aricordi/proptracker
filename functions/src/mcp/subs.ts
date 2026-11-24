// A prop that's taken that day never ends the conversation (owner, Nov 24: "automatic swaps"): for each prop that can't go
// on that day, the closest free alternatives (same search as the closet tools, free on that day, not damaged).
import { propsProblem, freeOn, type McpUser } from './common.js'

export async function propsProblemWithSubs(e: unknown, day: string, u: McpUser): Promise<string | null> {
  const why = propsProblem(e)
  if (!why) return null
  const conflicts = ((e as { details?: { conflicts?: { itemId: string; name: string; requested: number }[] } })?.details?.conflicts ?? []).slice(0, 4)
  try {
    const { findProps } = await import('./tools.js')   // loaded here to avoid a circular import at start-up
    const lines: string[] = []
    for (const c of conflicts) {
      // The same kind of thing: the full name, then without its first word ("red rotary phone" → "rotary phone"), then the last word.
      const words = c.name.trim().split(/\s+/)
      const asks = [...new Set([c.name, words.slice(1).join(' '), words[words.length - 1]].filter(q => q.length >= 3))]
      const seen = new Map<string, Awaited<ReturnType<typeof findProps>>['found'][number]>()
      for (const q of asks) for (const p of (await findProps(q, '', 8, u)).found) if (p.id !== c.itemId && !p.damaged && !seen.has(p.id)) seen.set(p.id, p)
      const found = [...seen.values()].slice(0, 10)
      const free = await freeOn(day, found.map(p => p.id))
      const ok = found.filter(p => (free[p.id] ?? 0) >= c.requested).slice(0, 3)
      if (ok.length) lines.push(`Instead of ${c.name}: ${ok.map(p => `${p.name} (${p.id}, ${free[p.id]} free)`).join(', ')}`)
    }
    return lines.length ? `${why}\nFree that day instead (offer them; show_props shows photos):\n${lines.join('\n')}` : why
  } catch { return why }
}
