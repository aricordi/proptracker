// Pure helpers for the video-idea helper (assistant.ts): what to search when the AI can't answer, and how to pick
// from smart-search results without it. No database, no AI: unit-tested in tests/unit/ideaHelpers.test.ts.
import { safeText } from './gemini.js'

export interface Pick { kind: 'prop' | 'gear'; id: string; why: string }

// When step 1 can't run (Google busy, a safety refusal of a perfectly fine horror idea, a broken answer), the idea
// itself is searched: split into its parts ("a cop, a diner and a radar gun") so each part finds its own props.
export function plainNeeds(idea: string): { scene: string; items: string[] }[] {
  const parts = idea.split(/[,;\n]|\band\b|\bwith\b|\bplus\b|\bthen\b/i).map(x => x.trim()).filter(x => x.length >= 3).slice(0, 6)
  return [{ scene: 'For your idea', items: [...new Set([idea.slice(0, 120), ...parts])].slice(0, 6) }]
}

// Step 3 without the AI: the closest props for each need, in the order smart search ranked them.
export function rankedPicks(needs: { scene: string; items: string[] }[], nearByPhrase: Record<string, string[]>, ok: Set<string>): { title: string; picks: Pick[] }[] {
  const seen = new Set<string>()
  return needs.map(n => ({
    title: n.scene,
    picks: n.items.flatMap(item => (nearByPhrase[item] ?? []).filter(id => ok.has(id) && !seen.has(id)).slice(0, 2)
      .map(id => { seen.add(id); return { kind: 'prop' as const, id, why: safeText(`Close match for "${item}"`, 80) } })).slice(0, 5),
  })).filter(g => g.picks.length)
}


// ─── Learning from real requests (owner, Oct 28: "learn from the prop matching already happening") ───────────
// Only totals across everyone's requests: how often each prop was asked for, and which props were asked for in the
// same request. No names, titles, notes or dates leave the server, and only company props that can be borrowed
// are ever suggested from it.
export interface PropSignals { uses: Record<string, number>; pairs: Record<string, Record<string, number>> }

export function signalsFrom(requests: { itemIds: string[] }[]): PropSignals {
  const uses: Record<string, number> = {}, pairs: Record<string, Record<string, number>> = {}
  for (const r of requests) {
    const ids = [...new Set(r.itemIds)].slice(0, 40)   // a huge request says little about what goes together
    for (const a of ids) {
      uses[a] = (uses[a] ?? 0) + 1
      if (ids.length < 2 || ids.length > 25) continue
      const row = (pairs[a] ??= {})
      for (const b of ids) if (b !== a) row[b] = (row[b] ?? 0) + 1
    }
  }
  return { uses, pairs }
}

// Props often requested together with the picked ones (at least `min` times), best first, never one already shown.
export function goesWith(picked: string[], s: PropSignals, skip: Set<string>, max = 3, min = 2): { id: string; times: number }[] {
  const score: Record<string, number> = {}
  for (const p of picked) for (const [b, n] of Object.entries(s.pairs[p] ?? {})) if (!skip.has(b) && !picked.includes(b)) score[b] = (score[b] ?? 0) + n
  return Object.entries(score).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([id, times]) => ({ id, times }))
}
