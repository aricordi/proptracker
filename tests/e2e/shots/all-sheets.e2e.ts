// The pop-up sheets (booking, offsite, move, swap, cancel, report a problem, team actions…): pictures for a design review.
//   npm run e2e -- --only shots --grep "all sheets"     → .e2e/screens/sheets/<name>.png
import { test, reseed, signIn, allowConsole, plainDayAhead, type Page } from '../helpers'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.e2e/screens/sheets')
fs.mkdirSync(out, { recursive: true })
async function snap(page: Page, name: string, fn: () => Promise<void>) {
  try { await fn(); await page.waitForTimeout(900); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name) }
  catch (e) { console.log('SKIP', name, String(e).slice(0, 120)) }
}
const esc = async (page: Page) => { for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {}) }
async function openDay(page: Page, date: string) {
  await page.goto('/schedule')
  const btn = page.getByRole('button', { name: new RegExp(`^${date}:`) })
  await page.waitForTimeout(1500)
  if (!(await btn.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
  await btn.click()
}
const click = (page: Page, re: RegExp) => page.getByRole('button', { name: re }).first().click({ timeout: 6000 })

test.beforeAll(() => reseed())
test.beforeEach(({ page }) => allowConsole(page, /.*/))

test('all sheets creator', async ({ page }) => {
  test.setTimeout(600_000)
  await signIn(page, 'creator')
  const d = plainDayAhead(4)
  await snap(page, 'c-day', async () => { await openDay(page, d) })
  await snap(page, 'c-book', async () => { await page.getByRole('dialog').getByRole('button', { name: /Free/ }).first().click() })
  await snap(page, 'c-book-3', async () => { await click(page, /3 slots/) })
  await snap(page, 'c-book-both', async () => { await click(page, /1 slot/); await page.getByText(/both houses/i).first().click() })
  await esc(page)
  await snap(page, 'c-offsite', async () => { await openDay(page, d); await click(page, /Offsite/) })
  await esc(page)
  await snap(page, 'c-shoot', async () => { await page.goto('/schedule?shoot=sh9') })
  await snap(page, 'c-shoot-end', async () => { await page.getByRole('dialog').evaluate(el => { const sc = el.querySelector('.overflow-y-auto') ?? el; sc.scrollTop = 99999 }) })
  await snap(page, 'c-move', async () => { await click(page, /^Move/) })
  await esc(page)
  await snap(page, 'c-swap', async () => { await page.goto('/schedule?shoot=sh9'); await click(page, /Swap/) })
  await esc(page)
  await snap(page, 'c-cancel', async () => { await page.goto('/schedule?shoot=sh9'); await click(page, /^Cancel/) })
  await esc(page)
  await snap(page, 'c-invite', async () => { await page.goto('/schedule?shoot=sh9&cast=1') })
  await esc(page)
  await snap(page, 'c-report', async () => { await page.goto('/account'); await click(page, /Report a problem/); await page.waitForTimeout(600); await click(page, /Report this screen/) })
  await esc(page)
  await snap(page, 'c-add-to-shoot', async () => { await page.goto('/item/chairs'); await click(page, /Add to/) })
  await esc(page)
  await snap(page, 'c-status', async () => { await page.goto('/browse'); await click(page, /^Status/) })
  await esc(page)
  await snap(page, 'c-shoot-picker', async () => { await page.goto('/browse'); await page.locator('button:has-text("PM")').first().click() })
  await esc(page)
  await snap(page, 'c-chat-time', async () => { await page.goto('/'); const b = page.getByRole('textbox').last(); await b.fill('saturday at cliff 2'); await b.press('Enter'); await page.waitForTimeout(3000) })
  await snap(page, 'c-chat-cancel', async () => { const b = page.getByRole('textbox').last(); await b.fill('cancel my next shoot'); await b.press('Enter'); await page.waitForTimeout(3000) })
  await snap(page, 'c-calendar-feed', async () => { await page.goto('/schedule'); await click(page, /phone's calendar/) })
})

test('all sheets gear', async ({ page }) => {
  test.setTimeout(600_000)
  await signIn(page, 'gear')
  const d = plainDayAhead(4)
  await snap(page, 'e-day', async () => { await openDay(page, d) })
  await snap(page, 'e-team-slot', async () => { await page.getByRole('dialog').getByRole('button', { name: /Free/ }).first().click() })
  await esc(page)
  await snap(page, 'e-booking-card', async () => { await page.goto('/schedule?shoot=sh9') })
  await snap(page, 'e-team-move', async () => { await click(page, /Move to another/) })
  await esc(page)
  await snap(page, 'e-team-swap', async () => { await page.goto('/schedule?shoot=sh9'); await click(page, /Swap with another/) })
  await esc(page)
  await snap(page, 'e-priority', async () => { await page.goto('/schedule?shoot=sh9'); await click(page, /Priority booking/) })
  await esc(page)
  await snap(page, 'e-team-cancel', async () => { await page.goto('/schedule?shoot=sh9'); await click(page, /Cancel their shoot|^Cancel/) })
  await esc(page)
  await snap(page, 'e-approvals-day', async () => { await page.goto('/approvals'); await page.waitForTimeout(1500); await page.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}:/ }).nth(3).click() })
  await esc(page)
  await snap(page, 'e-deny', async () => { await page.goto('/approvals'); await click(page, /^Deny/) })
  await esc(page)
  await snap(page, 'e-gear-item', async () => { await page.goto('/gear/items'); await page.locator('button:has-text("loose"), button:has-text("bookable"), li button').first().click() })
  await esc(page)
  await snap(page, 'e-add-gear', async () => { await page.goto('/gear/items'); await click(page, /Add gear/) })
})

test('all sheets arts', async ({ page }) => {
  test.setTimeout(600_000)
  await signIn(page, 'arts')
  await snap(page, 'a-prop-menu', async () => { await page.goto('/item/phone'); await click(page, /More|⋯/) })
  await snap(page, 'a-dupes', async () => { await click(page, /Find duplicates/) })
  await esc(page)
  await snap(page, 'a-remove', async () => { await page.goto('/item/phone'); await click(page, /More|⋯/); await click(page, /Remove this prop/) })
  await esc(page)
  await snap(page, 'a-quick-edit', async () => { await page.goto('/cleanup/bin/none'); await page.locator('main button img, button img').first().click() })
  await esc(page)
  await snap(page, 'a-request', async () => { await page.goto('/reservations?tab=done'); await page.locator('a[href^="/reservations/"]').first().click() })
  await snap(page, 'a-zoom', async () => { await page.goto('/item/chairs'); await page.locator('main img').first().click() })
})
