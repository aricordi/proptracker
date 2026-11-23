// Every screen, for every role, on a phone (and the team's laptop view): pictures for a design review (not a test).
//   npm run e2e -- --only shots --grep "all screens"     → .e2e/screens/<role>/<route>.png
import { test, reseed, signIn, allowConsole, type Page, type RoleKey } from '../helpers'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.e2e/screens')
const LIST = ['/', '/schedule', '/browse', '/account', '/help', '/shoots', '/requests', '/videos', '/gear', '/reserve', '/return',
  '/schedule/how', '/team-guide', '/admin', '/approvals', '/approvals?tab=calendar', '/reservations', '/calendar', '/gear/bookings',
  '/gear/items', '/gear/bundles', '/gear/bundles/new', '/schedule/team', '/schedule/settings', '/schedule/import', '/schedule/calendar',
  '/analytics', '/analytics?tab=flags', '/analytics?tab=teams', '/analytics?tab=late', '/analytics?tab=trends', '/analytics?view=table',
  '/creators', '/users', '/rules-sheet', '/booking-rules', '/insights', '/cleanup', '/cleanup/check', '/cleanup/list', '/cleanup/doubles',
  '/cleanup/bins', '/cleanup/bin/none', '/cleanup/approve', '/cleanup/place', '/cleanup/names', '/cleanup/removed', '/add', '/bins',
  '/locations', '/categories', '/health', '/duplicates', '/suggestions', '/activity', '/import', '/connections', '/email', '/ai', '/costs',
  '/bugs', '/personal', '/item/chairs', '/item/cop/edit', '/bin/bin-a1', '/people/creator@example.com', '/gear/take', '/not-a-page']
// Detail pages reached by tapping the first item in a list.
const DETAILS: [string, string][] = [['/reservations', 'a[href^="/reservations/"]'], ['/gear/bookings', 'a[href^="/gear/bookings/"]'],
  ['/gear/bundles', 'a[href^="/gear/bundles/"]:not([href$="/new"])'], ['/gear', 'a[href^="/gear/b/"]'], ['/import', 'a[href^="/import/"]']]

const slug = (r: string) => (r === '/' ? 'home' : r.replace(/^\//, '').replace(/[/?=&]+/g, '_'))
async function shoot(page: Page, dir: string, name: string) {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
  const scrolled = await page.evaluate(() => {
    const els = [document.scrollingElement, document.getElementById('root'), ...Array.from(document.querySelectorAll('main, .overflow-y-auto'))]
    for (const el of els) if (el && el.scrollHeight > el.clientHeight + 200) { el.scrollTop = el.scrollHeight; return true }
    return false
  })
  if (scrolled) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(dir, `${name}~end.png`) }) }
}
async function crawl(page: Page, role: RoleKey, tag = '') {
  const dir = path.join(out, role + tag); fs.mkdirSync(dir, { recursive: true })
  await signIn(page, role)
  const seen = new Set<string>()
  for (const r of LIST) {
    try {
      await page.goto(r)
      const at = new URL(page.url()); const key = at.pathname + at.search
      if (seen.has(key) && r !== '/not-a-page') continue
      seen.add(key); await shoot(page, dir, slug(r))
    } catch (e) { console.log('SKIP', role, r, String(e).slice(0, 80)) }
  }
  for (const [list, sel] of DETAILS) {
    try {
      await page.goto(list); const a = page.locator(sel).first(); await a.waitFor({ timeout: 5000 })
      await a.click()
      const key = new URL(page.url()).pathname; if (seen.has(key)) continue; seen.add(key)
      await shoot(page, dir, slug(key))
    } catch { /* not reachable for this role */ }
  }
  console.log('done', role + tag, seen.size)
}

test.beforeAll(() => reseed())
test.beforeEach(({ page }) => allowConsole(page, /.*/))
for (const role of ['creator', 'newbie', 'demo', 'arts', 'gear', 'admin', 'owner'] as RoleKey[]) {
  test(`all screens ${role}`, async ({ page }) => { test.setTimeout(900_000); await crawl(page, role) })
}
for (const role of ['gear', 'admin', 'owner'] as RoleKey[]) {
  test(`all screens ${role} laptop`, async ({ page }) => {
    test.setTimeout(900_000); await page.setViewportSize({ width: 1440, height: 900 }); await crawl(page, role, '-laptop')
  })
}
