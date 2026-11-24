// What creators ask the AI connector for that the app can't do yet (owner, Nov 24: "keep track of what the most requested
// features are without them having to be explicitly requested").
//
// Within OpenAI's data rules ("no tracking or profiling… unless explicitly disclosed, narrowly scoped, subject to meaningful
// user control"):
//   • ANONYMOUS: only a short cleaned summary and a count are kept (mcp_demand/{hash}); never a name, email, person id, or which
//     person asked. Nothing is linked to anyone, so it can't build a picture of a person.
//   • NARROW + ASKED FIRST (final compliance review, Nov 24): only what the person agreed to pass on with note_feature_request
//     (a feature/service, or a prop/costume/gear the studio doesn't have). Nothing is counted quietly in the background.
//   • DISCLOSED + CONTROLLED: privacy policy section; More → ChatGPT & Claude → "Share anonymous suggestions" switch, stored
//     privately in connector_prefs/{email} (only that person can read or change it), checked before every write.
//     The reviewer demo account never writes.
//   • Names of people who film are removed from the text and only the MONTH is kept, so a suggestion can't be traced back.
//   • Deleted automatically a year after it was last seen (ttl).
import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from '../auth.js'
import { todayInStudio } from '../booking.js'
import { filmingPeople } from '../scheduling.js'
import type { McpUser } from './common.js'

export type DemandKind = 'feature' | 'prop_missing'
export const DEMAND_KINDS: DemandKind[] = ['feature', 'prop_missing']

/** A short, anonymous summary: personal details stripped, lower case, ≤ 120 characters. Pure (unit-tested). */
export function cleanDemand(text: unknown, names: string[] = []): string {
  let out = String(text ?? '')
  // People's names (first names and full names of everyone who films, the caller included) never stay in the text.
  for (const n of names.flatMap(x => [x, ...String(x).split(/\s+/)]).map(x => x.trim()).filter(x => x.length >= 2).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?\\b`, 'gi'), ' ')
  }
  return out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')          // email addresses
    .replace(/https?:\/\/\S+/g, ' ')                        // links
    .replace(/\bp_[0-9a-f]{12}\b/gi, ' ')                   // person ids
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')                 // phone numbers and long numbers
    .replace(/@\w+/g, ' ')                                   // handles
    .replace(/[<>{}[\]\\`]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
}

async function sharing(u: McpUser) {
  if (u.reviewer || u.practice) return false
  try { return (await db.doc(`connector_prefs/${u.email}`).get()).get('shareSuggestions') !== false } catch { return false }
}

/** Count one anonymous signal. Never throws (it must never break the tool the person actually asked for). */
export async function noteDemand(u: McpUser, kind: DemandKind, text: unknown, tool = ''): Promise<boolean> {
  try {
    if (!(await sharing(u))) return false
    const people = await filmingPeople({ includeDemo: true, offApp: true }).catch(() => [] as { name: string }[])
    const t = cleanDemand(text, [u.name, ...people.map(p => p.name)])
    if (t.replace(/[^a-z0-9]/g, '').length < 3) return false
    const id = createHash('sha1').update(`${kind}|${t}`).digest('hex').slice(0, 32)
    const month = todayInStudio().slice(0, 7)
    await db.doc(`mcp_demand/${id}`).set({
      kind, text: t, tool: String(tool).slice(0, 40), count: FieldValue.increment(1), last: month,
      ttl: Timestamp.fromMillis(Date.now() + 365 * 86400_000),
    }, { merge: true })
    return true
  } catch { return false }
}
