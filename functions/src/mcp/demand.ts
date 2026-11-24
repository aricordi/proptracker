// What creators ask the AI connector for that the app can't do yet (owner, Nov 24: "keep track of what the most requested
// features are without them having to be explicitly requested").
//
// Within OpenAI's data rules ("no tracking or profiling… unless explicitly disclosed, narrowly scoped, subject to meaningful
// user control"):
//   • ANONYMOUS: only a short cleaned summary and a count are kept (mcp_demand/{hash}); never a name, email, person id, or which
//     person asked. Nothing is linked to anyone, so it can't build a picture of a person.
//   • NARROW: three kinds only: a feature/service the app doesn't offer (the AI passes it on with note_feature_request and tells
//     the person), a prop searched for that the closet doesn't have, and questions the tools couldn't make sense of (which field).
//   • DISCLOSED + CONTROLLED: privacy policy section; More → ChatGPT & Claude → "Share anonymous suggestions" switch
//     (profiles/{email}.shareSuggestions = false turns it off, checked before every write). The reviewer demo account never writes.
//   • Deleted automatically a year after it was last seen (ttl).
import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from '../auth.js'
import { todayInStudio } from '../booking.js'
import type { McpUser } from './common.js'

export type DemandKind = 'feature' | 'prop_missing' | 'unclear'
export const DEMAND_KINDS: DemandKind[] = ['feature', 'prop_missing', 'unclear']

/** A short, anonymous summary: personal details stripped, lower case, ≤ 120 characters. Pure (unit-tested). */
export function cleanDemand(text: unknown): string {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')          // email addresses
    .replace(/https?:\/\/\S+/g, ' ')                        // links
    .replace(/\bp_[0-9a-f]{12}\b/gi, ' ')                   // person ids
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')                 // phone numbers and long numbers
    .replace(/@\w+/g, ' ')                                   // handles
    .replace(/[<>{}[\]\\`]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
}

async function sharing(u: McpUser) {
  if (u.reviewer) return false
  try { return (await db.doc(`profiles/${u.email}`).get()).get('shareSuggestions') !== false } catch { return false }
}

/** Count one anonymous signal. Never throws (it must never break the tool the person actually asked for). */
export async function noteDemand(u: McpUser, kind: DemandKind, text: unknown, tool = ''): Promise<boolean> {
  try {
    const t = cleanDemand(text)
    if (t.length < 3 || !(await sharing(u))) return false
    const id = createHash('sha1').update(`${kind}|${t}`).digest('hex').slice(0, 32)
    const day = todayInStudio()
    await db.doc(`mcp_demand/${id}`).set({
      kind, text: t, tool: String(tool).slice(0, 40), count: FieldValue.increment(1), last: day,
      ttl: Timestamp.fromMillis(Date.now() + 365 * 86400_000),
    }, { merge: true })
    return true
  } catch { return false }
}
