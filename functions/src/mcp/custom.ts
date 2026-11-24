// Custom props through the connector (owner, Nov 24): the assistant helps fill in the request (what, how many, an optional
// reference picture it made with the person) and sends it; it never gives a date. The arts department follows up separately.
import { s, type Json, type McpUser } from './common.js'
import { saveRefImage } from './refImage.js'
const APP_LINK = 'https://proptracker.arbcreative.co'
// Custom props (owner, Nov 24): the assistant only helps fill in the request; it never gives a date.
export const CUSTOM_NOTE = 'Custom props have no guaranteed date: the arts department will contact them separately (e.g. on Slack) about details and timing. Don\'t promise a date.'
/** The reference picture (ChatGPT's file or a link) saved to the creator's folder and put on the right custom prop. */
export async function attachRefImage(args: Json, builds: { description: string; qty: number; refPhoto?: string }[], u: McpUser): Promise<{ builds: typeof builds } | { problem: string }> {
  if (!args.reference_image) return { builds }
  if (!builds.length) return { problem: 'A reference picture goes with a custom prop: add the custom prop (what it is, how many) too.' }
  if (u.reviewer || u.practice) return { builds: builds.map((b, i) => i === 0 ? { ...b, refPhoto: 'demo' } : b) }
  const saved = await saveRefImage(args.reference_image, u.email)
  if ('problem' in saved) return { problem: `Couldn't attach the picture (${saved.problem}). Send the request without it, or attach the picture in the app: ${APP_LINK}/requests` }
  const want = s(args.reference_for, 200).toLowerCase()
  let at = want ? builds.findIndex(b => b.description.toLowerCase().includes(want) || want.includes(b.description.toLowerCase())) : 0
  if (at < 0) at = 0
  return { builds: builds.map((b, i) => i === at ? { ...b, refPhoto: saved.url } : b) }
}
