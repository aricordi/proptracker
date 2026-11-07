// Shared bits for the robot tests: sign in with the emulator's test buttons, fresh test data, studio dates,
// a test photo, and a watch on every page for crashes and console errors (any test fails if the app logs one).
import { test as base, expect, type Page, type Locator, type ConsoleMessage } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// The "Test mode: sign in as" buttons on the login page (src/screens/LoginScreen.tsx TEST_ACCOUNTS).
export const ROLES = {
  owner: 'Owner',
  arts: 'Arts department',
  creator: 'Creator',                     // Riley, Full app, has shoots
  kyle: 'Kyle (creator)',                 // Kyle, books without approval
  newbie: 'New creator (first day)',      // Nia, Full app, nothing booked yet
  demo: 'Creator on Props only (demo)',   // Dee, Props only
  gear: 'Equipment team',
  admin: 'Admin',
} as const
export type RoleKey = keyof typeof ROLES

// Fresh test data (wipes the EMULATOR database, never the live one). Each journey file calls this first.
export function reseed() {
  execFileSync('node', [path.join(root, 'scripts/seed-emulator.mjs'), '--reset'], { cwd: root, stdio: 'pipe' })
}

// Console messages that aren't the app's fault (dev-only library notices, the emulator, the browser itself).
const NOISE = [
  /React Router Future Flag Warning/i,
  /Download the React DevTools/i,
  /favicon/i,
  /service ?worker/i,
  // The browser's own line for any refused request (e.g. a server function saying no on purpose). A real failure shows
  // on screen and fails the test's own checks; a server crash (5xx) is still reported.
  /Failed to load resource: the server responded with a status of 4\d\d/i,
  /\[vite\]/i,
  /emulator/i,
  /WebChannelConnection RPC 'Listen' stream .* transport errored/i,      // Firestore reconnect chatter when a test ends
  /net::ERR_ABORTED/i,
  /ResizeObserver loop/i,
]
export interface Problems { list: string[] }

function watch(page: Page, problems: Problems) {
  page.on('pageerror', e => problems.list.push(`Page crashed: ${e.message}`))
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (NOISE.some(r => r.test(text))) return
    problems.list.push(`Console error: ${text.slice(0, 500)}`)
  })
}

// `test` with a page that is watched: the test fails at the end if the page crashed or logged a console error.
// Tests that expect an error on purpose can call `allowConsole(page, /pattern/)`.
const allowed = new WeakMap<Page, RegExp[]>()
export function allowConsole(page: Page, ...patterns: RegExp[]) {
  allowed.set(page, [...(allowed.get(page) ?? []), ...patterns])
}
export const test = base.extend<{ problems: Problems }>({
  problems: [async ({ page }, use, testInfo) => {
    const problems: Problems = { list: [] }
    watch(page, problems)
    await use(problems)
    const ok = allowed.get(page) ?? []
    const real = problems.list.filter(p => !ok.some(r => r.test(p)))
    if (real.length && testInfo.status === testInfo.expectedStatus) {
      throw new Error(`The app reported problems during this test:\n- ${real.join('\n- ')}`)
    }
  }, { auto: true }],
})
export { expect }

// Sign in with a test button, then get past a staff member's one-time welcome (team guide or short tour).
export async function signIn(page: Page, role: RoleKey) {
  await page.goto('/')
  await page.getByRole('button', { name: ROLES[role], exact: true }).click()
  await afterSignIn(page)
}
export async function afterSignIn(page: Page) {
  // Phone: the bottom tab bar (navigation). Laptop: the sidebar (complementary).
  const nav = page.getByRole('navigation').or(page.getByRole('complementary')).first()
  const skip = page.getByRole('button', { name: 'Skip for now' })
  const gotIt = page.getByRole('button', { name: 'Got it' })
  await expect(nav.or(skip).or(gotIt).first()).toBeVisible({ timeout: 30_000 })
  if (await skip.isVisible()) await skip.click()
  else if (await gotIt.isVisible()) await gotIt.click()
  await expect(nav).toBeVisible()
}

// The bottom tab bar (phone) or the sidebar (laptop).
export const tabs = (page: Page) => page.getByRole('navigation').first()
export async function openTab(page: Page, name: string | RegExp) {
  await tabs(page).getByRole('link', { name }).click()
}

// Dates the way the studio counts them (Toronto), as YYYY-MM-DD.
export function studioDate(offsetDays = 0, from = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date(from.getTime() + offsetDays * 86_400_000))
}
export function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay()   // 0 = Sunday … 6 = Saturday
}
// The next day at least `minDays` away that isn't a Cliff 1 priority day (Thursday/Saturday) or a Sunday.
export function plainDayAhead(minDays: number, avoid: number[] = [0, 4, 6]) {
  for (let d = minDays; d < minDays + 14; d++) {
    const date = studioDate(d)
    if (!avoid.includes(weekdayOf(date))) return date
  }
  throw new Error('no plain day found')
}

// A real (small) photo for file inputs: the app shrinks and uploads it like a phone picture.
let photo: Buffer | null = null
export function testPhoto(name = 'photo.png') {
  if (!photo) {
    const png = new PNG({ width: 320, height: 240 })
    for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
      const i = (y * 320 + x) * 4
      png.data[i] = (x * 255 / 320) | 0; png.data[i + 1] = (y * 255 / 240) | 0; png.data[i + 2] = 150; png.data[i + 3] = 255
    }
    photo = PNG.sync.write(png)
  }
  return { name, mimeType: 'image/png', buffer: photo }
}

// The bottom sheet / dialog that's open right now.
export const sheet = (page: Page, name?: string | RegExp) => name ? page.getByRole('dialog', { name }) : page.getByRole('dialog').last()

// A row of the day sheet ("3 PM" → its Cliff 1 and Cliff 2 cells).
export function slotRow(scope: Locator, time: string) {
  return scope.getByText(time, { exact: true }).locator('xpath=..')
}

// Write one document straight into the EMULATOR database (test setup only, like scripts/seed-emulator.mjs does).
type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain }
function toValue(v: Plain): unknown {
  if (v === null) return { nullValue: null }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } }
  return { stringValue: String(v) }
}
export async function putDoc(docPath: string, data: Record<string, Plain>) {
  const url = `http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/${docPath}`
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) })
  if (!res.ok) throw new Error(`${docPath}: ${res.status} ${await res.text()}`)
}
