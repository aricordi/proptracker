// Screenshots of the real app for the training manuals (docs/manuals/img/*.png). Runs on the EMULATOR with test data:
//   npm run e2e -- --only shots      (add --no-build to reuse the last build)
// Each picture is taken on its own: one that fails is skipped and the rest still come out.
import { test, reseed, signIn, openTab, sheet, plainDayAhead, allowConsole, type Page } from '../helpers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/manuals/img')
const wait = (page: Page, ms = 900) => page.waitForTimeout(ms)
async function snap(page: Page, name: string, fn: () => Promise<void>) {
  try { await fn(); await wait(page); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name) }
  catch (e) { console.log('SKIPPED', name, String(e).slice(0, 160)) }
}
async function closeSheets(page: Page) { for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {}) }

test.beforeAll(() => reseed())
test.beforeEach(({ page }) => allowConsole(page, /.*/))

test('creator', async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, 'creator')
  await snap(page, 'c-chat-home', async () => { await page.goto('/') })
  await snap(page, 'c-chat-typed', async () => {
    const box = page.getByRole('textbox').last()
    await box.fill('is my shoot approved?'); await box.press('Enter'); await wait(page, 2500)
  })
  await snap(page, 'c-calendar', async () => { await openTab(page, 'Calendar') })
  const date = plainDayAhead(4)
  await snap(page, 'c-day-sheet', async () => {
    const heading = page.getByRole('heading', { level: 2 })
    await heading.first().waitFor()
    const btn = page.getByRole('button', { name: new RegExp(`^${date}:`) })
    if (!(await btn.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
    await btn.click()
  })
  // Free time (Nov 24): a free stretch → start/end → who's filming.
  await snap(page, 'c-book-1slot', async () => {
    await sheet(page).locator('[data-testid="free-gap"][data-house="cliff2"]').first().click()
    const ask = sheet(page, /Ask for|Book this/)
    await ask.waitFor()
    await ask.getByTestId('time-pick').getByRole('combobox').first().selectOption('795')
    await ask.getByTestId('time-pick').getByRole('combobox').nth(1).selectOption('915')
  })
  await snap(page, 'c-book-3slots', async () => {
    const ask = sheet(page, /Ask for|Book this/)
    await ask.getByTestId('time-pick').getByRole('combobox').first().selectOption('660')
    await ask.getByTestId('time-pick').getByRole('combobox').nth(1).selectOption('1020')
    const who = ask.getByTestId('who-films')
    await who.getByRole('button', { name: /\+ Add someone filming with you/ }).click()
    await who.getByPlaceholder('Search by name or channel').fill('Kyle')
    await who.getByRole('button', { name: /^Kyle/ }).first().click()
    await who.getByRole('button', { name: /\+ Add someone filming with you/ }).click()
    await who.getByPlaceholder('Search by name or channel').fill('Sam Guest')
    await who.getByRole('button', { name: /Add "Sam Guest"/ }).click()
  })
  await closeSheets(page)
  await snap(page, 'c-offsite', async () => {
    await page.goto('/schedule')
    const btn = page.getByRole('button', { name: new RegExp(`^${date}:`) })
    if (!(await btn.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
    await btn.click()
    await sheet(page).getByRole('button', { name: /Offsite/ }).first().click()
  })
  await closeSheets(page)
  await snap(page, 'c-my-shoots', async () => { await page.goto('/shoots') })
  await snap(page, 'c-shoot-sheet', async () => { await page.goto('/schedule?shoot=sh9'); await sheet(page).waitFor() })
  await closeSheets(page)
  await snap(page, 'c-props', async () => { await page.goto('/browse') })
  await snap(page, 'c-prop-page', async () => { await page.goto('/item/chairs') })
  await snap(page, 'c-prop-added', async () => {
    await page.getByRole('button', { name: /Add to (this|a) shoot/ }).first().click().catch(() => {})
    await wait(page, 800)
  })
  await snap(page, 'c-reserve', async () => { await page.goto('/reserve') })
  await snap(page, 'c-my-requests', async () => { await page.goto('/requests') })
  await snap(page, 'c-more', async () => { await page.goto('/account') })
  await snap(page, 'c-help', async () => { await page.goto('/help') })
  await snap(page, 'c-videos', async () => { await page.goto('/videos') })
  await snap(page, 'c-take-gear', async () => { await page.goto('/gear') })
})

test('new creator', async ({ page }) => {
  await signIn(page, 'newbie')
  await snap(page, 'c-chat-empty', async () => { await page.goto('/') })
})

test('arts', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, 'arts')
  await snap(page, 'a-home', async () => { await page.goto('/') })
  await snap(page, 'a-queue', async () => { await page.goto('/reservations') })
  await snap(page, 'a-request', async () => {
    await page.goto('/reservations')
    await page.locator('a[href^="/reservations/"]').first().click()
  })
  await snap(page, 'a-calendar', async () => { await page.goto('/calendar') })
  await snap(page, 'a-cleanup', async () => { await page.goto('/cleanup') })
  await snap(page, 'a-cleanup-check', async () => { await page.goto('/cleanup/check') })
  await snap(page, 'a-doubles', async () => { await page.goto('/cleanup/doubles'); await wait(page, 2500) })
  await snap(page, 'a-add', async () => { await page.goto('/add') })
  await snap(page, 'a-insights', async () => { await page.goto('/insights') })
  await snap(page, 'a-prop-menu', async () => { await page.goto('/item/phone'); await page.getByRole('button', { name: /More|⋯/ }).first().click() })
  await snap(page, 'a-bins', async () => { await page.goto('/bins') })
  await snap(page, 'a-admin', async () => { await page.goto('/admin') })
})

test('equipment', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, 'gear')
  await snap(page, 'e-requests', async () => { await page.goto('/approvals') })
  await snap(page, 'e-calendar-tab', async () => { await page.goto('/approvals?tab=calendar') })
  await snap(page, 'e-gear-log', async () => { await page.goto('/gear/bookings') })
  await snap(page, 'e-all-gear', async () => { await page.goto('/gear/items') })
  await snap(page, 'e-kits', async () => { await page.goto('/gear/bundles') })
  await snap(page, 'e-schedule', async () => { await page.goto('/schedule') })
  await snap(page, 'e-schedule-team', async () => { await page.goto('/schedule/team') })
  await snap(page, 'e-admin', async () => { await page.goto('/admin') })
})

test('admin', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, 'admin')
  await snap(page, 'd-dashboard', async () => { await page.goto('/') })
  await snap(page, 'd-analytics', async () => { await page.goto('/analytics') })
  await snap(page, 'd-flags', async () => { await page.goto('/analytics?tab=flags') })
  await snap(page, 'd-late', async () => { await page.goto('/analytics?tab=late') })
  await snap(page, 'd-person', async () => { await page.goto('/people/creator@example.com') })
  await snap(page, 'd-people', async () => { await page.goto('/users') })
  await snap(page, 'd-rules', async () => { await page.goto('/rules-sheet') })
  await snap(page, 'd-requests', async () => { await page.goto('/approvals') })
})
