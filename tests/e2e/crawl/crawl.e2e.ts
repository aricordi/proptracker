// Journey 11 — the crawl: for every role, visit every screen in src/App.tsx (ids filled in from the test data)
// and fail on a crash, a console error or a blank screen. Screens a role can't use simply redirect; that's fine.
// The route list is read from App.tsx each run, so new screens are crawled automatically.
import { test, expect, signIn, allowConsole, ROLES, type RoleKey } from '../helpers'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// Ids from scripts/seed-emulator.mjs (and scripts/test-gear.json) for routes that need one.
const IDS: Record<string, string[]> = {
  ':qrSlug': ['bin-a1'],
  ':id': [],               // depends on the route, see below
  ':email': ['creator@example.com'],
}
const BY_ROUTE: Record<string, string[]> = {
  '/item/:id': ['/item/phone', '/item/cop', '/item/legacy-skull'],
  '/item/:id/edit': ['/item/phone/edit'],
  '/reservations/:id': ['/reservations/rs1', '/reservations/rs5'],
  '/gear/bundles/:id': ['/gear/bundles/tb-fx3', '/gear/bundles/new'],
  '/gear/b/:id': ['/gear/b/tb-fx3'],
  '/cleanup/bin/:id': ['/cleanup/bin/bin-a1', '/cleanup/bin/none'],
  '/gear/bookings/:id': ['/gear/bookings/gb1'],     // Kyle's finished FX3 kit booking (emulator-only seed)
  '/import/:jobId': ['/import/imp-job1'],           // a finished photo import (emulator-only seed)
}
// Routes with an id the test data doesn't have.
const SKIPPED: string[] = []

function routes(): { list: string[]; skipped: string[] } {
  const src = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  const found = [...new Set([...src.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]))].filter(p => p !== '*')
  const list: string[] = []
  const skipped: string[] = []
  for (const p of found) {
    if (!p.includes(':')) { list.push(p); continue }
    if (BY_ROUTE[p]) { list.push(...BY_ROUTE[p]); continue }
    const param = p.match(/:[A-Za-z]+/)![0]
    const ids = IDS[param] ?? []
    if (!ids.length || SKIPPED.includes(p)) { skipped.push(p); continue }
    list.push(...ids.map(id => p.replace(param, encodeURIComponent(id))))
  }
  // A few extra states of the same screens (query strings the app uses).
  list.push('/analytics?tab=flags', '/analytics?tab=teams', '/analytics?tab=trends', '/analytics?tab=late', '/analytics?view=table',
    '/approvals?tab=calendar', '/schedule?shoot=sh9', '/browse?q=phone', '/return?ref=props:rs1')
  return { list, skipped }
}

const { list: ROUTES, skipped: SKIPPED_ROUTES } = routes()

// Move around inside the app the way a tap on a link does (no full reload), so each screen mounts fresh.
async function go(page: import('@playwright/test').Page, to: string) {
  await page.evaluate(p => {
    window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2), idx: window.history.length }, '', p)
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  }, to)
}

// Roles run side by side (each in its own browser); the crawl only looks, it doesn't change data.
test.describe.configure({ mode: 'parallel' })

for (const role of Object.keys(ROLES) as RoleKey[]) {
  test(`crawl every screen as ${ROLES[role]}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    allowConsole(page, /.*/)   // this test reports problems per screen itself (below)
    const problems: string[] = []
    let where = 'sign-in'
    page.on('pageerror', e => problems.push(`${where}: page crashed: ${e.message}`))
    page.on('console', m => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (/React Router Future Flag|favicon|Download the React DevTools|net::ERR_ABORTED|ResizeObserver loop/i.test(t)) return
      // The browser's own line for a refused request: the response itself is checked below (refusals are noted, crashes fail).
      if (/Failed to load resource: the server responded with a status of 4\d\d/i.test(t)) return
      problems.push(`${where}: console error: ${t.slice(0, 300)}`)
    })
    const refused: string[] = []
    page.on('response', async r => {
      // Server functions: a crash (5xx) is a problem; a refusal (4xx: "not allowed", "set this up first") is only noted.
      const fn = r.url().match(/:5001\/[^/]+\/[^/]+\/([A-Za-z]+)/)?.[1]
      if (fn && r.status() >= 400) {
        const at = where
        const why = await r.json().then((j: { error?: { message?: string } }) => j?.error?.message ?? '', () => '')
        if (r.status() >= 500) problems.push(`${at}: server function ${fn} failed (${r.status()}) ${why}`)
        else refused.push(`${at}: ${fn} → ${r.status()} ${why}`)
      } else if (!fn && r.status() >= 500) problems.push(`${where}: ${r.status()} for ${r.url().slice(0, 120)}`)
      else if (!fn && r.status() >= 400) refused.push(`${where}: ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '').slice(0, 120)}`)
    })
    page.on('response', r => {
      // Our own files (the app's code) must never 404; other 404s (e.g. a missing photo) are only noted.
      if (r.status() >= 400 && r.url().startsWith(process.env.E2E_BASE_URL ?? 'http://127.0.0.1') && /\.(js|css)(\?|$)/.test(r.url())) {
        problems.push(`${where}: ${r.status()} for ${r.url()}`)
      }
    })

    await signIn(page, role)
    const blank: string[] = []
    const landed: string[] = []
    for (const route of ROUTES) {
      where = route
      await go(page, route)
      // Not blank: something readable on screen within a few seconds (a lazy screen that fails to load stays blank).
      // The tab bar stays while a screen loads, so look at the page area (<main>) when there is one.
      const ok = await page.waitForFunction(() => {
        const area = document.querySelector('main') ?? document.getElementById('root')
        return (area?.textContent?.trim().length ?? 0) > 0
      }, null, { timeout: 8000 })
        .then(() => true, () => false)
      if (!ok) blank.push(route)
      // Give listeners a moment to report errors (permission problems arrive after the first paint).
      await page.waitForTimeout(400)
      const now = new URL(page.url()).pathname + new URL(page.url()).search
      if (now !== route) landed.push(`${route} → ${now}`)
      // Close anything a screen opened on its own (e.g. a sheet) so the next screen starts clean.
      await page.keyboard.press('Escape').catch(() => {})
    }
    testInfo.annotations.push({ type: 'routes', description: `${ROUTES.length} visited, skipped (no test data): ${SKIPPED_ROUTES.join(', ') || 'none'}` })
    if (landed.length) testInfo.annotations.push({ type: 'redirects', description: landed.join(' | ') })
    if (refused.length) testInfo.annotations.push({ type: 'refused by the server (expected or worth a look)', description: [...new Set(refused)].join(' | ') })
    expect(blank, `Blank screens as ${ROLES[role]}`).toEqual([])
    expect(problems, `Problems as ${ROLES[role]}`).toEqual([])
  })
}
