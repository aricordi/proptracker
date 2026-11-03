// Pure check (no Firebase), shared by practice.ts and gemini.ts: are these server functions running on the PRACTICE site?
// Needs PRACTICE=1 (written into functions/.env.<project> only by the "Practice site" button) AND a project that isn't the
// live one, so the live app can never switch into practice behaviour, even by mistake.
export const LIVE_PROJECT = 'proptracker-9732e'
export function isPractice(env: Record<string, string | undefined> = process.env) {
  const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || ''
  return env.PRACTICE === '1' && !!project && project !== LIVE_PROJECT
}
