// Say it once, confirm once (owner, Nov 7): one message with a time AND props ("Thursday 5pm at Cliff 1 with Kyle, I need
// a cop costume and handcuffs") gets ONE card: the best free slot + the top props ticked + one "Do it" button.
// Pure helpers only (unit-tested in tests/unit/sayItOnce.test.ts); the chat screen does the calls.

export interface PairTurn { action: string; query?: string; also?: { action: string; query: string } }

// The chat's AI read both a time and props in the same message: the standalone search for each.
export function pairOf(turn: PairTurn): { time: string; props: string } | null {
  const a = turn.action, b = turn.also?.action
  const qa = (turn.query ?? '').trim(), qb = (turn.also?.query ?? '').trim()
  if (!qa || !qb) return null
  if (a === 'times' && b === 'props') return { time: qa, props: qb }
  if (a === 'props' && b === 'times') return { time: qb, props: qa }
  return null
}

export interface PickLike { id: string; kind: string }
export const PLAN_MAX_PICKS = 5

// The props to tick on the card: in the AI's order (best first, scene by scene), props only, each once, only ones
// still free that day (free > 0). No props at all → null (the chat shows its usual separate answers instead).
export function topPicks(groups: { picks: PickLike[] }[], freeOn: (id: string) => number | null, max = PLAN_MAX_PICKS): string[] {
  const out: string[] = []
  for (const g of groups) for (const p of g.picks) {
    if (out.length >= max) return out
    if (p.kind !== 'prop' || out.includes(p.id)) continue
    const f = freeOn(p.id)
    if (f !== null && f > 0) out.push(p.id)
  }
  return out
}

// Why the one-card plan can't be offered (then the chat shows today's separate answers). null = show the card.
export type PlanSkip = 'no-time' | 'guideline' | 'too-late' | 'no-props'
export function planSkip(o: { hasTime: boolean; needsGuideline: boolean; tooLateForProps: boolean; picks: number }): PlanSkip | null {
  if (!o.hasTime) return 'no-time'
  if (o.needsGuideline) return 'guideline'
  if (o.tooLateForProps) return 'too-late'
  if (o.picks === 0) return 'no-props'
  return null
}

// The video name on the props request: their idea, tidied (one line, no trailing punctuation, ≤ 80 characters on a word).
export function videoName(idea: string): string {
  let t = idea.replace(/\s+/g, ' ').trim().replace(/^(i need|i want|we need|need|get me|find me)\s+/i, '').replace(/[\s.,;:!?]+$/, '')
  if (t.length > 80) { const cut = t.slice(0, 80); const sp = cut.lastIndexOf(' '); t = (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?]+$/, '') }
  return t ? t[0].toUpperCase() + t.slice(1) : 'My video'
}
