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

