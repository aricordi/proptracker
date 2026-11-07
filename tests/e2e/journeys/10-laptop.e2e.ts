// Journey 10 — the laptop layouts (1440×900): the equipment team's week board of requests,
// and the admin's Analytics with the list on the left and the report card on the right.
import { test, expect, reseed, signIn } from '../helpers'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })
test.beforeAll(() => reseed())

test('equipment team on a laptop: the Requests week board', async ({ page }) => {
  await signIn(page, 'gear')
  const sidebar = page.getByRole('complementary').first()
  await sidebar.getByRole('link', { name: /^Requests/ }).click()
  await expect(page).toHaveURL(/\/approvals/)

  await test.step('the week board fills the screen', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible()
    await expect(page.getByText('Requests waiting')).toBeVisible()
    // 7 days × 2 houses of 7 AM cells (a few may be blocked or booked).
    const cells = page.getByRole('button', { name: /· Cliff [12] · 7 AM–9 AM ·/ })
    await expect.poll(() => cells.count(), { message: 'free 7 AM cells on the week board' }).toBeGreaterThanOrEqual(10)
    await expect(page.getByText('Request waiting', { exact: true })).toBeVisible()   // the colour key
  })

  await test.step('the waiting queue and the inspector sit on the right', async () => {
    const side = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: /^Waiting \(\d+\)/ }) })
    await expect(side.getByRole('heading', { name: 'Waiting (2)' })).toBeVisible()
    await expect(side.getByRole('checkbox', { name: 'Tick Jana' })).toBeVisible()
    await expect(side.getByRole('button', { name: /^Approve/ })).toBeVisible()
    await expect(side.getByRole('button', { name: /^Deny/ })).toBeVisible()
  })

  await test.step('Month view switches in place', async () => {
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(page.getByRole('radiogroup', { name: 'Which house' })).toBeVisible()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page.getByText('Requests waiting')).toBeVisible()
  })
})

test('admin on a laptop: Analytics list on the left, report card on the right', async ({ page }) => {
  await signIn(page, 'admin')
  const sidebar = page.getByRole('complementary').first()
  await sidebar.getByRole('link', { name: 'Analytics', exact: true }).click()
  await expect(page).toHaveURL(/\/analytics/)
  await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Creators', selected: true })).toBeVisible()

  const panel = page.getByRole('complementary').filter({ hasText: /Click a creator on the left|Record ›/ })
  await expect(panel.getByText('Click a creator on the left: their report card opens here.')).toBeVisible()

  await page.getByRole('button', { name: /^\d+ Riley \(Creator\)/ }).click()
  await expect(panel.getByRole('button', { name: 'Record ›' })).toBeVisible()
  // The list stays on screen next to the report card.
  await expect(page.getByRole('button', { name: /^\d+ Kyle/ })).toBeVisible()
})
